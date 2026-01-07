import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { v4 as uuidv4 } from 'uuid';
import {
  createImageGeneratorFromEnv,
  buildDTGPrompt,
  buildAvoidanceGuidance,
  requestsSolidBackground,
  removeWhiteBackgroundBatch,
  type ImageGenerator,
} from '../services/image-generation';
import {
  uploadImage,
  buildTempImageKey,
  buildCdnUrl,
} from '../services/storage/s3';
import {
  updateRequestStatus,
  createImage,
} from '../services/storage/dynamo';
import { getSecretValue } from '../services/storage/secrets';
import {
  postMessage,
  respondToWebhook,
  buildGeneratedImagesMessage,
  buildGenerationFailedMessage,
} from '../services/slack';
import { GenerationJobMessageSchema } from '../types/domain.types';
import type { GeneratedImage } from '../types/domain.types';
import type { GeneratedImageInfo } from '../services/slack/messages';

// Cached image generator instance
let imageGenerator: ImageGenerator | null = null;

const logger = new Logger({ serviceName: 't-shirt-generator', logLevel: 'INFO' });

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      await processGenerationJob(record.body);
    } catch (error) {
      logger.error('Failed to process generation job', {
        error,
        messageId: record.messageId,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

const processGenerationJob = async (messageBody: string): Promise<void> => {
  // Parse and validate message
  const message = JSON.parse(messageBody) as unknown;
  const parseResult = GenerationJobMessageSchema.safeParse(message);

  if (!parseResult.success) {
    logger.error('Invalid generation job message', {
      errors: parseResult.error.issues,
    });
    throw new Error('Invalid message format');
  }

  const { requestId, userId: _userId, channelId, prompt, responseUrl } = parseResult.data;

  logger.info('Processing generation job', { requestId, prompt });

  // Get configuration
  const imagesBucket = process.env.IMAGES_BUCKET;
  const imagesCdnDomain = process.env.IMAGES_CDN_DOMAIN;
  const requestsTable = process.env.REQUESTS_TABLE;
  const imagesTable = process.env.IMAGES_TABLE;
  const botTokenArn = process.env.SLACK_BOT_TOKEN_ARN;

  if (!imagesBucket || !imagesCdnDomain || !requestsTable || !imagesTable || !botTokenArn) {
    throw new Error('Missing required environment variables');
  }

  // Get Slack bot token
  const botToken = await getSecretValue(botTokenArn);

  // Initialize image generator (cached across invocations)
  if (!imageGenerator) {
    imageGenerator = await createImageGeneratorFromEnv(getSecretValue);
    logger.info('Image generator initialized', {
      provider: imageGenerator.getProvider(),
      model: imageGenerator.getModel(),
    });
  }

  // Update request status to generating
  await updateRequestStatus({
    tableName: requestsTable,
    requestId,
    status: 'generating',
  });

  try {
    // Build DTG-optimized prompt using narrative description style
    const enhancedPrompt = buildDTGPrompt(prompt);
    const avoidanceGuidance = buildAvoidanceGuidance(prompt);

    logger.info('Enhanced prompt for DTG printing', {
      original: prompt,
      enhanced: enhancedPrompt,
      avoidanceGuidance,
    });

    // Generate images using the configured provider
    // Using 4:5 aspect ratio to match DTG print area (4500x5100 at 300dpi)
    const generationResult = await imageGenerator.generate({
      prompt: enhancedPrompt,
      negativePrompt: avoidanceGuidance,
      imageCount: 3,
      aspectRatio: '4:5',
      cfgScale: 8.0,
    });

    logger.info('Images generated', {
      count: generationResult.images.length,
      model: generationResult.model,
    });

    // Post-process images to add true transparency if needed
    // AI models render checkered patterns instead of true alpha, so we generate
    // on solid white background and remove it here
    let processedImages = generationResult.images;

    if (!requestsSolidBackground(prompt)) {
      logger.info('Removing white backgrounds for transparency');
      processedImages = await removeWhiteBackgroundBatch(generationResult.images);
      logger.info('Background removal complete', {
        count: processedImages.length,
      });
    }

    // Upload images to S3 and create records
    const imageInfos: GeneratedImageInfo[] = [];
    const now = new Date().toISOString();

    const uploadPromises = processedImages.map(async (imageBuffer, index) => {
      const imageId = uuidv4();
      const s3Key = buildTempImageKey(requestId, imageId);

      // Upload to S3
      await uploadImage({
        bucket: imagesBucket,
        key: s3Key,
        imageBuffer,
      });

      // Create image record
      const imageRecord: GeneratedImage = {
        imageId,
        requestId,
        s3Key,
        status: 'generated',
        createdAt: now,
      };

      await createImage({
        tableName: imagesTable,
        image: imageRecord,
      });

      // Build CDN URL for display in Slack (permanent, doesn't expire)
      const imageUrl = buildCdnUrl(imagesCdnDomain, s3Key);

      return {
        imageId,
        imageUrl,
        index,
      };
    });

    const uploadResults = await Promise.all(uploadPromises);
    imageInfos.push(...uploadResults);

    // Sort by index to maintain order
    imageInfos.sort((a, b) => a.index - b.index);

    // Build and post message to Slack
    const blocks = buildGeneratedImagesMessage(prompt, imageInfos, requestId);

    await postMessage({
      token: botToken,
      channel: channelId,
      text: `Generated images for: ${prompt}`,
      blocks,
    });

    // Update request status to completed
    await updateRequestStatus({
      tableName: requestsTable,
      requestId,
      status: 'completed',
    });

    logger.info('Generation job completed', { requestId });
  } catch (error) {
    logger.error('Generation failed', { error, requestId });

    // Update request status to failed
    await updateRequestStatus({
      tableName: requestsTable,
      requestId,
      status: 'failed',
    });

    // Notify user of failure
    const errorMessage =
      error instanceof Error ? error.message : 'Unknown error occurred';

    try {
      await respondToWebhook(responseUrl, {
        response_type: 'ephemeral',
        blocks: buildGenerationFailedMessage(errorMessage),
      });
    } catch (webhookError) {
      logger.error('Failed to send error notification', { webhookError });
    }

    throw error;
  }
};

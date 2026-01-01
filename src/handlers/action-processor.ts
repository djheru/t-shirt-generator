import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import {
  copyImage,
  buildSavedImageKey,
  buildCdnUrl,
} from '../services/storage/s3';
import {
  getImage,
  getImagesByRequest,
  getRequest,
  updateImageStatus,
  updateImageS3Key,
  createRequest,
} from '../services/storage/dynamo';
import {
  respondToWebhook,
  buildRegeneratingMessage,
  buildUpdatedImagesMessage,
  type ImageWithStatus,
} from '../services/slack';
import { ActionJobMessageSchema } from '../types/domain.types';
import type { GenerationRequest, GenerationJobMessage } from '../types/domain.types';

const logger = new Logger({ serviceName: 't-shirt-generator', logLevel: 'INFO' });

let sqsClient: SQSClient | null = null;

const getSQSClient = (): SQSClient => {
  if (!sqsClient) {
    sqsClient = new SQSClient({});
  }
  return sqsClient;
};

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      await processActionJob(record.body);
    } catch (error) {
      logger.error('Failed to process action job', {
        error,
        messageId: record.messageId,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

const processActionJob = async (messageBody: string): Promise<void> => {
  // Parse and validate message
  const message = JSON.parse(messageBody) as unknown;
  const parseResult = ActionJobMessageSchema.safeParse(message);

  if (!parseResult.success) {
    logger.error('Invalid action job message', {
      errors: parseResult.error.issues,
    });
    throw new Error('Invalid message format');
  }

  const { action, imageId, requestId, userId, channelId, responseUrl, originalPrompt } =
    parseResult.data;

  logger.info('Processing action job', { action, requestId, imageId });

  // Get configuration
  const imagesBucket = process.env.IMAGES_BUCKET;
  const imagesCdnDomain = process.env.IMAGES_CDN_DOMAIN;
  const requestsTable = process.env.REQUESTS_TABLE;
  const imagesTable = process.env.IMAGES_TABLE;

  if (!imagesBucket || !imagesCdnDomain || !requestsTable || !imagesTable) {
    throw new Error('Missing required environment variables');
  }

  switch (action) {
    case 'keep':
      await handleKeepImage({
        imageId: imageId!,
        requestId,
        userId,
        imagesBucket,
        imagesCdnDomain,
        requestsTable,
        imagesTable,
        responseUrl,
      });
      break;

    case 'discard':
      await handleDiscardImage({
        imageId: imageId!,
        requestId,
        imagesCdnDomain,
        requestsTable,
        imagesTable,
        responseUrl,
      });
      break;

    case 'keep_all':
      await handleKeepAll({
        requestId,
        userId,
        imagesBucket,
        imagesCdnDomain,
        requestsTable,
        imagesTable,
        responseUrl,
      });
      break;

    case 'discard_all':
      await handleDiscardAll({
        requestId,
        requestsTable,
        imagesTable,
        responseUrl,
      });
      break;

    case 'regenerate_all':
      await handleRegenerateAll({
        requestId,
        userId,
        channelId,
        originalPrompt: originalPrompt!,
        requestsTable,
        responseUrl,
      });
      break;

    default:
      logger.warn('Unknown action type', { action });
  }
};

interface KeepImageParams {
  readonly imageId: string;
  readonly requestId: string;
  readonly userId: string;
  readonly imagesBucket: string;
  readonly imagesCdnDomain: string;
  readonly requestsTable: string;
  readonly imagesTable: string;
  readonly responseUrl: string;
}

const handleKeepImage = async ({
  imageId,
  requestId,
  userId,
  imagesBucket,
  imagesCdnDomain,
  requestsTable,
  imagesTable,
  responseUrl,
}: KeepImageParams): Promise<void> => {
  logger.info('Keeping image', { imageId, requestId });

  // Get the image record
  const image = await getImage({
    tableName: imagesTable,
    imageId,
    requestId,
  });

  if (!image) {
    throw new Error(`Image not found: ${imageId}`);
  }

  // Copy to saved location
  const sourceKey = image.s3Key;
  const destinationKey = buildSavedImageKey(userId, requestId, imageId);

  await copyImage({
    bucket: imagesBucket,
    sourceKey,
    destinationKey,
  });

  // Build permanent CDN URL for the saved image
  const cdnUrl = buildCdnUrl(imagesCdnDomain, destinationKey);

  // Update image record
  await updateImageS3Key({
    tableName: imagesTable,
    imageId,
    requestId,
    s3Key: destinationKey,
  });

  await updateImageStatus({
    tableName: imagesTable,
    imageId,
    requestId,
    status: 'kept',
  });

  // Get request for the original prompt
  const request = await getRequest({
    tableName: requestsTable,
    requestId,
  });

  // Get all images to rebuild the message
  const allImages = await getImagesByRequest({
    tableName: imagesTable,
    requestId,
  });

  // Build updated message with current statuses
  const imagesWithStatus: ImageWithStatus[] = allImages.map(img => ({
    imageId: img.imageId,
    imageUrl: buildCdnUrl(imagesCdnDomain, img.s3Key),
    status: img.status,
    downloadUrl: img.imageId === imageId ? cdnUrl : undefined,
  }));

  const updatedBlocks = buildUpdatedImagesMessage(
    request?.prompt ?? 'Unknown prompt',
    imagesWithStatus,
    requestId
  );

  // Update the original message in the channel
  await respondToWebhook(responseUrl, {
    replace_original: true,
    blocks: updatedBlocks,
  });

  logger.info('Image kept', { imageId, destinationKey, cdnUrl });
};

interface DiscardImageParams {
  readonly imageId: string;
  readonly requestId: string;
  readonly imagesCdnDomain: string;
  readonly requestsTable: string;
  readonly imagesTable: string;
  readonly responseUrl: string;
}

const handleDiscardImage = async ({
  imageId,
  requestId,
  imagesCdnDomain,
  requestsTable,
  imagesTable,
  responseUrl,
}: DiscardImageParams): Promise<void> => {
  logger.info('Discarding image', { imageId, requestId });

  // Update image status (TTL will clean up the S3 object)
  await updateImageStatus({
    tableName: imagesTable,
    imageId,
    requestId,
    status: 'discarded',
  });

  // Get request for the original prompt
  const request = await getRequest({
    tableName: requestsTable,
    requestId,
  });

  // Get all images to rebuild the message
  const allImages = await getImagesByRequest({
    tableName: imagesTable,
    requestId,
  });

  // Build updated message with current statuses (discarded images will be hidden)
  const imagesWithStatus: ImageWithStatus[] = allImages.map(img => ({
    imageId: img.imageId,
    imageUrl: buildCdnUrl(imagesCdnDomain, img.s3Key),
    status: img.status,
  }));

  const updatedBlocks = buildUpdatedImagesMessage(
    request?.prompt ?? 'Unknown prompt',
    imagesWithStatus,
    requestId
  );

  // Update the original message in the channel
  await respondToWebhook(responseUrl, {
    replace_original: true,
    blocks: updatedBlocks,
  });

  logger.info('Image discarded', { imageId });
};

interface KeepAllParams {
  readonly requestId: string;
  readonly userId: string;
  readonly imagesBucket: string;
  readonly imagesCdnDomain: string;
  readonly requestsTable: string;
  readonly imagesTable: string;
  readonly responseUrl: string;
}

const handleKeepAll = async ({
  requestId,
  userId,
  imagesBucket,
  imagesCdnDomain,
  requestsTable,
  imagesTable,
  responseUrl,
}: KeepAllParams): Promise<void> => {
  logger.info('Keeping all images', { requestId });

  // Get all images for this request
  const images = await getImagesByRequest({
    tableName: imagesTable,
    requestId,
  });

  if (images.length === 0) {
    throw new Error(`No images found for request: ${requestId}`);
  }

  // Process each image - collect CDN URLs
  const cdnUrls: Array<{ index: number; url: string }> = [];

  const keepPromises = images.map(async (image, index) => {
    // Skip already kept or discarded images
    if (image.status !== 'generated') {
      return;
    }

    // Copy to saved location
    const sourceKey = image.s3Key;
    const destinationKey = buildSavedImageKey(userId, requestId, image.imageId);

    await copyImage({
      bucket: imagesBucket,
      sourceKey,
      destinationKey,
    });

    // Build permanent CDN URL
    const cdnUrl = buildCdnUrl(imagesCdnDomain, destinationKey);

    // Update image record
    await updateImageS3Key({
      tableName: imagesTable,
      imageId: image.imageId,
      requestId,
      s3Key: destinationKey,
    });

    await updateImageStatus({
      tableName: imagesTable,
      imageId: image.imageId,
      requestId,
      status: 'kept',
    });

    cdnUrls.push({ index, url: cdnUrl });
  });

  await Promise.all(keepPromises);

  // Sort by index
  cdnUrls.sort((a, b) => a.index - b.index);

  // Get request for the original prompt
  const request = await getRequest({
    tableName: requestsTable,
    requestId,
  });

  // Get updated images to rebuild the message
  const allImages = await getImagesByRequest({
    tableName: imagesTable,
    requestId,
  });

  // Build updated message showing all images as kept
  const imagesWithStatus: ImageWithStatus[] = allImages.map((img, index) => ({
    imageId: img.imageId,
    imageUrl: buildCdnUrl(imagesCdnDomain, img.s3Key),
    status: img.status,
    downloadUrl: cdnUrls.find(u => u.index === index)?.url,
  }));

  const updatedBlocks = buildUpdatedImagesMessage(
    request?.prompt ?? 'Unknown prompt',
    imagesWithStatus,
    requestId
  );

  // Update the original message
  await respondToWebhook(responseUrl, {
    replace_original: true,
    blocks: updatedBlocks,
  });

  logger.info('All images kept', { requestId, count: cdnUrls.length });
};

interface DiscardAllParams {
  readonly requestId: string;
  readonly requestsTable: string;
  readonly imagesTable: string;
  readonly responseUrl: string;
}

const handleDiscardAll = async ({
  requestId,
  requestsTable,
  imagesTable,
  responseUrl,
}: DiscardAllParams): Promise<void> => {
  logger.info('Discarding all images', { requestId });

  // Get all images for this request
  const images = await getImagesByRequest({
    tableName: imagesTable,
    requestId,
  });

  // Discard each image
  const discardPromises = images.map(async (image) => {
    // Skip already discarded images
    if (image.status === 'discarded') {
      return;
    }

    await updateImageStatus({
      tableName: imagesTable,
      imageId: image.imageId,
      requestId,
      status: 'discarded',
    });
  });

  await Promise.all(discardPromises);

  // Get request for the original prompt
  const request = await getRequest({
    tableName: requestsTable,
    requestId,
  });

  // Build updated message showing all images discarded
  const updatedBlocks = buildUpdatedImagesMessage(
    request?.prompt ?? 'Unknown prompt',
    [], // All discarded, no visible images
    requestId
  );

  // Update the original message
  await respondToWebhook(responseUrl, {
    replace_original: true,
    blocks: updatedBlocks,
  });

  logger.info('All images discarded', { requestId });
};

interface RegenerateAllParams {
  readonly requestId: string;
  readonly userId: string;
  readonly channelId: string;
  readonly originalPrompt: string;
  readonly requestsTable: string;
  readonly responseUrl: string;
}

const handleRegenerateAll = async ({
  requestId: _originalRequestId,
  userId,
  channelId,
  originalPrompt,
  requestsTable,
  responseUrl,
}: RegenerateAllParams): Promise<void> => {
  logger.info('Regenerating all images', { userId, originalPrompt });

  // Create a new generation request
  const newRequestId = uuidv4();
  const now = new Date().toISOString();
  const bedrockModel = (process.env.BEDROCK_MODEL ?? 'titan') as 'titan' | 'sdxl';

  const generationRequest: GenerationRequest = {
    requestId: newRequestId,
    userId,
    channelId,
    prompt: originalPrompt,
    enhancedPrompt: '',
    status: 'pending',
    model: bedrockModel,
    responseUrl,
    createdAt: now,
    updatedAt: now,
    ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
  };

  await createRequest({
    tableName: requestsTable,
    request: generationRequest,
  });

  // Queue new generation job
  const queueUrl = process.env.GENERATION_QUEUE_URL;
  if (!queueUrl) {
    throw new Error('GENERATION_QUEUE_URL environment variable not set');
  }

  const jobMessage: GenerationJobMessage = {
    requestId: newRequestId,
    userId,
    channelId,
    prompt: originalPrompt,
    responseUrl,
  };

  const sqsCommand = new SendMessageCommand({
    QueueUrl: queueUrl,
    MessageBody: JSON.stringify(jobMessage),
  });

  await getSQSClient().send(sqsCommand);

  // Update the original message to show regenerating status
  await respondToWebhook(responseUrl, {
    replace_original: true,
    blocks: buildRegeneratingMessage(originalPrompt),
  });

  logger.info('Regeneration queued', { newRequestId, originalPrompt });
};

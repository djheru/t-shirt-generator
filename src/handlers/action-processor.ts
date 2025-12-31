import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import {
  copyImage,
  buildSavedImageKey,
  generatePresignedUrl,
} from '../services/storage/s3';
import {
  getImage,
  getImagesByRequest,
  updateImageStatus,
  updateImageS3Key,
  createRequest,
} from '../services/storage/dynamo';
import {
  respondToWebhook,
  buildKeptImageMessage,
  buildAllKeptMessage,
  buildAllDiscardedMessage,
  buildRegeneratingMessage,
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
  const requestsTable = process.env.REQUESTS_TABLE;
  const imagesTable = process.env.IMAGES_TABLE;
  const presignedUrlExpiry = parseInt(process.env.PRESIGNED_URL_EXPIRY ?? '604800', 10);
  const expiryDays = Math.floor(presignedUrlExpiry / 86400);

  if (!imagesBucket || !requestsTable || !imagesTable) {
    throw new Error('Missing required environment variables');
  }

  switch (action) {
    case 'keep':
      await handleKeepImage({
        imageId: imageId!,
        requestId,
        userId,
        imagesBucket,
        imagesTable,
        presignedUrlExpiry,
        expiryDays,
        responseUrl,
      });
      break;

    case 'discard':
      await handleDiscardImage({
        imageId: imageId!,
        requestId,
        imagesTable,
        responseUrl,
      });
      break;

    case 'keep_all':
      await handleKeepAll({
        requestId,
        userId,
        imagesBucket,
        imagesTable,
        presignedUrlExpiry,
        expiryDays,
        responseUrl,
      });
      break;

    case 'discard_all':
      await handleDiscardAll({
        requestId,
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
  readonly imagesTable: string;
  readonly presignedUrlExpiry: number;
  readonly expiryDays: number;
  readonly responseUrl: string;
}

const handleKeepImage = async ({
  imageId,
  requestId,
  userId,
  imagesBucket,
  imagesTable,
  presignedUrlExpiry,
  expiryDays,
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

  // Generate presigned URL
  const presignedUrl = await generatePresignedUrl({
    bucket: imagesBucket,
    key: destinationKey,
    expiresIn: presignedUrlExpiry,
  });

  const presignedUrlExpiry_date = new Date(
    Date.now() + presignedUrlExpiry * 1000
  ).toISOString();

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
    presignedUrl,
    presignedUrlExpiry: presignedUrlExpiry_date,
  });

  // Respond to Slack
  await respondToWebhook(responseUrl, {
    response_type: 'ephemeral',
    blocks: buildKeptImageMessage(presignedUrl, expiryDays),
  });

  logger.info('Image kept', { imageId, destinationKey });
};

interface DiscardImageParams {
  readonly imageId: string;
  readonly requestId: string;
  readonly imagesTable: string;
  readonly responseUrl: string;
}

const handleDiscardImage = async ({
  imageId,
  requestId,
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

  // Respond to Slack
  await respondToWebhook(responseUrl, {
    response_type: 'ephemeral',
    text: 'Image discarded.',
  });

  logger.info('Image discarded', { imageId });
};

interface KeepAllParams {
  readonly requestId: string;
  readonly userId: string;
  readonly imagesBucket: string;
  readonly imagesTable: string;
  readonly presignedUrlExpiry: number;
  readonly expiryDays: number;
  readonly responseUrl: string;
}

const handleKeepAll = async ({
  requestId,
  userId,
  imagesBucket,
  imagesTable,
  presignedUrlExpiry,
  expiryDays,
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

  // Process each image
  const presignedUrls: Array<{ index: number; url: string }> = [];

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

    // Generate presigned URL
    const presignedUrl = await generatePresignedUrl({
      bucket: imagesBucket,
      key: destinationKey,
      expiresIn: presignedUrlExpiry,
    });

    const presignedUrlExpiry_date = new Date(
      Date.now() + presignedUrlExpiry * 1000
    ).toISOString();

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
      presignedUrl,
      presignedUrlExpiry: presignedUrlExpiry_date,
    });

    presignedUrls.push({ index, url: presignedUrl });
  });

  await Promise.all(keepPromises);

  // Sort by index
  presignedUrls.sort((a, b) => a.index - b.index);

  // Respond to Slack
  await respondToWebhook(responseUrl, {
    response_type: 'ephemeral',
    blocks: buildAllKeptMessage(presignedUrls, expiryDays),
  });

  logger.info('All images kept', { requestId, count: presignedUrls.length });
};

interface DiscardAllParams {
  readonly requestId: string;
  readonly imagesTable: string;
  readonly responseUrl: string;
}

const handleDiscardAll = async ({
  requestId,
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

  // Respond to Slack
  await respondToWebhook(responseUrl, {
    response_type: 'ephemeral',
    blocks: buildAllDiscardedMessage(),
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

  // Respond to Slack
  await respondToWebhook(responseUrl, {
    response_type: 'ephemeral',
    blocks: buildRegeneratingMessage(originalPrompt),
  });

  logger.info('Regeneration queued', { newRequestId, originalPrompt });
};

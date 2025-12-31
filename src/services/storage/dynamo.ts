import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  PutCommand,
  GetCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { Logger } from '@aws-lambda-powertools/logger';
import type {
  GenerationRequest,
  GeneratedImage,
  RequestStatus,
  ImageStatus,
} from '../../types/domain.types';

const logger = new Logger({ serviceName: 't-shirt-generator' });

let docClient: DynamoDBDocumentClient | null = null;

export const getDynamoClient = (): DynamoDBDocumentClient => {
  if (!docClient) {
    const client = new DynamoDBClient({});
    docClient = DynamoDBDocumentClient.from(client, {
      marshallOptions: {
        removeUndefinedValues: true,
      },
    });
  }
  return docClient;
};

export const resetDynamoClient = (): void => {
  docClient = null;
};

// Generation Requests

export interface CreateRequestParams {
  readonly tableName: string;
  readonly request: GenerationRequest;
}

export const createRequest = async ({
  tableName,
  request,
}: CreateRequestParams): Promise<void> => {
  const client = getDynamoClient();

  logger.debug('Creating generation request', {
    tableName,
    requestId: request.requestId,
  });

  const command = new PutCommand({
    TableName: tableName,
    Item: request,
    ConditionExpression: 'attribute_not_exists(requestId)',
  });

  await client.send(command);

  logger.info('Generation request created', { requestId: request.requestId });
};

export interface GetRequestParams {
  readonly tableName: string;
  readonly requestId: string;
}

export const getRequest = async ({
  tableName,
  requestId,
}: GetRequestParams): Promise<GenerationRequest | null> => {
  const client = getDynamoClient();

  logger.debug('Getting generation request', { tableName, requestId });

  const command = new GetCommand({
    TableName: tableName,
    Key: { requestId },
  });

  const response = await client.send(command);

  if (!response.Item) {
    logger.debug('Generation request not found', { requestId });
    return null;
  }

  return response.Item as GenerationRequest;
};

export interface UpdateRequestStatusParams {
  readonly tableName: string;
  readonly requestId: string;
  readonly status: RequestStatus;
}

export const updateRequestStatus = async ({
  tableName,
  requestId,
  status,
}: UpdateRequestStatusParams): Promise<void> => {
  const client = getDynamoClient();

  logger.debug('Updating request status', { tableName, requestId, status });

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { requestId },
    UpdateExpression: 'SET #status = :status, updatedAt = :updatedAt',
    ExpressionAttributeNames: {
      '#status': 'status',
    },
    ExpressionAttributeValues: {
      ':status': status,
      ':updatedAt': new Date().toISOString(),
    },
  });

  await client.send(command);

  logger.info('Request status updated', { requestId, status });
};

// Generated Images

export interface CreateImageParams {
  readonly tableName: string;
  readonly image: GeneratedImage;
}

export const createImage = async ({
  tableName,
  image,
}: CreateImageParams): Promise<void> => {
  const client = getDynamoClient();

  logger.debug('Creating image record', {
    tableName,
    imageId: image.imageId,
    requestId: image.requestId,
  });

  const command = new PutCommand({
    TableName: tableName,
    Item: image,
  });

  await client.send(command);

  logger.info('Image record created', {
    imageId: image.imageId,
    requestId: image.requestId,
  });
};

export interface GetImageParams {
  readonly tableName: string;
  readonly imageId: string;
  readonly requestId: string;
}

export const getImage = async ({
  tableName,
  imageId,
  requestId,
}: GetImageParams): Promise<GeneratedImage | null> => {
  const client = getDynamoClient();

  logger.debug('Getting image record', { tableName, imageId, requestId });

  const command = new GetCommand({
    TableName: tableName,
    Key: { imageId, requestId },
  });

  const response = await client.send(command);

  if (!response.Item) {
    logger.debug('Image record not found', { imageId, requestId });
    return null;
  }

  return response.Item as GeneratedImage;
};

export interface GetImagesByRequestParams {
  readonly tableName: string;
  readonly requestId: string;
}

export const getImagesByRequest = async ({
  tableName,
  requestId,
}: GetImagesByRequestParams): Promise<GeneratedImage[]> => {
  const client = getDynamoClient();

  logger.debug('Getting images by request', { tableName, requestId });

  const command = new QueryCommand({
    TableName: tableName,
    IndexName: 'requestId-index',
    KeyConditionExpression: 'requestId = :requestId',
    ExpressionAttributeValues: {
      ':requestId': requestId,
    },
  });

  const response = await client.send(command);

  return (response.Items ?? []) as GeneratedImage[];
};

export interface UpdateImageStatusParams {
  readonly tableName: string;
  readonly imageId: string;
  readonly requestId: string;
  readonly status: ImageStatus;
  readonly presignedUrl?: string;
  readonly presignedUrlExpiry?: string;
}

export const updateImageStatus = async ({
  tableName,
  imageId,
  requestId,
  status,
  presignedUrl,
  presignedUrlExpiry,
}: UpdateImageStatusParams): Promise<void> => {
  const client = getDynamoClient();

  logger.debug('Updating image status', {
    tableName,
    imageId,
    requestId,
    status,
  });

  let updateExpression = 'SET #status = :status';
  const expressionAttributeValues: Record<string, unknown> = {
    ':status': status,
  };

  if (presignedUrl) {
    updateExpression += ', presignedUrl = :presignedUrl';
    expressionAttributeValues[':presignedUrl'] = presignedUrl;
  }

  if (presignedUrlExpiry) {
    updateExpression += ', presignedUrlExpiry = :presignedUrlExpiry';
    expressionAttributeValues[':presignedUrlExpiry'] = presignedUrlExpiry;
  }

  // Set TTL for discarded images (7 days)
  if (status === 'discarded') {
    const ttl = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
    updateExpression += ', #ttl = :ttl';
    expressionAttributeValues[':ttl'] = ttl;
  }

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { imageId, requestId },
    UpdateExpression: updateExpression,
    ExpressionAttributeNames: {
      '#status': 'status',
      ...(status === 'discarded' && { '#ttl': 'ttl' }),
    },
    ExpressionAttributeValues: expressionAttributeValues,
  });

  await client.send(command);

  logger.info('Image status updated', { imageId, requestId, status });
};

export interface UpdateImageS3KeyParams {
  readonly tableName: string;
  readonly imageId: string;
  readonly requestId: string;
  readonly s3Key: string;
}

export const updateImageS3Key = async ({
  tableName,
  imageId,
  requestId,
  s3Key,
}: UpdateImageS3KeyParams): Promise<void> => {
  const client = getDynamoClient();

  logger.debug('Updating image S3 key', { tableName, imageId, requestId, s3Key });

  const command = new UpdateCommand({
    TableName: tableName,
    Key: { imageId, requestId },
    UpdateExpression: 'SET s3Key = :s3Key',
    ExpressionAttributeValues: {
      ':s3Key': s3Key,
    },
  });

  await client.send(command);

  logger.info('Image S3 key updated', { imageId, requestId, s3Key });
};

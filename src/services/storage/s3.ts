import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 't-shirt-generator' });

let s3Client: S3Client | null = null;

export const getS3Client = (): S3Client => {
  if (!s3Client) {
    s3Client = new S3Client({});
  }
  return s3Client;
};

export const resetS3Client = (): void => {
  s3Client = null;
};

export interface UploadImageParams {
  readonly bucket: string;
  readonly key: string;
  readonly imageBuffer: Buffer;
  readonly contentType?: string;
}

export const uploadImage = async ({
  bucket,
  key,
  imageBuffer,
  contentType = 'image/png',
}: UploadImageParams): Promise<void> => {
  const client = getS3Client();

  logger.debug('Uploading image to S3', { bucket, key, size: imageBuffer.length });

  const command = new PutObjectCommand({
    Bucket: bucket,
    Key: key,
    Body: imageBuffer,
    ContentType: contentType,
  });

  await client.send(command);

  logger.info('Image uploaded to S3', { bucket, key });
};

export interface GetImageParams {
  readonly bucket: string;
  readonly key: string;
}

export const getImage = async ({
  bucket,
  key,
}: GetImageParams): Promise<Buffer> => {
  const client = getS3Client();

  logger.debug('Getting image from S3', { bucket, key });

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const response = await client.send(command);

  if (!response.Body) {
    throw new Error(`No body returned for S3 object: ${key}`);
  }

  const bytes = await response.Body.transformToByteArray();
  return Buffer.from(bytes);
};

export interface CopyImageParams {
  readonly bucket: string;
  readonly sourceKey: string;
  readonly destinationKey: string;
}

export const copyImage = async ({
  bucket,
  sourceKey,
  destinationKey,
}: CopyImageParams): Promise<void> => {
  const client = getS3Client();

  logger.debug('Copying image in S3', { bucket, sourceKey, destinationKey });

  const command = new CopyObjectCommand({
    Bucket: bucket,
    CopySource: `${bucket}/${sourceKey}`,
    Key: destinationKey,
  });

  await client.send(command);

  logger.info('Image copied in S3', { bucket, sourceKey, destinationKey });
};

export interface DeleteImageParams {
  readonly bucket: string;
  readonly key: string;
}

export const deleteImage = async ({
  bucket,
  key,
}: DeleteImageParams): Promise<void> => {
  const client = getS3Client();

  logger.debug('Deleting image from S3', { bucket, key });

  const command = new DeleteObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  await client.send(command);

  logger.info('Image deleted from S3', { bucket, key });
};

export interface GeneratePresignedUrlParams {
  readonly bucket: string;
  readonly key: string;
  readonly expiresIn: number; // seconds
}

export const generatePresignedUrl = async ({
  bucket,
  key,
  expiresIn,
}: GeneratePresignedUrlParams): Promise<string> => {
  const client = getS3Client();

  logger.debug('Generating presigned URL', { bucket, key, expiresIn });

  const command = new GetObjectCommand({
    Bucket: bucket,
    Key: key,
  });

  const url = await getSignedUrl(client, command, { expiresIn });

  logger.info('Presigned URL generated', { bucket, key });

  return url;
};

export const buildTempImageKey = (requestId: string, imageId: string): string =>
  `temp/${requestId}/${imageId}.png`;

export const buildSavedImageKey = (
  userId: string,
  requestId: string,
  imageId: string
): string => `saved/${userId}/${requestId}/${imageId}.png`;

export const buildThumbnailKey = (requestId: string, imageId: string): string =>
  `thumbnails/${requestId}/${imageId}.png`;

/**
 * Build a public CloudFront URL for an image.
 * Unlike presigned URLs, these don't expire.
 */
export const buildCdnUrl = (cdnDomain: string, key: string): string =>
  `https://${cdnDomain}/${key}`;

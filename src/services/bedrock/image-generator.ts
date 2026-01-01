import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  ThrottlingException,
} from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import type { BedrockModel, BedrockGenerationResult } from '../../types/domain.types';
import { BEDROCK_MODEL_IDS } from '../../config';

const logger = new Logger({ serviceName: 't-shirt-generator' });

let bedrockClient: BedrockRuntimeClient | null = null;

// Retry configuration
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000; // Start with 2 seconds
const MAX_DELAY_MS = 30000; // Max 30 seconds

export const getBedrockClient = (): BedrockRuntimeClient => {
  if (!bedrockClient) {
    bedrockClient = new BedrockRuntimeClient({
      maxAttempts: 3, // SDK-level retries
    });
  }
  return bedrockClient;
};

export const resetBedrockClient = (): void => {
  bedrockClient = null;
};

// Sleep helper for retry delays
const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

// Retry wrapper with exponential backoff for throttling
const withRetry = async <T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> => {
  let lastError: Error | undefined;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error as Error;

      // Check if it's a throttling error
      const isThrottling =
        error instanceof ThrottlingException ||
        (error as Error).name === 'ThrottlingException' ||
        (error as Error).message?.includes('ThrottlingException') ||
        (error as Error).message?.includes('Too many requests');

      if (!isThrottling) {
        // Not a throttling error, don't retry
        throw error;
      }

      if (attempt < MAX_RETRIES - 1) {
        // Calculate delay with exponential backoff and jitter
        const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        const jitter = Math.random() * 1000; // Add up to 1 second of jitter
        const delay = baseDelay + jitter;

        logger.warn(`${operationName} throttled, retrying in ${Math.round(delay)}ms`, {
          attempt: attempt + 1,
          maxRetries: MAX_RETRIES,
          delay: Math.round(delay),
        });

        await sleep(delay);
      }
    }
  }

  logger.error(`${operationName} failed after ${MAX_RETRIES} retries`, {
    error: lastError,
  });
  throw lastError;
};

export interface GenerateImagesParams {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly model: BedrockModel;
  readonly imageCount: number;
  readonly width?: number;
  readonly height?: number;
  readonly cfgScale?: number;
  readonly seed?: number;
}

interface TitanImageGenerationResponse {
  readonly images: string[]; // Base64 encoded images
}

interface SDXLImageGenerationResponse {
  readonly artifacts: Array<{
    readonly base64: string;
    readonly seed: number;
    readonly finishReason: string;
  }>;
}

export const generateImages = async ({
  prompt,
  negativePrompt,
  model,
  imageCount,
  width = 1024,
  height = 1024,
  cfgScale = 8.0,
  seed,
}: GenerateImagesParams): Promise<BedrockGenerationResult> => {
  const client = getBedrockClient();
  const modelId = BEDROCK_MODEL_IDS[model];

  logger.info('Generating images with Bedrock', {
    model,
    modelId,
    imageCount,
    width,
    height,
    promptLength: prompt.length,
  });

  try {
    if (model === 'titan') {
      return await generateWithTitan({
        client,
        modelId,
        prompt,
        negativePrompt,
        imageCount,
        width,
        height,
        cfgScale,
        seed,
      });
    } else {
      return await generateWithSDXL({
        client,
        modelId,
        prompt,
        negativePrompt,
        imageCount,
        width,
        height,
        cfgScale,
        seed,
      });
    }
  } catch (error) {
    logger.error('Failed to generate images', { error, model, modelId });
    throw error;
  }
};

interface TitanGenerationParams {
  readonly client: BedrockRuntimeClient;
  readonly modelId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly imageCount: number;
  readonly width: number;
  readonly height: number;
  readonly cfgScale: number;
  readonly seed?: number;
}

const generateWithTitan = async ({
  client,
  modelId,
  prompt,
  negativePrompt,
  imageCount,
  width,
  height,
  cfgScale,
  seed,
}: TitanGenerationParams): Promise<BedrockGenerationResult> => {
  const requestBody = {
    taskType: 'TEXT_IMAGE',
    textToImageParams: {
      text: prompt,
      ...(negativePrompt && { negativeText: negativePrompt }),
    },
    imageGenerationConfig: {
      numberOfImages: imageCount,
      width,
      height,
      cfgScale,
      ...(seed !== undefined && { seed }),
    },
  };

  logger.debug('Titan request body', { requestBody });

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(requestBody),
  });

  // Use retry wrapper for throttling resilience
  const response = await withRetry(
    () => client.send(command),
    'Titan image generation'
  );

  const responseBody = JSON.parse(
    new TextDecoder().decode(response.body)
  ) as TitanImageGenerationResponse;

  logger.info('Titan generation complete', {
    imageCount: responseBody.images.length,
  });

  const images = responseBody.images.map((base64Image) =>
    Buffer.from(base64Image, 'base64')
  );

  return { images, model: 'titan' };
};

interface SDXLGenerationParams {
  readonly client: BedrockRuntimeClient;
  readonly modelId: string;
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly imageCount: number;
  readonly width: number;
  readonly height: number;
  readonly cfgScale: number;
  readonly seed?: number;
}

const generateWithSDXL = async ({
  client,
  modelId,
  prompt,
  negativePrompt,
  imageCount,
  width,
  height,
  cfgScale,
  seed,
}: SDXLGenerationParams): Promise<BedrockGenerationResult> => {
  // SDXL generates one image per call, so we need to make multiple calls
  // We generate SEQUENTIALLY to avoid throttling on accounts with low quotas
  const images: Buffer[] = [];

  for (let index = 0; index < imageCount; index++) {
    const requestBody = {
      text_prompts: [
        { text: prompt, weight: 1.0 },
        ...(negativePrompt ? [{ text: negativePrompt, weight: -1.0 }] : []),
      ],
      cfg_scale: cfgScale,
      width,
      height,
      samples: 1,
      steps: 50,
      ...(seed !== undefined && { seed: seed + index }), // Different seed for each image
    };

    logger.debug('SDXL request body', { requestBody, imageIndex: index });

    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    });

    // Use retry wrapper for throttling resilience
    const response = await withRetry(
      () => client.send(command),
      `SDXL image generation (${index + 1}/${imageCount})`
    );

    const responseBody = JSON.parse(
      new TextDecoder().decode(response.body)
    ) as SDXLImageGenerationResponse;

    if (responseBody.artifacts.length === 0) {
      throw new Error(`SDXL generation returned no artifacts for image ${index}`);
    }

    images.push(Buffer.from(responseBody.artifacts[0].base64, 'base64'));

    // Add a small delay between requests to avoid throttling
    if (index < imageCount - 1) {
      await sleep(1000); // 1 second delay between images
    }
  }

  logger.info('SDXL generation complete', {
    imageCount: images.length,
  });

  return { images, model: 'sdxl' };
};

export const enhancePrompt = (
  userPrompt: string,
  suffix: string,
  transparencySuffix: string
): string => {
  const needsTransparency = /transparent|no background|isolated/i.test(userPrompt);
  const enhancedPrompt = needsTransparency
    ? `${userPrompt}${suffix}${transparencySuffix}`
    : `${userPrompt}${suffix}`;

  return enhancedPrompt;
};

export const buildNegativePrompt = (
  baseNegativePrompt: string,
  transparencyNegativePrompt: string,
  userPrompt: string
): string => {
  const needsTransparency = /transparent|no background|isolated/i.test(userPrompt);
  return needsTransparency
    ? `${baseNegativePrompt}${transparencyNegativePrompt}`
    : baseNegativePrompt;
};

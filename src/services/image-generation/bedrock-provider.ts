import {
  BedrockRuntimeClient,
  InvokeModelCommand,
  ThrottlingException,
} from '@aws-sdk/client-bedrock-runtime';
import { Logger } from '@aws-lambda-powertools/logger';
import type {
  ImageGenerator,
  GenerateImagesParams,
  GeneratedImageResult,
  BedrockModel,
  AspectRatio,
} from './types';

const logger = new Logger({ serviceName: 't-shirt-generator' });

// Retry configuration
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

const BEDROCK_MODEL_IDS: Record<BedrockModel, string> = {
  titan: 'amazon.titan-image-generator-v2:0',
  sdxl: 'stability.stable-diffusion-xl-v1',
};

// Max resolutions for each model
const MAX_RESOLUTIONS: Record<BedrockModel, number> = {
  titan: 2048, // Titan v2 supports up to 2048x2048
  sdxl: 1024,  // SDXL supports up to 1024x1024
};

/**
 * Convert aspect ratio to dimensions, maximizing resolution within model limits.
 * Both Titan and SDXL require dimensions to be multiples of 64.
 */
const aspectRatioToDimensions = (
  aspectRatio: AspectRatio | undefined,
  model: BedrockModel
): { width: number; height: number } => {
  const maxSize = MAX_RESOLUTIONS[model];

  if (!aspectRatio || aspectRatio === '1:1') {
    return { width: maxSize, height: maxSize };
  }

  const [w, h] = aspectRatio.split(':').map(Number);
  const ratio = w / h;

  let width: number;
  let height: number;

  if (ratio > 1) {
    // Landscape
    width = maxSize;
    height = Math.round(maxSize / ratio);
  } else {
    // Portrait
    height = maxSize;
    width = Math.round(maxSize * ratio);
  }

  // Round to nearest 64 (required by both models)
  width = Math.round(width / 64) * 64;
  height = Math.round(height / 64) * 64;

  // Ensure we don't exceed max
  width = Math.min(width, maxSize);
  height = Math.min(height, maxSize);

  return { width, height };
};

interface TitanImageGenerationResponse {
  readonly images: string[];
}

interface SDXLImageGenerationResponse {
  readonly artifacts: Array<{
    readonly base64: string;
    readonly seed: number;
    readonly finishReason: string;
  }>;
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

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

      const isThrottling =
        error instanceof ThrottlingException ||
        (error as Error).name === 'ThrottlingException' ||
        (error as Error).message?.includes('ThrottlingException') ||
        (error as Error).message?.includes('Too many requests');

      if (!isThrottling) {
        throw error;
      }

      if (attempt < MAX_RETRIES - 1) {
        const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        const jitter = Math.random() * 1000;
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

export interface BedrockProviderConfig {
  readonly model: BedrockModel;
  readonly region?: string;
}

export const createBedrockProvider = (config: BedrockProviderConfig): ImageGenerator => {
  const { model, region } = config;
  const modelId = BEDROCK_MODEL_IDS[model];

  const client = new BedrockRuntimeClient({
    region,
    maxAttempts: 3,
  });

  const generateWithTitan = async (
    params: GenerateImagesParams
  ): Promise<Buffer[]> => {
    // Calculate dimensions from aspect ratio, maximizing resolution
    const dimensions = aspectRatioToDimensions(params.aspectRatio, 'titan');

    const requestBody = {
      taskType: 'TEXT_IMAGE',
      textToImageParams: {
        text: params.prompt,
        ...(params.negativePrompt && { negativeText: params.negativePrompt }),
      },
      imageGenerationConfig: {
        numberOfImages: params.imageCount,
        width: params.width ?? dimensions.width,
        height: params.height ?? dimensions.height,
        cfgScale: params.cfgScale ?? 8.0,
        ...(params.seed !== undefined && { seed: params.seed }),
      },
    };

    logger.debug('Titan request body', { requestBody });

    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(requestBody),
    });

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

    return responseBody.images.map((base64Image) =>
      Buffer.from(base64Image, 'base64')
    );
  };

  const generateWithSDXL = async (
    params: GenerateImagesParams
  ): Promise<Buffer[]> => {
    // Calculate dimensions from aspect ratio, maximizing resolution
    const dimensions = aspectRatioToDimensions(params.aspectRatio, 'sdxl');
    const images: Buffer[] = [];

    for (let index = 0; index < params.imageCount; index++) {
      const requestBody = {
        text_prompts: [
          { text: params.prompt, weight: 1.0 },
          ...(params.negativePrompt
            ? [{ text: params.negativePrompt, weight: -1.0 }]
            : []),
        ],
        cfg_scale: params.cfgScale ?? 8.0,
        width: params.width ?? dimensions.width,
        height: params.height ?? dimensions.height,
        samples: 1,
        steps: 50,
        ...(params.seed !== undefined && { seed: params.seed + index }),
      };

      logger.debug('SDXL request body', { requestBody, imageIndex: index });

      const command = new InvokeModelCommand({
        modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      });

      const response = await withRetry(
        () => client.send(command),
        `SDXL image generation (${index + 1}/${params.imageCount})`
      );

      const responseBody = JSON.parse(
        new TextDecoder().decode(response.body)
      ) as SDXLImageGenerationResponse;

      if (responseBody.artifacts.length === 0) {
        throw new Error(`SDXL generation returned no artifacts for image ${index}`);
      }

      images.push(Buffer.from(responseBody.artifacts[0].base64, 'base64'));

      if (index < params.imageCount - 1) {
        await sleep(1000);
      }
    }

    logger.info('SDXL generation complete', {
      imageCount: images.length,
    });

    return images;
  };

  return {
    async generate(params: GenerateImagesParams): Promise<GeneratedImageResult> {
      const dimensions = aspectRatioToDimensions(params.aspectRatio, model);
      logger.info('Generating images with Bedrock', {
        model,
        modelId,
        imageCount: params.imageCount,
        aspectRatio: params.aspectRatio ?? '1:1',
        width: params.width ?? dimensions.width,
        height: params.height ?? dimensions.height,
        promptLength: params.prompt.length,
      });

      try {
        const images =
          model === 'titan'
            ? await generateWithTitan(params)
            : await generateWithSDXL(params);

        return {
          images,
          provider: 'bedrock',
          model: modelId,
        };
      } catch (error) {
        logger.error('Failed to generate images with Bedrock', { error, model, modelId });
        throw error;
      }
    },

    getProvider() {
      return 'bedrock' as const;
    },

    getModel() {
      return modelId;
    },
  };
};

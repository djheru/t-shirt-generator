import { GoogleGenerativeAI } from '@google/generative-ai';
import { Logger } from '@aws-lambda-powertools/logger';
import type {
  ImageGenerator,
  GenerateImagesParams,
  GeneratedImageResult,
  GeminiModel,
} from './types';

const logger = new Logger({ serviceName: 't-shirt-generator' });

// Retry configuration
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 2000;
const MAX_DELAY_MS = 30000;

// Gemini model IDs for image generation
// See: https://ai.google.dev/gemini-api/docs/image-generation
const GEMINI_MODEL_IDS: Record<GeminiModel, string> = {
  'gemini-2.5-flash': 'gemini-2.5-flash-preview-05-20',
  'gemini-3-pro': 'gemini-3-pro-image-preview',
};

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

      // Check for rate limiting / quota errors
      const errorMessage = (error as Error).message?.toLowerCase() ?? '';
      const isRetryable =
        errorMessage.includes('rate') ||
        errorMessage.includes('quota') ||
        errorMessage.includes('limit') ||
        errorMessage.includes('429') ||
        errorMessage.includes('503') ||
        errorMessage.includes('overloaded');

      if (!isRetryable) {
        throw error;
      }

      if (attempt < MAX_RETRIES - 1) {
        const baseDelay = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS);
        const jitter = Math.random() * 1000;
        const delay = baseDelay + jitter;

        logger.warn(`${operationName} rate limited, retrying in ${Math.round(delay)}ms`, {
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

export interface GeminiProviderConfig {
  readonly apiKey: string;
  readonly model?: GeminiModel;
}

/**
 * Create a Gemini image generation provider.
 *
 * Supports:
 * - gemini-2.5-flash: Fast, efficient image generation
 * - gemini-3-pro: Professional-grade with advanced reasoning (default)
 */
export const createGeminiProvider = (config: GeminiProviderConfig): ImageGenerator => {
  const { apiKey, model = 'gemini-3-pro' } = config;
  const modelId = GEMINI_MODEL_IDS[model];

  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    async generate(params: GenerateImagesParams): Promise<GeneratedImageResult> {
      logger.info('Generating images with Gemini', {
        model,
        modelId,
        imageCount: params.imageCount,
        promptLength: params.prompt.length,
      });

      try {
        // Configure the model with image generation capabilities
        const imageModel = genAI.getGenerativeModel({
          model: modelId,
          generationConfig: {
            // @ts-expect-error - responseModalities not in types yet
            responseModalities: ['TEXT', 'IMAGE'],
          },
        });

        const images: Buffer[] = [];

        // Generate images sequentially to avoid rate limits
        for (let i = 0; i < params.imageCount; i++) {
          logger.debug('Generating image', { index: i + 1, total: params.imageCount });

          // Build the prompt - incorporate negative prompt as guidance
          let fullPrompt = `Generate an image: ${params.prompt}`;
          if (params.negativePrompt) {
            fullPrompt += `. Do not include: ${params.negativePrompt}`;
          }

          const result = await withRetry(async () => {
            const response = await imageModel.generateContent(fullPrompt);
            return response;
          }, `Gemini image generation (${i + 1}/${params.imageCount})`);

          // Extract the generated image
          const response = result.response;
          const candidates = response.candidates;

          if (!candidates || candidates.length === 0) {
            throw new Error(`No candidates returned for image ${i + 1}`);
          }

          // Find the image part in the response
          let imageFound = false;
          for (const candidate of candidates) {
            if (candidate.content?.parts) {
              for (const part of candidate.content.parts) {
                // Check for inline data (base64 image)
                if (part.inlineData?.data) {
                  const base64Data = part.inlineData.data as string;
                  images.push(Buffer.from(base64Data, 'base64'));
                  imageFound = true;
                  break;
                }
              }
            }
            if (imageFound) break;
          }

          if (!imageFound) {
            logger.warn(`No image found in response for image ${i + 1}`, {
              candidateCount: candidates.length,
            });
          }

          // Add delay between requests to avoid rate limiting
          if (i < params.imageCount - 1) {
            await sleep(1500);
          }
        }

        if (images.length === 0) {
          throw new Error('No images were generated');
        }

        logger.info('Gemini generation complete', {
          imageCount: images.length,
        });

        return {
          images,
          provider: 'gemini',
          model: modelId,
        };
      } catch (error) {
        logger.error('Failed to generate images with Gemini', { error, model, modelId });
        throw error;
      }
    },

    getProvider() {
      return 'gemini' as const;
    },

    getModel() {
      return modelId;
    },
  };
};

/**
 * @deprecated Use createGeminiProvider with model='gemini-2.5-flash' instead
 */
export const createGeminiFlashProvider = (config: GeminiProviderConfig): ImageGenerator => {
  return createGeminiProvider({ ...config, model: 'gemini-2.5-flash' });
};

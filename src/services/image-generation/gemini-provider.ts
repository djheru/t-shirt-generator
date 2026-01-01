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
const GEMINI_MODEL_IDS: Record<GeminiModel, string> = {
  'imagen-3': 'imagen-3.0-generate-002',
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

export const createGeminiProvider = (config: GeminiProviderConfig): ImageGenerator => {
  const { apiKey, model = 'imagen-3' } = config;
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
        // Use the Imagen model for image generation
        const imageModel = genAI.getGenerativeModel({
          model: modelId,
        });

        const images: Buffer[] = [];

        // Generate images sequentially to avoid rate limits
        for (let i = 0; i < params.imageCount; i++) {
          logger.debug('Generating image', { index: i + 1, total: params.imageCount });

          // Build the prompt - Imagen doesn't support negative prompts in the same way
          // We incorporate the negative aspects into the prompt guidance
          let fullPrompt = params.prompt;
          if (params.negativePrompt) {
            fullPrompt = `${params.prompt}. Avoid: ${params.negativePrompt}`;
          }

          const result = await withRetry(async () => {
            const response = await imageModel.generateContent({
              contents: [
                {
                  role: 'user',
                  parts: [{ text: fullPrompt }],
                },
              ],
              generationConfig: {
                // Imagen-specific settings
                // @ts-expect-error - Imagen config not fully typed yet
                numberOfImages: 1,
                aspectRatio: '1:1', // Square for t-shirts
                outputMimeType: 'image/png',
              },
            });

            return response;
          }, `Gemini image generation (${i + 1}/${params.imageCount})`);

          // Extract the generated image
          const response = result.response;
          const candidates = response.candidates;

          if (!candidates || candidates.length === 0) {
            throw new Error(`No candidates returned for image ${i + 1}`);
          }

          // Find the image part in the response
          for (const candidate of candidates) {
            if (candidate.content?.parts) {
              for (const part of candidate.content.parts) {
                // Check for inline data (base64 image)
                if (part.inlineData?.data) {
                  const base64Data = part.inlineData.data as string;
                  images.push(Buffer.from(base64Data, 'base64'));
                  break;
                }
              }
            }
          }

          // Add delay between requests to avoid rate limiting
          if (i < params.imageCount - 1) {
            await sleep(1000);
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
 * Alternative implementation using Gemini 2.0 Flash's native image generation
 * This uses the multimodal model which can also generate images
 */
export const createGeminiFlashProvider = (config: GeminiProviderConfig): ImageGenerator => {
  const { apiKey } = config;
  const modelId = 'gemini-2.0-flash-exp'; // Experimental model with image generation

  const genAI = new GoogleGenerativeAI(apiKey);

  return {
    async generate(params: GenerateImagesParams): Promise<GeneratedImageResult> {
      logger.info('Generating images with Gemini Flash', {
        modelId,
        imageCount: params.imageCount,
        promptLength: params.prompt.length,
      });

      try {
        const model = genAI.getGenerativeModel({
          model: modelId,
          generationConfig: {
            // @ts-expect-error - responseModalities not in types yet
            responseModalities: ['image', 'text'],
          },
        });

        const images: Buffer[] = [];

        for (let i = 0; i < params.imageCount; i++) {
          logger.debug('Generating image with Flash', { index: i + 1, total: params.imageCount });

          // Craft prompt for image generation
          let prompt = `Generate an image: ${params.prompt}`;
          if (params.negativePrompt) {
            prompt += `. Do not include: ${params.negativePrompt}`;
          }

          const result = await withRetry(async () => {
            const response = await model.generateContent(prompt);
            return response;
          }, `Gemini Flash image generation (${i + 1}/${params.imageCount})`);

          const response = result.response;

          // Extract image from response
          for (const candidate of response.candidates ?? []) {
            for (const part of candidate.content?.parts ?? []) {
              if (part.inlineData?.mimeType?.startsWith('image/')) {
                const base64Data = part.inlineData.data as string;
                images.push(Buffer.from(base64Data, 'base64'));
                break;
              }
            }
          }

          if (i < params.imageCount - 1) {
            await sleep(1500); // Slightly longer delay for Flash model
          }
        }

        if (images.length === 0) {
          throw new Error('No images were generated by Gemini Flash');
        }

        logger.info('Gemini Flash generation complete', {
          imageCount: images.length,
        });

        return {
          images,
          provider: 'gemini',
          model: modelId,
        };
      } catch (error) {
        logger.error('Failed to generate images with Gemini Flash', { error, modelId });
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

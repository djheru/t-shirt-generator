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
        aspectRatio: params.aspectRatio ?? '1:1',
        promptLength: params.prompt.length,
      });

      try {
        // Build image config for aspect ratio and size
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const imageConfig: any = {};

        // Add aspect ratio if specified (Gemini supports: 1:1, 3:4, 4:3, 9:16, 16:9, etc.)
        if (params.aspectRatio) {
          imageConfig.aspectRatio = params.aspectRatio;
        }

        // Request 4K resolution for Gemini 3 Pro for print-quality output
        if (model === 'gemini-3-pro') {
          imageConfig.imageSize = '4K';
        }

        // Build generation config with image output settings
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const generationConfig: any = {
          responseModalities: ['IMAGE'],
        };

        // Only add imageConfig if it has properties
        if (Object.keys(imageConfig).length > 0) {
          generationConfig.imageConfig = imageConfig;
        }

        // Configure the model with image generation capabilities
        const imageModel = genAI.getGenerativeModel({
          model: modelId,
          generationConfig,
        });

        const images: Buffer[] = [];

        // Generate images sequentially to avoid rate limits
        for (let i = 0; i < params.imageCount; i++) {
          logger.debug('Generating image', { index: i + 1, total: params.imageCount });

          // The prompt is already a complete narrative from buildDTGPrompt
          // Append avoidance guidance as additional context
          let fullPrompt = params.prompt;
          if (params.negativePrompt) {
            fullPrompt += `\n\n${params.negativePrompt}`;
          }

          // Add distinct style variations for each image
          if (params.imageCount > 1) {
            const styleVariations = [
              'Use a bold, graphic illustration style with strong outlines and flat colors. Think screen-printed poster aesthetic.',
              'Use a detailed, realistic artistic style with rich textures and depth. Think fine art or digital painting.',
              'Use a minimalist, modern style with clean geometric shapes and limited color palette. Think contemporary design.',
              'Use a vintage or retro aesthetic with weathered textures and nostalgic color tones. Think 70s/80s poster art.',
              'Use an abstract or stylized approach with dynamic composition and artistic interpretation.',
            ];
            const styleHint = styleVariations[i % styleVariations.length];
            fullPrompt += `\n\nStyle direction for this variation: ${styleHint}`;
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

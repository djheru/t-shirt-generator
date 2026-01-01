import { Logger } from '@aws-lambda-powertools/logger';
import type { ImageGenerator, ImageProvider, BedrockModel, GeminiModel } from './types';
import { createBedrockProvider } from './bedrock-provider';
import { createGeminiProvider } from './gemini-provider';

const logger = new Logger({ serviceName: 't-shirt-generator' });

export interface ImageGeneratorFactoryConfig {
  readonly provider: ImageProvider;
  readonly bedrockModel?: BedrockModel;
  readonly geminiModel?: GeminiModel;
  readonly geminiApiKey?: string;
  readonly awsRegion?: string;
  readonly useGeminiFlash?: boolean;
}

/**
 * Factory function to create the appropriate image generator based on configuration.
 *
 * Usage:
 * ```typescript
 * // For Bedrock
 * const generator = createImageGenerator({
 *   provider: 'bedrock',
 *   bedrockModel: 'titan',
 * });
 *
 * // For Gemini
 * const generator = createImageGenerator({
 *   provider: 'gemini',
 *   geminiApiKey: 'your-api-key',
 *   geminiModel: 'imagen-3',
 * });
 * ```
 */
export const createImageGenerator = (config: ImageGeneratorFactoryConfig): ImageGenerator => {
  const { provider } = config;

  logger.info('Creating image generator', {
    provider,
    bedrockModel: config.bedrockModel,
    geminiModel: config.geminiModel,
  });

  switch (provider) {
    case 'bedrock': {
      const bedrockModel = config.bedrockModel ?? 'titan';
      return createBedrockProvider({
        model: bedrockModel,
        region: config.awsRegion,
      });
    }

    case 'gemini': {
      if (!config.geminiApiKey) {
        throw new Error('Gemini API key is required for Gemini provider');
      }

      // Use Gemini Flash for faster/cheaper generation, or Pro for higher quality
      const geminiModel = config.useGeminiFlash ? 'gemini-2.5-flash' : (config.geminiModel ?? 'gemini-3-pro');

      return createGeminiProvider({
        apiKey: config.geminiApiKey,
        model: geminiModel,
      });
    }

    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unknown image provider: ${exhaustiveCheck}`);
    }
  }
};

/**
 * Create an image generator from environment variables.
 * This is the preferred way to create generators in Lambda handlers.
 */
export const createImageGeneratorFromEnv = async (
  getSecret: (arn: string) => Promise<string>
): Promise<ImageGenerator> => {
  const provider = (process.env.IMAGE_PROVIDER ?? 'bedrock') as ImageProvider;

  // Load Gemini API key if using Gemini
  let geminiApiKey: string | undefined;
  if (provider === 'gemini') {
    const geminiKeyArn = process.env.GEMINI_API_KEY_ARN;
    if (!geminiKeyArn) {
      throw new Error('GEMINI_API_KEY_ARN environment variable is required for Gemini provider');
    }
    geminiApiKey = await getSecret(geminiKeyArn);
  }

  const config: ImageGeneratorFactoryConfig = {
    provider,
    bedrockModel: (process.env.BEDROCK_MODEL ?? 'titan') as BedrockModel,
    geminiModel: (process.env.GEMINI_MODEL ?? 'imagen-3') as GeminiModel,
    geminiApiKey,
    awsRegion: process.env.AWS_REGION,
    useGeminiFlash: process.env.USE_GEMINI_FLASH === 'true',
  };

  return createImageGenerator(config);
};

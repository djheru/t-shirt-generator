import { Logger } from '@aws-lambda-powertools/logger';
import type { PromptIdeator, IdeationProvider } from './types';
import { createAnthropicIdeator } from './anthropic-ideation';
import { createGeminiIdeator } from './gemini-ideation';

const logger = new Logger({ serviceName: 't-shirt-generator' });

export interface IdeationFactoryConfig {
  readonly provider: IdeationProvider;
  readonly anthropicApiKey?: string;
  readonly anthropicModel?: string;
  readonly geminiApiKey?: string;
  readonly geminiModel?: string;
}

/**
 * Create an ideation provider based on configuration.
 * Defaults to Gemini if no provider is specified.
 */
export const createIdeator = (config: IdeationFactoryConfig): PromptIdeator => {
  const { provider } = config;

  logger.info('Creating ideation provider', {
    provider,
    anthropicModel: config.anthropicModel,
    geminiModel: config.geminiModel,
  });

  switch (provider) {
    case 'anthropic': {
      if (!config.anthropicApiKey) {
        throw new Error('Anthropic API key is required for anthropic provider');
      }
      return createAnthropicIdeator({
        apiKey: config.anthropicApiKey,
        model: config.anthropicModel,
      });
    }

    case 'gemini': {
      if (!config.geminiApiKey) {
        throw new Error('Gemini API key is required for gemini provider');
      }
      return createGeminiIdeator({
        apiKey: config.geminiApiKey,
        model: config.geminiModel,
      });
    }

    default: {
      const exhaustiveCheck: never = provider;
      throw new Error(`Unknown ideation provider: ${exhaustiveCheck}`);
    }
  }
};

export interface CreateIdeatorFromEnvOptions {
  readonly getSecret: (arn: string) => Promise<string>;
}

/**
 * Create an ideation provider from environment variables.
 * Uses IDEATION_PROVIDER env var, defaulting to 'gemini'.
 */
export const createIdeatorFromEnv = async (
  options: CreateIdeatorFromEnvOptions
): Promise<PromptIdeator> => {
  const { getSecret } = options;

  const provider = (process.env.IDEATION_PROVIDER ?? 'gemini') as IdeationProvider;

  logger.info('Creating ideation provider from environment', { provider });

  const config: IdeationFactoryConfig = {
    provider,
  };

  // Load the appropriate API key based on provider
  if (provider === 'anthropic') {
    const anthropicApiKeyArn = process.env.ANTHROPIC_API_KEY_ARN;
    if (!anthropicApiKeyArn) {
      throw new Error('ANTHROPIC_API_KEY_ARN environment variable not set');
    }
    const anthropicApiKey = await getSecret(anthropicApiKeyArn);
    return createIdeator({
      ...config,
      anthropicApiKey,
      anthropicModel: process.env.ANTHROPIC_MODEL,
    });
  }

  if (provider === 'gemini') {
    const geminiApiKeyArn = process.env.GEMINI_API_KEY_ARN;
    if (!geminiApiKeyArn) {
      throw new Error('GEMINI_API_KEY_ARN environment variable not set');
    }
    const geminiApiKey = await getSecret(geminiApiKeyArn);
    return createIdeator({
      ...config,
      geminiApiKey,
      geminiModel: process.env.GEMINI_IDEATION_MODEL,
    });
  }

  throw new Error(`Unknown ideation provider: ${provider}`);
};

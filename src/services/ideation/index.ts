/**
 * Ideation service exports
 * Provides configurable ideation providers (Anthropic Claude, Google Gemini)
 */

export type {
  IdeationResult,
  ResearchInsights,
  PromptVariation,
  PromptIdeator,
  IdeationProvider,
} from './types';

export { createAnthropicIdeator } from './anthropic-ideation';
export type { AnthropicIdeationConfig } from './anthropic-ideation';

export { createGeminiIdeator } from './gemini-ideation';
export type { GeminiIdeationConfig } from './gemini-ideation';

export { createIdeator, createIdeatorFromEnv } from './factory';
export type {
  IdeationFactoryConfig,
  CreateIdeatorFromEnvOptions,
} from './factory';

/**
 * Image Generation Service
 *
 * Provider-agnostic image generation with support for multiple backends.
 * Currently supports:
 * - Amazon Bedrock (Titan, SDXL)
 * - Google Gemini (Imagen 3, Gemini Flash)
 */

// Types and interfaces
export type {
  ImageProvider,
  BedrockModel,
  GeminiModel,
  GenerateImagesParams,
  GeneratedImageResult,
  ImageGeneratorConfig,
  ImageGenerator,
  PromptEnhancementConfig,
} from './types';

export { needsTransparency, enhancePrompt, buildNegativePrompt } from './types';

// Factory functions
export {
  createImageGenerator,
  createImageGeneratorFromEnv,
} from './factory';
export type { ImageGeneratorFactoryConfig } from './factory';

// Provider implementations (for direct use if needed)
export { createBedrockProvider } from './bedrock-provider';
export type { BedrockProviderConfig } from './bedrock-provider';

export { createGeminiProvider, createGeminiFlashProvider } from './gemini-provider';
export type { GeminiProviderConfig } from './gemini-provider';

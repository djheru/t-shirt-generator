/**
 * Image Generation Provider Abstraction
 *
 * This module defines the interface for image generation providers,
 * allowing easy switching between Bedrock, Gemini, or other providers.
 */

export type ImageProvider = 'bedrock' | 'gemini';
export type BedrockModel = 'titan' | 'sdxl';
export type GeminiModel = 'gemini-2.5-flash' | 'gemini-3-pro';

export interface GenerateImagesParams {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly imageCount: number;
  readonly width?: number;
  readonly height?: number;
  readonly cfgScale?: number;
  readonly seed?: number;
}

export interface GeneratedImageResult {
  readonly images: Buffer[];
  readonly provider: ImageProvider;
  readonly model: string;
  readonly metadata?: Record<string, unknown>;
}

export interface ImageGeneratorConfig {
  readonly provider: ImageProvider;
  readonly bedrockModel?: BedrockModel;
  readonly geminiModel?: GeminiModel;
  readonly geminiApiKey?: string;
}

/**
 * Interface that all image generation providers must implement
 */
export interface ImageGenerator {
  /**
   * Generate images from a text prompt
   */
  generate(params: GenerateImagesParams): Promise<GeneratedImageResult>;

  /**
   * Get the provider name
   */
  getProvider(): ImageProvider;

  /**
   * Get the model being used
   */
  getModel(): string;
}

/**
 * Prompt enhancement configuration
 */
export interface PromptEnhancementConfig {
  readonly suffix: string;
  readonly negativePrompt: string;
  readonly transparencySuffix: string;
  readonly transparencyNegativePrompt: string;
}

/**
 * Check if a prompt requests transparency
 */
export const needsTransparency = (prompt: string): boolean =>
  /transparent|no background|isolated/i.test(prompt);

/**
 * Enhance a prompt with t-shirt optimization suffixes
 */
export const enhancePrompt = (
  userPrompt: string,
  config: PromptEnhancementConfig
): string => {
  const transparent = needsTransparency(userPrompt);
  return transparent
    ? `${userPrompt}${config.suffix}${config.transparencySuffix}`
    : `${userPrompt}${config.suffix}`;
};

/**
 * Build negative prompt with transparency additions if needed
 */
export const buildNegativePrompt = (
  userPrompt: string,
  config: PromptEnhancementConfig
): string => {
  const transparent = needsTransparency(userPrompt);
  return transparent
    ? `${config.negativePrompt}${config.transparencyNegativePrompt}`
    : config.negativePrompt;
};

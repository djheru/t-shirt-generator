/**
 * Image Generation Provider Abstraction
 *
 * This module defines the interface for image generation providers,
 * allowing easy switching between Bedrock, Gemini, or other providers.
 */

export type ImageProvider = 'bedrock' | 'gemini';
export type BedrockModel = 'titan' | 'sdxl';
export type GeminiModel = 'gemini-2.5-flash' | 'gemini-3-pro';

export type AspectRatio = '1:1' | '4:5' | '5:4' | '3:4' | '4:3' | '9:16' | '16:9';

export interface GenerateImagesParams {
  readonly prompt: string;
  readonly negativePrompt?: string;
  readonly imageCount: number;
  readonly width?: number;
  readonly height?: number;
  readonly aspectRatio?: AspectRatio;
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
 * Prompt enhancement configuration for DTG t-shirt printing
 */
export interface PromptEnhancementConfig {
  /** Whether to default to transparent background when not specified */
  readonly defaultTransparent: boolean;
  /** Whether the user's prompt contains text to render */
  readonly hasTextContent: boolean;
}

/**
 * Check if a prompt requests transparency
 */
export const needsTransparency = (prompt: string): boolean =>
  /transparent|no background|isolated|floating/i.test(prompt);

/**
 * Check if a prompt requests a solid/specific background
 */
export const requestsSolidBackground = (prompt: string): boolean =>
  /on\s+(a\s+)?(white|black|colored?|solid|dark|light)\s+background/i.test(prompt) ||
  /background\s*(color|:)/i.test(prompt);

/**
 * Check if a prompt contains text that needs to be rendered
 */
export const containsTextRequest = (prompt: string): boolean =>
  /(saying|says|text|words?|quote|typography|lettering|"[^"]+"|'[^']+')/i.test(prompt);

/**
 * Build a DTG-optimized prompt for t-shirt graphic generation.
 *
 * Uses narrative description style as recommended by Gemini documentation.
 * Focuses on creating print-ready isolated graphics.
 */
export const buildDTGPrompt = (userPrompt: string): string => {
  const wantsTransparency = needsTransparency(userPrompt);
  const wantsSolidBackground = requestsSolidBackground(userPrompt);
  const hasText = containsTextRequest(userPrompt);

  // Determine background handling
  // NOTE: AI models cannot generate true PNG transparency - they render checkered patterns
  // instead. We request a solid white background and remove it in post-processing.
  let backgroundGuidance: string;
  if (wantsSolidBackground) {
    backgroundGuidance = 'Place the design on a clean, solid background as specified.';
  } else if (wantsTransparency || !wantsSolidBackground) {
    // Request solid white background for post-processing removal
    backgroundGuidance = 'Create the design as an isolated graphic element on a pure solid white background (#FFFFFF). The background must be completely uniform white with no gradients, shadows, or variations. The graphic should have clean, crisp edges that contrast clearly against the white background.';
  } else {
    backgroundGuidance = '';
  }

  // Text handling guidance
  const textGuidance = hasText
    ? 'Any text in the design must be perfectly legible, with correct spelling and proper grammar. Use clear, readable fonts that will reproduce well in print.'
    : '';

  // Build the narrative prompt
  const promptParts = [
    `Create a professional, print-ready graphic design for direct-to-garment (DTG) t-shirt printing.`,
    '',
    `Design concept: ${userPrompt}`,
    '',
    backgroundGuidance,
    textGuidance,
    '',
    'Technical requirements:',
    '- Create only the graphic design itself, NOT a mockup of a t-shirt with the design on it',
    '- Use bold, vibrant colors with high contrast that will reproduce well in DTG printing',
    '- Ensure clean, crisp edges suitable for fabric printing',
    '- Design should be an original creation - do not include any copyrighted characters, trademarked logos, brand names, or recognizable intellectual property',
    '- Style should be commercially appealing and marketable',
  ].filter(Boolean).join('\n');

  return promptParts;
};

/**
 * Build guidance for what to avoid in generation.
 * Uses positive framing where possible per Gemini best practices.
 */
export const buildAvoidanceGuidance = (userPrompt: string): string => {
  const hasText = containsTextRequest(userPrompt);
  const wantsSolidBackground = requestsSolidBackground(userPrompt);

  const avoidItems = [
    'mockups of t-shirts or clothing items',
    'blurry or low-resolution elements',
    'watermarks or signatures',
    'copyrighted characters or trademarked logos',
    'brand names or recognizable IP',
    'human models wearing the design',
  ];

  // Only avoid text if user didn't request it
  if (!hasText) {
    avoidItems.push('text, words, or lettering unless specifically requested');
  }

  // When we want transparency (solid white background for post-processing),
  // avoid checkered patterns and gradients
  if (!wantsSolidBackground) {
    avoidItems.push('checkered patterns in the background');
    avoidItems.push('gradient backgrounds');
    avoidItems.push('off-white or cream backgrounds');
  }

  return `Avoid: ${avoidItems.join(', ')}`;
};

// Legacy exports for backward compatibility
export interface LegacyPromptEnhancementConfig {
  readonly suffix: string;
  readonly negativePrompt: string;
  readonly transparencySuffix: string;
  readonly transparencyNegativePrompt: string;
}

/** @deprecated Use buildDTGPrompt instead */
export const enhancePrompt = (
  userPrompt: string,
  _config: LegacyPromptEnhancementConfig
): string => buildDTGPrompt(userPrompt);

/** @deprecated Use buildAvoidanceGuidance instead */
export const buildNegativePrompt = (
  userPrompt: string,
  _config: LegacyPromptEnhancementConfig
): string => buildAvoidanceGuidance(userPrompt);

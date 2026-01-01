import {
  needsTransparency,
  enhancePrompt,
  buildNegativePrompt,
  type PromptEnhancementConfig,
} from '../../../../src/services/image-generation';

describe('Image Generation Types', () => {
  const defaultConfig: PromptEnhancementConfig = {
    suffix: ', professional design',
    negativePrompt: 'blurry, low quality',
    transparencySuffix: ', transparent background',
    transparencyNegativePrompt: ', background elements',
  };

  describe('needsTransparency', () => {
    it('should return true for prompts with "transparent"', () => {
      expect(needsTransparency('A cat on transparent background')).toBe(true);
      expect(needsTransparency('Transparent logo design')).toBe(true);
    });

    it('should return true for prompts with "no background"', () => {
      expect(needsTransparency('A logo with no background')).toBe(true);
      expect(needsTransparency('No background please')).toBe(true);
    });

    it('should return true for prompts with "isolated"', () => {
      expect(needsTransparency('An isolated character')).toBe(true);
      expect(needsTransparency('Isolated on white')).toBe(true);
    });

    it('should return false for regular prompts', () => {
      expect(needsTransparency('A cool dragon design')).toBe(false);
      expect(needsTransparency('Sunset over mountains')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(needsTransparency('TRANSPARENT background')).toBe(true);
      expect(needsTransparency('No Background')).toBe(true);
      expect(needsTransparency('ISOLATED element')).toBe(true);
    });
  });

  describe('enhancePrompt', () => {
    it('should add suffix to regular prompts', () => {
      const result = enhancePrompt('A cool dragon', defaultConfig);
      expect(result).toBe('A cool dragon, professional design');
    });

    it('should add suffix and transparency suffix for transparency prompts', () => {
      const result = enhancePrompt('A logo transparent background', defaultConfig);
      expect(result).toBe('A logo transparent background, professional design, transparent background');
    });

    it('should handle empty prompt', () => {
      const result = enhancePrompt('', defaultConfig);
      expect(result).toBe(', professional design');
    });
  });

  describe('buildNegativePrompt', () => {
    it('should return base negative prompt for regular prompts', () => {
      const result = buildNegativePrompt('A cool dragon', defaultConfig);
      expect(result).toBe('blurry, low quality');
    });

    it('should add transparency negative prompt for transparency prompts', () => {
      const result = buildNegativePrompt('A logo transparent background', defaultConfig);
      expect(result).toBe('blurry, low quality, background elements');
    });
  });
});

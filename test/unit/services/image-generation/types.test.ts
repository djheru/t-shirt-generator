import {
  needsTransparency,
  requestsSolidBackground,
  containsTextRequest,
  buildDTGPrompt,
  buildAvoidanceGuidance,
} from '../../../../src/services/image-generation';

describe('Image Generation Types', () => {
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

    it('should return true for prompts with "floating"', () => {
      expect(needsTransparency('A floating astronaut')).toBe(true);
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

  describe('requestsSolidBackground', () => {
    it('should return true for prompts with solid background requests', () => {
      expect(requestsSolidBackground('Logo on a white background')).toBe(true);
      expect(requestsSolidBackground('Design on black background')).toBe(true);
      expect(requestsSolidBackground('Text on a solid background')).toBe(true);
    });

    it('should return true for colored background requests', () => {
      expect(requestsSolidBackground('Logo on a colored background')).toBe(true);
      expect(requestsSolidBackground('On dark background')).toBe(true);
      expect(requestsSolidBackground('On light background')).toBe(true);
    });

    it('should return true for background color specifications', () => {
      expect(requestsSolidBackground('background color: blue')).toBe(true);
      expect(requestsSolidBackground('background: red')).toBe(true);
    });

    it('should return false for regular prompts', () => {
      expect(requestsSolidBackground('A cool dragon design')).toBe(false);
      expect(requestsSolidBackground('Sunset over mountains')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(requestsSolidBackground('ON A WHITE BACKGROUND')).toBe(true);
      expect(requestsSolidBackground('On Black Background')).toBe(true);
    });
  });

  describe('containsTextRequest', () => {
    it('should return true for prompts with text requests', () => {
      expect(containsTextRequest('Logo saying "Hello World"')).toBe(true);
      expect(containsTextRequest('Design with text "Buy One Get One"')).toBe(true);
    });

    it('should return true for quoted text', () => {
      expect(containsTextRequest('A shirt with "Cool Vibes" on it')).toBe(true);
      expect(containsTextRequest("Design saying 'Be Happy'")).toBe(true);
    });

    it('should return true for typography requests', () => {
      expect(containsTextRequest('Typography design')).toBe(true);
      expect(containsTextRequest('Cool lettering art')).toBe(true);
    });

    it('should return true for word/quote requests', () => {
      expect(containsTextRequest('A motivational quote')).toBe(true);
      expect(containsTextRequest('The words "stay positive"')).toBe(true);
    });

    it('should return false for regular prompts', () => {
      expect(containsTextRequest('A cool dragon design')).toBe(false);
      expect(containsTextRequest('Sunset over mountains')).toBe(false);
    });

    it('should be case-insensitive', () => {
      expect(containsTextRequest('TEXT design')).toBe(true);
      expect(containsTextRequest('TYPOGRAPHY art')).toBe(true);
    });
  });

  describe('buildDTGPrompt', () => {
    it('should create a narrative prompt with DTG guidance', () => {
      const result = buildDTGPrompt('A cool dragon');
      expect(result).toContain('direct-to-garment');
      expect(result).toContain('Design concept: A cool dragon');
      expect(result).toContain('NOT a mockup');
    });

    it('should include solid white background for post-processing transparency', () => {
      // AI models cannot generate true alpha transparency, so we request solid white
      // background which is then removed in post-processing
      const result = buildDTGPrompt('A cool dragon');
      expect(result).toContain('solid white background');
      expect(result).toContain('#FFFFFF');
      expect(result).toContain('isolated graphic');
    });

    it('should respect solid background requests', () => {
      const result = buildDTGPrompt('Logo on a white background');
      expect(result).toContain('solid background as specified');
      expect(result).not.toContain('transparent background');
    });

    it('should include text guidance when text is requested', () => {
      const result = buildDTGPrompt('Logo saying "Hello World"');
      expect(result).toContain('legible');
      expect(result).toContain('spelling');
    });

    it('should not include text guidance for non-text prompts', () => {
      const result = buildDTGPrompt('A cool dragon');
      expect(result).not.toContain('legible');
      expect(result).not.toContain('spelling');
    });

    it('should include copyright avoidance guidance', () => {
      const result = buildDTGPrompt('A cool design');
      expect(result).toContain('copyrighted');
      expect(result).toContain('trademarked');
    });

    it('should emphasize print quality', () => {
      const result = buildDTGPrompt('A cool design');
      expect(result).toContain('bold, vibrant colors');
      expect(result).toContain('high contrast');
      expect(result).toContain('clean, crisp edges');
    });
  });

  describe('buildAvoidanceGuidance', () => {
    it('should include standard avoidance items', () => {
      const result = buildAvoidanceGuidance('A cool dragon');
      expect(result).toContain('mockups');
      expect(result).toContain('blurry');
      expect(result).toContain('watermarks');
      expect(result).toContain('copyrighted');
    });

    it('should avoid text for non-text prompts', () => {
      const result = buildAvoidanceGuidance('A cool dragon');
      expect(result).toContain('text, words, or lettering');
    });

    it('should not avoid text when text is requested', () => {
      const result = buildAvoidanceGuidance('Logo saying "Hello World"');
      expect(result).not.toContain('text, words, or lettering');
    });

    it('should avoid human models', () => {
      const result = buildAvoidanceGuidance('A cool design');
      expect(result).toContain('human models');
    });

    it('should avoid checkered patterns and gradients for transparency prompts', () => {
      const result = buildAvoidanceGuidance('A cool dragon');
      expect(result).toContain('checkered patterns');
      expect(result).toContain('gradient backgrounds');
      expect(result).toContain('off-white');
    });

    it('should not avoid checkered patterns when solid background is requested', () => {
      const result = buildAvoidanceGuidance('Logo on a white background');
      expect(result).not.toContain('checkered patterns');
      expect(result).not.toContain('gradient backgrounds');
    });
  });
});

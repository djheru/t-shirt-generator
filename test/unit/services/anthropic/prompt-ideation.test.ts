// Setup mock before any imports
const mockCreate = jest.fn();

jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: function MockAnthropic() {
    return {
      messages: {
        create: mockCreate,
      },
    };
  },
}));

import { createAnthropicIdeator } from '../../../../src/services/ideation';

describe('Prompt Ideation Service', () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  // Sample valid JSON response matching the new format
  const validJsonResponse = {
    theme: 'retro gaming',
    research_insights: {
      trending_keywords: ['pixel art', '8-bit', 'arcade', 'nostalgia'],
      popular_visuals: ['neon colors', 'CRT effects', 'glitch art'],
      market_context: 'Retro gaming continues to be popular with millennials seeking nostalgic designs.',
    },
    prompts: [
      {
        name: 'Pixel Crown',
        concept: 'Empowerment through classic gaming imagery',
        prompt: 'Flat vector illustration of a golden pixel art crown, metallic gold on solid black background, bold graphic style',
      },
      {
        name: 'Legacy Controller',
        concept: 'Generational wealth meets gaming heritage',
        prompt: 'Minimalist geometric game controller icon in gold and burnt orange, isolated on black background, screen print style',
      },
    ],
  };

  describe('createAnthropicIdeator', () => {
    it('should create an ideator with provided config', () => {
      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      expect(ideator).toBeDefined();
      expect(ideator.generatePrompts).toBeDefined();
      expect(ideator.getProvider()).toBe('anthropic');
      expect(ideator.getModel()).toBe('claude-sonnet-4-5-20250929');
    });
  });

  describe('generatePrompts', () => {
    it('should generate prompts from Claude JSON response', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: JSON.stringify(validJsonResponse),
          },
        ],
      };

      mockCreate.mockResolvedValueOnce(mockResponse);

      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      const result = await ideator.generatePrompts('retro gaming');

      expect(result.prompts).toHaveLength(2);
      expect(result.theme).toBe('retro gaming');
      expect(result.research_insights.trending_keywords).toContain('pixel art');
      expect(result.research_insights.market_context).toContain('Retro gaming');
      expect(result.prompts[0].name).toBe('Pixel Crown');
      expect(result.prompts[0].concept).toContain('Empowerment');
      expect(result.prompts[0].prompt).toContain('golden pixel art crown');
    });

    it('should extract JSON even with surrounding text', async () => {
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: `Here is my research and prompts:\n\n${JSON.stringify(validJsonResponse)}\n\nLet me know if you need more!`,
          },
        ],
      };

      mockCreate.mockResolvedValueOnce(mockResponse);

      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      const result = await ideator.generatePrompts('retro gaming');

      expect(result.prompts).toHaveLength(2);
      expect(result.theme).toBe('retro gaming');
    });

    it('should handle multiple text blocks from web search tool use', async () => {
      // When web search is used, there may be multiple text blocks
      const mockResponse = {
        content: [
          {
            type: 'text',
            text: 'Let me search for current trends...',
          },
          {
            type: 'tool_use',
            id: 'search_1',
            name: 'web_search',
            input: { query: 'retro gaming t-shirt designs 2025' },
          },
          {
            type: 'text',
            text: JSON.stringify(validJsonResponse),
          },
        ],
      };

      mockCreate.mockResolvedValueOnce(mockResponse);

      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      const result = await ideator.generatePrompts('retro gaming');

      expect(result.prompts).toHaveLength(2);
      expect(result.research_insights.trending_keywords.length).toBeGreaterThan(0);
    });

    it('should throw error when no text content in response', async () => {
      mockCreate.mockResolvedValueOnce({ content: [] });

      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      await expect(ideator.generatePrompts('test')).rejects.toThrow('No text content in Claude response');
    });

    it('should throw error when no JSON found in response', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'Some random text without JSON' }],
      });

      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      await expect(ideator.generatePrompts('test')).rejects.toThrow('No JSON object found');
    });

    it('should throw error when JSON is missing required fields', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"theme": "test"}' }],
      });

      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      await expect(ideator.generatePrompts('test')).rejects.toThrow('missing required fields');
    });

    it('should throw error when prompts array is empty', async () => {
      const emptyPrompts = { ...validJsonResponse, prompts: [] };
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(emptyPrompts) }],
      });

      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      await expect(ideator.generatePrompts('test')).rejects.toThrow('prompts must be a non-empty array');
    });

    it('should call Claude with web search tool', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(validJsonResponse) }],
      });

      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      await ideator.generatePrompts('retro gaming');

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          model: 'claude-sonnet-4-5-20250929',
          max_tokens: 4096,
          tools: [
            {
              type: 'web_search_20250305',
              name: 'web_search',
            },
          ],
          messages: [
            {
              role: 'user',
              content: 'Research current trends and create t-shirt design prompts for this theme: "retro gaming"',
            },
          ],
        })
      );
    });

    it('should propagate API errors', async () => {
      mockCreate.mockRejectedValueOnce(new Error('API error'));

      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      await expect(ideator.generatePrompts('test')).rejects.toThrow('API error');
    });

    it('should include model in result', async () => {
      mockCreate.mockResolvedValueOnce({
        content: [{ type: 'text', text: JSON.stringify(validJsonResponse) }],
      });

      const ideator = createAnthropicIdeator({ apiKey: 'test-api-key' });
      const result = await ideator.generatePrompts('retro gaming');

      expect(result.model).toBe('claude-sonnet-4-5-20250929');
    });
  });
});

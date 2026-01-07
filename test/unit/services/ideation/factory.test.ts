// Setup mocks before any imports
jest.mock('@anthropic-ai/sdk', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation(() => ({
    messages: { create: jest.fn() },
  })),
}));

jest.mock('@google/genai', () => ({
  GoogleGenAI: jest.fn().mockImplementation(() => ({
    models: { generateContent: jest.fn() },
  })),
}));

import {
  createIdeator,
  createIdeatorFromEnv,
  type IdeationFactoryConfig,
} from '../../../../src/services/ideation';

describe('Ideation Factory', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('createIdeator', () => {
    it('should create Anthropic ideator when provider is anthropic', () => {
      const config: IdeationFactoryConfig = {
        provider: 'anthropic',
        anthropicApiKey: 'test-api-key',
      };

      const ideator = createIdeator(config);

      expect(ideator.getProvider()).toBe('anthropic');
      expect(ideator.getModel()).toBe('claude-sonnet-4-5-20250929');
    });

    it('should create Gemini ideator when provider is gemini', () => {
      const config: IdeationFactoryConfig = {
        provider: 'gemini',
        geminiApiKey: 'test-api-key',
      };

      const ideator = createIdeator(config);

      expect(ideator.getProvider()).toBe('gemini');
      expect(ideator.getModel()).toBe('gemini-2.5-flash');
    });

    it('should throw when anthropic provider is missing API key', () => {
      const config: IdeationFactoryConfig = {
        provider: 'anthropic',
      };

      expect(() => createIdeator(config)).toThrow(
        'Anthropic API key is required for anthropic provider'
      );
    });

    it('should throw when gemini provider is missing API key', () => {
      const config: IdeationFactoryConfig = {
        provider: 'gemini',
      };

      expect(() => createIdeator(config)).toThrow(
        'Gemini API key is required for gemini provider'
      );
    });

    it('should use custom model for anthropic', () => {
      const config: IdeationFactoryConfig = {
        provider: 'anthropic',
        anthropicApiKey: 'test-api-key',
        anthropicModel: 'claude-opus-4-20250514',
      };

      const ideator = createIdeator(config);

      expect(ideator.getModel()).toBe('claude-opus-4-20250514');
    });

    it('should use custom model for gemini', () => {
      const config: IdeationFactoryConfig = {
        provider: 'gemini',
        geminiApiKey: 'test-api-key',
        geminiModel: 'gemini-2.0-pro',
      };

      const ideator = createIdeator(config);

      expect(ideator.getModel()).toBe('gemini-2.0-pro');
    });
  });

  describe('createIdeatorFromEnv', () => {
    const mockGetSecret = jest.fn();

    beforeEach(() => {
      mockGetSecret.mockReset();
    });

    it('should default to gemini provider when IDEATION_PROVIDER not set', async () => {
      process.env.GEMINI_API_KEY_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:gemini-key';
      mockGetSecret.mockResolvedValueOnce('test-gemini-api-key');

      const ideator = await createIdeatorFromEnv({ getSecret: mockGetSecret });

      expect(ideator.getProvider()).toBe('gemini');
      expect(mockGetSecret).toHaveBeenCalledWith(process.env.GEMINI_API_KEY_ARN);
    });

    it('should create anthropic ideator when IDEATION_PROVIDER is anthropic', async () => {
      process.env.IDEATION_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:anthropic-key';
      mockGetSecret.mockResolvedValueOnce('test-anthropic-api-key');

      const ideator = await createIdeatorFromEnv({ getSecret: mockGetSecret });

      expect(ideator.getProvider()).toBe('anthropic');
      expect(mockGetSecret).toHaveBeenCalledWith(process.env.ANTHROPIC_API_KEY_ARN);
    });

    it('should create gemini ideator when IDEATION_PROVIDER is gemini', async () => {
      process.env.IDEATION_PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:gemini-key';
      mockGetSecret.mockResolvedValueOnce('test-gemini-api-key');

      const ideator = await createIdeatorFromEnv({ getSecret: mockGetSecret });

      expect(ideator.getProvider()).toBe('gemini');
    });

    it('should throw when ANTHROPIC_API_KEY_ARN not set for anthropic provider', async () => {
      process.env.IDEATION_PROVIDER = 'anthropic';
      delete process.env.ANTHROPIC_API_KEY_ARN;

      await expect(createIdeatorFromEnv({ getSecret: mockGetSecret })).rejects.toThrow(
        'ANTHROPIC_API_KEY_ARN environment variable not set'
      );
    });

    it('should throw when GEMINI_API_KEY_ARN not set for gemini provider', async () => {
      process.env.IDEATION_PROVIDER = 'gemini';
      delete process.env.GEMINI_API_KEY_ARN;

      await expect(createIdeatorFromEnv({ getSecret: mockGetSecret })).rejects.toThrow(
        'GEMINI_API_KEY_ARN environment variable not set'
      );
    });

    it('should use ANTHROPIC_MODEL env var when provided', async () => {
      process.env.IDEATION_PROVIDER = 'anthropic';
      process.env.ANTHROPIC_API_KEY_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:anthropic-key';
      process.env.ANTHROPIC_MODEL = 'claude-opus-4-20250514';
      mockGetSecret.mockResolvedValueOnce('test-anthropic-api-key');

      const ideator = await createIdeatorFromEnv({ getSecret: mockGetSecret });

      expect(ideator.getModel()).toBe('claude-opus-4-20250514');
    });

    it('should use GEMINI_IDEATION_MODEL env var when provided', async () => {
      process.env.IDEATION_PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY_ARN = 'arn:aws:secretsmanager:us-east-1:123456789012:secret:gemini-key';
      process.env.GEMINI_IDEATION_MODEL = 'gemini-2.0-pro';
      mockGetSecret.mockResolvedValueOnce('test-gemini-api-key');

      const ideator = await createIdeatorFromEnv({ getSecret: mockGetSecret });

      expect(ideator.getModel()).toBe('gemini-2.0-pro');
    });
  });
});

import { createImageGenerator, createImageGeneratorFromEnv } from '../../../../src/services/image-generation';

// Mock the Bedrock SDK
jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({
    send: jest.fn(),
  })),
  InvokeModelCommand: jest.fn(),
  ThrottlingException: class ThrottlingException extends Error {},
}));

// Mock the Google Generative AI SDK
jest.mock('@google/generative-ai', () => ({
  GoogleGenerativeAI: jest.fn().mockImplementation(() => ({
    getGenerativeModel: jest.fn(),
  })),
}));

describe('Image Generation Factory', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createImageGenerator', () => {
    it('should create a Bedrock provider with Titan model', () => {
      const generator = createImageGenerator({
        provider: 'bedrock',
        bedrockModel: 'titan',
      });

      expect(generator.getProvider()).toBe('bedrock');
      expect(generator.getModel()).toBe('amazon.titan-image-generator-v2:0');
    });

    it('should create a Bedrock provider with SDXL model', () => {
      const generator = createImageGenerator({
        provider: 'bedrock',
        bedrockModel: 'sdxl',
      });

      expect(generator.getProvider()).toBe('bedrock');
      expect(generator.getModel()).toBe('stability.stable-diffusion-xl-v1');
    });

    it('should default to Titan model when bedrockModel is not specified', () => {
      const generator = createImageGenerator({
        provider: 'bedrock',
      });

      expect(generator.getProvider()).toBe('bedrock');
      expect(generator.getModel()).toBe('amazon.titan-image-generator-v2:0');
    });

    it('should create a Gemini provider with gemini-3-pro', () => {
      const generator = createImageGenerator({
        provider: 'gemini',
        geminiApiKey: 'test-api-key',
        geminiModel: 'gemini-3-pro',
      });

      expect(generator.getProvider()).toBe('gemini');
      expect(generator.getModel()).toBe('gemini-3-pro-image-preview');
    });

    it('should create a Gemini provider with gemini-2.5-flash', () => {
      const generator = createImageGenerator({
        provider: 'gemini',
        geminiApiKey: 'test-api-key',
        geminiModel: 'gemini-2.5-flash',
      });

      expect(generator.getProvider()).toBe('gemini');
      expect(generator.getModel()).toBe('gemini-2.5-flash-preview-05-20');
    });

    it('should throw error when Gemini API key is missing', () => {
      expect(() =>
        createImageGenerator({
          provider: 'gemini',
          geminiModel: 'gemini-3-pro',
        })
      ).toThrow('Gemini API key is required for Gemini provider');
    });

    it('should create a Gemini Flash provider when useGeminiFlash is true', () => {
      const generator = createImageGenerator({
        provider: 'gemini',
        geminiApiKey: 'test-api-key',
        useGeminiFlash: true,
      });

      expect(generator.getProvider()).toBe('gemini');
      expect(generator.getModel()).toBe('gemini-2.5-flash-preview-05-20');
    });
  });

  describe('createImageGeneratorFromEnv', () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { ...originalEnv };
    });

    afterEach(() => {
      process.env = originalEnv;
    });

    it('should create Bedrock provider from env with defaults', async () => {
      const mockGetSecret = jest.fn();

      const generator = await createImageGeneratorFromEnv(mockGetSecret);

      expect(generator.getProvider()).toBe('bedrock');
      expect(generator.getModel()).toBe('amazon.titan-image-generator-v2:0');
      expect(mockGetSecret).not.toHaveBeenCalled();
    });

    it('should create Bedrock provider with custom model from env', async () => {
      process.env.IMAGE_PROVIDER = 'bedrock';
      process.env.BEDROCK_MODEL = 'sdxl';

      const mockGetSecret = jest.fn();

      const generator = await createImageGeneratorFromEnv(mockGetSecret);

      expect(generator.getProvider()).toBe('bedrock');
      expect(generator.getModel()).toBe('stability.stable-diffusion-xl-v1');
    });

    it('should create Gemini provider and load API key from secrets', async () => {
      process.env.IMAGE_PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY_ARN = 'arn:aws:secretsmanager:us-east-1:123456789:secret:gemini-key';

      const mockGetSecret = jest.fn().mockResolvedValue('test-gemini-api-key');

      const generator = await createImageGeneratorFromEnv(mockGetSecret);

      expect(generator.getProvider()).toBe('gemini');
      expect(mockGetSecret).toHaveBeenCalledWith(
        'arn:aws:secretsmanager:us-east-1:123456789:secret:gemini-key'
      );
    });

    it('should throw error when Gemini is selected but API key ARN is missing', async () => {
      process.env.IMAGE_PROVIDER = 'gemini';
      delete process.env.GEMINI_API_KEY_ARN;

      const mockGetSecret = jest.fn();

      await expect(createImageGeneratorFromEnv(mockGetSecret)).rejects.toThrow(
        'GEMINI_API_KEY_ARN environment variable is required for Gemini provider'
      );
    });

    it('should create Gemini Flash provider when USE_GEMINI_FLASH is true', async () => {
      process.env.IMAGE_PROVIDER = 'gemini';
      process.env.GEMINI_API_KEY_ARN = 'arn:aws:secretsmanager:us-east-1:123456789:secret:gemini-key';
      process.env.USE_GEMINI_FLASH = 'true';

      const mockGetSecret = jest.fn().mockResolvedValue('test-gemini-api-key');

      const generator = await createImageGeneratorFromEnv(mockGetSecret);

      expect(generator.getProvider()).toBe('gemini');
      expect(generator.getModel()).toBe('gemini-2.5-flash-preview-05-20');
    });
  });
});

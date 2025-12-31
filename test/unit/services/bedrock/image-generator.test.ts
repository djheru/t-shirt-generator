import { mockClient } from 'aws-sdk-client-mock';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import {
  generateImages,
  enhancePrompt,
  buildNegativePrompt,
  resetBedrockClient,
} from '../../../../src/services/bedrock/image-generator';

const bedrockMock = mockClient(BedrockRuntimeClient);

// Helper to create mock response body that satisfies the SDK types
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const createMockBody = (data: unknown): any => {
  const encoded = new TextEncoder().encode(JSON.stringify(data));
  // Create an object that satisfies the Uint8ArrayBlobAdapter interface
  return Object.assign(encoded, {
    transformToString: () => JSON.stringify(data),
  });
};

describe('Bedrock Image Generator', () => {
  beforeEach(() => {
    bedrockMock.reset();
    resetBedrockClient();
  });

  describe('generateImages', () => {
    describe('with Titan model', () => {
      it('should generate images using Titan model', async () => {
        const mockImages = [
          Buffer.from('image1').toString('base64'),
          Buffer.from('image2').toString('base64'),
          Buffer.from('image3').toString('base64'),
        ];

        bedrockMock.on(InvokeModelCommand).resolves({
          body: createMockBody({ images: mockImages }),
        });

        const result = await generateImages({
          prompt: 'A sunset over mountains',
          model: 'titan',
          imageCount: 3,
        });

        expect(result.model).toBe('titan');
        expect(result.images).toHaveLength(3);
        expect(result.images[0]).toEqual(Buffer.from('image1'));
        expect(result.images[1]).toEqual(Buffer.from('image2'));
        expect(result.images[2]).toEqual(Buffer.from('image3'));

        expect(bedrockMock.calls()).toHaveLength(1);
      });

      it('should include negative prompt when provided', async () => {
        const mockImages = [Buffer.from('image1').toString('base64')];

        bedrockMock.on(InvokeModelCommand).resolves({
          body: createMockBody({ images: mockImages }),
        });

        await generateImages({
          prompt: 'A sunset',
          negativePrompt: 'blurry, low quality',
          model: 'titan',
          imageCount: 1,
        });

        expect(bedrockMock.calls()).toHaveLength(1);
      });
    });

    describe('with SDXL model', () => {
      it('should generate images using SDXL model (multiple calls)', async () => {
        const mockResponse = {
          artifacts: [
            {
              base64: Buffer.from('sdxl-image').toString('base64'),
              seed: 12345,
              finishReason: 'SUCCESS',
            },
          ],
        };

        bedrockMock.on(InvokeModelCommand).resolves({
          body: createMockBody(mockResponse),
        });

        const result = await generateImages({
          prompt: 'A mountain landscape',
          model: 'sdxl',
          imageCount: 3,
        });

        expect(result.model).toBe('sdxl');
        expect(result.images).toHaveLength(3);

        // SDXL makes one call per image
        expect(bedrockMock.calls()).toHaveLength(3);
      });
    });

    it('should throw error when Bedrock call fails', async () => {
      bedrockMock.on(InvokeModelCommand).rejects(new Error('Bedrock error'));

      await expect(
        generateImages({
          prompt: 'Test prompt',
          model: 'titan',
          imageCount: 1,
        })
      ).rejects.toThrow('Bedrock error');
    });
  });

  describe('enhancePrompt', () => {
    it('should append suffix to prompt', () => {
      const result = enhancePrompt(
        'A cool design',
        ', high quality',
        ', transparent background'
      );

      expect(result).toBe('A cool design, high quality');
    });

    it('should append transparency suffix when prompt mentions transparency', () => {
      const result = enhancePrompt(
        'A cool design on transparent background',
        ', high quality',
        ', isolated on transparent'
      );

      expect(result).toBe(
        'A cool design on transparent background, high quality, isolated on transparent'
      );
    });

    it('should detect "no background" keyword', () => {
      const result = enhancePrompt(
        'A logo with no background',
        ', high quality',
        ', isolated'
      );

      expect(result).toContain(', isolated');
    });

    it('should detect "isolated" keyword', () => {
      const result = enhancePrompt(
        'An isolated icon',
        ', high quality',
        ', PNG alpha'
      );

      expect(result).toContain(', PNG alpha');
    });
  });

  describe('buildNegativePrompt', () => {
    it('should return base negative prompt for normal prompts', () => {
      const result = buildNegativePrompt(
        'blurry, low quality',
        ', background',
        'A cool design'
      );

      expect(result).toBe('blurry, low quality');
    });

    it('should append transparency negative for transparency prompts', () => {
      const result = buildNegativePrompt(
        'blurry, low quality',
        ', background',
        'A design on transparent background'
      );

      expect(result).toBe('blurry, low quality, background');
    });
  });
});

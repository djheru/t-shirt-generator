import type { BedrockModel, PromptEnhancementConfig } from '../types/domain.types';

interface Config {
  readonly slack: {
    readonly signingSecret: string;
    readonly botToken: string;
    readonly allowedChannelId: string;
  };
  readonly bedrock: {
    readonly model: BedrockModel;
    readonly imageCount: number;
    readonly imageWidth: number;
    readonly imageHeight: number;
    readonly cfgScale: number;
  };
  readonly storage: {
    readonly imagesBucket: string;
    readonly requestsTable: string;
    readonly imagesTable: string;
  };
  readonly presignedUrlExpiry: number;
  readonly promptEnhancement: PromptEnhancementConfig;
}

const getEnvOrThrow = (key: string): string => {
  const value = process.env[key];
  if (!value) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value;
};

const getEnvOrDefault = (key: string, defaultValue: string): string => {
  return process.env[key] ?? defaultValue;
};

const parseBedrockModel = (value: string): BedrockModel => {
  if (value === 'titan' || value === 'sdxl') {
    return value;
  }
  throw new Error(`Invalid BEDROCK_MODEL value: ${value}. Must be 'titan' or 'sdxl'`);
};

export const getConfig = (): Config => ({
  slack: {
    signingSecret: getEnvOrThrow('SLACK_SIGNING_SECRET'),
    botToken: getEnvOrThrow('SLACK_BOT_TOKEN'),
    allowedChannelId: getEnvOrThrow('ALLOWED_CHANNEL_ID'),
  },
  bedrock: {
    model: parseBedrockModel(getEnvOrDefault('BEDROCK_MODEL', 'titan')),
    imageCount: 3,
    imageWidth: 1024,
    imageHeight: 1024,
    cfgScale: 8.0,
  },
  storage: {
    imagesBucket: getEnvOrThrow('IMAGES_BUCKET'),
    requestsTable: getEnvOrThrow('REQUESTS_TABLE'),
    imagesTable: getEnvOrThrow('IMAGES_TABLE'),
  },
  presignedUrlExpiry: parseInt(getEnvOrDefault('PRESIGNED_URL_EXPIRY', '604800'), 10),
  promptEnhancement: {
    suffix: getEnvOrDefault(
      'PROMPT_SUFFIX',
      ', high quality, professional graphic design, suitable for t-shirt print, bold colors'
    ),
    negativePrompt: getEnvOrDefault(
      'NEGATIVE_PROMPT',
      'blurry, low quality, distorted, watermark, text, words, letters, signature, logo'
    ),
    transparencySuffix: ', isolated on transparent background, no background, PNG with alpha channel',
    transparencyNegativePrompt: ', background, backdrop, scenery, environment',
  },
});

export const BEDROCK_MODEL_IDS: Record<BedrockModel, string> = {
  titan: 'amazon.titan-image-generator-v2:0',
  sdxl: 'stability.stable-diffusion-xl-v1',
};

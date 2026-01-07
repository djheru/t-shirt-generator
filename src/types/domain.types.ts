import { z } from 'zod';

export type RequestStatus = 'pending' | 'generating' | 'completed' | 'failed';
export type ImageStatus = 'generated' | 'kept' | 'discarded';
export type BedrockModel = 'titan' | 'sdxl';

export interface GenerationRequest {
  readonly requestId: string;
  readonly userId: string;
  readonly channelId: string;
  readonly prompt: string;
  readonly enhancedPrompt: string;
  readonly status: RequestStatus;
  readonly model: BedrockModel;
  readonly responseUrl: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly ttl?: number;
}

export interface GeneratedImage {
  readonly imageId: string;
  readonly requestId: string;
  readonly s3Key: string;
  readonly status: ImageStatus;
  readonly presignedUrl?: string;
  readonly presignedUrlExpiry?: string;
  readonly createdAt: string;
  readonly ttl?: number;
}

export interface GenerationJobMessage {
  readonly requestId: string;
  readonly userId: string;
  readonly channelId: string;
  readonly prompt: string;
  readonly responseUrl: string;
}

export interface ActionJobMessage {
  readonly action: 'keep' | 'discard' | 'keep_all' | 'discard_all' | 'regenerate_all';
  readonly imageId?: string;
  readonly requestId: string;
  readonly userId: string;
  readonly channelId: string;
  readonly responseUrl: string;
  readonly originalPrompt?: string;
}

export interface IdeationJobMessage {
  readonly theme: string;
  readonly userId: string;
  readonly channelId: string;
  readonly responseUrl: string;
}

export const GenerationJobMessageSchema = z.object({
  requestId: z.string().uuid(),
  userId: z.string().min(1),
  channelId: z.string().min(1),
  prompt: z.string().min(1).max(1000),
  responseUrl: z.string().url(),
});

export const ActionJobMessageSchema = z.object({
  action: z.enum(['keep', 'discard', 'keep_all', 'discard_all', 'regenerate_all']),
  imageId: z.string().uuid().optional(),
  requestId: z.string().uuid(),
  userId: z.string().min(1),
  channelId: z.string().min(1),
  responseUrl: z.string().url(),
  originalPrompt: z.string().optional(),
});

export const IdeationJobMessageSchema = z.object({
  theme: z.string().min(1).max(500),
  userId: z.string().min(1),
  channelId: z.string().min(1),
  responseUrl: z.string().url(),
});

export interface PromptEnhancementConfig {
  readonly suffix: string;
  readonly negativePrompt: string;
  readonly transparencySuffix: string;
  readonly transparencyNegativePrompt: string;
}

export interface BedrockGenerationResult {
  readonly images: Buffer[];
  readonly model: BedrockModel;
}

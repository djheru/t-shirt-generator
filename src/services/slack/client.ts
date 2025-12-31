import { WebClient } from '@slack/web-api';
import { Logger } from '@aws-lambda-powertools/logger';
import type { SlackBlock, SlackResponse } from '../../types/slack.types';

const logger = new Logger({ serviceName: 't-shirt-generator' });

let webClientInstance: WebClient | null = null;

export const getSlackClient = (token: string): WebClient => {
  if (!webClientInstance) {
    webClientInstance = new WebClient(token, {
      retryConfig: {
        retries: 3,
        factor: 2,
        minTimeout: 1000,
        maxTimeout: 10000,
      },
    });
  }
  return webClientInstance;
};

export const resetSlackClient = (): void => {
  webClientInstance = null;
};

export interface PostMessageParams {
  readonly token: string;
  readonly channel: string;
  readonly text: string;
  readonly blocks?: SlackBlock[];
  readonly threadTs?: string;
}

export interface UpdateMessageParams {
  readonly token: string;
  readonly channel: string;
  readonly ts: string;
  readonly text?: string;
  readonly blocks?: SlackBlock[];
}

export interface UploadImageParams {
  readonly token: string;
  readonly channel: string;
  readonly imageBuffer: Buffer;
  readonly filename: string;
  readonly title?: string;
  readonly initialComment?: string;
  readonly threadTs?: string;
}

export const postMessage = async ({
  token,
  channel,
  text,
  blocks,
  threadTs,
}: PostMessageParams): Promise<string | undefined> => {
  const client = getSlackClient(token);

  try {
    const result = await client.chat.postMessage({
      channel,
      text,
      blocks,
      thread_ts: threadTs,
    });

    if (!result.ok) {
      logger.error('Failed to post message', { error: result.error });
      throw new Error(`Slack API error: ${result.error}`);
    }

    return result.ts;
  } catch (error) {
    logger.error('Error posting message to Slack', { error });
    throw error;
  }
};

export const updateMessage = async ({
  token,
  channel,
  ts,
  text,
  blocks,
}: UpdateMessageParams): Promise<void> => {
  const client = getSlackClient(token);

  try {
    const result = await client.chat.update({
      channel,
      ts,
      text,
      // Cast blocks to any to avoid type conflicts with Slack SDK
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      blocks: blocks as any,
    });

    if (!result.ok) {
      logger.error('Failed to update message', { error: result.error });
      throw new Error(`Slack API error: ${result.error}`);
    }
  } catch (error) {
    logger.error('Error updating message in Slack', { error });
    throw error;
  }
};

export const uploadImage = async ({
  token,
  channel,
  imageBuffer,
  filename,
  title,
  initialComment,
  threadTs,
}: UploadImageParams): Promise<string | undefined> => {
  const client = getSlackClient(token);

  try {
    // Build upload params, only including thread_ts if defined
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const uploadParams: any = {
      channel_id: channel,
      file: imageBuffer,
      filename,
      title,
      initial_comment: initialComment,
    };

    if (threadTs) {
      uploadParams.thread_ts = threadTs;
    }

    const result = await client.files.uploadV2(uploadParams);

    if (!result.ok) {
      logger.error('Failed to upload image', { error: result.error });
      throw new Error(`Slack API error: ${result.error}`);
    }

    // Return the file ID if available
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const files = (result as any).files;
    if (files && files.length > 0) {
      return files[0].id;
    }

    return undefined;
  } catch (error) {
    logger.error('Error uploading image to Slack', { error });
    throw error;
  }
};

export const respondToWebhook = async (
  responseUrl: string,
  response: SlackResponse
): Promise<void> => {
  try {
    const result = await fetch(responseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(response),
    });

    if (!result.ok) {
      const text = await result.text();
      logger.error('Failed to respond to webhook', {
        status: result.status,
        body: text,
      });
      throw new Error(`Webhook response failed: ${result.status}`);
    }
  } catch (error) {
    logger.error('Error responding to webhook', { error });
    throw error;
  }
};

export const deleteMessage = async (
  token: string,
  channel: string,
  ts: string
): Promise<void> => {
  const client = getSlackClient(token);

  try {
    const result = await client.chat.delete({
      channel,
      ts,
    });

    if (!result.ok) {
      logger.error('Failed to delete message', { error: result.error });
      throw new Error(`Slack API error: ${result.error}`);
    }
  } catch (error) {
    logger.error('Error deleting message from Slack', { error });
    throw error;
  }
};

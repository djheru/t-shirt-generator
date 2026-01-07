import type { SQSEvent, SQSBatchResponse } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { createIdeatorFromEnv } from '../services/ideation';
import { getSecretValue } from '../services/storage/secrets';
import {
  respondToWebhook,
  buildIdeationResultMessage,
  buildIdeationFailedMessage,
} from '../services/slack';
import { IdeationJobMessageSchema } from '../types/domain.types';

const logger = new Logger({ serviceName: 't-shirt-generator', logLevel: 'INFO' });

export const handler = async (event: SQSEvent): Promise<SQSBatchResponse> => {
  const batchItemFailures: SQSBatchResponse['batchItemFailures'] = [];

  for (const record of event.Records) {
    try {
      await processIdeationJob(record.body);
    } catch (error) {
      logger.error('Failed to process ideation job', {
        error,
        messageId: record.messageId,
      });
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures };
};

const processIdeationJob = async (messageBody: string): Promise<void> => {
  // Parse and validate the message
  const rawMessage = JSON.parse(messageBody);
  const parseResult = IdeationJobMessageSchema.safeParse(rawMessage);

  if (!parseResult.success) {
    logger.error('Invalid ideation job message', {
      errors: parseResult.error.issues,
    });
    throw new Error('Invalid ideation job message');
  }

  const message = parseResult.data;
  const { theme, userId, channelId, responseUrl } = message;

  logger.info('Processing ideation job', { theme, userId, channelId });

  try {
    // Create ideator from environment configuration (supports Anthropic and Gemini)
    const ideator = await createIdeatorFromEnv({ getSecret: getSecretValue });
    const result = await ideator.generatePrompts(theme);

    logger.info('Using ideation provider', {
      provider: ideator.getProvider(),
      model: ideator.getModel(),
    });

    logger.info('Ideation complete', {
      theme,
      promptCount: result.prompts.length,
      trendingKeywords: result.research_insights.trending_keywords.length,
      channelId,
    });

    // Post results to Slack via response_url
    await respondToWebhook(responseUrl, {
      response_type: 'in_channel',
      blocks: buildIdeationResultMessage(result),
    });

    logger.info('Posted ideation results to Slack', { theme, channelId });
  } catch (error) {
    logger.error('Ideation failed', { error, theme });

    // Post error message to Slack
    await respondToWebhook(
      responseUrl,
      buildIdeationFailedMessage(
        error instanceof Error ? error.message : 'Unknown error'
      )
    );

    // Re-throw to mark the job as failed for DLQ
    throw error;
  }
};

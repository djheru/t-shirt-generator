import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { v4 as uuidv4 } from 'uuid';
import {
  verifySlackRequest,
  extractSlackHeaders,
  buildGeneratingMessage,
  buildChannelRestrictionMessage,
  buildEmptyPromptMessage,
  buildErrorMessage,
} from '../services/slack';
import { createRequest } from '../services/storage/dynamo';
import { getSlackSecrets } from '../services/storage/secrets';
import { SlackSlashCommandSchema } from '../types/slack.types';
import type { GenerationRequest, GenerationJobMessage } from '../types/domain.types';

const logger = new Logger({ serviceName: 't-shirt-generator', logLevel: 'INFO' });

let sqsClient: SQSClient | null = null;

const getSQSClient = (): SQSClient => {
  if (!sqsClient) {
    sqsClient = new SQSClient({});
  }
  return sqsClient;
};

const parseFormUrlEncoded = (body: string): Record<string, string> => {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    result[key] = value;
  }
  return result;
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.info('Received webhook request', {
    path: event.path,
    httpMethod: event.httpMethod,
  });

  try {
    // Extract and validate headers
    const headers = event.headers as Record<string, string | undefined>;
    const slackHeaders = extractSlackHeaders(headers);

    if (!slackHeaders) {
      logger.warn('Missing Slack headers');
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Missing Slack headers' }),
      };
    }

    // Get secrets
    const signingSecretArn = process.env.SLACK_SIGNING_SECRET_ARN;
    const botTokenArn = process.env.SLACK_BOT_TOKEN_ARN;

    if (!signingSecretArn || !botTokenArn) {
      logger.error('Missing secret ARN environment variables');
      return {
        statusCode: 500,
        body: JSON.stringify({ error: 'Server configuration error' }),
      };
    }

    const secrets = await getSlackSecrets(signingSecretArn, botTokenArn);

    // Verify request signature
    const body = event.body ?? '';
    const verificationResult = verifySlackRequest({
      signingSecret: secrets.signingSecret,
      timestamp: slackHeaders.timestamp,
      body,
      signature: slackHeaders.signature,
    });

    if (!verificationResult.valid) {
      logger.warn('Slack signature verification failed', {
        error: verificationResult.error,
      });
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'Invalid signature' }),
      };
    }

    // Parse slash command payload
    const parsedBody = parseFormUrlEncoded(body);
    const parseResult = SlackSlashCommandSchema.safeParse(parsedBody);

    if (!parseResult.success) {
      logger.warn('Invalid slash command payload', {
        errors: parseResult.error.issues,
      });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid payload' }),
      };
    }

    const payload = parseResult.data;

    // Check channel restriction
    const allowedChannelId = process.env.ALLOWED_CHANNEL_ID;
    if (allowedChannelId && payload.channel_id !== allowedChannelId) {
      logger.info('Request from unauthorized channel', {
        channelId: payload.channel_id,
        allowedChannelId,
      });
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildChannelRestrictionMessage()),
      };
    }

    // Validate prompt
    const prompt = payload.text.trim();
    if (!prompt) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildEmptyPromptMessage()),
      };
    }

    // Create generation request
    const requestId = uuidv4();
    const now = new Date().toISOString();
    const bedrockModel = (process.env.BEDROCK_MODEL ?? 'titan') as 'titan' | 'sdxl';

    const generationRequest: GenerationRequest = {
      requestId,
      userId: payload.user_id,
      channelId: payload.channel_id,
      prompt,
      enhancedPrompt: '', // Will be set by the generator
      status: 'pending',
      model: bedrockModel,
      responseUrl: payload.response_url,
      createdAt: now,
      updatedAt: now,
      ttl: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60, // 30 days
    };

    // Store request in DynamoDB
    const requestsTable = process.env.REQUESTS_TABLE;
    if (!requestsTable) {
      throw new Error('REQUESTS_TABLE environment variable not set');
    }

    await createRequest({
      tableName: requestsTable,
      request: generationRequest,
    });

    // Queue generation job
    const queueUrl = process.env.GENERATION_QUEUE_URL;
    if (!queueUrl) {
      throw new Error('GENERATION_QUEUE_URL environment variable not set');
    }

    const jobMessage: GenerationJobMessage = {
      requestId,
      userId: payload.user_id,
      channelId: payload.channel_id,
      prompt,
      responseUrl: payload.response_url,
    };

    const sqsCommand = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(jobMessage),
    });

    await getSQSClient().send(sqsCommand);

    logger.info('Generation job queued', { requestId, prompt });

    // Return immediate acknowledgment
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildGeneratingMessage(prompt)),
    };
  } catch (error) {
    logger.error('Error processing webhook', { error });
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(
        buildErrorMessage('Failed to process your request. Please try again.')
      ),
    };
  }
};

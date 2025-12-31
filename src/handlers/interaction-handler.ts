import type { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Logger } from '@aws-lambda-powertools/logger';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import {
  verifySlackRequest,
  extractSlackHeaders,
} from '../services/slack';
import { getSlackSecrets } from '../services/storage/secrets';
import { getRequest } from '../services/storage/dynamo';
import { SlackInteractionSchema } from '../types/slack.types';
import type { ActionJobMessage } from '../types/domain.types';

const logger = new Logger({ serviceName: 't-shirt-generator', logLevel: 'INFO' });

let sqsClient: SQSClient | null = null;

const getSQSClient = (): SQSClient => {
  if (!sqsClient) {
    sqsClient = new SQSClient({});
  }
  return sqsClient;
};

export const handler = async (
  event: APIGatewayProxyEvent
): Promise<APIGatewayProxyResult> => {
  logger.info('Received interaction request', {
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

    // Parse interaction payload (it's URL-encoded with a 'payload' field containing JSON)
    const params = new URLSearchParams(body);
    const payloadString = params.get('payload');

    if (!payloadString) {
      logger.warn('Missing payload in interaction request');
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Missing payload' }),
      };
    }

    const payloadJson = JSON.parse(payloadString) as unknown;
    const parseResult = SlackInteractionSchema.safeParse(payloadJson);

    if (!parseResult.success) {
      logger.warn('Invalid interaction payload', {
        errors: parseResult.error.issues,
      });
      return {
        statusCode: 400,
        body: JSON.stringify({ error: 'Invalid payload' }),
      };
    }

    const payload = parseResult.data;

    // Only handle block_actions
    if (payload.type !== 'block_actions') {
      logger.info('Ignoring non-block_actions interaction', { type: payload.type });
      return {
        statusCode: 200,
        body: '',
      };
    }

    // Process each action
    const action = payload.actions[0];
    if (!action) {
      logger.warn('No action in payload');
      return {
        statusCode: 200,
        body: '',
      };
    }

    const actionId = action.action_id;
    const actionValue = action.value;

    logger.info('Processing action', { actionId, actionValue });

    // Determine action type and queue the job
    let actionType: ActionJobMessage['action'];
    let imageId: string | undefined;
    let requestId: string;

    switch (actionId) {
      case 'keep_image':
      case 'discard_image': {
        actionType = actionId === 'keep_image' ? 'keep' : 'discard';
        // Value format: imageId|requestId
        const parsed = parseImageActionValue(actionValue);
        imageId = parsed.imageId;
        requestId = parsed.requestId;
        break;
      }
      case 'keep_all':
        actionType = 'keep_all';
        requestId = actionValue;
        break;
      case 'discard_all':
        actionType = 'discard_all';
        requestId = actionValue;
        break;
      case 'regenerate_all':
        actionType = 'regenerate_all';
        requestId = actionValue;
        break;
      default:
        logger.warn('Unknown action', { actionId });
        return {
          statusCode: 200,
          body: '',
        };
    }

    // Get original prompt for regenerate
    let originalPrompt: string | undefined;
    if (actionType === 'regenerate_all') {
      const requestsTable = process.env.REQUESTS_TABLE;
      if (requestsTable) {
        const request = await getRequest({
          tableName: requestsTable,
          requestId,
        });
        originalPrompt = request?.prompt;
      }
    }

    // Queue action job
    const queueUrl = process.env.ACTION_QUEUE_URL;
    if (!queueUrl) {
      throw new Error('ACTION_QUEUE_URL environment variable not set');
    }

    const jobMessage: ActionJobMessage = {
      action: actionType,
      imageId,
      requestId,
      userId: payload.user.id,
      channelId: payload.channel.id,
      responseUrl: payload.response_url,
      originalPrompt,
    };

    const sqsCommand = new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify(jobMessage),
    });

    await getSQSClient().send(sqsCommand);

    logger.info('Action job queued', { actionType, requestId, imageId });

    // Return immediate acknowledgment (empty response to prevent "updating..." message)
    return {
      statusCode: 200,
      body: '',
    };
  } catch (error) {
    logger.error('Error processing interaction', { error });
    return {
      statusCode: 200,
      body: JSON.stringify({
        response_type: 'ephemeral',
        text: 'An error occurred processing your action. Please try again.',
      }),
    };
  }
};

// Parse image action value in format: imageId|requestId
const parseImageActionValue = (
  value: string
): { imageId: string; requestId: string } => {
  const parts = value.split('|');
  if (parts.length !== 2) {
    throw new Error(
      `Invalid image action value format: ${value}. Expected imageId|requestId`
    );
  }

  const [imageId, requestId] = parts;
  return { imageId, requestId };
};

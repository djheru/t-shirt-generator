import { getSecret } from '@aws-lambda-powertools/parameters/secrets';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 't-shirt-generator' });

// Cache TTL in seconds (Powertools default is 5 seconds, we use 5 minutes)
const CACHE_MAX_AGE_SECONDS = 300;

/**
 * Retrieve a secret value from AWS Secrets Manager.
 *
 * Uses AWS Lambda Powertools Parameters utility which provides:
 * - Built-in caching (configurable TTL)
 * - Automatic retries
 * - JSON transformation support
 *
 * @see https://docs.aws.amazon.com/powertools/typescript/latest/utilities/parameters/
 */
export const getSecretValue = async (secretArn: string): Promise<string> => {
  logger.debug('Fetching secret from Secrets Manager', { secretArn });

  try {
    // Powertools getSecret with JSON transform and caching
    const secret = await getSecret<Record<string, string>>(secretArn, {
      maxAge: CACHE_MAX_AGE_SECONDS,
      transform: 'json',
    });

    if (!secret) {
      throw new Error(`Secret ${secretArn} returned null`);
    }

    // Extract the value from common secret formats
    let secretValue: string;
    if (typeof secret === 'string') {
      secretValue = secret;
    } else if ('value' in secret && typeof secret.value === 'string') {
      secretValue = secret.value;
    } else if ('secret' in secret && typeof secret.secret === 'string') {
      secretValue = secret.secret;
    } else {
      // Return the first string value found
      const firstValue = Object.values(secret).find(
        (v): v is string => typeof v === 'string'
      );
      if (!firstValue) {
        throw new Error(`Secret ${secretArn} has no valid string value`);
      }
      secretValue = firstValue;
    }

    logger.debug('Secret retrieved successfully', { secretArn });
    return secretValue;
  } catch (error) {
    // If JSON transform fails, try fetching as plain string
    if ((error as Error).message?.includes('transform')) {
      logger.debug('JSON transform failed, fetching as plain string', { secretArn });
      const plainSecret = await getSecret(secretArn, {
        maxAge: CACHE_MAX_AGE_SECONDS,
      });
      if (!plainSecret || typeof plainSecret !== 'string') {
        throw new Error(`Secret ${secretArn} has no string value`);
      }
      return plainSecret;
    }
    throw error;
  }
};

export interface SlackSecrets {
  readonly signingSecret: string;
  readonly botToken: string;
}

/**
 * Retrieve Slack secrets (signing secret and bot token) in parallel.
 */
export const getSlackSecrets = async (
  signingSecretArn: string,
  botTokenArn: string
): Promise<SlackSecrets> => {
  const [signingSecret, botToken] = await Promise.all([
    getSecretValue(signingSecretArn),
    getSecretValue(botTokenArn),
  ]);

  return { signingSecret, botToken };
};

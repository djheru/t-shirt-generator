import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { Logger } from '@aws-lambda-powertools/logger';

const logger = new Logger({ serviceName: 't-shirt-generator' });

let secretsClient: SecretsManagerClient | null = null;

// Cache for secrets to avoid repeated API calls
const secretsCache = new Map<string, { value: string; expiry: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

export const getSecretsClient = (): SecretsManagerClient => {
  if (!secretsClient) {
    secretsClient = new SecretsManagerClient({});
  }
  return secretsClient;
};

export const resetSecretsClient = (): void => {
  secretsClient = null;
  secretsCache.clear();
};

export const getSecretValue = async (secretArn: string): Promise<string> => {
  // Check cache first
  const cached = secretsCache.get(secretArn);
  if (cached && cached.expiry > Date.now()) {
    logger.debug('Returning cached secret', { secretArn });
    return cached.value;
  }

  const client = getSecretsClient();

  logger.debug('Fetching secret from Secrets Manager', { secretArn });

  const command = new GetSecretValueCommand({
    SecretId: secretArn,
  });

  const response = await client.send(command);

  if (!response.SecretString) {
    throw new Error(`Secret ${secretArn} has no string value`);
  }

  // Parse the secret - it might be JSON or plain text
  let secretValue: string;
  try {
    const parsed = JSON.parse(response.SecretString) as Record<string, unknown>;
    // If it's the placeholder format, return the generated value
    if ('value' in parsed && typeof parsed.value === 'string') {
      secretValue = parsed.value;
    } else if ('secret' in parsed && typeof parsed.secret === 'string') {
      secretValue = parsed.secret;
    } else {
      // Return the first string value found
      const firstValue = Object.values(parsed).find(
        (v): v is string => typeof v === 'string'
      );
      if (!firstValue) {
        throw new Error(`Secret ${secretArn} has no valid string value`);
      }
      secretValue = firstValue;
    }
  } catch {
    // Not JSON, use as-is
    secretValue = response.SecretString;
  }

  // Cache the secret
  secretsCache.set(secretArn, {
    value: secretValue,
    expiry: Date.now() + CACHE_TTL_MS,
  });

  logger.info('Secret fetched and cached', { secretArn });

  return secretValue;
};

export interface SlackSecrets {
  readonly signingSecret: string;
  readonly botToken: string;
}

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

import crypto from 'node:crypto';

const SLACK_SIGNATURE_VERSION = 'v0';
const MAX_REQUEST_AGE_SECONDS = 300; // 5 minutes

export interface SlackVerificationParams {
  readonly signingSecret: string;
  readonly timestamp: string;
  readonly body: string;
  readonly signature: string;
}

export interface VerificationResult {
  readonly valid: boolean;
  readonly error?: string;
}

export const verifySlackRequest = ({
  signingSecret,
  timestamp,
  body,
  signature,
}: SlackVerificationParams): VerificationResult => {
  // Check timestamp to prevent replay attacks
  const requestTimestamp = parseInt(timestamp, 10);
  const currentTimestamp = Math.floor(Date.now() / 1000);

  if (isNaN(requestTimestamp)) {
    return { valid: false, error: 'Invalid timestamp format' };
  }

  if (currentTimestamp - requestTimestamp > MAX_REQUEST_AGE_SECONDS) {
    return { valid: false, error: 'Request timestamp too old' };
  }

  // Create signature base string
  const sigBaseString = `${SLACK_SIGNATURE_VERSION}:${timestamp}:${body}`;

  // Calculate expected signature
  const expectedSignature =
    SLACK_SIGNATURE_VERSION +
    '=' +
    crypto.createHmac('sha256', signingSecret).update(sigBaseString).digest('hex');

  // Use timing-safe comparison to prevent timing attacks
  try {
    const signatureBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (signatureBuffer.length !== expectedBuffer.length) {
      return { valid: false, error: 'Signature length mismatch' };
    }

    const valid = crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    return valid ? { valid: true } : { valid: false, error: 'Signature mismatch' };
  } catch {
    return { valid: false, error: 'Signature comparison failed' };
  }
};

export const extractSlackHeaders = (
  headers: Record<string, string | undefined>
): { timestamp: string; signature: string } | null => {
  // Slack headers can be lowercase or mixed case depending on the gateway
  const timestamp =
    headers['x-slack-request-timestamp'] ??
    headers['X-Slack-Request-Timestamp'] ??
    headers['X-SLACK-REQUEST-TIMESTAMP'];

  const signature =
    headers['x-slack-signature'] ??
    headers['X-Slack-Signature'] ??
    headers['X-SLACK-SIGNATURE'];

  if (!timestamp || !signature) {
    return null;
  }

  return { timestamp, signature };
};

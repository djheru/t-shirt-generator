import crypto from 'node:crypto';
import {
  verifySlackRequest,
  extractSlackHeaders,
} from '../../../../src/services/slack/verification';

describe('Slack Verification', () => {
  const signingSecret = 'test-signing-secret';

  describe('verifySlackRequest', () => {
    const createValidSignature = (timestamp: string, body: string): string => {
      const sigBaseString = `v0:${timestamp}:${body}`;
      return (
        'v0=' +
        crypto.createHmac('sha256', signingSecret).update(sigBaseString).digest('hex')
      );
    };

    it('should return valid for correct signature', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = 'test=value&another=param';
      const signature = createValidSignature(timestamp, body);

      const result = verifySlackRequest({
        signingSecret,
        timestamp,
        body,
        signature,
      });

      expect(result.valid).toBe(true);
      expect(result.error).toBeUndefined();
    });

    it('should return invalid for incorrect signature', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = 'test=value';
      const signature = 'v0=invalid_signature_hash';

      const result = verifySlackRequest({
        signingSecret,
        timestamp,
        body,
        signature,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBeDefined();
    });

    it('should return invalid for old timestamp', () => {
      const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 6 * 60;
      const timestamp = String(fiveMinutesAgo);
      const body = 'test=value';
      const signature = createValidSignature(timestamp, body);

      const result = verifySlackRequest({
        signingSecret,
        timestamp,
        body,
        signature,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Request timestamp too old');
    });

    it('should return invalid for non-numeric timestamp', () => {
      const timestamp = 'not-a-number';
      const body = 'test=value';
      const signature = 'v0=somehash';

      const result = verifySlackRequest({
        signingSecret,
        timestamp,
        body,
        signature,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Invalid timestamp format');
    });

    it('should return invalid for signature length mismatch', () => {
      const timestamp = String(Math.floor(Date.now() / 1000));
      const body = 'test=value';
      const signature = 'v0=short';

      const result = verifySlackRequest({
        signingSecret,
        timestamp,
        body,
        signature,
      });

      expect(result.valid).toBe(false);
      expect(result.error).toBe('Signature length mismatch');
    });
  });

  describe('extractSlackHeaders', () => {
    it('should extract headers with lowercase keys', () => {
      const headers = {
        'x-slack-request-timestamp': '1234567890',
        'x-slack-signature': 'v0=abc123',
      };

      const result = extractSlackHeaders(headers);

      expect(result).toEqual({
        timestamp: '1234567890',
        signature: 'v0=abc123',
      });
    });

    it('should extract headers with mixed case keys', () => {
      const headers = {
        'X-Slack-Request-Timestamp': '1234567890',
        'X-Slack-Signature': 'v0=abc123',
      };

      const result = extractSlackHeaders(headers);

      expect(result).toEqual({
        timestamp: '1234567890',
        signature: 'v0=abc123',
      });
    });

    it('should return null if timestamp is missing', () => {
      const headers = {
        'x-slack-signature': 'v0=abc123',
      };

      const result = extractSlackHeaders(headers);

      expect(result).toBeNull();
    });

    it('should return null if signature is missing', () => {
      const headers = {
        'x-slack-request-timestamp': '1234567890',
      };

      const result = extractSlackHeaders(headers);

      expect(result).toBeNull();
    });

    it('should return null for empty headers', () => {
      const headers = {};

      const result = extractSlackHeaders(headers);

      expect(result).toBeNull();
    });
  });
});

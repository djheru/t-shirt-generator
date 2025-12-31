# T-Shirt Generator - Project Instructions

## Project Overview

Slack-integrated t-shirt graphic generator using Amazon Bedrock image models. Users submit prompts via `/generate` command in a designated Slack channel, receive 3 generated images, and can keep, discard, or regenerate them.

See `DESIGN.md` for full architecture documentation.

## Tech Stack

- **Runtime**: Node.js 22, TypeScript 5+
- **Infrastructure**: AWS CDK v2
- **AWS Services**: Lambda, API Gateway, DynamoDB, S3, SQS, Secrets Manager, Bedrock
- **Image Models**: Amazon Titan Image Generator G1 v2, Stability AI SDXL 1.0
- **Testing**: Jest with aws-sdk-client-mock
- **Validation**: Zod schemas
- **Logging**: AWS Lambda Powertools

## Project Structure

```
t-shirt-generator/
├── infrastructure/           # CDK infrastructure code
│   ├── bin/
│   │   └── app.ts           # CDK app entry point
│   └── lib/
│       ├── stacks/          # CDK stacks
│       │   ├── storage-stack.ts
│       │   ├── api-stack.ts
│       │   └── processing-stack.ts
│       └── constructs/      # Reusable constructs
├── src/                     # Lambda function source code
│   ├── handlers/            # Lambda entry points
│   │   ├── webhook-handler.ts
│   │   ├── interaction-handler.ts
│   │   ├── image-generator.ts
│   │   └── action-processor.ts
│   ├── services/            # Business logic services
│   │   ├── slack/
│   │   ├── bedrock/
│   │   └── storage/
│   ├── types/               # TypeScript type definitions
│   └── config/              # Configuration management
├── test/                    # Test files
│   ├── unit/
│   └── integration/
├── DESIGN.md               # Architecture documentation
└── CLAUDE.md               # This file
```

## Commands

```bash
# Development
npm run build              # Compile TypeScript
npm run watch              # Watch mode compilation
npm run test               # Run Jest tests with coverage
npm run test:watch         # Watch mode testing
npm run lint               # ESLint check
npm run lint:fix           # Auto-fix linting issues
npm run type-check         # TypeScript type checking

# Infrastructure
npx cdk diff               # Show infrastructure changes
npx cdk deploy --all       # Deploy all stacks
npx cdk destroy --all      # Destroy all stacks
npx cdk synth              # Synthesize CloudFormation templates
```

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Image count | 3 per request | Balance variety and cost |
| Bedrock model | Configurable (Titan/SDXL) | `BEDROCK_MODEL` env var |
| Image format | PNG | Transparency support |
| Presigned URL expiry | 7 days | Reasonable download window |
| Channel restriction | Single channel | `ALLOWED_CHANNEL_ID` env var |
| Prompt enhancement | Static refinements | Optimized for t-shirt designs |

## Domain Types

```typescript
// Core domain types - define in src/types/domain.types.ts

type RequestStatus = 'pending' | 'generating' | 'completed' | 'failed';
type ImageStatus = 'generated' | 'kept' | 'discarded';
type BedrockModel = 'titan' | 'sdxl';

interface GenerationRequest {
  requestId: string;
  userId: string;
  channelId: string;
  prompt: string;
  enhancedPrompt: string;
  status: RequestStatus;
  model: BedrockModel;
  responseUrl: string;
  createdAt: string;
  updatedAt: string;
}

interface GeneratedImage {
  imageId: string;
  requestId: string;
  s3Key: string;
  status: ImageStatus;
  presignedUrl?: string;
  presignedUrlExpiry?: string;
  createdAt: string;
}
```

## Slack Integration

### Slash Command Flow
1. User: `/generate A retro sunset with palm trees`
2. Webhook handler validates signature and channel
3. Returns immediate acknowledgment
4. Queues generation job to SQS
5. Generator Lambda calls Bedrock, stores in S3
6. Posts images to Slack with action buttons

### Action Buttons
- **Keep**: Copy to saved/, generate presigned URL, post to Slack
- **Discard**: Mark as discarded, update message
- **Regenerate All**: Queue new generation with same prompt
- **Keep All / Discard All**: Batch operations

### Channel Restriction
Only the designated channel (via `ALLOWED_CHANNEL_ID`) can use the `/generate` command.

## Bedrock Integration

### Model Selection
Toggle via `BEDROCK_MODEL` environment variable:
- `titan`: Amazon Titan Image Generator G1 v2 (~$0.008/image)
- `sdxl`: Stability AI SDXL 1.0 (~$0.04/image)

### Prompt Enhancement
All prompts are enhanced with static refinements:
```typescript
const enhancePrompt = (userPrompt: string): string => {
  const suffix = process.env.PROMPT_SUFFIX ??
    ', high quality, professional graphic design, suitable for t-shirt print';
  return `${userPrompt}${suffix}`;
};
```

Transparency detection:
```typescript
const needsTransparency = (prompt: string): boolean =>
  /transparent|no background|isolated/i.test(prompt);
```

## S3 Structure

```
{bucket}/
├── temp/{requestId}/{imageId}.png     # Temporary (7-day lifecycle)
├── saved/{userId}/{requestId}/{imageId}.png  # Permanent
└── thumbnails/{requestId}/{imageId}.png      # Display (7-day lifecycle)
```

## Error Handling

### Slack Timeout
Slack requires response within 3 seconds. Always:
1. Acknowledge immediately with ephemeral message
2. Process async via SQS
3. Post results via Slack Web API

### Bedrock Failures
- Retry with exponential backoff (SQS handles this)
- After max retries, post error message to Slack
- Log full error for debugging

### Partial Failures
Use SQS partial batch failure pattern for processing multiple images.

## Testing Patterns

### Mocking AWS SDK
```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { DynamoDBDocumentClient, PutCommand } from '@aws-sdk/lib-dynamodb';

const ddbMock = mockClient(DynamoDBDocumentClient);

beforeEach(() => {
  ddbMock.reset();
});

it('should store generation request', async () => {
  ddbMock.on(PutCommand).resolves({});
  // ... test implementation
});
```

### Mocking Slack
```typescript
// Mock Slack Web API client
jest.mock('@slack/web-api', () => ({
  WebClient: jest.fn().mockImplementation(() => ({
    chat: {
      postMessage: jest.fn().mockResolvedValue({ ok: true }),
      update: jest.fn().mockResolvedValue({ ok: true }),
    },
    files: {
      uploadV2: jest.fn().mockResolvedValue({ ok: true }),
    },
  })),
}));
```

## Security Requirements

### Slack Signature Verification
All incoming requests must be verified:
```typescript
import crypto from 'node:crypto';

const verifySlackSignature = (
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean => {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 300;
  if (parseInt(timestamp, 10) < fiveMinutesAgo) {
    return false;
  }

  const sigBasestring = `v0:${timestamp}:${body}`;
  const mySignature = 'v0=' + crypto
    .createHmac('sha256', signingSecret)
    .update(sigBasestring)
    .digest('hex');

  return crypto.timingSafeEqual(
    Buffer.from(mySignature),
    Buffer.from(signature)
  );
};
```

### Secrets Management
- Store Slack credentials in AWS Secrets Manager
- Reference in CDK via `Secret.fromSecretNameV2()`
- Never log secrets or include in error messages

### S3 Security
- Block all public access
- Use presigned URLs for downloads (7-day expiry)
- Server-side encryption enabled

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `SLACK_SIGNING_SECRET` | Yes | From Secrets Manager |
| `SLACK_BOT_TOKEN` | Yes | From Secrets Manager |
| `ALLOWED_CHANNEL_ID` | Yes | Designated Slack channel |
| `BEDROCK_MODEL` | Yes | `titan` or `sdxl` |
| `IMAGES_BUCKET` | Yes | S3 bucket name |
| `REQUESTS_TABLE` | Yes | DynamoDB table name |
| `IMAGES_TABLE` | Yes | DynamoDB table name |
| `PROMPT_SUFFIX` | No | Appended to prompts |
| `NEGATIVE_PROMPT` | No | Default negative prompt |
| `PRESIGNED_URL_EXPIRY` | No | URL expiry seconds (default: 604800) |

## Implementation Notes

### Lambda Timeouts
| Function | Timeout | Memory |
|----------|---------|--------|
| webhook-handler | 10s | 256MB |
| interaction-handler | 10s | 256MB |
| image-generator | 5min | 1024MB |
| action-processor | 2min | 512MB |

### SQS Configuration
- Visibility timeout: 6x Lambda timeout
- DLQ after 3 failed attempts
- Enable partial batch responses

### DynamoDB
- On-demand capacity (pay per request)
- TTL enabled for auto-cleanup
- Point-in-time recovery optional

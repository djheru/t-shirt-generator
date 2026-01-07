# T-Shirt Generator - System Design Document

## Overview

A Slack-integrated application that generates t-shirt graphics using AI image generation models. Users submit prompts via Slack, receive generated images, and can keep, discard, or regenerate them.

### Slash Commands
- **`/generate <prompt>`** - Generate 3 t-shirt graphics from a text prompt
- **`/ideate <theme>`** - Research trends and generate 5 brand-aligned design prompts using Claude AI with web search

## Requirements Summary

### Functional Requirements
1. Accept text prompts from a designated Slack channel only
2. Generate 3 images per prompt using Amazon Bedrock
3. Display generated images in Slack with action buttons
4. Allow users to: Keep, Discard, or Regenerate images
5. Store selected images in S3 and provide presigned download URLs (7-day expiry)
6. Support PNG format with transparency
7. Apply static prompt refinements for t-shirt optimization

### Non-Functional Requirements
- Respond to Slack within 3-second timeout (async processing)
- Secure webhook verification
- Cost-effective image generation
- Single-tenant architecture (no multi-tenancy)

### Design Decisions
| Decision | Choice | Rationale |
|----------|--------|-----------|
| Image count | 3 per request | Balance between variety and cost |
| Bedrock model | Both Titan & SDXL | Environment variable toggle |
| Image format | PNG | Required for transparency support |
| Presigned URL expiry | 7 days | Reasonable download window |
| Channel restriction | Single designated channel | Simpler implementation |
| History | Via Slack channel history | No separate command needed |
| Multi-tenancy | No | Single store focus for v1 |
| Prompt enhancement | Yes | Static refinements for t-shirt designs |

---

## Architecture

### High-Level Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                  SLACK                                       │
│  ┌─────────────┐  ┌─────────────┐  ┌───────────────┐  ┌─────────────────┐  │
│  │ /generate   │  │ /ideate     │  │ Image Preview │  │ Interactive     │  │
│  │ command     │  │ command     │  │ Messages      │  │ Buttons         │  │
│  └──────┬──────┘  └──────┬──────┘  └───────▲───────┘  └───────┬─────────┘  │
└─────────┼────────────────┼─────────────────┼──────────────────┼────────────┘
          │                │                 │                  │
          └───────┬────────┘                 │                  │
                  ▼                          │                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            AWS CLOUD                                         │
│                                                                              │
│  ┌──────────────────┐                    ┌──────────────────┐               │
│  │   API Gateway    │◄───────────────────│   API Gateway    │               │
│  │  /slack/events   │                    │ /slack/interact  │               │
│  └────────┬─────────┘                    └────────┬─────────┘               │
│           │                                       │                          │
│           ▼                                       ▼                          │
│  ┌──────────────────┐                    ┌──────────────────┐               │
│  │  Webhook Handler │───────────┐        │ Interaction      │               │
│  │     Lambda       │           │        │ Handler Lambda   │               │
│  └────────┬─────────┘           │        └────────┬─────────┘               │
│           │                     │                 │                          │
│           │ /generate           │ /ideate         │                          │
│           ▼                     ▼                 ▼                          │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐           │
│  │   SQS Queue      │  │   SQS Queue      │  │   SQS Queue      │           │
│  │ (Generation)     │  │ (Ideation)       │  │ (Actions)        │           │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘           │
│           │                     │                     │                      │
│           ▼                     ▼                     ▼                      │
│  ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐           │
│  │  Image Generator │  │ Ideation         │  │  Action Processor│           │
│  │     Lambda       │  │ Processor Lambda │  │     Lambda       │           │
│  └────────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘           │
│           │                     │                     │                      │
│           │                     ▼                     │                      │
│           │            ┌──────────────────┐           │                      │
│           │            │   Anthropic API  │           │                      │
│           │            │ (Claude + Search)│           │                      │
│           │            └──────────────────┘           │                      │
│           │                                       │                          │
│           ├───────────────────┬──────────────────┤                          │
│           ▼                   ▼                  ▼                          │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐                   │
│  │   Bedrock    │    │   DynamoDB   │   │      S3      │                   │
│  │ (Titan/SDXL) │    │  (Requests)  │   │   (Images)   │                   │
│  └──────────────┘    └──────────────┘   └──────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Details

#### 1. Slack App Configuration
- **Slash Commands**:
  - `/generate <prompt>` - triggers image generation (async via SQS)
  - `/ideate <theme>` - generates creative prompt ideas using Claude (sync)
- **Bot User**: Posts messages and images back to channel
- **Interactive Components**: Buttons for user actions
- **Channel Restriction**: Only responds in a designated channel (configured via `ALLOWED_CHANNEL_ID` env var)
- **OAuth Scopes Required**:
  - `commands` - for slash commands
  - `chat:write` - to post messages
  - `files:write` - to upload images

**Channel Validation Logic:**
```typescript
// In webhook-handler
if (event.channel_id !== process.env.ALLOWED_CHANNEL_ID) {
  return {
    response_type: 'ephemeral',
    text: 'This command is only available in the designated design channel.'
  };
}
```

#### 2. API Gateway (REST API)
Two endpoints:
- `POST /slack/events` - Receives slash command events
- `POST /slack/interactions` - Receives button click events

Both endpoints verify Slack request signatures for security.

#### 3. Lambda Functions

| Function | Purpose | Trigger | Timeout |
|----------|---------|---------|---------|
| `webhook-handler` | Validates Slack requests, routes `/generate` and `/ideate` commands | API Gateway | 10s |
| `interaction-handler` | Processes button clicks, queues action jobs | API Gateway | 10s |
| `image-generator` | Calls Bedrock/Gemini, stores images, posts to Slack | SQS | 5min |
| `action-processor` | Handles keep/discard/regenerate actions | SQS | 2min |
| `ideation-processor` | Calls Claude with web search, generates brand-aligned prompts | SQS | 60s |

#### 4. SQS Queues
- **generation-queue**: Buffers image generation requests
- **action-queue**: Buffers user action requests
- **ideation-queue**: Buffers ideation/research requests (6-min visibility timeout)
- All queues have DLQ for failed message handling

#### 5. DynamoDB Tables

**GenerationRequests Table**
```
PK: requestId (UUID)
Attributes:
  - userId: string (Slack user ID)
  - channelId: string (Slack channel ID)
  - prompt: string (original user prompt)
  - enhancedPrompt: string (with refinements applied)
  - status: 'pending' | 'generating' | 'completed' | 'failed'
  - model: 'titan' | 'sdxl' (Bedrock model used)
  - responseUrl: string (Slack response URL for async responses)
  - createdAt: ISO timestamp
  - updatedAt: ISO timestamp
  - ttl: number (auto-delete after 30 days)

GSI: userId-createdAt-index (for user history queries)
```

**Images Table**
```
PK: imageId (UUID)
SK: requestId
Attributes:
  - s3Key: string
  - status: 'generated' | 'kept' | 'discarded'
  - slackFileId: string (for message updates)
  - presignedUrl: string (for kept images)
  - presignedUrlExpiry: ISO timestamp
  - createdAt: ISO timestamp
  - ttl: number (auto-delete discarded after 7 days)

GSI: requestId-index (query all images for a request)
```

#### 6. S3 Bucket Structure
```
t-shirt-generator-images-{account-id}/
├── temp/                          # Temporary storage for generated images
│   └── {requestId}/
│       └── {imageId}.png
├── saved/                         # Permanent storage for kept images
│   └── {userId}/
│       └── {requestId}/
│           └── {imageId}.png
└── thumbnails/                    # Optimized for Slack display
    └── {requestId}/
        └── {imageId}.png
```

Lifecycle Rules:
- `temp/` objects expire after 7 days
- `saved/` objects retained indefinitely
- `thumbnails/` objects expire after 7 days

#### 7. Amazon Bedrock Integration

**Supported Models** (toggle via `BEDROCK_MODEL` environment variable):

| Model | Model ID | Cost/Image | Notes |
|-------|----------|------------|-------|
| Amazon Titan Image Generator G1 v2 | `amazon.titan-image-generator-v2:0` | ~$0.008 | Cost-effective, native AWS |
| Stability AI SDXL 1.0 | `stability.stable-diffusion-xl-v1` | ~$0.04 | Higher quality, more expensive |

**Generation Parameters**:
```typescript
interface ImageGenerationParams {
  prompt: string;
  negativePrompt?: string;
  numberOfImages: 3;
  width: 1024;
  height: 1024;
  cfgScale: 8.0;
  seed?: number; // For reproducibility
}
```

#### 8. Prompt Enhancement

Static refinements appended to user prompts for t-shirt optimization:

```typescript
const PROMPT_REFINEMENTS = {
  suffix: ", high quality, professional graphic design, suitable for t-shirt print",
  negativePrompt: "blurry, low quality, distorted, watermark, text, words, letters"
};

// When user requests transparency
const TRANSPARENCY_REFINEMENTS = {
  suffix: ", isolated on transparent background, no background, PNG with alpha channel",
  negativePrompt: "background, backdrop, scenery"
};
```

These refinements are configurable via environment variables:
- `PROMPT_SUFFIX`: Additional text appended to all prompts
- `NEGATIVE_PROMPT`: Default negative prompt for all generations

---

## User Flow

### Image Generation Flow

```
1. User types: /generate A retro sunset with palm trees
2. Slack sends POST to /slack/events
3. webhook-handler Lambda:
   a. Verifies Slack signature
   b. Creates GenerationRequest in DynamoDB (status: pending)
   c. Sends message to generation-queue
   d. Returns 200 with "Generating images..." message
4. image-generator Lambda (triggered by SQS):
   a. Updates request status to 'generating'
   b. Enhances prompt with static refinements
   c. Calls Bedrock to generate 3 images (model from env var)
   d. Stores images in S3 (temp/ prefix) as PNG
   e. Creates Image records in DynamoDB
   f. Posts images to Slack with Keep/Discard/Regenerate buttons
   g. Updates request status to 'completed'
```

### User Action Flow (Keep)

```
1. User clicks "Keep" button on an image
2. Slack sends POST to /slack/interactions
3. interaction-handler Lambda:
   a. Verifies Slack signature
   b. Sends message to action-queue
   c. Returns 200 with acknowledgment
4. action-processor Lambda (triggered by SQS):
   a. Copies image from temp/ to saved/
   b. Generates presigned URL (7-day expiry)
   c. Updates Image record (status: kept)
   d. Posts presigned URL to Slack
   e. Updates Slack message to show "Kept" status
```

### User Action Flow (Regenerate)

```
1. User clicks "Regenerate All" button
2. Slack sends POST to /slack/interactions
3. interaction-handler Lambda:
   a. Verifies Slack signature
   b. Creates new GenerationRequest linked to original
   c. Sends message to generation-queue
   d. Returns 200 with "Regenerating..." message
4. image-generator Lambda processes as new generation
```

### Prompt Ideation Flow

```
1. User types: /ideate retro gaming 80s
2. Slack sends POST to /slack/events
3. webhook-handler Lambda:
   a. Verifies Slack signature
   b. Validates theme is provided
   c. Sends message to ideation-queue
   d. Returns 200 with ephemeral "Researching trends..." message
4. ideation-processor Lambda (triggered by SQS):
   a. Calls Claude Sonnet with web_search tool enabled
   b. Claude searches for current trends related to the theme
   c. Claude generates structured JSON response with:
      - Research insights (trending keywords, visual trends, market context)
      - 5 brand-aligned prompts (each with name, angle, and detailed prompt)
   d. Posts rich results to Slack via response_url
```

**Brand Focus (Rise Wear Apparel)**:
All prompts are optimized for tall Black men seeking culturally authentic apparel:
- Color palette: Gold (primary), burnt orange, forest green on black backgrounds
- Themes: Empowerment, generational wealth, legacy, resilience, dignity
- Cultural elements: Subtle African textile patterns (kente, mudcloth)
- Typography: Bold, contemporary mix of sans-serif and modern serif

**Why SQS + Web Search?**
- Web search can take 15-30 seconds to gather trend data
- Allows Claude to research current market trends in real-time
- More reliable than synchronous processing with timeout risk

---

## Slack Message Formats

### Initial Response (Immediate)
```json
{
  "response_type": "ephemeral",
  "text": ":art: Generating 3 images for your prompt...\n\n*Prompt:* A retro sunset with palm trees\n\nThis may take 30-60 seconds."
}
```

### Generated Images Message
```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": "*Generated Images*\n*Prompt:* A retro sunset with palm trees"
      }
    },
    {
      "type": "image",
      "image_url": "https://s3.amazonaws.com/...",
      "alt_text": "Generated image 1"
    },
    {
      "type": "actions",
      "block_id": "image_1_actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Keep" },
          "style": "primary",
          "action_id": "keep_image",
          "value": "imageId_1"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Discard" },
          "style": "danger",
          "action_id": "discard_image",
          "value": "imageId_1"
        }
      ]
    },
    // ... repeat for each image
    {
      "type": "divider"
    },
    {
      "type": "actions",
      "block_id": "batch_actions",
      "elements": [
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Keep All" },
          "style": "primary",
          "action_id": "keep_all",
          "value": "requestId"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Discard All" },
          "action_id": "discard_all",
          "value": "requestId"
        },
        {
          "type": "button",
          "text": { "type": "plain_text", "text": "Regenerate All" },
          "action_id": "regenerate_all",
          "value": "requestId"
        }
      ]
    }
  ]
}
```

### Kept Image Confirmation
```json
{
  "blocks": [
    {
      "type": "section",
      "text": {
        "type": "mrkdwn",
        "text": ":white_check_mark: *Image saved!*\n\nDownload link (expires in 7 days):\n<presigned_url|Download Image>"
      }
    }
  ]
}
```

### Ideation Response (Immediate)
```json
{
  "response_type": "ephemeral",
  "text": "Researching trends and generating creative prompts for \"retro gaming 80s\"...\n\nThis may take 15-30 seconds as we search for current trends."
}
```

### Ideation Results Message
```json
{
  "response_type": "in_channel",
  "blocks": [
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*Rise Wear Design Prompts: \"retro gaming 80s\"*" }
    },
    { "type": "divider" },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*📊 Market Research Insights*" }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "_Retro gaming continues trending with millennials seeking nostalgic designs..._" }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*Trending Keywords:* pixel art • 8-bit • arcade • nostalgia • synthwave" }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*Visual Trends:* neon colors • CRT effects • glitch art • retro consoles" }
    },
    { "type": "divider" },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*🎨 Design Prompts (5)*\n_Use with_ `/generate <prompt>`" }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "*1. Pixel Crown*\n_Empowerment through classic gaming imagery_" }
    },
    {
      "type": "section",
      "text": { "type": "mrkdwn", "text": "```Design a t-shirt graphic featuring a golden pixel art crown with 8-bit styling on a black background...```" }
    },
    "... (additional prompts with name, angle, and copyable prompt)",
    { "type": "divider" },
    {
      "type": "context",
      "elements": [
        { "type": "mrkdwn", "text": "*Popular Phrases:* Level Up | Game Over | Player One | High Score" }
      ]
    }
  ]
}
```

---

## Security Considerations

### Slack Request Verification
```typescript
import crypto from 'crypto';

function verifySlackRequest(
  signingSecret: string,
  timestamp: string,
  body: string,
  signature: string
): boolean {
  const fiveMinutesAgo = Math.floor(Date.now() / 1000) - 60 * 5;
  if (parseInt(timestamp) < fiveMinutesAgo) {
    return false; // Request too old
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
}
```

### Secret Management
- Slack signing secret in AWS Secrets Manager
- Slack bot token in AWS Secrets Manager
- Anthropic API key in AWS Secrets Manager (for `/ideate` command)
- Gemini API key in AWS Secrets Manager (optional, for Gemini image provider)
- Lambda functions access secrets via environment variables (ARNs) and SDK

### S3 Security
- Block public access
- Presigned URLs for download (7-day expiry)
- Server-side encryption (SSE-S3)

### API Gateway
- No authentication (Slack handles via signature verification)
- Rate limiting via API Gateway throttling
- Request validation

---

## Cost Estimation

### Per Image Generation (3 images per request)

**Using Titan Image Generator:**
| Service | Usage | Estimated Cost |
|---------|-------|----------------|
| Bedrock (Titan) | 3 images @ $0.008/image | $0.024 |
| Lambda | ~2min compute | $0.002 |
| S3 | Storage + requests | $0.001 |
| DynamoDB | Read/write units | $0.001 |
| **Total per request** | | **~$0.03** |

**Using Stability SDXL:**
| Service | Usage | Estimated Cost |
|---------|-------|----------------|
| Bedrock (SDXL) | 3 images @ $0.04/image | $0.12 |
| Lambda | ~2min compute | $0.002 |
| S3 | Storage + requests | $0.001 |
| DynamoDB | Read/write units | $0.001 |
| **Total per request** | | **~$0.13** |

### Monthly Estimate (100 requests/month)
**Titan:** ~$3 generation + $5-10 infrastructure = **~$10-15/month**
**SDXL:** ~$12 generation + $5-10 infrastructure = **~$20-25/month**

---

## Project Structure

```
t-shirt-generator/
├── infrastructure/
│   ├── bin/
│   │   └── app.ts
│   └── lib/
│       ├── stacks/
│       │   ├── api-stack.ts
│       │   ├── storage-stack.ts
│       │   └── processing-stack.ts
│       └── constructs/
│           └── slack-api.ts
├── src/
│   ├── handlers/
│   │   ├── webhook-handler.ts      # Routes /generate and /ideate commands
│   │   ├── interaction-handler.ts
│   │   ├── image-generator.ts
│   │   ├── action-processor.ts
│   │   └── ideation-processor.ts   # Claude + web search for trend research
│   ├── services/
│   │   ├── anthropic/              # Claude AI integration for /ideate
│   │   │   ├── index.ts
│   │   │   └── prompt-ideation.ts
│   │   ├── slack/
│   │   │   ├── index.ts
│   │   │   ├── client.ts
│   │   │   ├── verification.ts
│   │   │   └── messages.ts
│   │   ├── bedrock/
│   │   │   ├── index.ts
│   │   │   └── providers/
│   │   │       ├── titan-provider.ts
│   │   │       └── sdxl-provider.ts
│   │   ├── gemini/                 # Alternative image provider
│   │   │   ├── index.ts
│   │   │   └── gemini-provider.ts
│   │   └── storage/
│   │       ├── dynamo.ts
│   │       ├── s3.ts
│   │       └── secrets.ts
│   ├── types/
│   │   ├── slack.types.ts
│   │   ├── domain.types.ts
│   │   └── bedrock.types.ts
│   └── config/
│       └── index.ts
├── test/
│   └── unit/
│       ├── handlers/
│       └── services/
│           ├── anthropic/
│           │   └── prompt-ideation.test.ts
│           └── ...
├── package.json
├── tsconfig.json
├── jest.config.js
├── cdk.json
├── CLAUDE.md
└── DESIGN.md
```

---

## Implementation Phases

### Phase 1: Foundation
- [ ] Initialize CDK project with TypeScript
- [ ] Set up S3 bucket with lifecycle rules
- [ ] Set up DynamoDB tables
- [ ] Create Secrets Manager secrets (placeholders)
- [ ] Basic Lambda function structure

### Phase 2: Slack Integration
- [ ] Implement Slack signature verification
- [ ] Create webhook handler Lambda
- [ ] Create interaction handler Lambda
- [ ] Set up API Gateway endpoints
- [ ] Create and configure Slack App

### Phase 3: Image Generation
- [ ] Implement Bedrock client
- [ ] Create image generator Lambda
- [ ] Set up SQS queue for generation
- [ ] Implement S3 storage logic
- [ ] DynamoDB CRUD operations

### Phase 4: User Actions
- [ ] Implement action processor Lambda
- [ ] Keep image flow (copy, presigned URL)
- [ ] Discard image flow
- [ ] Regenerate flow
- [ ] Slack message updates

### Phase 5: Polish & Testing
- [ ] Error handling and retries
- [ ] Unit tests
- [ ] Integration tests
- [ ] Monitoring and logging
- [ ] Documentation

---

## Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `SLACK_SIGNING_SECRET_ARN` | ARN of Slack signing secret | `arn:aws:secretsmanager:...` |
| `SLACK_BOT_TOKEN_ARN` | ARN of Slack bot OAuth token | `arn:aws:secretsmanager:...` |
| `ANTHROPIC_API_KEY_ARN` | ARN of Anthropic API key (for `/ideate`) | `arn:aws:secretsmanager:...` |
| `GEMINI_API_KEY_ARN` | ARN of Gemini API key (optional) | `arn:aws:secretsmanager:...` |
| `ALLOWED_CHANNEL_ID` | Slack channel ID for commands | `C0123456789` |
| `IMAGE_PROVIDER` | Image generation provider | `bedrock` or `gemini` |
| `BEDROCK_MODEL` | Bedrock model when using bedrock provider | `titan` or `sdxl` |
| `GEMINI_MODEL` | Gemini model when using gemini provider | `gemini-3-pro` |
| `IMAGES_BUCKET` | S3 bucket name | `t-shirt-generator-images` |
| `IMAGES_CDN_DOMAIN` | CloudFront domain for images | `d1234.cloudfront.net` |
| `REQUESTS_TABLE` | DynamoDB table name | `t-shirt-generator-requests` |
| `IMAGES_TABLE` | DynamoDB table name | `t-shirt-generator-images` |
| `GENERATION_QUEUE_URL` | SQS queue URL for generation jobs | `https://sqs...` |
| `ACTION_QUEUE_URL` | SQS queue URL for action jobs | `https://sqs...` |
| `IDEATION_QUEUE_URL` | SQS queue URL for ideation jobs | `https://sqs...` |

---

## Next Steps

1. ~~Review and approve architecture~~ **DONE**
2. Create CLAUDE.md with project-specific instructions
3. Initialize CDK project structure
4. Begin Phase 1 implementation

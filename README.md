# T-Shirt Generator

A Slack-integrated application that generates t-shirt graphics using AI image generation. Supports **Amazon Bedrock** (Titan, SDXL) and **Google Gemini** (Imagen 3) as providers. Users submit prompts via Slack slash commands, receive AI-generated images, and can keep, discard, or regenerate them.

**Slash Commands:**
- `/generate <prompt>` - Generate 3 t-shirt graphics from a text prompt
- `/ideate <theme>` - Generate 10 creative prompt ideas using Claude AI for inspiration

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Prerequisites](#prerequisites)
- [Project Structure](#project-structure)
- [Setup & Deployment](#setup--deployment)
- [Slack App Configuration](#slack-app-configuration)
- [Usage](#usage)
- [Configuration Options](#configuration-options)
- [Development](#development)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Cost Estimation](#cost-estimation)

## Overview

This application provides a streamlined workflow for generating t-shirt graphics:

1. **User enters a prompt** in a designated Slack channel using `/generate <prompt>`
2. **AI generates 3 images** based on the prompt with t-shirt-optimized enhancements
3. **Images are displayed in Slack** with interactive buttons
4. **User can Keep, Discard, or Regenerate** each image
5. **Kept images are saved to S3** with a 7-day presigned download URL

### Key Features

- **Multiple AI providers** - Switch between Bedrock and Gemini via environment variable
- **Bedrock models**: Amazon Titan Image Generator v2, Stability AI SDXL
- **Gemini models**: Gemini 3 Pro (gemini-3-pro-image-preview), Gemini 2.5 Flash
- Automatic **prompt enhancement** for t-shirt-optimized outputs
- **Transparency detection** - automatically optimizes prompts mentioning "transparent background"
- **Channel restriction** - only works in a designated Slack channel
- **Async processing** - handles Slack's 3-second timeout requirement
- **Presigned URLs** for secure image downloads (7-day expiry)
- **AWS Lambda Powertools** - Structured logging and secrets management with caching

### Technology Stack

| Category | Technology |
|----------|------------|
| **Runtime** | Node.js 22, TypeScript 5 |
| **Infrastructure** | AWS CDK v2 |
| **Compute** | AWS Lambda (ARM64) |
| **Storage** | S3, DynamoDB |
| **Messaging** | SQS |
| **API** | API Gateway |
| **AI Providers** | Amazon Bedrock, Google Gemini, Anthropic Claude |
| **Observability** | [AWS Lambda Powertools](https://docs.powertools.aws.dev/lambda/typescript/) (Logger, Parameters) |
| **Validation** | Zod |

## Architecture

```
┌────────────────────────────────────────────────────────────────────────────┐
│                                  SLACK                                     │
│  ┌─────────────┐     ┌─────────────────┐     ┌─────────────────────────┐   │
│  │ /generate   │     │ Image Preview   │     │ Interactive Buttons     │   │
│  │ command     │     │ Messages        │     │ (Keep/Discard/Regen)    │   │
│  └──────┬──────┘     └────────▲────────┘     └───────────┬─────────────┘   │
└─────────┼──────────────────────┼─────────────────────────┼─────────────────┘
          │                      │                         │
          ▼                      │                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            AWS CLOUD                                         │
│                                                                              │
│  ┌──────────────────┐                    ┌──────────────────┐               │
│  │   API Gateway    │                    │   API Gateway    │               │
│  │  /slack/events   │                    │ /slack/interact  │               │
│  └────────┬─────────┘                    └────────┬─────────┘               │
│           │                                       │                          │
│           ▼                                       ▼                          │
│  ┌──────────────────┐                    ┌──────────────────┐               │
│  │  Webhook Handler │                    │ Interaction      │               │
│  │     Lambda       │                    │ Handler Lambda   │               │
│  └────────┬─────────┘                    └────────┬─────────┘               │
│           │                                       │                          │
│           ▼                                       ▼                          │
│  ┌──────────────────┐                    ┌──────────────────┐               │
│  │   SQS Queue      │                    │   SQS Queue      │               │
│  │ (Generation)     │                    │ (Actions)        │               │
│  └────────┬─────────┘                    └────────┬─────────┘               │
│           │                                       │                          │
│           ▼                                       ▼                          │
│  ┌──────────────────┐                    ┌──────────────────┐               │
│  │  Image Generator │                    │  Action Processor│               │
│  │     Lambda       │                    │     Lambda       │               │
│  └────────┬─────────┘                    └────────┬─────────┘               │
│           │                                       │                          │
│           ├───────────────────┬──────────────────┤                          │
│           ▼                   ▼                  ▼                          │
│  ┌──────────────┐    ┌──────────────┐   ┌──────────────┐                   │
│  │ AI Provider  │    │   DynamoDB   │   │      S3      │                   │
│  │ (Bedrock or  │    │  (Requests)  │   │   (Images)   │                   │
│  │   Gemini)    │    │              │   │              │                   │
│  └──────────────┘    └──────────────┘   └──────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Component Overview

| Component | Purpose |
|-----------|---------|
| **API Gateway** | Receives Slack webhooks (slash commands and button interactions) |
| **Webhook Handler Lambda** | Validates Slack requests, queues generation jobs |
| **Interaction Handler Lambda** | Processes button clicks (keep/discard/regenerate) |
| **Image Generator Lambda** | Calls AI provider (Bedrock/Gemini), stores images in S3, posts to Slack |
| **Action Processor Lambda** | Handles keep (copy to saved/), discard, and regenerate actions |
| **SQS Queues** | Decouple request handling from processing (async pattern) |
| **DynamoDB** | Stores generation requests and image metadata |
| **S3** | Stores generated images (temp and saved) |
| **Secrets Manager** | Securely stores Slack and provider credentials (accessed via Powertools Parameters) |

### Data Flow

#### Image Generation Flow

```
1. User: /generate A retro sunset with palm trees
2. API Gateway → Webhook Handler Lambda
3. Lambda validates Slack signature
4. Lambda creates request in DynamoDB (status: pending)
5. Lambda queues job to SQS generation queue
6. Lambda returns immediate "Generating..." response to Slack
7. Image Generator Lambda picks up SQS message
8. Lambda enhances prompt with t-shirt optimizations
9. Lambda calls Bedrock to generate 3 images
10. Lambda stores images in S3 (temp/{requestId}/)
11. Lambda creates image records in DynamoDB
12. Lambda posts images to Slack with action buttons
```

#### Keep Image Flow

```
1. User clicks "Keep" button on an image
2. API Gateway → Interaction Handler Lambda
3. Lambda validates Slack signature
4. Lambda queues action to SQS action queue
5. Action Processor Lambda picks up message
6. Lambda copies image from temp/ to saved/{userId}/
7. Lambda generates 7-day presigned URL
8. Lambda updates image record in DynamoDB
9. Lambda posts download link to Slack
```

## Prerequisites

- **Node.js 22+** and npm
- **AWS CLI** configured with appropriate credentials
- **AWS CDK CLI** (`npm install -g aws-cdk`)
- **Slack workspace** with admin access to create apps

**For Bedrock provider (default):**
- **Amazon Bedrock** access enabled in your AWS account
- Model access enabled for Titan Image Generator and/or Stability SDXL

**For /ideate command (Claude AI):**
- **Anthropic API key** from [Anthropic Console](https://console.anthropic.com/)

**For Gemini provider (optional):**
- **Google Cloud account** with Gemini API access
- **Gemini API key** from [Google AI Studio](https://makersuite.google.com/app/apikey)

## Project Structure

```
t-shirt-generator/
├── infrastructure/                 # AWS CDK infrastructure code
│   ├── bin/
│   │   └── app.ts                 # CDK app entry point
│   └── lib/
│       └── stacks/
│           ├── storage-stack.ts   # S3, DynamoDB, Secrets Manager
│           ├── processing-stack.ts # SQS queues, Lambda functions
│           └── api-stack.ts       # API Gateway endpoints
├── src/                           # Lambda function source code
│   ├── handlers/                  # Lambda entry points
│   │   ├── webhook-handler.ts     # Handles /generate command
│   │   ├── interaction-handler.ts # Handles button clicks
│   │   ├── image-generator.ts     # Generates images via Bedrock
│   │   └── action-processor.ts    # Processes keep/discard/regenerate
│   ├── services/                  # Business logic
│   │   ├── slack/                 # Slack API integration
│   │   │   ├── verification.ts    # Request signature verification
│   │   │   ├── client.ts          # Slack Web API client
│   │   │   └── messages.ts        # Message builders
│   │   ├── image-generation/      # Provider-agnostic image generation
│   │   │   ├── types.ts           # ImageGenerator interface
│   │   │   ├── factory.ts         # Provider factory functions
│   │   │   ├── bedrock-provider.ts # Bedrock (Titan/SDXL)
│   │   │   └── gemini-provider.ts # Gemini (Imagen 3/Flash)
│   │   ├── bedrock/               # Legacy Bedrock integration
│   │   │   └── image-generator.ts # Titan & SDXL integration
│   │   └── storage/               # Data persistence
│   │       ├── s3.ts              # S3 operations
│   │       ├── dynamo.ts          # DynamoDB operations
│   │       └── secrets.ts         # Secrets Manager (via Powertools Parameters)
│   ├── types/                     # TypeScript type definitions
│   │   ├── domain.types.ts        # Domain models
│   │   └── slack.types.ts         # Slack API types
│   └── config/                    # Configuration
│       └── index.ts               # Environment-based config
├── test/                          # Test files
│   └── unit/                      # Unit tests
├── DESIGN.md                      # Detailed architecture documentation
├── CLAUDE.md                      # AI assistant project instructions
└── package.json                   # Dependencies and scripts
```

## Setup & Deployment

### 1. Install Dependencies

```bash
npm install
```

### 2. Build and Verify

```bash
# Type check
npm run type-check

# Run tests
npm test

# Synthesize CDK (verify infrastructure)
npx cdk synth
```

### 3. Deploy Infrastructure

```bash
# Deploy all stacks
npx cdk deploy --all

# Or deploy individually
npx cdk deploy TShirtGeneratorStorage
npx cdk deploy TShirtGeneratorProcessing
npx cdk deploy TShirtGeneratorApi
```

After deployment, note the outputs:
- `TShirtGeneratorApi.WebhookEndpoint` - URL for Slack slash command
- `TShirtGeneratorApi.InteractionEndpoint` - URL for Slack interactive components
- `TShirtGeneratorStorage.SlackSigningSecretArn` - ARN to update with real secret
- `TShirtGeneratorStorage.SlackBotTokenArn` - ARN to update with real token

### 4. Update Secrets

After creating your Slack app (see next section), update the secrets:

```bash
# Update signing secret
aws secretsmanager put-secret-value \
  --secret-id t-shirt-generator/slack-signing-secret \
  --secret-string '{"value":"your-signing-secret-here"}'

# Update bot token
aws secretsmanager put-secret-value \
  --secret-id t-shirt-generator/slack-bot-token \
  --secret-string '{"value":"xoxb-your-bot-token-here"}'

# Update Anthropic API key (required for /ideate command)
aws secretsmanager put-secret-value \
  --secret-id t-shirt-generator/anthropic-api-key \
  --secret-string '{"value":"your-anthropic-api-key-here"}'

# (Optional) If using Gemini provider, update API key
aws secretsmanager put-secret-value \
  --secret-id t-shirt-generator/gemini-api-key \
  --secret-string '{"value":"your-gemini-api-key-here"}'
```

### 5. Configure Lambda Environment Variables

Update the `ALLOWED_CHANNEL_ID` environment variable on all Lambda functions:

```bash
# Get your channel ID from Slack (right-click channel > View channel details)
aws lambda update-function-configuration \
  --function-name t-shirt-generator-webhook-handler \
  --environment "Variables={ALLOWED_CHANNEL_ID=C0123456789,...}"
```

Or update via the AWS Console in each Lambda function's configuration.

## Slack App Configuration

### 1. Create Slack App

1. Go to https://api.slack.com/apps
2. Click **Create New App** → **From scratch**
3. Enter app name: `T-Shirt Generator`
4. Select your workspace

### 2. Configure Slash Commands

1. Navigate to **Slash Commands** in the sidebar
2. Click **Create New Command** and configure `/generate`:
   - **Command**: `/generate`
   - **Request URL**: `https://<api-id>.execute-api.<region>.amazonaws.com/prod/slack/events`
   - **Short Description**: `Generate t-shirt graphics`
   - **Usage Hint**: `[your design prompt]`
3. Click **Save**, then **Create New Command** again for `/ideate`:
   - **Command**: `/ideate`
   - **Request URL**: `https://<api-id>.execute-api.<region>.amazonaws.com/prod/slack/events`
   - **Short Description**: `Generate creative prompt ideas`
   - **Usage Hint**: `[theme keywords]`
4. Click **Save**

### 3. Configure Interactive Components

1. Navigate to **Interactivity & Shortcuts**
2. Toggle **Interactivity** to **On**
3. Set **Request URL**: `https://<api-id>.execute-api.<region>.amazonaws.com/prod/slack/interactions`
4. Click **Save Changes**

### 4. Configure Bot Permissions

1. Navigate to **OAuth & Permissions**
2. Under **Scopes** → **Bot Token Scopes**, add:
   - `commands`
   - `chat:write`
   - `files:write`
3. Click **Install to Workspace**
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`)

### 5. Get Signing Secret

1. Navigate to **Basic Information**
2. Under **App Credentials**, copy the **Signing Secret**

### 6. Invite Bot to Channel

1. In Slack, go to your designated channel
2. Type `/invite @T-Shirt Generator` or add via channel settings

## Usage

### Generating Images

In your designated Slack channel:

```
/generate A vintage sunset with palm trees and mountains
```

The bot will respond with a "Generating..." message, then post 3 images with action buttons.

### Getting Prompt Ideas

Need inspiration? Use the `/ideate` command to generate creative prompts:

```
/ideate retro gaming 80s
```

The bot will use Claude AI to generate 10 creative t-shirt design prompts based on your theme. Copy any prompt and use it with `/generate`.

### Action Buttons

Each image has:
- **Keep** - Saves the image and provides a download link
- **Discard** - Removes the image

Batch actions:
- **Keep All** - Saves all images
- **Discard All** - Removes all images
- **Regenerate All** - Creates 3 new images with the same prompt

### Transparency Support

Include "transparent", "no background", or "isolated" in your prompt:

```
/generate A cartoon rocket ship on transparent background
```

The system automatically adds transparency-optimized prompt enhancements.

### Example Prompts

```
/generate A retro 80s neon grid with palm trees
/generate Cute kawaii cat with coffee cup, isolated on transparent background
/generate Minimalist mountain landscape in geometric style
/generate Vintage motorcycle with American flag, distressed look
/generate Abstract watercolor splashes in vibrant colors
```

## Configuration Options

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `ALLOWED_CHANNEL_ID` | Slack channel ID (required) | - |
| `IMAGE_PROVIDER` | `bedrock` or `gemini` | `bedrock` |
| `BEDROCK_MODEL` | `titan` or `sdxl` (when using Bedrock) | `titan` |
| `GEMINI_MODEL` | `gemini-3-pro` or `gemini-2.5-flash` | `gemini-3-pro` |
| `USE_GEMINI_FLASH` | Use Gemini 2.5 Flash instead of 3 Pro | `false` |
| `PROMPT_SUFFIX` | Text appended to all prompts | `, high quality, professional graphic design...` |
| `NEGATIVE_PROMPT` | Default negative prompt | `blurry, low quality, distorted...` |
| `PRESIGNED_URL_EXPIRY` | URL expiry in seconds | `604800` (7 days) |

### Switching Image Providers

Update the `IMAGE_PROVIDER` environment variable on the `image-generator` Lambda:

```bash
# Switch to Gemini
aws lambda update-function-configuration \
  --function-name t-shirt-generator-image-generator \
  --environment "Variables={IMAGE_PROVIDER=gemini,...}"

# Switch back to Bedrock
aws lambda update-function-configuration \
  --function-name t-shirt-generator-image-generator \
  --environment "Variables={IMAGE_PROVIDER=bedrock,...}"
```

### Switching Bedrock Models

Update the `BEDROCK_MODEL` environment variable on the `image-generator` Lambda:

```bash
aws lambda update-function-configuration \
  --function-name t-shirt-generator-image-generator \
  --environment "Variables={BEDROCK_MODEL=sdxl,...}"
```

### Using Gemini 2.5 Flash

Gemini 2.5 Flash is faster and cheaper than Gemini 3 Pro. To use it:

```bash
aws lambda update-function-configuration \
  --function-name t-shirt-generator-image-generator \
  --environment "Variables={IMAGE_PROVIDER=gemini,USE_GEMINI_FLASH=true,...}"
```

Or set `GEMINI_MODEL=gemini-2.5-flash` directly.

**Provider & Model Comparison:**

| Provider | Model | Cost/Image | Quality | Speed | Notes |
|----------|-------|------------|---------|-------|-------|
| Bedrock | Titan Image Generator v2 | ~$0.008 | Good | Fast | Best value |
| Bedrock | Stability SDXL 1.0 | ~$0.04 | Higher | Slower | Premium quality |
| Gemini | Gemini 3 Pro | ~$0.02 | High | Medium | Default, high quality |
| Gemini | Gemini 2.5 Flash | ~$0.005 | Good | Fast | Cost-effective |

### Customizing Prompt Enhancements

Update environment variables to customize how prompts are enhanced:

```bash
# Custom suffix for all prompts
PROMPT_SUFFIX=", vector art style, bold colors, print ready"

# Custom negative prompt
NEGATIVE_PROMPT="blurry, pixelated, low resolution, watermark"
```

### Secrets Management

Secrets are retrieved using [AWS Lambda Powertools Parameters](https://docs.aws.amazon.com/powertools/typescript/latest/utilities/parameters/) utility, which provides:

- **Built-in caching** - Secrets are cached for 5 minutes to reduce API calls
- **Automatic retries** - Handles transient failures gracefully
- **JSON transformation** - Automatically parses JSON-formatted secrets

```typescript
// Example: How secrets are retrieved internally
import { getSecret } from '@aws-lambda-powertools/parameters/secrets';

const secret = await getSecret(secretArn, {
  maxAge: 300,        // Cache for 5 minutes
  transform: 'json',  // Auto-parse JSON
});
```

Secrets are stored in AWS Secrets Manager with the format `{"value": "your-secret-here"}`.

## Development

### Local Development

```bash
# Install dependencies
npm install

# Type checking (watch mode)
npm run watch

# Run tests in watch mode
npm run test:watch

# Lint code
npm run lint

# Auto-fix lint issues
npm run lint:fix
```

### CDK Commands

```bash
# Show pending infrastructure changes
npx cdk diff

# Deploy all stacks
npx cdk deploy --all

# Deploy specific stack
npx cdk deploy TShirtGeneratorProcessing

# Destroy all stacks (careful!)
npx cdk destroy --all

# Synthesize CloudFormation templates
npx cdk synth
```

### Adding New Features

1. **New Lambda Handler**: Add to `src/handlers/`, update `processing-stack.ts`
2. **New Service**: Add to `src/services/`, export from index
3. **New Types**: Add to `src/types/`
4. **Infrastructure Changes**: Modify stacks in `infrastructure/lib/stacks/`

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```

### Test Structure

```
test/
└── unit/
    └── services/
        ├── slack/
        │   └── verification.test.ts       # Slack signature verification
        ├── bedrock/
        │   └── image-generator.test.ts    # Legacy Bedrock integration
        └── image-generation/
            ├── factory.test.ts            # Provider factory tests
            └── types.test.ts              # Type utilities tests
```

### Writing Tests

Tests use Jest with `aws-sdk-client-mock` for AWS SDK mocking:

```typescript
import { mockClient } from 'aws-sdk-client-mock';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';

const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

it('should upload image', async () => {
  s3Mock.on(PutObjectCommand).resolves({});
  // ... test implementation
});
```

## Troubleshooting

### Common Issues

#### "This command is only available in the designated design channel"

- Verify `ALLOWED_CHANNEL_ID` is set correctly on Lambda functions
- Get channel ID: Right-click channel → View channel details → Copy ID at bottom

#### Images not appearing in Slack

1. Check CloudWatch Logs for `image-generator` Lambda
2. **For Bedrock:** Verify model access is enabled in your AWS region
3. **For Gemini:** Verify API key is set correctly in Secrets Manager
4. Check S3 bucket permissions

#### Gemini API errors

1. Verify your API key is valid and has quota remaining
2. Check that Imagen 3 or Gemini Flash is enabled for your API key
3. Ensure the secret format is correct: `{"value":"your-api-key"}`
4. Check for rate limiting - Gemini has strict quotas on free tier

#### "Invalid signature" errors

1. Verify signing secret is correctly stored in Secrets Manager
2. Check secret format: `{"value":"your-secret"}`
3. Ensure request isn't being modified by a proxy

#### Button clicks not working

1. Verify Interactivity URL is correct in Slack app settings
2. Check `interaction-handler` Lambda logs
3. Verify bot has `chat:write` permission

### Viewing Logs

```bash
# View webhook handler logs
aws logs tail /aws/lambda/t-shirt-generator-webhook-handler --follow

# View image generator logs
aws logs tail /aws/lambda/t-shirt-generator-image-generator --follow

# View action processor logs
aws logs tail /aws/lambda/t-shirt-generator-action-processor --follow
```

### DLQ Monitoring

Failed messages go to Dead Letter Queues. Monitor and reprocess:

```bash
# Check DLQ message count
aws sqs get-queue-attributes \
  --queue-url https://sqs.<region>.amazonaws.com/<account>/t-shirt-generator-generation-dlq \
  --attribute-names ApproximateNumberOfMessages
```

## Cost Estimation

### Per Generation Request (3 images)

| Service | Bedrock Titan | Bedrock SDXL | Gemini 3 Pro | Gemini 2.5 Flash |
|---------|---------------|--------------|--------------|------------------|
| AI Generation | $0.024 | $0.12 | ~$0.06 | ~$0.015 |
| Lambda | ~$0.002 | ~$0.002 | ~$0.002 | ~$0.002 |
| S3 | ~$0.001 | ~$0.001 | ~$0.001 | ~$0.001 |
| DynamoDB | ~$0.001 | ~$0.001 | ~$0.001 | ~$0.001 |
| **Total** | **~$0.03** | **~$0.13** | **~$0.07** | **~$0.02** |

### Monthly Estimate (Bedrock)

| Usage | Titan | SDXL |
|-------|-------|------|
| 50 requests/month | ~$5 | ~$12 |
| 100 requests/month | ~$8 | ~$18 |
| 500 requests/month | ~$20 | ~$70 |

### Monthly Estimate (Gemini)

| Usage | Gemini 3 Pro | Gemini 2.5 Flash |
|-------|--------------|------------------|
| 50 requests/month | ~$8 | ~$5 |
| 100 requests/month | ~$12 | ~$7 |
| 500 requests/month | ~$40 | ~$15 |

*Includes base infrastructure costs (~$5-10/month for API Gateway, Lambda, S3, DynamoDB)*

**Note:** Gemini pricing may vary. Check [Google AI pricing](https://ai.google.dev/pricing) for current rates.

## License

ISC

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make changes with tests
4. Run `npm test` and `npm run type-check`
5. Submit a pull request

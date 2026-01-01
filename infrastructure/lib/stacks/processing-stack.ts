import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambdaEventSources from 'aws-cdk-lib/aws-lambda-event-sources';
import type { Construct } from 'constructs';
import type { SlackSecrets, ProviderSecrets } from './storage-stack';
import * as path from 'node:path';

export interface ProcessingStackProps extends cdk.StackProps {
  readonly imagesBucket: s3.IBucket;
  readonly requestsTable: dynamodb.ITable;
  readonly imagesTable: dynamodb.ITable;
  readonly slackSecrets: SlackSecrets;
  readonly providerSecrets: ProviderSecrets;
}

export class ProcessingStack extends cdk.Stack {
  public readonly webhookHandler: nodejs.NodejsFunction;
  public readonly interactionHandler: nodejs.NodejsFunction;
  public readonly imageGenerator: nodejs.NodejsFunction;
  public readonly actionProcessor: nodejs.NodejsFunction;
  public readonly generationQueue: sqs.Queue;
  public readonly actionQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);

    const { imagesBucket, requestsTable, imagesTable, slackSecrets, providerSecrets } = props;

    // Dead Letter Queues
    const generationDlq = new sqs.Queue(this, 'GenerationDLQ', {
      queueName: 't-shirt-generator-generation-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    const actionDlq = new sqs.Queue(this, 'ActionDLQ', {
      queueName: 't-shirt-generator-action-dlq',
      retentionPeriod: cdk.Duration.days(14),
    });

    // Main Queues
    this.generationQueue = new sqs.Queue(this, 'GenerationQueue', {
      queueName: 't-shirt-generator-generation-queue',
      visibilityTimeout: cdk.Duration.minutes(6), // 6x Lambda timeout
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: generationDlq,
        maxReceiveCount: 3,
      },
    });

    this.actionQueue = new sqs.Queue(this, 'ActionQueue', {
      queueName: 't-shirt-generator-action-queue',
      visibilityTimeout: cdk.Duration.minutes(3), // 6x Lambda timeout
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: actionDlq,
        maxReceiveCount: 3,
      },
    });

    // Common Lambda configuration
    const lambdaEnvironment = {
      IMAGES_BUCKET: imagesBucket.bucketName,
      REQUESTS_TABLE: requestsTable.tableName,
      IMAGES_TABLE: imagesTable.tableName,
      GENERATION_QUEUE_URL: this.generationQueue.queueUrl,
      ACTION_QUEUE_URL: this.actionQueue.queueUrl,
      // Image provider configuration - defaults to Bedrock
      IMAGE_PROVIDER: 'bedrock', // Can be 'bedrock' or 'gemini'
      BEDROCK_MODEL: 'titan',
      GEMINI_MODEL: 'imagen-3',
      USE_GEMINI_FLASH: 'false',
      ALLOWED_CHANNEL_ID: '', // Must be set after deployment
      PRESIGNED_URL_EXPIRY: '604800',
      NODE_OPTIONS: '--enable-source-maps',
      POWERTOOLS_SERVICE_NAME: 't-shirt-generator',
      POWERTOOLS_LOG_LEVEL: 'INFO',
    };

    const nodejsFunctionProps: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        minify: true,
        sourceMap: true,
        target: 'node22',
        format: nodejs.OutputFormat.CJS,
        mainFields: ['module', 'main'],
        externalModules: ['@aws-sdk/*'],
      },
    };

    // Webhook Handler Lambda
    this.webhookHandler = new nodejs.NodejsFunction(this, 'WebhookHandler', {
      ...nodejsFunctionProps,
      functionName: 't-shirt-generator-webhook-handler',
      description: 'Handles Slack slash command webhooks',
      entry: path.join(__dirname, '../../../src/handlers/webhook-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: lambdaEnvironment,
    });

    // Interaction Handler Lambda
    this.interactionHandler = new nodejs.NodejsFunction(this, 'InteractionHandler', {
      ...nodejsFunctionProps,
      functionName: 't-shirt-generator-interaction-handler',
      description: 'Handles Slack interactive component events',
      entry: path.join(__dirname, '../../../src/handlers/interaction-handler.ts'),
      handler: 'handler',
      timeout: cdk.Duration.seconds(10),
      memorySize: 256,
      environment: lambdaEnvironment,
    });

    // Image Generator Lambda
    this.imageGenerator = new nodejs.NodejsFunction(this, 'ImageGenerator', {
      ...nodejsFunctionProps,
      functionName: 't-shirt-generator-image-generator',
      description: 'Generates images using Amazon Bedrock',
      entry: path.join(__dirname, '../../../src/handlers/image-generator.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: lambdaEnvironment,
      reservedConcurrentExecutions: 5, // Limit concurrent Bedrock calls
    });

    // Action Processor Lambda
    this.actionProcessor = new nodejs.NodejsFunction(this, 'ActionProcessor', {
      ...nodejsFunctionProps,
      functionName: 't-shirt-generator-action-processor',
      description: 'Processes user actions (keep, discard, regenerate)',
      entry: path.join(__dirname, '../../../src/handlers/action-processor.ts'),
      handler: 'handler',
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // Grant secrets access to all handlers
    slackSecrets.signingSecret.grantRead(this.webhookHandler);
    slackSecrets.signingSecret.grantRead(this.interactionHandler);
    slackSecrets.botToken.grantRead(this.webhookHandler);
    slackSecrets.botToken.grantRead(this.interactionHandler);
    slackSecrets.botToken.grantRead(this.imageGenerator);
    slackSecrets.botToken.grantRead(this.actionProcessor);

    // Add environment variables for secret ARNs
    const secretEnvVars = {
      SLACK_SIGNING_SECRET_ARN: slackSecrets.signingSecret.secretArn,
      SLACK_BOT_TOKEN_ARN: slackSecrets.botToken.secretArn,
    };

    this.webhookHandler.addEnvironment('SLACK_SIGNING_SECRET_ARN', secretEnvVars.SLACK_SIGNING_SECRET_ARN);
    this.webhookHandler.addEnvironment('SLACK_BOT_TOKEN_ARN', secretEnvVars.SLACK_BOT_TOKEN_ARN);
    this.interactionHandler.addEnvironment('SLACK_SIGNING_SECRET_ARN', secretEnvVars.SLACK_SIGNING_SECRET_ARN);
    this.interactionHandler.addEnvironment('SLACK_BOT_TOKEN_ARN', secretEnvVars.SLACK_BOT_TOKEN_ARN);
    this.imageGenerator.addEnvironment('SLACK_BOT_TOKEN_ARN', secretEnvVars.SLACK_BOT_TOKEN_ARN);
    this.actionProcessor.addEnvironment('SLACK_BOT_TOKEN_ARN', secretEnvVars.SLACK_BOT_TOKEN_ARN);

    // Grant Gemini API key access to image generator (for when using Gemini provider)
    providerSecrets.geminiApiKey.grantRead(this.imageGenerator);
    this.imageGenerator.addEnvironment('GEMINI_API_KEY_ARN', providerSecrets.geminiApiKey.secretArn);

    // Grant SQS permissions
    this.generationQueue.grantSendMessages(this.webhookHandler);
    this.generationQueue.grantSendMessages(this.actionProcessor); // For regenerate
    this.actionQueue.grantSendMessages(this.interactionHandler);

    // Add SQS event sources
    this.imageGenerator.addEventSource(
      new lambdaEventSources.SqsEventSource(this.generationQueue, {
        batchSize: 1, // Process one generation at a time
        maxConcurrency: 5,
      })
    );

    this.actionProcessor.addEventSource(
      new lambdaEventSources.SqsEventSource(this.actionQueue, {
        batchSize: 1,
        maxConcurrency: 10,
      })
    );

    // Grant DynamoDB permissions
    requestsTable.grantReadWriteData(this.webhookHandler);
    requestsTable.grantReadWriteData(this.interactionHandler);
    requestsTable.grantReadWriteData(this.imageGenerator);
    requestsTable.grantReadWriteData(this.actionProcessor);

    imagesTable.grantReadWriteData(this.imageGenerator);
    imagesTable.grantReadWriteData(this.actionProcessor);

    // Grant S3 permissions
    imagesBucket.grantReadWrite(this.imageGenerator);
    imagesBucket.grantReadWrite(this.actionProcessor);

    // Grant Bedrock permissions
    const bedrockPolicy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-image-generator-v2:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/stability.stable-diffusion-xl-v1`,
      ],
    });

    this.imageGenerator.addToRolePolicy(bedrockPolicy);

    // Outputs
    new cdk.CfnOutput(this, 'GenerationQueueUrl', {
      value: this.generationQueue.queueUrl,
      description: 'URL of the image generation SQS queue',
    });

    new cdk.CfnOutput(this, 'ActionQueueUrl', {
      value: this.actionQueue.queueUrl,
      description: 'URL of the action processing SQS queue',
    });

    new cdk.CfnOutput(this, 'WebhookHandlerArn', {
      value: this.webhookHandler.functionArn,
      description: 'ARN of the webhook handler Lambda',
    });

    new cdk.CfnOutput(this, 'InteractionHandlerArn', {
      value: this.interactionHandler.functionArn,
      description: 'ARN of the interaction handler Lambda',
    });
  }
}

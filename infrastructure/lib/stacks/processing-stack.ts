import * as cdk from "aws-cdk-lib";
import * as lambda from "aws-cdk-lib/aws-lambda";
import * as nodejs from "aws-cdk-lib/aws-lambda-nodejs";
import * as sqs from "aws-cdk-lib/aws-sqs";
import * as s3 from "aws-cdk-lib/aws-s3";
import * as dynamodb from "aws-cdk-lib/aws-dynamodb";
import * as iam from "aws-cdk-lib/aws-iam";
import * as lambdaEventSources from "aws-cdk-lib/aws-lambda-event-sources";
import type { Construct } from "constructs";
import type { SlackSecrets, ProviderSecrets } from "./storage-stack";
import * as path from "node:path";

export interface ProcessingStackProps extends cdk.StackProps {
  readonly imagesBucket: s3.IBucket;
  readonly imagesCdnDomain: string;
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
  public readonly ideationProcessor: nodejs.NodejsFunction;
  public readonly generationQueue: sqs.Queue;
  public readonly actionQueue: sqs.Queue;
  public readonly ideationQueue: sqs.Queue;

  constructor(scope: Construct, id: string, props: ProcessingStackProps) {
    super(scope, id, props);

    const {
      imagesBucket,
      imagesCdnDomain,
      requestsTable,
      imagesTable,
      slackSecrets,
      providerSecrets,
    } = props;

    // Read image provider configuration from CDK context
    const imageProvider = this.node.tryGetContext("imageProvider") ?? "gemini";
    const bedrockModel = this.node.tryGetContext("bedrockModel") ?? "titan";
    const geminiModel =
      this.node.tryGetContext("geminiModel") ?? "gemini-3-pro";
    const useGeminiFlash = this.node.tryGetContext("useGeminiFlash") === "true";

    // Read ideation provider configuration from CDK context
    const ideationProvider =
      this.node.tryGetContext("ideationProvider") ?? "gemini";
    const geminiIdeationModel =
      this.node.tryGetContext("geminiIdeationModel") ?? "gemini-2.5-flash";
    const anthropicModel =
      this.node.tryGetContext("anthropicModel") ?? "claude-sonnet-4-5-20250929";

    // Dead Letter Queues
    const generationDlq = new sqs.Queue(this, "GenerationDLQ", {
      queueName: "t-shirt-generator-generation-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    const actionDlq = new sqs.Queue(this, "ActionDLQ", {
      queueName: "t-shirt-generator-action-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    const ideationDlq = new sqs.Queue(this, "IdeationDLQ", {
      queueName: "t-shirt-generator-ideation-dlq",
      retentionPeriod: cdk.Duration.days(14),
    });

    // Main Queues
    this.generationQueue = new sqs.Queue(this, "GenerationQueue", {
      queueName: "t-shirt-generator-generation-queue",
      visibilityTimeout: cdk.Duration.minutes(6), // 6x Lambda timeout
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: generationDlq,
        maxReceiveCount: 3,
      },
    });

    this.actionQueue = new sqs.Queue(this, "ActionQueue", {
      queueName: "t-shirt-generator-action-queue",
      visibilityTimeout: cdk.Duration.minutes(3), // 6x Lambda timeout
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: actionDlq,
        maxReceiveCount: 3,
      },
    });

    this.ideationQueue = new sqs.Queue(this, "IdeationQueue", {
      queueName: "t-shirt-generator-ideation-queue",
      visibilityTimeout: cdk.Duration.minutes(6), // 6x Lambda timeout (60s)
      retentionPeriod: cdk.Duration.days(4),
      deadLetterQueue: {
        queue: ideationDlq,
        maxReceiveCount: 3,
      },
    });

    // Common Lambda configuration
    const lambdaEnvironment = {
      IMAGES_BUCKET: imagesBucket.bucketName,
      IMAGES_CDN_DOMAIN: imagesCdnDomain,
      REQUESTS_TABLE: requestsTable.tableName,
      IMAGES_TABLE: imagesTable.tableName,
      GENERATION_QUEUE_URL: this.generationQueue.queueUrl,
      ACTION_QUEUE_URL: this.actionQueue.queueUrl,
      IDEATION_QUEUE_URL: this.ideationQueue.queueUrl,
      // Image provider configuration (configurable via CDK context)
      IMAGE_PROVIDER: imageProvider,
      BEDROCK_MODEL: bedrockModel,
      GEMINI_MODEL: geminiModel,
      USE_GEMINI_FLASH: useGeminiFlash ? "true" : "false",
      // Ideation provider configuration (configurable via CDK context)
      IDEATION_PROVIDER: ideationProvider,
      GEMINI_IDEATION_MODEL: geminiIdeationModel,
      ANTHROPIC_MODEL: anthropicModel,
      ALLOWED_CHANNEL_ID: "", // Must be set after deployment
      NODE_OPTIONS: "--enable-source-maps",
      POWERTOOLS_SERVICE_NAME: "t-shirt-generator",
      POWERTOOLS_LOG_LEVEL: "INFO",
    };

    const nodejsFunctionProps: Partial<nodejs.NodejsFunctionProps> = {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: {
        minify: true,
        sourceMap: true,
        target: "node22",
        format: nodejs.OutputFormat.CJS,
        mainFields: ["module", "main"],
        externalModules: ["@aws-sdk/*"],
      },
    };

    // Bundling config for Lambdas with native dependencies (e.g., sharp)
    // Uses Docker to compile for the correct Linux ARM64 platform
    const nativeDependenciesBundling: nodejs.BundlingOptions = {
      ...nodejsFunctionProps.bundling,
      minify: true,
      sourceMap: true,
      target: "node22",
      format: nodejs.OutputFormat.CJS,
      mainFields: ["module", "main"],
      externalModules: ["@aws-sdk/*"],
      // Force Docker bundling to ensure native modules are compiled for Linux ARM64
      forceDockerBundling: true,
      // Include sharp in the bundle with correct platform binaries
      nodeModules: ["sharp"],
    };

    // Webhook Handler Lambda
    this.webhookHandler = new nodejs.NodejsFunction(this, "WebhookHandler", {
      ...nodejsFunctionProps,
      functionName: "t-shirt-generator-webhook-handler",
      description: "Handles Slack slash command webhooks",
      entry: path.join(__dirname, "../../../src/handlers/webhook-handler.ts"),
      handler: "handler",
      timeout: cdk.Duration.seconds(90),
      memorySize: 256,
      environment: lambdaEnvironment,
    });

    // Interaction Handler Lambda
    this.interactionHandler = new nodejs.NodejsFunction(
      this,
      "InteractionHandler",
      {
        ...nodejsFunctionProps,
        functionName: "t-shirt-generator-interaction-handler",
        description: "Handles Slack interactive component events",
        entry: path.join(
          __dirname,
          "../../../src/handlers/interaction-handler.ts"
        ),
        handler: "handler",
        timeout: cdk.Duration.seconds(10),
        memorySize: 256,
        environment: lambdaEnvironment,
      }
    );

    // Image Generator Lambda
    // Uses Docker bundling for sharp native dependency (linux-arm64)
    this.imageGenerator = new nodejs.NodejsFunction(this, "ImageGenerator", {
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      bundling: nativeDependenciesBundling,
      functionName: "t-shirt-generator-image-generator",
      description: "Generates images using Amazon Bedrock",
      entry: path.join(__dirname, "../../../src/handlers/image-generator.ts"),
      handler: "handler",
      timeout: cdk.Duration.minutes(5),
      memorySize: 1024,
      environment: lambdaEnvironment,
      reservedConcurrentExecutions: 5, // Limit concurrent Bedrock calls
    });

    // Action Processor Lambda
    this.actionProcessor = new nodejs.NodejsFunction(this, "ActionProcessor", {
      ...nodejsFunctionProps,
      functionName: "t-shirt-generator-action-processor",
      description: "Processes user actions (keep, discard, regenerate)",
      entry: path.join(__dirname, "../../../src/handlers/action-processor.ts"),
      handler: "handler",
      timeout: cdk.Duration.minutes(2),
      memorySize: 512,
      environment: lambdaEnvironment,
    });

    // Ideation Processor Lambda
    // Increased timeout for web search capabilities
    this.ideationProcessor = new nodejs.NodejsFunction(
      this,
      "IdeationProcessor",
      {
        ...nodejsFunctionProps,
        functionName: "t-shirt-generator-ideation-processor",
        description: "Generates creative prompts using Claude AI with web search",
        entry: path.join(
          __dirname,
          "../../../src/handlers/ideation-processor.ts"
        ),
        handler: "handler",
        timeout: cdk.Duration.seconds(60),
        memorySize: 256,
        environment: lambdaEnvironment,
      }
    );

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

    this.webhookHandler.addEnvironment(
      "SLACK_SIGNING_SECRET_ARN",
      secretEnvVars.SLACK_SIGNING_SECRET_ARN
    );
    this.webhookHandler.addEnvironment(
      "SLACK_BOT_TOKEN_ARN",
      secretEnvVars.SLACK_BOT_TOKEN_ARN
    );
    this.interactionHandler.addEnvironment(
      "SLACK_SIGNING_SECRET_ARN",
      secretEnvVars.SLACK_SIGNING_SECRET_ARN
    );
    this.interactionHandler.addEnvironment(
      "SLACK_BOT_TOKEN_ARN",
      secretEnvVars.SLACK_BOT_TOKEN_ARN
    );
    this.imageGenerator.addEnvironment(
      "SLACK_BOT_TOKEN_ARN",
      secretEnvVars.SLACK_BOT_TOKEN_ARN
    );
    this.actionProcessor.addEnvironment(
      "SLACK_BOT_TOKEN_ARN",
      secretEnvVars.SLACK_BOT_TOKEN_ARN
    );

    // Grant Gemini API key access to image generator (for when using Gemini provider)
    providerSecrets.geminiApiKey.grantRead(this.imageGenerator);
    this.imageGenerator.addEnvironment(
      "GEMINI_API_KEY_ARN",
      providerSecrets.geminiApiKey.secretArn
    );

    // Grant API key access to ideation processor (supports both Anthropic and Gemini)
    providerSecrets.anthropicApiKey.grantRead(this.ideationProcessor);
    providerSecrets.geminiApiKey.grantRead(this.ideationProcessor);
    this.ideationProcessor.addEnvironment(
      "ANTHROPIC_API_KEY_ARN",
      providerSecrets.anthropicApiKey.secretArn
    );
    this.ideationProcessor.addEnvironment(
      "GEMINI_API_KEY_ARN",
      providerSecrets.geminiApiKey.secretArn
    );

    // Grant SQS permissions
    this.generationQueue.grantSendMessages(this.webhookHandler);
    this.generationQueue.grantSendMessages(this.actionProcessor); // For regenerate
    this.actionQueue.grantSendMessages(this.interactionHandler);
    this.ideationQueue.grantSendMessages(this.webhookHandler); // For /ideate command

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

    this.ideationProcessor.addEventSource(
      new lambdaEventSources.SqsEventSource(this.ideationQueue, {
        batchSize: 1,
        maxConcurrency: 5,
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
      actions: ["bedrock:InvokeModel"],
      resources: [
        `arn:aws:bedrock:${this.region}::foundation-model/amazon.titan-image-generator-v2:0`,
        `arn:aws:bedrock:${this.region}::foundation-model/stability.stable-diffusion-xl-v1`,
      ],
    });

    this.imageGenerator.addToRolePolicy(bedrockPolicy);

    // Outputs
    new cdk.CfnOutput(this, "GenerationQueueUrl", {
      value: this.generationQueue.queueUrl,
      description: "URL of the image generation SQS queue",
    });

    new cdk.CfnOutput(this, "ActionQueueUrl", {
      value: this.actionQueue.queueUrl,
      description: "URL of the action processing SQS queue",
    });

    new cdk.CfnOutput(this, "IdeationQueueUrl", {
      value: this.ideationQueue.queueUrl,
      description: "URL of the ideation processing SQS queue",
    });

    new cdk.CfnOutput(this, "WebhookHandlerArn", {
      value: this.webhookHandler.functionArn,
      description: "ARN of the webhook handler Lambda",
    });

    new cdk.CfnOutput(this, "InteractionHandlerArn", {
      value: this.interactionHandler.functionArn,
      description: "ARN of the interaction handler Lambda",
    });
  }
}

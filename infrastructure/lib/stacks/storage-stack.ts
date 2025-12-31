import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface SlackSecrets {
  readonly signingSecret: secretsmanager.ISecret;
  readonly botToken: secretsmanager.ISecret;
}

export class StorageStack extends cdk.Stack {
  public readonly imagesBucket: s3.Bucket;
  public readonly requestsTable: dynamodb.Table;
  public readonly imagesTable: dynamodb.Table;
  public readonly slackSecrets: SlackSecrets;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 Bucket for storing generated images
    this.imagesBucket = new s3.Bucket(this, 'ImagesBucket', {
      bucketName: `t-shirt-generator-images-${this.account}`,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: false,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      lifecycleRules: [
        {
          id: 'DeleteTempImages',
          prefix: 'temp/',
          expiration: cdk.Duration.days(7),
        },
        {
          id: 'DeleteThumbnails',
          prefix: 'thumbnails/',
          expiration: cdk.Duration.days(7),
        },
      ],
      cors: [
        {
          allowedMethods: [s3.HttpMethods.GET],
          allowedOrigins: ['*'],
          allowedHeaders: ['*'],
          maxAge: 3000,
        },
      ],
    });

    // DynamoDB Table for Generation Requests
    this.requestsTable = new dynamodb.Table(this, 'RequestsTable', {
      tableName: 't-shirt-generator-requests',
      partitionKey: {
        name: 'requestId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
      },
    });

    // GSI for querying by userId
    this.requestsTable.addGlobalSecondaryIndex({
      indexName: 'userId-createdAt-index',
      partitionKey: {
        name: 'userId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'createdAt',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // DynamoDB Table for Generated Images
    this.imagesTable = new dynamodb.Table(this, 'ImagesTable', {
      tableName: 't-shirt-generator-images',
      partitionKey: {
        name: 'imageId',
        type: dynamodb.AttributeType.STRING,
      },
      sortKey: {
        name: 'requestId',
        type: dynamodb.AttributeType.STRING,
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.RETAIN,
    });

    // GSI for querying images by requestId
    this.imagesTable.addGlobalSecondaryIndex({
      indexName: 'requestId-index',
      partitionKey: {
        name: 'requestId',
        type: dynamodb.AttributeType.STRING,
      },
      projectionType: dynamodb.ProjectionType.ALL,
    });

    // Secrets Manager for Slack credentials
    // These are placeholder secrets - actual values must be set manually after deployment
    const signingSecret = new secretsmanager.Secret(this, 'SlackSigningSecret', {
      secretName: 't-shirt-generator/slack-signing-secret',
      description: 'Slack app signing secret for request verification',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ placeholder: true }),
        generateStringKey: 'value',
      },
    });

    const botToken = new secretsmanager.Secret(this, 'SlackBotToken', {
      secretName: 't-shirt-generator/slack-bot-token',
      description: 'Slack bot OAuth token for API calls',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ placeholder: true }),
        generateStringKey: 'value',
      },
    });

    this.slackSecrets = {
      signingSecret,
      botToken,
    };

    // Outputs
    new cdk.CfnOutput(this, 'ImagesBucketName', {
      value: this.imagesBucket.bucketName,
      description: 'S3 bucket for storing generated images',
      exportName: 'TShirtGeneratorImagesBucket',
    });

    new cdk.CfnOutput(this, 'RequestsTableName', {
      value: this.requestsTable.tableName,
      description: 'DynamoDB table for generation requests',
      exportName: 'TShirtGeneratorRequestsTable',
    });

    new cdk.CfnOutput(this, 'ImagesTableName', {
      value: this.imagesTable.tableName,
      description: 'DynamoDB table for generated images',
      exportName: 'TShirtGeneratorImagesTable',
    });

    new cdk.CfnOutput(this, 'SlackSigningSecretArn', {
      value: signingSecret.secretArn,
      description: 'ARN of the Slack signing secret (update value after deployment)',
      exportName: 'TShirtGeneratorSlackSigningSecretArn',
    });

    new cdk.CfnOutput(this, 'SlackBotTokenArn', {
      value: botToken.secretArn,
      description: 'ARN of the Slack bot token (update value after deployment)',
      exportName: 'TShirtGeneratorSlackBotTokenArn',
    });
  }
}

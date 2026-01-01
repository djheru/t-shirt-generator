#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { StorageStack } from '../lib/stacks/storage-stack';
import { ProcessingStack } from '../lib/stacks/processing-stack';
import { ApiStack } from '../lib/stacks/api-stack';

const app = new cdk.App();

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

const storageStack = new StorageStack(app, 'TShirtGeneratorStorage', {
  env,
  description: 'T-Shirt Generator - Storage resources (S3, DynamoDB, Secrets)',
});

const processingStack = new ProcessingStack(app, 'TShirtGeneratorProcessing', {
  env,
  description: 'T-Shirt Generator - Processing resources (SQS, Lambda)',
  imagesBucket: storageStack.imagesBucket,
  requestsTable: storageStack.requestsTable,
  imagesTable: storageStack.imagesTable,
  slackSecrets: storageStack.slackSecrets,
  providerSecrets: storageStack.providerSecrets,
});

new ApiStack(app, 'TShirtGeneratorApi', {
  env,
  description: 'T-Shirt Generator - API resources (API Gateway)',
  webhookHandler: processingStack.webhookHandler,
  interactionHandler: processingStack.interactionHandler,
});

app.synth();

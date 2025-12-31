import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';

export interface ApiStackProps extends cdk.StackProps {
  readonly webhookHandler: lambda.IFunction;
  readonly interactionHandler: lambda.IFunction;
}

export class ApiStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly webhookEndpoint: string;
  public readonly interactionEndpoint: string;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);

    const { webhookHandler, interactionHandler } = props;

    // Create REST API
    this.api = new apigateway.RestApi(this, 'SlackApi', {
      restApiName: 't-shirt-generator-api',
      description: 'API for T-Shirt Generator Slack integration',
      deployOptions: {
        stageName: 'prod',
        throttlingBurstLimit: 100,
        throttlingRateLimit: 50,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: false,
        metricsEnabled: true,
        accessLogDestination: new apigateway.LogGroupLogDestination(
          new logs.LogGroup(this, 'ApiAccessLogs', {
            logGroupName: '/aws/apigateway/t-shirt-generator',
            retention: logs.RetentionDays.ONE_MONTH,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
          })
        ),
        accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields({
          caller: true,
          httpMethod: true,
          ip: true,
          protocol: true,
          requestTime: true,
          resourcePath: true,
          responseLength: true,
          status: true,
          user: true,
        }),
      },
      endpointTypes: [apigateway.EndpointType.REGIONAL],
    });

    // Create /slack resource
    const slackResource = this.api.root.addResource('slack');

    // POST /slack/events - Slash command webhook
    const eventsResource = slackResource.addResource('events');
    eventsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(webhookHandler, {
        proxy: true,
        allowTestInvoke: false,
      }),
      {
        methodResponses: [
          {
            statusCode: '200',
            responseModels: {
              'application/json': apigateway.Model.EMPTY_MODEL,
            },
          },
          {
            statusCode: '400',
            responseModels: {
              'application/json': apigateway.Model.ERROR_MODEL,
            },
          },
          {
            statusCode: '401',
            responseModels: {
              'application/json': apigateway.Model.ERROR_MODEL,
            },
          },
        ],
      }
    );

    // POST /slack/interactions - Interactive components
    const interactionsResource = slackResource.addResource('interactions');
    interactionsResource.addMethod(
      'POST',
      new apigateway.LambdaIntegration(interactionHandler, {
        proxy: true,
        allowTestInvoke: false,
      }),
      {
        methodResponses: [
          {
            statusCode: '200',
            responseModels: {
              'application/json': apigateway.Model.EMPTY_MODEL,
            },
          },
          {
            statusCode: '400',
            responseModels: {
              'application/json': apigateway.Model.ERROR_MODEL,
            },
          },
          {
            statusCode: '401',
            responseModels: {
              'application/json': apigateway.Model.ERROR_MODEL,
            },
          },
        ],
      }
    );

    // Store endpoint URLs
    this.webhookEndpoint = `${this.api.url}slack/events`;
    this.interactionEndpoint = `${this.api.url}slack/interactions`;

    // Outputs
    new cdk.CfnOutput(this, 'ApiUrl', {
      value: this.api.url,
      description: 'Base URL of the API Gateway',
      exportName: 'TShirtGeneratorApiUrl',
    });

    new cdk.CfnOutput(this, 'WebhookEndpoint', {
      value: this.webhookEndpoint,
      description: 'Webhook endpoint URL for Slack slash commands',
      exportName: 'TShirtGeneratorWebhookEndpoint',
    });

    new cdk.CfnOutput(this, 'InteractionEndpoint', {
      value: this.interactionEndpoint,
      description: 'Interaction endpoint URL for Slack interactive components',
      exportName: 'TShirtGeneratorInteractionEndpoint',
    });
  }
}

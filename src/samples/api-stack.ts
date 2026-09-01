import * as cdk from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import { Construct } from 'constructs';

/**
 * CDK source is imported read-only: the diagram is derived from the construct
 * calls below, but edits are not written back into TypeScript.
 */
export class ApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const assets = new s3.Bucket(this, 'Assets', {
      versioned: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
    });

    const table = new dynamodb.Table(this, 'ItemsTable', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const queue = new sqs.Queue(this, 'WorkQueue', {
      visibilityTimeout: cdk.Duration.seconds(60),
    });

    const events = new sns.Topic(this, 'EventsTopic', {
      displayName: 'item-events',
    });

    const api = new lambda.Function(this, 'ApiFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      memorySize: 512,
      timeout: cdk.Duration.seconds(15),
      code: lambda.Code.fromAsset('dist/api'),
      environment: {
        TABLE_NAME: table.tableName,
        QUEUE_URL: queue.queueUrl,
        BUCKET_NAME: assets.bucketName,
      },
    });

    const worker = new lambda.Function(this, 'WorkerFunction', {
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'worker.handler',
      memorySize: 256,
      code: lambda.Code.fromAsset('dist/worker'),
      environment: {
        TOPIC_ARN: events.topicArn,
      },
    });

    table.grantReadWriteData(api);
    assets.grantRead(api);
    queue.grantSendMessages(api);
    queue.grantConsumeMessages(worker);
    events.grantPublish(worker);
  }
}

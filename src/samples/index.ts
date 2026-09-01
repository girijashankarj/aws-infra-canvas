/** Bundled example templates, loaded from the "Samples" menu. */

import serverlessApi from './serverless-api.yaml?raw';
import vpcWebTier from './vpc-web-tier.yaml?raw';
import staticSite from './static-site.json?raw';
import lambdaApiTf from './lambda-api.tf?raw';
import apiStackCdk from './api-stack.ts?raw';

export interface Sample {
  name: string;
  filename: string;
  description: string;
  text: string;
}

export const SAMPLES: Sample[] = [
  {
    name: 'Serverless API',
    filename: 'serverless-api.yaml',
    description: 'Lambda, DynamoDB, SQS and an HTTP API.',
    text: serverlessApi,
  },
  {
    name: 'VPC web tier',
    filename: 'vpc-web-tier.yaml',
    description: 'Nested subnets, a load balancer and a private database.',
    text: vpcWebTier,
  },
  {
    name: 'Static site (JSON)',
    filename: 'static-site.json',
    description: 'CloudFront over S3, written as a JSON template.',
    text: staticSite,
  },
  {
    name: 'Terraform VPC + Lambda',
    filename: 'lambda-api.tf',
    description: 'The same shape written in HCL, also fully round-trippable.',
    text: lambdaApiTf,
  },
  {
    name: 'CDK stack (read-only)',
    filename: 'api-stack.ts',
    description: 'TypeScript constructs, imported for viewing only.',
    text: apiStackCdk,
  },
];

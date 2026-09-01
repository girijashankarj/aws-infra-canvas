/**
 * The service catalog. One entry per supported AWS resource, carrying its
 * identity in every dialect plus everything the UI needs to draw it.
 *
 * Adding support for a new service should be a one-entry change here.
 */

import type { CanonicalType, PropPath } from './types';

export type Category =
  | 'compute'
  | 'containers'
  | 'storage'
  | 'database'
  | 'network'
  | 'integration'
  | 'security'
  | 'management'
  | 'analytics'
  | 'edge';

/** Glyph key resolved by `src/icons`. */
export type IconKey =
  | 'lambda'
  | 'server'
  | 'container'
  | 'bucket'
  | 'database'
  | 'table'
  | 'cloud'
  | 'subnet'
  | 'gateway'
  | 'router'
  | 'loadbalancer'
  | 'cdn'
  | 'queue'
  | 'topic'
  | 'statemachine'
  | 'key'
  | 'shield'
  | 'user'
  | 'clock'
  | 'log'
  | 'stream'
  | 'generic';

export interface ServiceDef {
  canonical: CanonicalType;
  /** Full display name, e.g. "Lambda Function". */
  name: string;
  /** Compact badge text shown under the glyph. */
  short: string;
  category: Category;
  icon: IconKey;
  cfn?: string;
  tf?: string;
  /** CDK construct paths, e.g. "lambda.Function". */
  cdk?: string[];
  /** Renders as a container that other nodes nest inside. */
  container?: boolean;
  /** Property paths whose reference target becomes this node's parent. */
  parentProps?: PropPath[];
  /** Same, for Terraform attribute names. */
  tfParentProps?: PropPath[];
  /** Skeleton properties used when adding this resource from the palette. */
  defaults?: Record<string, unknown>;
  /** Whether the palette offers this service. */
  palette?: boolean;
}

export const SERVICES: ServiceDef[] = [
  // ── Network (containers first: order matters for nothing, but reads better) ──
  {
    canonical: 'ec2.vpc',
    name: 'VPC',
    short: 'VPC',
    category: 'network',
    icon: 'cloud',
    cfn: 'AWS::EC2::VPC',
    tf: 'aws_vpc',
    cdk: ['ec2.Vpc', 'ec2.CfnVPC'],
    container: true,
    palette: true,
    defaults: { CidrBlock: '10.0.0.0/16', EnableDnsHostnames: true, EnableDnsSupport: true },
  },
  {
    canonical: 'ec2.subnet',
    name: 'Subnet',
    short: 'Subnet',
    category: 'network',
    icon: 'subnet',
    cfn: 'AWS::EC2::Subnet',
    tf: 'aws_subnet',
    cdk: ['ec2.Subnet', 'ec2.CfnSubnet'],
    container: true,
    parentProps: [['VpcId']],
    tfParentProps: [['vpc_id']],
    palette: true,
    defaults: { CidrBlock: '10.0.1.0/24' },
  },
  {
    canonical: 'ec2.securitygroup',
    name: 'Security Group',
    short: 'SG',
    category: 'security',
    icon: 'shield',
    cfn: 'AWS::EC2::SecurityGroup',
    tf: 'aws_security_group',
    cdk: ['ec2.SecurityGroup', 'ec2.CfnSecurityGroup'],
    parentProps: [['VpcId']],
    tfParentProps: [['vpc_id']],
    palette: true,
    defaults: { GroupDescription: 'Managed by diagram editor' },
  },
  {
    canonical: 'ec2.internetgateway',
    name: 'Internet Gateway',
    short: 'IGW',
    category: 'network',
    icon: 'gateway',
    cfn: 'AWS::EC2::InternetGateway',
    tf: 'aws_internet_gateway',
    cdk: ['ec2.CfnInternetGateway'],
    palette: true,
  },
  {
    canonical: 'ec2.natgateway',
    name: 'NAT Gateway',
    short: 'NAT',
    category: 'network',
    icon: 'gateway',
    cfn: 'AWS::EC2::NatGateway',
    tf: 'aws_nat_gateway',
    cdk: ['ec2.CfnNatGateway'],
    parentProps: [['SubnetId']],
    tfParentProps: [['subnet_id']],
    palette: true,
  },
  {
    canonical: 'ec2.routetable',
    name: 'Route Table',
    short: 'RTB',
    category: 'network',
    icon: 'router',
    cfn: 'AWS::EC2::RouteTable',
    tf: 'aws_route_table',
    cdk: ['ec2.CfnRouteTable'],
    parentProps: [['VpcId']],
    tfParentProps: [['vpc_id']],
  },
  {
    canonical: 'ec2.route',
    name: 'Route',
    short: 'Route',
    category: 'network',
    icon: 'router',
    cfn: 'AWS::EC2::Route',
    tf: 'aws_route',
  },
  {
    canonical: 'ec2.subnetrouteassoc',
    name: 'Route Table Association',
    short: 'Assoc',
    category: 'network',
    icon: 'router',
    cfn: 'AWS::EC2::SubnetRouteTableAssociation',
    tf: 'aws_route_table_association',
  },
  {
    canonical: 'ec2.eip',
    name: 'Elastic IP',
    short: 'EIP',
    category: 'network',
    icon: 'router',
    cfn: 'AWS::EC2::EIP',
    tf: 'aws_eip',
  },
  {
    canonical: 'ec2.vpcendpoint',
    name: 'VPC Endpoint',
    short: 'Endpoint',
    category: 'network',
    icon: 'gateway',
    cfn: 'AWS::EC2::VPCEndpoint',
    tf: 'aws_vpc_endpoint',
    parentProps: [['VpcId']],
    tfParentProps: [['vpc_id']],
  },

  // ── Compute ──
  {
    canonical: 'lambda.function',
    name: 'Lambda Function',
    short: 'Lambda',
    category: 'compute',
    icon: 'lambda',
    cfn: 'AWS::Lambda::Function',
    tf: 'aws_lambda_function',
    cdk: ['lambda.Function', 'lambda.DockerImageFunction', 'lambdaNodejs.NodejsFunction', 'nodejs.NodejsFunction'],
    parentProps: [['VpcConfig', 'SubnetIds', 0]],
    tfParentProps: [['vpc_config', 'subnet_ids', 0]],
    palette: true,
    defaults: {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler',
      Code: { ZipFile: 'exports.handler = async () => ({ statusCode: 200 });' },
      Role: '',
    },
  },
  {
    canonical: 'lambda.permission',
    name: 'Lambda Permission',
    short: 'Perm',
    category: 'security',
    icon: 'key',
    cfn: 'AWS::Lambda::Permission',
    tf: 'aws_lambda_permission',
  },
  {
    canonical: 'lambda.eventsourcemapping',
    name: 'Event Source Mapping',
    short: 'ESM',
    category: 'integration',
    icon: 'stream',
    cfn: 'AWS::Lambda::EventSourceMapping',
    tf: 'aws_lambda_event_source_mapping',
  },
  {
    canonical: 'ec2.instance',
    name: 'EC2 Instance',
    short: 'EC2',
    category: 'compute',
    icon: 'server',
    cfn: 'AWS::EC2::Instance',
    tf: 'aws_instance',
    cdk: ['ec2.Instance', 'ec2.CfnInstance'],
    parentProps: [['SubnetId'], ['NetworkInterfaces', 0, 'SubnetId']],
    tfParentProps: [['subnet_id']],
    palette: true,
    defaults: { InstanceType: 't3.micro', ImageId: '' },
  },
  {
    canonical: 'autoscaling.group',
    name: 'Auto Scaling Group',
    short: 'ASG',
    category: 'compute',
    icon: 'server',
    cfn: 'AWS::AutoScaling::AutoScalingGroup',
    tf: 'aws_autoscaling_group',
    parentProps: [['VPCZoneIdentifier', 0]],
    tfParentProps: [['vpc_zone_identifier', 0]],
  },
  {
    canonical: 'ec2.launchtemplate',
    name: 'Launch Template',
    short: 'LT',
    category: 'compute',
    icon: 'server',
    cfn: 'AWS::EC2::LaunchTemplate',
    tf: 'aws_launch_template',
  },

  // ── Containers ──
  {
    canonical: 'ecs.cluster',
    name: 'ECS Cluster',
    short: 'ECS',
    category: 'containers',
    icon: 'container',
    cfn: 'AWS::ECS::Cluster',
    tf: 'aws_ecs_cluster',
    cdk: ['ecs.Cluster'],
    palette: true,
  },
  {
    canonical: 'ecs.service',
    name: 'ECS Service',
    short: 'Service',
    category: 'containers',
    icon: 'container',
    cfn: 'AWS::ECS::Service',
    tf: 'aws_ecs_service',
    cdk: ['ecs.FargateService', 'ecs.Ec2Service'],
    parentProps: [['NetworkConfiguration', 'AwsvpcConfiguration', 'Subnets', 0]],
    tfParentProps: [['network_configuration', 'subnets', 0]],
  },
  {
    canonical: 'ecs.taskdefinition',
    name: 'ECS Task Definition',
    short: 'Task',
    category: 'containers',
    icon: 'container',
    cfn: 'AWS::ECS::TaskDefinition',
    tf: 'aws_ecs_task_definition',
    cdk: ['ecs.FargateTaskDefinition', 'ecs.TaskDefinition'],
  },
  {
    canonical: 'eks.cluster',
    name: 'EKS Cluster',
    short: 'EKS',
    category: 'containers',
    icon: 'container',
    cfn: 'AWS::EKS::Cluster',
    tf: 'aws_eks_cluster',
    cdk: ['eks.Cluster'],
  },
  {
    canonical: 'ecr.repository',
    name: 'ECR Repository',
    short: 'ECR',
    category: 'containers',
    icon: 'container',
    cfn: 'AWS::ECR::Repository',
    tf: 'aws_ecr_repository',
    cdk: ['ecr.Repository'],
  },

  // ── Storage ──
  {
    canonical: 's3.bucket',
    name: 'S3 Bucket',
    short: 'S3',
    category: 'storage',
    icon: 'bucket',
    cfn: 'AWS::S3::Bucket',
    tf: 'aws_s3_bucket',
    cdk: ['s3.Bucket'],
    palette: true,
    defaults: { BucketEncryption: { ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }] } },
  },
  {
    canonical: 's3.bucketpolicy',
    name: 'S3 Bucket Policy',
    short: 'Policy',
    category: 'security',
    icon: 'key',
    cfn: 'AWS::S3::BucketPolicy',
    tf: 'aws_s3_bucket_policy',
  },
  {
    canonical: 'efs.filesystem',
    name: 'EFS File System',
    short: 'EFS',
    category: 'storage',
    icon: 'bucket',
    cfn: 'AWS::EFS::FileSystem',
    tf: 'aws_efs_file_system',
  },

  // ── Database ──
  {
    canonical: 'dynamodb.table',
    name: 'DynamoDB Table',
    short: 'DynamoDB',
    category: 'database',
    icon: 'table',
    cfn: 'AWS::DynamoDB::Table',
    tf: 'aws_dynamodb_table',
    cdk: ['dynamodb.Table', 'dynamodb.TableV2'],
    palette: true,
    defaults: {
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: [{ AttributeName: 'pk', AttributeType: 'S' }],
      KeySchema: [{ AttributeName: 'pk', KeyType: 'HASH' }],
    },
  },
  {
    canonical: 'rds.instance',
    name: 'RDS Instance',
    short: 'RDS',
    category: 'database',
    icon: 'database',
    cfn: 'AWS::RDS::DBInstance',
    tf: 'aws_db_instance',
    cdk: ['rds.DatabaseInstance'],
    palette: true,
    defaults: { Engine: 'postgres', DBInstanceClass: 'db.t3.micro', AllocatedStorage: '20' },
  },
  {
    canonical: 'rds.cluster',
    name: 'Aurora Cluster',
    short: 'Aurora',
    category: 'database',
    icon: 'database',
    cfn: 'AWS::RDS::DBCluster',
    tf: 'aws_rds_cluster',
    cdk: ['rds.DatabaseCluster'],
  },
  {
    canonical: 'rds.subnetgroup',
    name: 'DB Subnet Group',
    short: 'SubnetGrp',
    category: 'database',
    icon: 'subnet',
    cfn: 'AWS::RDS::DBSubnetGroup',
    tf: 'aws_db_subnet_group',
  },
  {
    canonical: 'elasticache.cluster',
    name: 'ElastiCache Cluster',
    short: 'Cache',
    category: 'database',
    icon: 'database',
    cfn: 'AWS::ElastiCache::CacheCluster',
    tf: 'aws_elasticache_cluster',
  },

  // ── Integration ──
  {
    canonical: 'sqs.queue',
    name: 'SQS Queue',
    short: 'SQS',
    category: 'integration',
    icon: 'queue',
    cfn: 'AWS::SQS::Queue',
    tf: 'aws_sqs_queue',
    cdk: ['sqs.Queue'],
    palette: true,
    defaults: { VisibilityTimeout: 30 },
  },
  {
    canonical: 'sns.topic',
    name: 'SNS Topic',
    short: 'SNS',
    category: 'integration',
    icon: 'topic',
    cfn: 'AWS::SNS::Topic',
    tf: 'aws_sns_topic',
    cdk: ['sns.Topic'],
    palette: true,
  },
  {
    canonical: 'sns.subscription',
    name: 'SNS Subscription',
    short: 'Sub',
    category: 'integration',
    icon: 'topic',
    cfn: 'AWS::SNS::Subscription',
    tf: 'aws_sns_topic_subscription',
  },
  {
    canonical: 'events.rule',
    name: 'EventBridge Rule',
    short: 'Rule',
    category: 'integration',
    icon: 'clock',
    cfn: 'AWS::Events::Rule',
    tf: 'aws_cloudwatch_event_rule',
    cdk: ['events.Rule'],
    palette: true,
  },
  {
    canonical: 'stepfunctions.statemachine',
    name: 'Step Functions',
    short: 'States',
    category: 'integration',
    icon: 'statemachine',
    cfn: 'AWS::StepFunctions::StateMachine',
    tf: 'aws_sfn_state_machine',
    cdk: ['stepfunctions.StateMachine', 'sfn.StateMachine'],
  },
  {
    canonical: 'kinesis.stream',
    name: 'Kinesis Stream',
    short: 'Kinesis',
    category: 'analytics',
    icon: 'stream',
    cfn: 'AWS::Kinesis::Stream',
    tf: 'aws_kinesis_stream',
    cdk: ['kinesis.Stream'],
  },

  // ── Edge / API ──
  {
    canonical: 'apigateway.restapi',
    name: 'API Gateway (REST)',
    short: 'API',
    category: 'edge',
    icon: 'gateway',
    cfn: 'AWS::ApiGateway::RestApi',
    tf: 'aws_api_gateway_rest_api',
    cdk: ['apigateway.RestApi', 'apigateway.LambdaRestApi'],
    palette: true,
  },
  {
    canonical: 'apigateway.method',
    name: 'API Method',
    short: 'Method',
    category: 'edge',
    icon: 'gateway',
    cfn: 'AWS::ApiGateway::Method',
    tf: 'aws_api_gateway_method',
  },
  {
    canonical: 'apigateway.resource',
    name: 'API Resource',
    short: 'Resource',
    category: 'edge',
    icon: 'gateway',
    cfn: 'AWS::ApiGateway::Resource',
    tf: 'aws_api_gateway_resource',
  },
  {
    canonical: 'apigatewayv2.api',
    name: 'API Gateway (HTTP)',
    short: 'HTTP API',
    category: 'edge',
    icon: 'gateway',
    cfn: 'AWS::ApiGatewayV2::Api',
    tf: 'aws_apigatewayv2_api',
    cdk: ['apigatewayv2.HttpApi'],
    palette: true,
  },
  {
    canonical: 'cloudfront.distribution',
    name: 'CloudFront',
    short: 'CDN',
    category: 'edge',
    icon: 'cdn',
    cfn: 'AWS::CloudFront::Distribution',
    tf: 'aws_cloudfront_distribution',
    cdk: ['cloudfront.Distribution', 'cloudfront.CloudFrontWebDistribution'],
    palette: true,
  },
  {
    canonical: 'elbv2.loadbalancer',
    name: 'Load Balancer',
    short: 'ALB',
    category: 'network',
    icon: 'loadbalancer',
    cfn: 'AWS::ElasticLoadBalancingV2::LoadBalancer',
    tf: 'aws_lb',
    cdk: ['elbv2.ApplicationLoadBalancer', 'elbv2.NetworkLoadBalancer'],
    parentProps: [['Subnets', 0]],
    tfParentProps: [['subnets', 0]],
    palette: true,
  },
  {
    canonical: 'elbv2.targetgroup',
    name: 'Target Group',
    short: 'TG',
    category: 'network',
    icon: 'loadbalancer',
    cfn: 'AWS::ElasticLoadBalancingV2::TargetGroup',
    tf: 'aws_lb_target_group',
    parentProps: [['VpcId']],
    tfParentProps: [['vpc_id']],
  },
  {
    canonical: 'elbv2.listener',
    name: 'Listener',
    short: 'Listener',
    category: 'network',
    icon: 'loadbalancer',
    cfn: 'AWS::ElasticLoadBalancingV2::Listener',
    tf: 'aws_lb_listener',
  },
  {
    canonical: 'route53.recordset',
    name: 'Route 53 Record',
    short: 'DNS',
    category: 'edge',
    icon: 'router',
    cfn: 'AWS::Route53::RecordSet',
    tf: 'aws_route53_record',
  },

  // ── Security ──
  {
    canonical: 'iam.role',
    name: 'IAM Role',
    short: 'Role',
    category: 'security',
    icon: 'user',
    cfn: 'AWS::IAM::Role',
    tf: 'aws_iam_role',
    cdk: ['iam.Role'],
    palette: true,
    defaults: {
      AssumeRolePolicyDocument: {
        Version: '2012-10-17',
        Statement: [
          { Effect: 'Allow', Principal: { Service: 'lambda.amazonaws.com' }, Action: 'sts:AssumeRole' },
        ],
      },
    },
  },
  {
    canonical: 'iam.policy',
    name: 'IAM Policy',
    short: 'Policy',
    category: 'security',
    icon: 'key',
    cfn: 'AWS::IAM::Policy',
    tf: 'aws_iam_policy',
    cdk: ['iam.Policy', 'iam.ManagedPolicy'],
  },
  {
    canonical: 'iam.managedpolicy',
    name: 'Managed Policy',
    short: 'Policy',
    category: 'security',
    icon: 'key',
    cfn: 'AWS::IAM::ManagedPolicy',
  },
  {
    canonical: 'iam.instanceprofile',
    name: 'Instance Profile',
    short: 'Profile',
    category: 'security',
    icon: 'user',
    cfn: 'AWS::IAM::InstanceProfile',
    tf: 'aws_iam_instance_profile',
  },
  {
    canonical: 'kms.key',
    name: 'KMS Key',
    short: 'KMS',
    category: 'security',
    icon: 'key',
    cfn: 'AWS::KMS::Key',
    tf: 'aws_kms_key',
    cdk: ['kms.Key'],
  },
  {
    canonical: 'secretsmanager.secret',
    name: 'Secret',
    short: 'Secret',
    category: 'security',
    icon: 'key',
    cfn: 'AWS::SecretsManager::Secret',
    tf: 'aws_secretsmanager_secret',
    cdk: ['secretsmanager.Secret'],
  },
  {
    canonical: 'cognito.userpool',
    name: 'Cognito User Pool',
    short: 'Cognito',
    category: 'security',
    icon: 'user',
    cfn: 'AWS::Cognito::UserPool',
    tf: 'aws_cognito_user_pool',
    cdk: ['cognito.UserPool'],
  },

  // ── Management ──
  {
    canonical: 'logs.loggroup',
    name: 'Log Group',
    short: 'Logs',
    category: 'management',
    icon: 'log',
    cfn: 'AWS::Logs::LogGroup',
    tf: 'aws_cloudwatch_log_group',
    cdk: ['logs.LogGroup'],
    palette: true,
    defaults: { RetentionInDays: 14 },
  },
  {
    canonical: 'cloudwatch.alarm',
    name: 'CloudWatch Alarm',
    short: 'Alarm',
    category: 'management',
    icon: 'log',
    cfn: 'AWS::CloudWatch::Alarm',
    tf: 'aws_cloudwatch_metric_alarm',
    cdk: ['cloudwatch.Alarm'],
  },
  {
    canonical: 'ssm.parameter',
    name: 'SSM Parameter',
    short: 'Param',
    category: 'management',
    icon: 'log',
    cfn: 'AWS::SSM::Parameter',
    tf: 'aws_ssm_parameter',
  },
];

export const CATEGORY_COLORS: Record<Category, string> = {
  compute: '#ed7100',
  containers: '#ed7100',
  storage: '#7aa116',
  database: '#2e73b8',
  network: '#8c4fff',
  integration: '#e7157b',
  security: '#dd344c',
  management: '#e7157b',
  analytics: '#8c4fff',
  edge: '#8c4fff',
};

const byCfn = new Map<string, ServiceDef>();
const byTf = new Map<string, ServiceDef>();
const byCdk = new Map<string, ServiceDef>();
const byCanonical = new Map<string, ServiceDef>();

for (const s of SERVICES) {
  byCanonical.set(s.canonical, s);
  if (s.cfn) byCfn.set(s.cfn.toLowerCase(), s);
  if (s.tf) byTf.set(s.tf, s);
  for (const c of s.cdk ?? []) byCdk.set(c, s);
}

export const lookupCfn = (type: string): ServiceDef | undefined => byCfn.get(type.toLowerCase());
export const lookupTf = (type: string): ServiceDef | undefined => byTf.get(type);
export const lookupCanonical = (t: CanonicalType): ServiceDef | undefined => byCanonical.get(t);

/** Matches a CDK construct by full path ("lambda.Function") or class name ("Function"). */
export function lookupCdk(ns: string | undefined, cls: string): ServiceDef | undefined {
  if (ns) {
    const hit = byCdk.get(`${ns}.${cls}`);
    if (hit) return hit;
  }
  for (const [key, def] of byCdk) {
    if (key.endsWith(`.${cls}`)) return def;
  }
  return undefined;
}

export const paletteServices = (): ServiceDef[] => SERVICES.filter((s) => s.palette);

/**
 * Derives a canonical type for a resource we have no entry for, so unknown
 * services still render with a sensible label instead of vanishing.
 * "AWS::Foo::BarBaz" → "foo.barbaz"
 */
export function canonicalFromCfn(type: string): CanonicalType {
  const parts = type.split('::');
  if (parts.length === 3) return `${parts[1].toLowerCase()}.${parts[2].toLowerCase()}`;
  return type.toLowerCase();
}

/** "aws_lambda_function" → "lambda.function" */
export function canonicalFromTf(type: string): CanonicalType {
  const bare = type.startsWith('aws_') ? type.slice(4) : type;
  const idx = bare.indexOf('_');
  return idx === -1 ? bare : `${bare.slice(0, idx)}.${bare.slice(idx + 1).replace(/_/g, '')}`;
}

/** Human label for a service we do not have an entry for. */
export function fallbackName(rawType: string): string {
  const parts = rawType.split('::');
  if (parts.length === 3) return parts[2].replace(/([a-z])([A-Z])/g, '$1 $2');
  return rawType.replace(/^aws_/, '').replace(/_/g, ' ');
}

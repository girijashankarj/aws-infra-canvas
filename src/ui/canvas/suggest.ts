/**
 * Suggests where a new reference should live when the user draws an edge.
 *
 * Drawing A → B has to become a concrete property on A, and the natural
 * property depends on what B is: a subnet lands in `SubnetId`, a table usually
 * ends up in the function's environment. These are starting points the user can
 * edit, not rules.
 */

import { lookupCanonical } from '../../model/registry';
import type { CanonicalType, PropPath } from '../../model/types';

const BY_TARGET: Record<string, string> = {
  'ec2.vpc': 'VpcId',
  'ec2.subnet': 'SubnetId',
  'ec2.securitygroup': 'SecurityGroupIds.0',
  'iam.role': 'Role',
  'iam.instanceprofile': 'IamInstanceProfile',
  'kms.key': 'KmsKeyId',
  'rds.subnetgroup': 'DBSubnetGroupName',
  'elbv2.targetgroup': 'TargetGroupArn',
  'elbv2.loadbalancer': 'LoadBalancerArn',
  'logs.loggroup': 'LoggingConfig.LogGroup',
  'dynamodb.table': 'Environment.Variables.TABLE_NAME',
  'sqs.queue': 'Environment.Variables.QUEUE_URL',
  'sns.topic': 'Environment.Variables.TOPIC_ARN',
  's3.bucket': 'Environment.Variables.BUCKET_NAME',
  'secretsmanager.secret': 'Environment.Variables.SECRET_ARN',
  'lambda.function': 'FunctionName',
  'ecs.cluster': 'Cluster',
  'ecs.taskdefinition': 'TaskDefinition',
  'apigateway.restapi': 'RestApiId',
};

/** Properties that only make sense on a source that can host them. */
const ENVIRONMENT_HOSTS = new Set(['lambda.function']);

export function suggestPropertyPath(from: CanonicalType, to: CanonicalType): string {
  const hint = BY_TARGET[to];
  if (hint) {
    if (hint.startsWith('Environment.') && !ENVIRONMENT_HOSTS.has(from)) {
      return `${lookupCanonical(to)?.short ?? 'Target'}Ref`;
    }
    return hint;
  }
  const short = lookupCanonical(to)?.short?.replace(/[^A-Za-z0-9]/g, '') ?? 'Target';
  return `${short}Ref`;
}

/** `Environment.Variables.X` / `SecurityGroupIds.0` → a `PropPath`. */
export function parsePropPath(input: string): PropPath {
  return input
    .split('.')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
}

/** Generates a logical ID that does not collide with an existing one. */
export function uniqueId(base: string, taken: Set<string>): string {
  const clean = base.replace(/[^A-Za-z0-9]/g, '') || 'Resource';
  if (!taken.has(clean)) return clean;
  for (let i = 2; i < 1000; i++) {
    const candidate = `${clean}${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${clean}${Date.now()}`;
}

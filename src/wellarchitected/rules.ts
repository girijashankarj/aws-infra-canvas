/**
 * Well-Architected checks that can be decided from a template alone.
 *
 * These are *mechanical* best practices — the subset of the framework that is
 * visible in infrastructure-as-code. A real Well-Architected Review is a
 * conversation about questions that no static analysis can answer ("how do you
 * evolve your workload?"), so this is a starting point for that conversation,
 * not a substitute for it. The UI says so too.
 *
 * A check returns:
 *   true  — the practice is followed
 *   false — it is not, and a finding is raised
 *   null  — undecidable in this dialect, so the rule is skipped entirely rather
 *           than counted as a pass or a failure
 */

import type { CanonicalType, Model, ResourceNode } from '../model/types';
import type { PillarId } from './pillars';
import {
  asBoolean,
  asNumber,
  asString,
  collectStrings,
  isExpression,
  walk,
  type PropSpec,
} from './props';

export type Severity = 'high' | 'medium' | 'low';

export interface RuleContext {
  model: Model;
  /** Reads a property using the spelling for this document's dialect. */
  get(node: ResourceNode, spec: PropSpec): unknown;
  /** Nodes of the given raw types that hold a reference to `node`. */
  referencedBy(node: ResourceNode, rawTypes: string[]): ResourceNode[];
  /** All nodes of a canonical type. */
  ofType(...types: CanonicalType[]): ResourceNode[];
}

export interface Rule {
  id: string;
  pillar: PillarId;
  title: string;
  /** Why it matters. */
  rationale: string;
  /** What to change. */
  remediation: string;
  severity: Severity;
  /** Relative importance within its pillar, 1–3. */
  weight: number;
  /** Canonical types this rule inspects. Empty means it runs once per model. */
  appliesTo: CanonicalType[];
  /** Deep link into the AWS documentation. */
  docs?: string;
  check(ctx: RuleContext, node: ResourceNode): boolean | null;
}

const OPEN_CIDRS = new Set(['0.0.0.0/0', '::/0']);
const ADMIN_PORTS = new Set([22, 3389, 3306, 5432, 1433, 27017, 6379]);
/** Instance families superseded by more efficient generations. */
const OLD_FAMILIES = /^(t1|t2|m1|m2|m3|m4|c1|c3|c4|r3|r4|i2|d2|g2|p2)\./;
const SECRET_NAME = /(PASSWORD|PASSWD|SECRET|TOKEN|API_?KEY|PRIVATE_?KEY|CREDENTIAL|ACCESS_?KEY)/i;

/** A value that is present and not an empty container. */
const isSet = (value: unknown): boolean => {
  if (value === undefined || value === null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
};

export const RULES: Rule[] = [
  // ── Security ──────────────────────────────────────────────────────────────
  {
    id: 'SEC-S3-ENCRYPTION',
    pillar: 'security',
    title: 'S3 bucket has no explicit encryption configuration',
    rationale:
      'Amazon S3 applies SSE-S3 by default, so objects are encrypted either way. Declaring encryption explicitly is still the practice AWS recommends: it makes the intent auditable and is where you switch to a customer-managed KMS key when data classification requires one.',
    remediation:
      'Add an encryption configuration. Use a KMS key if the data warrants key rotation, separate access control, or an audit trail of key use.',
    severity: 'low',
    weight: 1,
    appliesTo: ['s3.bucket'],
    docs: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/serv-side-encryption.html',
    check(ctx, node) {
      const inline = ctx.get(node, {
        cfn: [['BucketEncryption']],
        tf: [['server_side_encryption_configuration']],
        cdk: [['encryption'], ['encryptionKey']],
      });
      if (isSet(inline)) return true;
      // Terraform normally configures this from a separate resource.
      if (ctx.model.dialect === 'tf') {
        return ctx.referencedBy(node, ['aws_s3_bucket_server_side_encryption_configuration']).length > 0;
      }
      return false;
    },
  },
  {
    id: 'SEC-S3-PUBLIC-ACCESS',
    pillar: 'security',
    title: 'S3 bucket does not block public access explicitly',
    rationale:
      'Buckets created since April 2023 block public access by default, but the setting can be changed later and is easy to lose track of. Pinning it in the template makes the guarantee explicit and prevents a future change from silently opening the bucket.',
    remediation:
      'Declare a public access block that turns on all four settings, unless the bucket genuinely serves public content — in which case front it with CloudFront and an origin access control instead.',
    severity: 'medium',
    weight: 2,
    appliesTo: ['s3.bucket'],
    docs: 'https://docs.aws.amazon.com/AmazonS3/latest/userguide/access-control-block-public-access.html',
    check(ctx, node) {
      const inline = ctx.get(node, {
        cfn: [['PublicAccessBlockConfiguration']],
        tf: [],
        cdk: [['blockPublicAccess']],
      });
      if (isSet(inline)) return true;
      if (ctx.model.dialect === 'tf') {
        return ctx.referencedBy(node, ['aws_s3_bucket_public_access_block']).length > 0;
      }
      return false;
    },
  },
  {
    id: 'SEC-SG-OPEN-ADMIN',
    pillar: 'security',
    title: 'Security group exposes an administrative port to the whole internet',
    rationale:
      'An ingress rule from 0.0.0.0/0 on SSH, RDP, or a database port puts that service in front of the entire internet, where it is found by automated scanners within minutes.',
    remediation:
      'Restrict the source to a known CIDR or another security group. For shell access, prefer AWS Systems Manager Session Manager, which needs no open port at all.',
    severity: 'high',
    weight: 3,
    appliesTo: ['ec2.securitygroup'],
    docs: 'https://docs.aws.amazon.com/vpc/latest/userguide/vpc-security-groups.html',
    check(ctx, node) {
      const rules = ingressRules(ctx, node);
      if (rules === null) return null;
      return !rules.some((rule) => rule.open && rule.ports.some((p) => ADMIN_PORTS.has(p)));
    },
  },
  {
    id: 'SEC-SG-OPEN-INGRESS',
    pillar: 'security',
    title: 'Security group allows ingress from anywhere',
    rationale:
      'Open ingress is appropriate for a public web listener behind a load balancer, but on anything else it widens the blast radius of a single compromised component.',
    remediation:
      'Scope the source to the security group of the tier that should be calling this one, so traffic is authorized by role rather than by network position.',
    severity: 'medium',
    weight: 2,
    appliesTo: ['ec2.securitygroup'],
    docs: 'https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/protecting-networks.html',
    check(ctx, node) {
      const rules = ingressRules(ctx, node);
      if (rules === null) return null;
      // Public HTTP/HTTPS is expected; anything else open is worth a look.
      return !rules.some(
        (rule) => rule.open && !rule.ports.every((p) => p === 80 || p === 443),
      );
    },
  },
  {
    id: 'SEC-IAM-WILDCARD',
    pillar: 'security',
    title: 'IAM policy grants wildcard actions or resources',
    rationale:
      'A statement with "Action": "*" or "Resource": "*" grants far more than any workload needs, which is the opposite of the least-privilege principle the framework is built on.',
    remediation:
      'Name the specific actions the workload calls and the specific ARNs it touches. IAM Access Analyzer can generate a scoped policy from observed CloudTrail activity.',
    severity: 'high',
    weight: 3,
    appliesTo: ['iam.role', 'iam.policy', 'iam.managedpolicy', 's3.bucketpolicy'],
    docs: 'https://docs.aws.amazon.com/wellarchitected/latest/framework/sec_permissions_least_privileges.html',
    check(_ctx, node) {
      let sawStatement = false;
      let wildcard = false;
      for (const { path, value } of walk(node.props)) {
        const key = path[path.length - 1];
        if (key === 'Effect' || key === 'effect') sawStatement = true;
        if (key !== 'Action' && key !== 'Resource' && key !== 'actions' && key !== 'resources') {
          continue;
        }
        sawStatement = true;
        for (const str of collectStrings(value)) {
          if (str === '*' || str.endsWith(':*')) wildcard = true;
        }
      }
      // A role whose policies live elsewhere gives us nothing to judge.
      if (!sawStatement) return null;
      return !wildcard;
    },
  },
  {
    id: 'SEC-RDS-ENCRYPTION',
    pillar: 'security',
    title: 'Database storage is not encrypted at rest',
    rationale:
      'Encryption at rest cannot be turned on after an RDS instance exists — changing it means a snapshot, a restore, and a cutover. Getting it right in the template avoids that migration.',
    remediation: 'Set storage encryption on, with a KMS key if you need control over key policy and rotation.',
    severity: 'high',
    weight: 3,
    appliesTo: ['rds.instance', 'rds.cluster'],
    docs: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Overview.Encryption.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['StorageEncrypted']],
        tf: [['storage_encrypted']],
        cdk: [['storageEncrypted']],
      });
      if (isExpression(value)) return null;
      return asBoolean(value) === true;
    },
  },
  {
    id: 'SEC-RDS-PUBLIC',
    pillar: 'security',
    title: 'Database is reachable from the internet',
    rationale:
      'A publicly accessible database gets a public IP and is exposed to the internet at the network layer, leaving only the security group and credentials between it and everyone.',
    remediation:
      'Place the database in private subnets and reach it from application subnets or through a bastion/Session Manager session.',
    severity: 'high',
    weight: 3,
    appliesTo: ['rds.instance', 'rds.cluster'],
    docs: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_VPC.WorkingWithRDSInstanceinaVPC.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['PubliclyAccessible']],
        tf: [['publicly_accessible']],
        cdk: [['publiclyAccessible']],
      });
      if (value === undefined) return true; // Defaults to private in a VPC.
      if (isExpression(value)) return null;
      return asBoolean(value) !== true;
    },
  },
  {
    id: 'SEC-PLAINTEXT-SECRET',
    pillar: 'security',
    title: 'A secret looks hard-coded in an environment variable',
    rationale:
      'A literal value under a name like PASSWORD or API_KEY ends up in the template, in version control, and in the console, where anyone with read access to any of them can see it.',
    remediation:
      'Store the value in Secrets Manager or an SSM SecureString parameter and pass a reference instead, so the secret is resolved at runtime and can be rotated without a deployment.',
    severity: 'high',
    weight: 3,
    appliesTo: ['lambda.function', 'ecs.taskdefinition', 'ec2.instance'],
    docs: 'https://docs.aws.amazon.com/secretsmanager/latest/userguide/intro.html',
    check(_ctx, node) {
      for (const { path, value } of walk(node.props)) {
        const key = path[path.length - 1];
        if (typeof key !== 'string' || !SECRET_NAME.test(key)) continue;
        // Only a literal is a problem; a reference is exactly the right answer.
        if (typeof value === 'string' && value.trim() !== '' && !value.includes('${')) return false;
      }
      return true;
    },
  },

  // ── Reliability ───────────────────────────────────────────────────────────
  {
    id: 'REL-RDS-BACKUP',
    pillar: 'reliability',
    title: 'Database has no automated backups',
    rationale:
      'A backup retention period of zero disables automated backups and point-in-time recovery entirely, so there is nothing to restore from after an accidental delete or a bad migration.',
    remediation:
      'Set a retention period that matches your recovery point objective — commonly 7 days, or 35 for regulated workloads.',
    severity: 'high',
    weight: 3,
    appliesTo: ['rds.instance', 'rds.cluster'],
    docs: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_WorkingWithAutomatedBackups.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['BackupRetentionPeriod']],
        tf: [['backup_retention_period']],
        cdk: [['backupRetention']],
      });
      if (value === undefined) return false;
      if (isExpression(value)) return null;
      const days = asNumber(value);
      return days === undefined ? null : days > 0;
    },
  },
  {
    id: 'REL-RDS-MULTI-AZ',
    pillar: 'reliability',
    title: 'Database runs in a single Availability Zone',
    rationale:
      'A single-AZ instance is unavailable for the duration of an AZ failure, and even routine patching causes downtime. Multi-AZ gives you an automatic failover to a standby.',
    remediation:
      'Turn on Multi-AZ for production databases. It roughly doubles instance cost, so single-AZ can be the right call for development.',
    severity: 'medium',
    weight: 2,
    appliesTo: ['rds.instance'],
    docs: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/Concepts.MultiAZ.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['MultiAZ']],
        tf: [['multi_az']],
        cdk: [['multiAz']],
      });
      if (isExpression(value)) return null;
      return asBoolean(value) === true;
    },
  },
  {
    id: 'REL-DELETION-PROTECTION',
    pillar: 'reliability',
    title: 'Stateful resource has no deletion protection',
    rationale:
      'Without deletion protection, a mistaken parameter change or a stack delete destroys the data along with the resource, and there is no undo.',
    remediation:
      'Turn on deletion protection, and set the CloudFormation deletion and update-replace policies to Retain or Snapshot for anything holding data.',
    severity: 'medium',
    weight: 2,
    appliesTo: ['rds.instance', 'rds.cluster', 'dynamodb.table'],
    docs: 'https://docs.aws.amazon.com/AWSCloudFormation/latest/UserGuide/aws-attribute-deletionpolicy.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['DeletionProtection'], ['DeletionProtectionEnabled']],
        tf: [['deletion_protection'], ['deletion_protection_enabled']],
        cdk: [['deletionProtection']],
      });
      if (isExpression(value)) return null;
      return asBoolean(value) === true;
    },
  },
  {
    id: 'REL-SQS-DLQ',
    pillar: 'reliability',
    title: 'Queue has no dead-letter queue',
    rationale:
      'Without a redrive policy, a message that keeps failing is retried until it expires and is then silently dropped — and a poison message can block the consumer for as long as it survives.',
    remediation:
      'Attach a dead-letter queue with a maximum receive count, so failures are set aside for inspection instead of lost.',
    severity: 'medium',
    weight: 2,
    appliesTo: ['sqs.queue'],
    docs: 'https://docs.aws.amazon.com/AWSSimpleQueueService/latest/SQSDeveloperGuide/sqs-dead-letter-queues.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['RedrivePolicy']],
        tf: [['redrive_policy']],
        cdk: [['deadLetterQueue']],
      });
      return isSet(value);
    },
  },
  {
    id: 'REL-MULTI-AZ-SUBNETS',
    pillar: 'reliability',
    title: 'VPC has subnets in only one Availability Zone',
    rationale:
      'Everything placed in a single AZ shares its fate. Load balancers and managed services also require subnets in at least two AZs before they will provision.',
    remediation: 'Add at least one more subnet in a different Availability Zone and spread workloads across both.',
    severity: 'medium',
    weight: 2,
    appliesTo: ['ec2.vpc'],
    docs: 'https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/rel_fault_isolation_multiaz_region_system.html',
    check(ctx, node) {
      const subnets = ctx.ofType('ec2.subnet').filter((s) => s.parentId === node.id);
      if (subnets.length === 0) return null;
      const zones = new Set<string>();
      let unknown = 0;
      for (const subnet of subnets) {
        const az = asString(
          ctx.get(subnet, {
            cfn: [['AvailabilityZone']],
            tf: [['availability_zone']],
            cdk: [['availabilityZone']],
          }),
        );
        if (az) zones.add(az);
        else unknown++;
      }
      // `!Select [n, !GetAZs '']` is an expression, not a literal zone name.
      if (zones.size === 0 && unknown > 0) return subnets.length >= 2 ? true : null;
      return zones.size >= 2;
    },
  },

  // ── Operational Excellence ────────────────────────────────────────────────
  {
    id: 'OPS-LAMBDA-TRACING',
    pillar: 'operational-excellence',
    title: 'Function has no active tracing',
    rationale:
      'Without X-Ray tracing, a slow request through several functions and queues can only be reconstructed from separate log streams, which is where most of the time in an incident goes.',
    remediation: 'Set the tracing mode to Active so calls are sampled into a distributed trace.',
    severity: 'low',
    weight: 1,
    appliesTo: ['lambda.function'],
    docs: 'https://docs.aws.amazon.com/lambda/latest/dg/services-xray.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['TracingConfig', 'Mode']],
        tf: [['tracing_config', 'mode']],
        cdk: [['tracing']],
      });
      const mode = asString(value);
      if (mode === undefined) return isExpression(value) ? null : false;
      return /active/i.test(mode);
    },
  },
  {
    id: 'OPS-RESOURCE-TAGS',
    pillar: 'operational-excellence',
    title: 'Resource is untagged',
    rationale:
      'Tags are how cost reports, access policies, and automation identify what a resource belongs to. An untagged resource is invisible to all three, and nobody knows who owns it a year later.',
    remediation:
      'Apply your organisation’s standard tags. CloudFormation stack-level tags and the CDK’s Tags.of() propagate to most resources without repeating them.',
    severity: 'low',
    weight: 1,
    appliesTo: [
      's3.bucket',
      'dynamodb.table',
      'lambda.function',
      'rds.instance',
      'rds.cluster',
      'ec2.instance',
      'ec2.vpc',
      'sqs.queue',
      'sns.topic',
    ],
    docs: 'https://docs.aws.amazon.com/whitepapers/latest/tagging-best-practices/tagging-best-practices.html',
    check(ctx, node) {
      const value = ctx.get(node, { cfn: [['Tags']], tf: [['tags']], cdk: [] });
      // CDK tags are usually applied with an aspect, not a construct prop.
      if (ctx.model.dialect === 'cdk-ts') return null;
      return isSet(value);
    },
  },
  {
    id: 'OPS-LAMBDA-LOG-GROUP',
    pillar: 'operational-excellence',
    title: 'Function has no log group in the template',
    rationale:
      'If the template does not declare one, Lambda creates the log group on first invocation with retention set to never expire, outside the stack’s control — so it also survives stack deletion.',
    remediation:
      'Declare the log group explicitly, named /aws/lambda/<function>, with a retention period. That puts its lifecycle and cost inside the stack.',
    severity: 'low',
    weight: 1,
    appliesTo: ['lambda.function'],
    docs: 'https://docs.aws.amazon.com/lambda/latest/dg/monitoring-cloudwatchlogs.html',
    check(ctx) {
      return ctx.ofType('logs.loggroup').length > 0;
    },
  },

  // ── Cost Optimization ─────────────────────────────────────────────────────
  {
    id: 'COST-LOG-RETENTION',
    pillar: 'cost-optimization',
    title: 'Log group keeps logs forever',
    rationale:
      'A log group with no retention period never expires anything. Storage is charged monthly for the life of the account, and the bill grows without limit long after the logs stop being useful.',
    remediation:
      'Set a retention period. If logs must be kept for compliance, export them to S3 with a lifecycle rule into cheaper storage classes rather than holding them in CloudWatch.',
    severity: 'medium',
    weight: 2,
    appliesTo: ['logs.loggroup'],
    docs: 'https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/Working-with-log-groups-and-streams.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['RetentionInDays']],
        tf: [['retention_in_days']],
        cdk: [['retention']],
      });
      if (value === undefined) return false;
      if (isExpression(value)) return null;
      const days = asNumber(value);
      return days === undefined ? true : days > 0;
    },
  },
  {
    id: 'COST-LAMBDA-OVERSIZED',
    pillar: 'cost-optimization',
    title: 'Function is allocated a very large amount of memory',
    rationale:
      'Lambda bills on memory × duration. Large allocations pay off for CPU-bound work, because CPU scales with memory, but on I/O-bound work they multiply the cost of the same wall-clock time.',
    remediation:
      'Measure with Lambda Power Tuning before committing. The cheapest setting is often not the smallest one, but it is rarely the largest.',
    severity: 'low',
    weight: 1,
    appliesTo: ['lambda.function'],
    docs: 'https://docs.aws.amazon.com/lambda/latest/dg/configuration-function-common.html',
    check(ctx, node) {
      const memory = asNumber(
        ctx.get(node, {
          cfn: [['MemorySize']],
          tf: [['memory_size']],
          cdk: [['memorySize']],
        }),
      );
      if (memory === undefined) return null;
      return memory < 3008;
    },
  },
  {
    id: 'COST-DDB-BILLING-MODE',
    pillar: 'cost-optimization',
    title: 'Table uses provisioned capacity without autoscaling',
    rationale:
      'Provisioned capacity is billed whether or not it is used, and throttles when traffic exceeds it. It is cheaper than on-demand only for steady, well-understood traffic.',
    remediation:
      'Use PAY_PER_REQUEST for spiky or unknown traffic. If you keep provisioned capacity, attach autoscaling so it tracks demand.',
    severity: 'low',
    weight: 1,
    appliesTo: ['dynamodb.table'],
    docs: 'https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/HowItWorks.ReadWriteCapacityMode.html',
    check(ctx, node) {
      const mode = asString(
        ctx.get(node, {
          cfn: [['BillingMode']],
          tf: [['billing_mode']],
          cdk: [['billingMode']],
        }),
      );
      if (mode === undefined) return false; // Defaults to PROVISIONED.
      return /PAY_PER_REQUEST|ON_DEMAND/i.test(mode);
    },
  },

  // ── Performance Efficiency ────────────────────────────────────────────────
  {
    id: 'PERF-LAMBDA-MEMORY-DEFAULT',
    pillar: 'performance-efficiency',
    title: 'Function is left at the default memory size',
    rationale:
      'At 128 MB a function gets a fraction of a vCPU. For anything doing real work, raising memory shortens duration enough that the invocation often costs the same or less while finishing sooner.',
    remediation: 'Right-size against measured duration rather than leaving the default in place.',
    severity: 'low',
    weight: 1,
    appliesTo: ['lambda.function'],
    docs: 'https://docs.aws.amazon.com/lambda/latest/operatorguide/computing-power.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['MemorySize']],
        tf: [['memory_size']],
        cdk: [['memorySize']],
      });
      if (value === undefined) return false; // Unset means 128 MB.
      const memory = asNumber(value);
      return memory === undefined ? null : memory > 128;
    },
  },
  {
    id: 'PERF-RDS-INSIGHTS',
    pillar: 'performance-efficiency',
    title: 'Database has no Performance Insights',
    rationale:
      'Performance Insights is what turns "the database is slow" into a named query and a wait event. Without it, diagnosis starts from application logs.',
    remediation: 'Enable Performance Insights; seven days of retention is free on supported instance classes.',
    severity: 'low',
    weight: 1,
    appliesTo: ['rds.instance', 'rds.cluster'],
    docs: 'https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/USER_PerfInsights.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['EnablePerformanceInsights']],
        tf: [['performance_insights_enabled']],
        cdk: [['enablePerformanceInsights']],
      });
      if (isExpression(value)) return null;
      return asBoolean(value) === true;
    },
  },
  {
    id: 'PERF-S3-CDN',
    pillar: 'performance-efficiency',
    title: 'Static website bucket is served without a CDN',
    rationale:
      'Serving a website straight from S3 means every request travels to the bucket’s Region. A distribution puts the content at an edge location near the viewer and cuts origin requests.',
    remediation:
      'Put CloudFront in front of the bucket with an origin access control, and block public access on the bucket itself.',
    severity: 'low',
    weight: 1,
    appliesTo: ['s3.bucket'],
    docs: 'https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/DownloadDistS3AndCustomOrigins.html',
    check(ctx, node) {
      const website = ctx.get(node, {
        cfn: [['WebsiteConfiguration']],
        tf: [['website']],
        cdk: [['websiteIndexDocument']],
      });
      if (!isSet(website)) return null; // Not a website bucket.
      return ctx.ofType('cloudfront.distribution').length > 0;
    },
  },

  // ── Sustainability ────────────────────────────────────────────────────────
  {
    id: 'SUS-LAMBDA-ARM',
    pillar: 'sustainability',
    title: 'Function does not run on Graviton',
    rationale:
      'AWS Graviton delivers more performance per watt than the equivalent x86 instances, and Lambda prices arm64 about 20% lower. Most interpreted runtimes need no code change to move.',
    remediation:
      'Set the architecture to arm64. Check any native dependencies first — they need arm64 builds.',
    severity: 'low',
    weight: 1,
    appliesTo: ['lambda.function'],
    docs: 'https://docs.aws.amazon.com/lambda/latest/dg/foundation-arch.html',
    check(ctx, node) {
      const value = ctx.get(node, {
        cfn: [['Architectures']],
        tf: [['architectures']],
        cdk: [['architecture']],
      });
      if (value === undefined) return false; // Defaults to x86_64.
      return collectStrings(value).some((s) => /arm64/i.test(s));
    },
  },
  {
    id: 'SUS-OLD-GENERATION',
    pillar: 'sustainability',
    title: 'Resource uses a superseded instance generation',
    rationale:
      'Older instance families do the same work on less efficient hardware, consuming more energy per unit of output — and newer generations are usually cheaper and faster as well.',
    remediation: 'Move to the current generation of the same family; it is normally a type change and a restart.',
    severity: 'low',
    weight: 1,
    appliesTo: ['ec2.instance', 'rds.instance', 'elasticache.cluster'],
    docs: 'https://docs.aws.amazon.com/wellarchitected/latest/sustainability-pillar/hardware-and-services.html',
    check(ctx, node) {
      const type = asString(
        ctx.get(node, {
          cfn: [['InstanceType'], ['DBInstanceClass'], ['CacheNodeType']],
          tf: [['instance_type'], ['instance_class'], ['node_type']],
          cdk: [['instanceType']],
        }),
      );
      if (type === undefined) return null;
      return !OLD_FAMILIES.test(type.replace(/^db\.|^cache\./, ''));
    },
  },
];

// ── Shared helpers ──────────────────────────────────────────────────────────

interface IngressRule {
  open: boolean;
  ports: number[];
}

/**
 * Normalizes security-group ingress across dialects. Returns null when the
 * rules are not visible — CDK adds them with `addIngressRule` after
 * construction, and modern Terraform puts each rule in its own resource.
 */
function ingressRules(ctx: RuleContext, node: ResourceNode): IngressRule[] | null {
  if (ctx.model.dialect === 'cdk-ts') return null;

  const collected: IngressRule[] = [];

  const pushCfn = (entry: unknown) => {
    const from = asNumber(at(entry, 'FromPort'));
    const to = asNumber(at(entry, 'ToPort'));
    const cidrs = [at(entry, 'CidrIp'), at(entry, 'CidrIpv6')]
      .map((v) => asString(v))
      .filter((v): v is string => v !== undefined);
    collected.push({
      open: cidrs.some((c) => OPEN_CIDRS.has(c)),
      ports: portRange(from, to),
    });
  };

  const pushTf = (entry: unknown) => {
    const from = asNumber(at(entry, 'from_port'));
    const to = asNumber(at(entry, 'to_port'));
    const cidrs = collectStrings(at(entry, 'cidr_blocks')).concat(
      collectStrings(at(entry, 'ipv6_cidr_blocks')),
      collectStrings(at(entry, 'cidr_ipv4')),
    );
    collected.push({
      open: cidrs.some((c) => OPEN_CIDRS.has(c)),
      ports: portRange(from, to),
    });
  };

  if (ctx.model.dialect === 'tf') {
    for (const entry of asArray(node.props.ingress)) pushTf(entry);
    for (const rule of ctx.referencedBy(node, ['aws_vpc_security_group_ingress_rule', 'aws_security_group_rule'])) {
      const type = asString(rule.props.type);
      if (type !== undefined && type !== 'ingress') continue;
      pushTf(rule.props);
    }
  } else {
    for (const entry of asArray(node.props.SecurityGroupIngress)) pushCfn(entry);
    for (const rule of ctx.referencedBy(node, ['AWS::EC2::SecurityGroupIngress'])) {
      pushCfn(rule.props);
    }
  }

  return collected.length === 0 ? null : collected;
}

function portRange(from: number | undefined, to: number | undefined): number[] {
  if (from === undefined && to === undefined) return [-1]; // "-1" = all ports.
  const start = from ?? to!;
  const end = to ?? from!;
  if (start === -1 || end === -1) return [-1];
  // Only the endpoints matter for the checks above; a wide range counts as open.
  if (end - start > 64) return [-1, start, end];
  const ports: number[] = [];
  for (let p = start; p <= end; p++) ports.push(p);
  return ports;
}

const asArray = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];

/** Small local `at` that takes a single key, for readability above. */
function at(value: unknown, key: string): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return (value as Record<string, unknown>)[key];
}

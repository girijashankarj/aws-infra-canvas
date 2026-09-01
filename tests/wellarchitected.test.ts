import { beforeAll, describe, expect, it } from 'vitest';

import { cdkTypeScript, cfnYaml, terraform } from '../src/dialects';
import { PILLARS } from '../src/wellarchitected/pillars';
import { RULES } from '../src/wellarchitected/rules';
import { reviewModel } from '../src/wellarchitected/review';
import { fixture } from './helpers';

// The CDK dialect loads the TypeScript compiler on demand.
beforeAll(async () => {
  await cdkTypeScript.prepare!();
});

const reviewYaml = (text: string) => reviewModel(cfnYaml.parse(text).model);
const ruleIds = (r: ReturnType<typeof reviewModel>) => r.findings.map((f) => f.ruleId);

describe('rule set integrity', () => {
  it('has unique ids and a known pillar for every rule', () => {
    const ids = RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const pillarIds = new Set(PILLARS.map((p) => p.id));
    for (const rule of RULES) expect(pillarIds.has(rule.pillar)).toBe(true);
  });

  it('gives every rule a rationale, a remediation and a documentation link', () => {
    for (const rule of RULES) {
      expect(rule.rationale.length, rule.id).toBeGreaterThan(40);
      expect(rule.remediation.length, rule.id).toBeGreaterThan(20);
      expect(rule.docs, rule.id).toMatch(/^https:\/\/docs\.aws\.amazon\.com\//);
    }
  });

  it('covers all six pillars', () => {
    expect(new Set(RULES.map((r) => r.pillar)).size).toBe(6);
  });
});

describe('scoring', () => {
  it('scores nothing when there is nothing to check', () => {
    const review = reviewYaml('Resources: {}\n');
    expect(review.score).toBeNull();
    expect(review.findings).toEqual([]);
  });

  it('is a perfect score when every applicable rule passes', () => {
    const review = reviewYaml(
      [
        'Resources:',
        '  Logs:',
        '    Type: AWS::Logs::LogGroup',
        '    Properties:',
        '      RetentionInDays: 14',
        '',
      ].join('\n'),
    );
    expect(review.score).toBe(100);
    expect(review.findings).toEqual([]);
    expect(review.passed.map((p) => p.ruleId)).toContain('COST-LOG-RETENTION');
  });

  it('gives partial credit rather than zeroing a rule on one bad resource', () => {
    const good = 'RetentionInDays: 14';
    const template = [
      'Resources:',
      '  A:',
      '    Type: AWS::Logs::LogGroup',
      '    Properties:',
      `      ${good}`,
      '  B:',
      '    Type: AWS::Logs::LogGroup',
      '    Properties:',
      `      ${good}`,
      '  C:',
      '    Type: AWS::Logs::LogGroup',
      '  D:',
      '    Type: AWS::Logs::LogGroup',
      '    Properties:',
      `      ${good}`,
      '',
    ].join('\n');
    const review = reviewYaml(template);
    // One of four log groups fails, so the pillar sits at 75.
    expect(review.pillars.find((p) => p.pillar === 'cost-optimization')!.score).toBe(75);
    expect(review.findings).toHaveLength(1);
    expect(review.findings[0].nodeId).toBe('C');
  });

  it('leaves a pillar unscored when none of its rules applied', () => {
    const review = reviewYaml(
      ['Resources:', '  Q:', '    Type: AWS::SQS::Queue', ''].join('\n'),
    );
    expect(review.pillars.find((p) => p.pillar === 'sustainability')!.score).toBeNull();
    expect(review.pillars.find((p) => p.pillar === 'reliability')!.score).not.toBeNull();
  });

  it('orders findings by severity', () => {
    const review = reviewYaml(fixture('serverless-api.yaml'));
    const order = review.findings.map((f) => f.severity);
    const rank = { high: 0, medium: 1, low: 2 } as const;
    for (let i = 1; i < order.length; i++) {
      expect(rank[order[i]]).toBeGreaterThanOrEqual(rank[order[i - 1]]);
    }
  });
});

describe('security rules', () => {
  it('flags an open administrative port', () => {
    const review = reviewYaml(
      [
        'Resources:',
        '  Sg:',
        '    Type: AWS::EC2::SecurityGroup',
        '    Properties:',
        '      GroupDescription: test',
        '      SecurityGroupIngress:',
        '        - IpProtocol: tcp',
        '          FromPort: 22',
        '          ToPort: 22',
        '          CidrIp: 0.0.0.0/0',
        '',
      ].join('\n'),
    );
    expect(ruleIds(review)).toContain('SEC-SG-OPEN-ADMIN');
  });

  it('accepts public HTTPS without complaint', () => {
    const review = reviewYaml(
      [
        'Resources:',
        '  Sg:',
        '    Type: AWS::EC2::SecurityGroup',
        '    Properties:',
        '      GroupDescription: web',
        '      SecurityGroupIngress:',
        '        - IpProtocol: tcp',
        '          FromPort: 443',
        '          ToPort: 443',
        '          CidrIp: 0.0.0.0/0',
        '',
      ].join('\n'),
    );
    expect(ruleIds(review)).not.toContain('SEC-SG-OPEN-ADMIN');
    expect(ruleIds(review)).not.toContain('SEC-SG-OPEN-INGRESS');
  });

  it('flags a wildcard IAM action', () => {
    const review = reviewYaml(
      [
        'Resources:',
        '  Role:',
        '    Type: AWS::IAM::Role',
        '    Properties:',
        '      Policies:',
        '        - PolicyDocument:',
        '            Statement:',
        '              - Effect: Allow',
        '                Action: "*"',
        '                Resource: "*"',
        '',
      ].join('\n'),
    );
    expect(ruleIds(review)).toContain('SEC-IAM-WILDCARD');
  });

  it('does not flag a role whose policies are declared elsewhere', () => {
    const review = reviewYaml(fixture('serverless-api.yaml'));
    expect(ruleIds(review)).not.toContain('SEC-IAM-WILDCARD');
  });

  it('flags a hard-coded secret but not a reference', () => {
    const withLiteral = reviewYaml(
      [
        'Resources:',
        '  Fn:',
        '    Type: AWS::Lambda::Function',
        '    Properties:',
        '      Environment:',
        '        Variables:',
        '          DB_PASSWORD: hunter2',
        '',
      ].join('\n'),
    );
    expect(ruleIds(withLiteral)).toContain('SEC-PLAINTEXT-SECRET');

    const withRef = reviewYaml(
      [
        'Resources:',
        '  Secret:',
        '    Type: AWS::SecretsManager::Secret',
        '  Fn:',
        '    Type: AWS::Lambda::Function',
        '    Properties:',
        '      Environment:',
        '        Variables:',
        '          DB_PASSWORD: !Ref Secret',
        '',
      ].join('\n'),
    );
    expect(ruleIds(withRef)).not.toContain('SEC-PLAINTEXT-SECRET');
  });
});

describe('reliability rules', () => {
  it('flags a single-AZ VPC but accepts two zones', () => {
    const single = reviewYaml(
      [
        'Resources:',
        '  Vpc:',
        '    Type: AWS::EC2::VPC',
        '    Properties: { CidrBlock: 10.0.0.0/16 }',
        '  A:',
        '    Type: AWS::EC2::Subnet',
        '    Properties:',
        '      VpcId: !Ref Vpc',
        '      AvailabilityZone: us-east-1a',
        '  B:',
        '    Type: AWS::EC2::Subnet',
        '    Properties:',
        '      VpcId: !Ref Vpc',
        '      AvailabilityZone: us-east-1a',
        '',
      ].join('\n'),
    );
    expect(ruleIds(single)).toContain('REL-MULTI-AZ-SUBNETS');

    const spread = reviewYaml(
      [
        'Resources:',
        '  Vpc:',
        '    Type: AWS::EC2::VPC',
        '    Properties: { CidrBlock: 10.0.0.0/16 }',
        '  A:',
        '    Type: AWS::EC2::Subnet',
        '    Properties:',
        '      VpcId: !Ref Vpc',
        '      AvailabilityZone: us-east-1a',
        '  B:',
        '    Type: AWS::EC2::Subnet',
        '    Properties:',
        '      VpcId: !Ref Vpc',
        '      AvailabilityZone: us-east-1b',
        '',
      ].join('\n'),
    );
    expect(ruleIds(spread)).not.toContain('REL-MULTI-AZ-SUBNETS');
  });
});

describe('across dialects', () => {
  it('applies the same rules to Terraform spellings', () => {
    const review = reviewModel(terraform.parse(fixture('app.tf')).model);
    // memory_size is 256, so the default-memory rule passes.
    expect(ruleIds(review)).not.toContain('PERF-LAMBDA-MEMORY-DEFAULT');
    // No architectures = x86, no tracing, no tags on the lambda.
    expect(ruleIds(review)).toContain('SUS-LAMBDA-ARM');
    expect(ruleIds(review)).toContain('OPS-LAMBDA-TRACING');
    expect(review.score).not.toBeNull();
  });

  it('skips checks a dialect cannot answer instead of failing them', () => {
    const review = reviewModel(cdkTypeScript.parse(fixture('stack.ts')).model);
    // CDK applies tags with an aspect, so the rule must not fire.
    expect(ruleIds(review)).not.toContain('OPS-RESOURCE-TAGS');
    expect(review.undecided.map((u) => u.ruleId)).toContain('OPS-RESOURCE-TAGS');
  });
});

describe('a realistic template', () => {
  it('produces a score and actionable findings', () => {
    const review = reviewYaml(fixture('serverless-api.yaml'));
    expect(review.score).toBeGreaterThan(0);
    expect(review.score).toBeLessThan(100);
    expect(review.findings.length).toBeGreaterThan(0);
    // Every finding points at a real resource.
    const ids = new Set(cfnYaml.parse(fixture('serverless-api.yaml')).model.nodes.map((n) => n.id));
    for (const finding of review.findings) {
      if (finding.nodeId) expect(ids.has(finding.nodeId), finding.nodeId).toBe(true);
    }
  });
});

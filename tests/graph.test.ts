import { describe, expect, it } from 'vitest';

import { cfnJson, cfnYaml, detectDialect } from '../src/dialects';
import { fixture } from './helpers';

const yamlModel = (name: string) => cfnYaml.parse(fixture(name)).model;

describe('resource extraction', () => {
  it('types resources from the registry', () => {
    const model = yamlModel('serverless-api.yaml');
    const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
    expect(byId.ItemsTable.canonicalType).toBe('dynamodb.table');
    expect(byId.ApiFunction.canonicalType).toBe('lambda.function');
    expect(byId.WorkQueue.canonicalType).toBe('sqs.queue');
    expect(byId.ApiFunction.props.MemorySize).toBe(128);
  });

  it('gives a node a source range covering its whole block', () => {
    const text = fixture('serverless-api.yaml');
    const node = cfnYaml.parse(text).model.nodes.find((n) => n.id === 'WorkQueue')!;
    const slice = text.slice(node.range.start, node.range.end);
    expect(slice.startsWith('WorkQueue')).toBe(true);
    expect(slice).toContain('VisibilityTimeout: 30');
  });
});

describe('edge derivation', () => {
  const edgeSet = (name: string) =>
    new Set(yamlModel(name).edges.map((e) => `${e.from}->${e.to}:${e.kind}`));

  it('finds !Ref, !GetAtt and DependsOn edges', () => {
    const edges = edgeSet('serverless-api.yaml');
    expect(edges).toContain('ApiFunction->ItemsTable:ref');
    expect(edges).toContain('ApiFunction->WorkQueue:ref');
    expect(edges).toContain('ApiFunction->ItemsTable:getatt');
    expect(edges).toContain('ApiFunction->ApiRole:getatt');
    expect(edges).toContain('ApiFunction->ItemsTable:depends');
  });

  it('finds references inside Fn::Sub strings', () => {
    const model = cfnYaml.parse(
      ['Resources:', '  A:', '    Type: AWS::SQS::Queue', '  B:', '    Type: AWS::SNS::Topic', '    Properties:', '      X: !Sub \'q-${A}-${AWS::Region}\'', ''].join('\n'),
    ).model;
    expect(model.edges.map((e) => `${e.from}->${e.to}`)).toEqual(['B->A']);
  });

  it('ignores pseudo-parameters and parameter refs', () => {
    const model = yamlModel('serverless-api.yaml');
    expect(model.edges.some((e) => e.to === 'Stage')).toBe(false);
    expect(model.diagnostics.filter((d) => d.severity === 'warning')).toEqual([]);
  });

  it('warns about a reference to something that is not defined', () => {
    const model = cfnYaml.parse(
      ['Resources:', '  B:', '    Type: AWS::SNS::Topic', '    Properties:', '      X: !Ref Missing', ''].join('\n'),
    ).model;
    expect(model.diagnostics.map((d) => d.message)).toEqual([
      '"B" references "Missing" at X, which is not defined in this file.',
    ]);
  });

  it('produces the same edges from the JSON dialect', () => {
    const edges = new Set(
      cfnJson.parse(fixture('api.json')).model.edges.map((e) => `${e.from}->${e.to}:${e.kind}`),
    );
    expect(edges).toContain('ApiFunction->ItemsTable:ref');
    expect(edges).toContain('ApiFunction->ItemsTable:getatt');
    expect(edges).toContain('ApiFunction->ItemsTable:depends');
  });
});

describe('containment', () => {
  it('nests subnets in the VPC and instances in the subnet', () => {
    const model = yamlModel('vpc.yaml');
    const byId = Object.fromEntries(model.nodes.map((n) => [n.id, n]));
    expect(byId.PublicSubnet.parentId).toBe('AppVpc');
    expect(byId.AppSg.parentId).toBe('AppVpc');
    expect(byId.WebServer.parentId).toBe('PublicSubnet');
    expect(byId.AppVpc.parentId).toBeUndefined();
  });

  it('does not also draw an edge for a containment relationship', () => {
    const model = yamlModel('vpc.yaml');
    expect(model.edges.some((e) => e.from === 'PublicSubnet' && e.to === 'AppVpc')).toBe(false);
    // Non-containment references are still edges.
    expect(model.edges.some((e) => e.from === 'WebServer' && e.to === 'AppSg')).toBe(true);
  });
});

describe('dialect detection', () => {
  it('picks YAML for a YAML template', () => {
    expect(detectDialect(fixture('serverless-api.yaml'))?.id).toBe('cfn-yaml');
  });
  it('picks JSON for a JSON template', () => {
    expect(detectDialect(fixture('api.json'))?.id).toBe('cfn-json');
  });
  it('returns nothing for unrecognized text', () => {
    expect(detectDialect('hello world')).toBeUndefined();
  });
});

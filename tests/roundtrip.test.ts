import { describe, expect, it } from 'vitest';

import { cfnJson, cfnYaml } from '../src/dialects';
import type { Dialect, ModelOp } from '../src/model/types';
import { changedLines, fixture } from './helpers';

const apply = (d: Dialect, text: string, ops: ModelOp[]) => {
  const { doc } = d.parse(text);
  return d.applyOps(text, doc, ops);
};

const YAML_FIXTURES = ['serverless-api.yaml', 'vpc.yaml'];

describe('no-op is byte-identical', () => {
  for (const name of [...YAML_FIXTURES, 'api.json']) {
    it(name, () => {
      const text = fixture(name);
      const dialect = name.endsWith('.json') ? cfnJson : cfnYaml;
      expect(apply(dialect, text, [])).toBe(text);
    });
  }
});

describe('setProp touches only the target line', () => {
  it('changes a number in YAML without disturbing comments or quoting', () => {
    const text = fixture('serverless-api.yaml');
    const out = apply(cfnYaml, text, [
      { op: 'setProp', id: 'ApiFunction', path: ['MemorySize'], value: 512 },
    ]);
    expect(changedLines(text, out)).toEqual(['      MemorySize: 128 =>       MemorySize: 512']);
    expect(out).toContain('# the primary store');
    expect(out).toContain("!Sub '${AWS::StackName}-items-${Stage}'");
  });

  it('preserves the original quote style for strings', () => {
    const text = fixture('serverless-api.yaml');
    const out = apply(cfnYaml, text, [
      { op: 'setProp', id: 'ApiFunction', path: ['Runtime'], value: 'nodejs22.x' },
    ]);
    expect(changedLines(text, out)).toEqual([
      '      Runtime: nodejs20.x =>       Runtime: nodejs22.x',
    ]);
  });

  it('quotes a value that would otherwise parse as a boolean', () => {
    const text = fixture('vpc.yaml');
    const out = apply(cfnYaml, text, [
      { op: 'setProp', id: 'AppVpc', path: ['CidrBlock'], value: 'true' },
    ]);
    expect(out).toContain('CidrBlock: "true"');
  });

  it('changes a number in JSON without reformatting the file', () => {
    const text = fixture('api.json');
    const out = apply(cfnJson, text, [
      { op: 'setProp', id: 'ApiFunction', path: ['MemorySize'], value: 512 },
    ]);
    expect(changedLines(text, out)).toEqual([
      '        "MemorySize": 128, =>         "MemorySize": 512,',
    ]);
  });
});

describe('adding a nested property', () => {
  it('creates intermediate maps in YAML', () => {
    const text = fixture('vpc.yaml');
    const out = apply(cfnYaml, text, [
      { op: 'setProp', id: 'AppVpc', path: ['Tags', 0, 'Key'], value: 'Name' },
    ]);
    expect(out).toContain('Tags:');
    expect(out).toContain('Key: Name');
    // Untouched resources survive intact.
    expect(out).toContain('SubnetId: !Ref PublicSubnet');
  });

  it('creates intermediate objects in JSON', () => {
    const text = fixture('api.json');
    const out = apply(cfnJson, text, [
      { op: 'setProp', id: 'ItemsTable', path: ['SSESpecification', 'SSEEnabled'], value: true },
    ]);
    expect(JSON.parse(out).Resources.ItemsTable.Properties.SSESpecification.SSEEnabled).toBe(true);
    expect(out).toContain('"Fn::Sub": "table-${ItemsTable}"');
  });
});

describe('renameResource rewrites every reference', () => {
  it('handles !Ref, !GetAtt (both forms), !Sub, DependsOn and Outputs', () => {
    const text = fixture('serverless-api.yaml');
    const out = apply(cfnYaml, text, [
      { op: 'renameResource', from: 'ItemsTable', to: 'RecordsTable' },
    ]);

    expect(out).toContain('  RecordsTable:');
    expect(out).toContain('DependsOn: RecordsTable');
    expect(out).toContain('TABLE_NAME: !Ref RecordsTable');
    expect(out).toContain('TABLE_ARN: !GetAtt RecordsTable.Arn');
    expect(out).not.toMatch(/\bItemsTable\b/);

    // Unrelated content is byte-identical.
    expect(out).toContain('# the primary store');
    expect(out).toContain('Role: !GetAtt [ ApiRole, Arn ]');

    // The rename is the only thing that changed.
    const model = cfnYaml.parse(out).model;
    expect(model.nodes.map((n) => n.id).sort()).toEqual(
      ['ApiFunction', 'ApiRole', 'RecordsTable', 'WorkQueue'].sort(),
    );
  });

  it('rewrites the seq form of !GetAtt', () => {
    const text = fixture('serverless-api.yaml');
    const out = apply(cfnYaml, text, [{ op: 'renameResource', from: 'ApiRole', to: 'FnRole' }]);
    expect(out).toContain('Role: !GetAtt [ FnRole, Arn ]');
    expect(out).not.toMatch(/\bApiRole\b/);
  });

  it('rewrites long-form intrinsics in JSON', () => {
    const text = fixture('api.json');
    const out = apply(cfnJson, text, [
      { op: 'renameResource', from: 'ItemsTable', to: 'RecordsTable' },
    ]);
    const parsed = JSON.parse(out);
    expect(parsed.Resources.RecordsTable).toBeDefined();
    expect(parsed.Resources.ApiFunction.DependsOn).toEqual(['RecordsTable']);
    const vars = parsed.Resources.ApiFunction.Properties.Environment.Variables;
    expect(vars.TABLE_NAME).toEqual({ Ref: 'RecordsTable' });
    expect(vars.TABLE_ARN).toEqual({ 'Fn::GetAtt': ['RecordsTable', 'Arn'] });
    expect(vars.LABEL).toEqual({ 'Fn::Sub': 'table-${RecordsTable}' });
    expect(out).not.toMatch(/ItemsTable/);
  });
});

describe('structural ops', () => {
  it('adds and deletes a resource in YAML', () => {
    const text = fixture('vpc.yaml');
    const added = apply(cfnYaml, text, [
      { op: 'addResource', id: 'Logs', rawType: 'AWS::Logs::LogGroup', props: { RetentionInDays: 14 } },
    ]);
    expect(cfnYaml.parse(added).model.nodes.map((n) => n.id)).toContain('Logs');

    const removed = apply(cfnYaml, added, [{ op: 'deleteResource', id: 'Logs' }]);
    expect(cfnYaml.parse(removed).model.nodes.map((n) => n.id)).not.toContain('Logs');
  });

  it('adds a reference as a !Ref tag in YAML', () => {
    const text = fixture('serverless-api.yaml');
    const out = apply(cfnYaml, text, [
      { op: 'addRef', fromId: 'ApiFunction', toId: 'WorkQueue', path: ['DeadLetterConfig', 'TargetArn'] },
    ]);
    expect(out).toContain('TargetArn: !Ref WorkQueue');
  });

  it('round-trips layout metadata', () => {
    const text = fixture('vpc.yaml');
    const out = apply(cfnYaml, text, [
      { op: 'setLayout', positions: { AppVpc: { x: 10.4, y: 20.6 } } },
    ]);
    expect(cfnYaml.parse(out).model.layout).toEqual({ AppVpc: { x: 10, y: 21 } });

    const cleared = apply(cfnYaml, out, [{ op: 'setLayout', positions: {} }]);
    expect(cfnYaml.parse(cleared).model.layout).toEqual({});
  });
});

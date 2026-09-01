import { describe, expect, it } from 'vitest';

import { terraform } from '../src/dialects';
import type { ModelOp } from '../src/model/types';
import { changedLines, fixture } from './helpers';

const TEXT = fixture('app.tf');
const model = () => terraform.parse(TEXT).model;
const apply = (text: string, ops: ModelOp[]) =>
  terraform.applyOps(text, terraform.parse(text).doc, ops);

describe('parsing', () => {
  it('finds resources and names them by address', () => {
    const ids = model().nodes.map((n) => n.id);
    expect(ids).toEqual([
      'aws_vpc.main',
      'aws_subnet.private',
      'aws_dynamodb_table.items',
      'aws_iam_role.exec',
      'aws_lambda_function.api',
    ]);
  });

  it('maps Terraform types onto the shared registry', () => {
    const byId = Object.fromEntries(model().nodes.map((n) => [n.id, n]));
    expect(byId['aws_lambda_function.api'].canonicalType).toBe('lambda.function');
    expect(byId['aws_dynamodb_table.items'].canonicalType).toBe('dynamodb.table');
    expect(byId['aws_lambda_function.api'].label).toBe('api');
  });

  it('reads nested blocks and typed scalars', () => {
    const fn = model().nodes.find((n) => n.id === 'aws_lambda_function.api')!;
    expect(fn.props.memory_size).toBe(256);
    expect(fn.props.runtime).toBe('nodejs20.x');
    const vpcConfig = fn.props.vpc_config as Record<string, unknown>;
    expect(vpcConfig.subnet_ids).toEqual([{ 'Tf::Ref': 'aws_subnet.private.id' }]);
  });

  it('does not treat var/local references as dangling', () => {
    expect(model().diagnostics).toEqual([]);
  });

  it('derives edges from references, interpolation and depends_on', () => {
    const edges = new Set(model().edges.map((e) => `${e.from}->${e.to}:${e.kind}`));
    expect(edges).toContain('aws_lambda_function.api->aws_iam_role.exec:getatt');
    expect(edges).toContain('aws_lambda_function.api->aws_dynamodb_table.items:getatt');
    expect(edges).toContain('aws_lambda_function.api->aws_iam_role.exec:depends');
  });

  it('nests resources by containment', () => {
    const byId = Object.fromEntries(model().nodes.map((n) => [n.id, n]));
    expect(byId['aws_subnet.private'].parentId).toBe('aws_vpc.main');
    expect(byId['aws_lambda_function.api'].parentId).toBe('aws_subnet.private');
  });
});

describe('write-back', () => {
  it('is byte-identical for no ops', () => {
    expect(apply(TEXT, [])).toBe(TEXT);
  });

  it('changes one attribute and nothing else — comments included', () => {
    const out = apply(TEXT, [
      { op: 'setProp', id: 'aws_lambda_function.api', path: ['memory_size'], value: 1024 },
    ]);
    expect(changedLines(TEXT, out)).toEqual([
      '  memory_size   = 256 =>   memory_size   = 1024',
    ]);
    expect(out).toContain('# The network the whole stack lives in.');
    expect(out).toContain('# nested inside the VPC');
  });

  it('edits a value inside a nested block', () => {
    const out = apply(TEXT, [
      {
        op: 'setProp',
        id: 'aws_lambda_function.api',
        path: ['environment', 'variables', 'TABLE_NAME'],
        value: 'literal-name',
      },
    ]);
    expect(changedLines(TEXT, out)).toEqual([
      '      TABLE_NAME = aws_dynamodb_table.items.name =>       TABLE_NAME = "literal-name"',
    ]);
  });

  it('appends an attribute that does not exist yet', () => {
    const out = apply(TEXT, [
      { op: 'setProp', id: 'aws_vpc.main', path: ['enable_dns_support'], value: true },
    ]);
    expect(out).toContain('enable_dns_support = true');
    expect(terraform.parse(out).model.nodes.length).toBe(5);
    expect(out).toContain('# The network the whole stack lives in.');
  });

  it('deletes an attribute', () => {
    const out = apply(TEXT, [
      { op: 'deleteProp', id: 'aws_lambda_function.api', path: ['memory_size'] },
    ]);
    expect(out).not.toContain('memory_size');
    expect(out).toContain('runtime       = "nodejs20.x"');
  });

  it('renames a resource and every reference to it', () => {
    const out = apply(TEXT, [
      { op: 'renameResource', from: 'aws_dynamodb_table.items', to: 'aws_dynamodb_table.records' },
    ]);
    expect(out).toContain('resource "aws_dynamodb_table" "records"');
    expect(out).toContain('TABLE_NAME = aws_dynamodb_table.records.name');
    expect(out).not.toMatch(/aws_dynamodb_table\.items/);
    expect(out).toContain('# The network the whole stack lives in.');
    expect(terraform.parse(out).model.nodes.map((n) => n.id)).toContain(
      'aws_dynamodb_table.records',
    );
  });

  it('adds and deletes a resource', () => {
    const added = apply(TEXT, [
      {
        op: 'addResource',
        id: 'aws_sqs_queue.work',
        rawType: 'aws_sqs_queue',
        props: { name: 'work', visibility_timeout_seconds: 60 },
      },
    ]);
    const addedModel = terraform.parse(added).model;
    expect(addedModel.nodes.map((n) => n.id)).toContain('aws_sqs_queue.work');
    expect(addedModel.nodes.find((n) => n.id === 'aws_sqs_queue.work')!.props.visibility_timeout_seconds).toBe(60);

    const removed = apply(added, [{ op: 'deleteResource', id: 'aws_sqs_queue.work' }]);
    expect(terraform.parse(removed).model.nodes.map((n) => n.id)).not.toContain('aws_sqs_queue.work');
    expect(terraform.parse(removed).model.nodes.length).toBe(5);
  });

  it('adds a reference as a bare address', () => {
    const out = apply(TEXT, [
      {
        op: 'addRef',
        fromId: 'aws_lambda_function.api',
        toId: 'aws_vpc.main',
        path: ['some_vpc_id'],
      },
    ]);
    expect(out).toContain('some_vpc_id = aws_vpc.main.id');
    expect(
      terraform.parse(out).model.edges.some(
        (e) => e.from === 'aws_lambda_function.api' && e.to === 'aws_vpc.main',
      ),
    ).toBe(true);
  });

  it('leaves the file alone for a layout op, which it cannot store', () => {
    expect(apply(TEXT, [{ op: 'setLayout', positions: { 'aws_vpc.main': { x: 1, y: 2 } } }])).toBe(
      TEXT,
    );
  });
});

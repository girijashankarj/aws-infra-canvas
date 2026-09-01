import { beforeAll, describe, expect, it } from 'vitest';

import { cdkTypeScript } from '../src/dialects';
import { fixture } from './helpers';

const TEXT = fixture('stack.ts');

beforeAll(async () => {
  await cdkTypeScript.prepare!();
});

describe('CDK TypeScript import', () => {
  it('is detected ahead of the other dialects', () => {
    expect(cdkTypeScript.detect(TEXT, 'stack.ts')).toBeGreaterThan(0.8);
  });

  it('names constructs by their construct id', () => {
    const ids = cdkTypeScript.parse(TEXT).model.nodes.map((n) => n.id);
    expect(ids).toEqual(['Assets', 'ItemsTable', 'WorkQueue', 'ApiFunction']);
  });

  it('maps constructs onto the shared registry', () => {
    const byId = Object.fromEntries(cdkTypeScript.parse(TEXT).model.nodes.map((n) => [n.id, n]));
    expect(byId.ItemsTable.canonicalType).toBe('dynamodb.table');
    expect(byId.ApiFunction.canonicalType).toBe('lambda.function');
    expect(byId.Assets.canonicalType).toBe('s3.bucket');
    expect(byId.ApiFunction.props.memorySize).toBe(512);
    expect(byId.Assets.props.versioned).toBe(true);
  });

  it('marks every node read-only', () => {
    expect(cdkTypeScript.parse(TEXT).model.nodes.every((n) => n.readOnly)).toBe(true);
    expect(cdkTypeScript.canWriteBack).toBe(false);
  });

  it('derives edges from props and from grant calls', () => {
    const edges = new Set(
      cdkTypeScript.parse(TEXT).model.edges.map((e) => `${e.from}->${e.to}`),
    );
    // Referenced through `environment`.
    expect(edges).toContain('ApiFunction->ItemsTable');
    expect(edges).toContain('ApiFunction->WorkQueue');
    // Referenced only through `assets.grantRead(api)`.
    expect(edges).toContain('ApiFunction->Assets');
  });

  it('labels the grant relationships with the method that created them', () => {
    const grant = cdkTypeScript
      .parse(TEXT)
      .model.edges.find((e) => e.from === 'ApiFunction' && e.to === 'Assets');
    expect(grant?.label).toBe('grantRead');
  });

  it('never modifies the source', () => {
    const { doc } = cdkTypeScript.parse(TEXT);
    expect(
      cdkTypeScript.applyOps(TEXT, doc, [
        { op: 'setProp', id: 'ApiFunction', path: ['memorySize'], value: 1024 },
        { op: 'deleteResource', id: 'ItemsTable' },
      ]),
    ).toBe(TEXT);
  });
});

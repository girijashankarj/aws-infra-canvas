/**
 * Reading properties across dialects.
 *
 * The same architectural fact is spelled differently in each format —
 * `BackupRetentionPeriod`, `backup_retention_period`, `backupRetention`. Rules
 * declare all three spellings and this module picks the one that matches the
 * document being reviewed, so a rule is written once.
 */

import type { DialectId, Model, PropPath, ResourceNode } from '../model/types';

export type Flavor = 'cfn' | 'tf' | 'cdk';

/** Property paths per dialect flavor. */
export type PropSpec = Partial<Record<Flavor, PropPath[]>>;

export const flavorOf = (dialect: DialectId): Flavor =>
  dialect === 'tf' ? 'tf' : dialect === 'cdk-ts' ? 'cdk' : 'cfn';

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function at(value: unknown, path: PropPath): unknown {
  let cur = value;
  for (const seg of path) {
    if (cur == null) return undefined;
    if (typeof seg === 'number') {
      if (!Array.isArray(cur)) return undefined;
      cur = cur[seg];
    } else {
      if (!isPlainObject(cur)) return undefined;
      cur = cur[seg];
    }
  }
  return cur;
}

/** First defined value among the paths declared for this document's dialect. */
export function read(model: Model, node: ResourceNode, spec: PropSpec): unknown {
  const paths = spec[flavorOf(model.dialect)];
  if (!paths) return undefined;
  for (const path of paths) {
    const value = at(node.props, path);
    if (value !== undefined) return value;
  }
  return undefined;
}

/** True when the dialect has no declared path — the rule cannot judge it. */
export const isReadable = (model: Model, spec: PropSpec): boolean =>
  spec[flavorOf(model.dialect)] !== undefined;

/** A reference or an unresolved expression, rather than a literal value. */
export function isExpression(value: unknown): boolean {
  if (!isPlainObject(value)) return false;
  const keys = Object.keys(value);
  if (keys.length !== 1) return false;
  const key = keys[0];
  return (
    key === 'Ref' ||
    key === 'Condition' ||
    key.startsWith('Fn::') ||
    key.startsWith('Tf::') ||
    key.startsWith('Cdk::')
  );
}

/** Interprets CloudFormation's string-or-boolean truthiness. */
export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (/^true$/i.test(value)) return true;
    if (/^false$/i.test(value)) return false;
  }
  return undefined;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
    return Number(value);
  }
  return undefined;
}

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (isPlainObject(value) && typeof value['Tf::Interp'] === 'string') {
    return value['Tf::Interp'] as string;
  }
  return undefined;
}

/** Every string appearing anywhere inside a value. */
export function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (isPlainObject(value)) Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

/** Walks every leaf, yielding its path — used by rules that scan policies. */
export function* walk(value: unknown, path: PropPath = []): Generator<{ path: PropPath; value: unknown }> {
  yield { path, value };
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) yield* walk(value[i], [...path, i]);
  } else if (isPlainObject(value)) {
    for (const [k, v] of Object.entries(value)) yield* walk(v, [...path, k]);
  }
}

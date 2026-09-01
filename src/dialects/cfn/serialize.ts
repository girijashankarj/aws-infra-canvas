/**
 * Writes diagram edits back into CloudFormation source.
 *
 * Two techniques are used, in order of preference:
 *
 *  1. **Text splicing.** When an edit maps to a known character range (changing
 *     a scalar's value, renaming a logical ID), we replace exactly those bytes.
 *     Everything else in the file — comments, spacing, key order, anchors — is
 *     untouched because it is never re-serialized.
 *  2. **CST mutation.** Structural edits (adding or deleting a resource,
 *     creating a nested property) go through the document model and are
 *     re-stringified. Comment *placement* survives; only whitespace directly
 *     before a trailing comment may normalize.
 *
 * `applyOps(text, doc, [])` always returns `text` unchanged.
 */

import { Scalar, isMap, isPair, isScalar, isSeq, parseDocument, visit, type Document } from 'yaml';
import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
  type Node as JsonNode,
  type FormattingOptions,
} from 'jsonc-parser';

import type { ModelOp, XY } from '../../model/types';
import { cfnCustomTags, LONG_FORM_REF_KEYS } from './intrinsics';
import { LAYOUT_KEY } from './parse';

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

/** Applies non-overlapping edits right-to-left so earlier offsets stay valid. */
function applyTextEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Infinity;
  for (const e of sorted) {
    if (e.end > lastStart) continue; // defensive: drop overlaps
    out = out.slice(0, e.start) + e.text + out.slice(e.end);
    lastStart = e.start;
  }
  return out;
}

const roundPositions = (positions: Record<string, XY>): Record<string, XY> =>
  Object.fromEntries(
    Object.entries(positions).map(([id, p]) => [id, { x: Math.round(p.x), y: Math.round(p.y) }]),
  );

// ── YAML ────────────────────────────────────────────────────────────────────

const reparse = (text: string): Document.Parsed => parseDocument(text, { customTags: cfnCustomTags });

export function applyCfnYamlOps(text: string, _doc: unknown, ops: ModelOp[]): string {
  let out = text;
  // Ops are applied one at a time against freshly parsed state. Batches from the
  // UI are small, and this keeps every op's offsets trivially correct.
  for (const op of ops) out = applyYamlOp(out, op);
  return out;
}

function applyYamlOp(text: string, op: ModelOp): string {
  if (op.op === 'renameResource') return renameYaml(text, op.from, op.to);

  const doc = reparse(text);

  switch (op.op) {
    case 'setProp': {
      const path = ['Resources', op.id, 'Properties', ...op.path];
      const spliced = spliceScalar(text, doc, path, op.value);
      if (spliced !== null) return spliced;
      doc.setIn(path, op.value);
      return doc.toString();
    }
    case 'deleteProp':
      doc.deleteIn(['Resources', op.id, 'Properties', ...op.path]);
      return doc.toString();
    case 'addResource': {
      const body: Record<string, unknown> = { Type: op.rawType };
      if (Object.keys(op.props).length > 0) body.Properties = op.props;
      doc.setIn(['Resources', op.id], body);
      return doc.toString();
    }
    case 'deleteResource':
      doc.deleteIn(['Resources', op.id]);
      return doc.toString();
    case 'addRef': {
      const ref = new Scalar(op.toId);
      ref.tag = '!Ref';
      doc.setIn(['Resources', op.fromId, 'Properties', ...op.path], ref);
      return doc.toString();
    }
    case 'setLayout': {
      const positions = roundPositions(op.positions);
      if (Object.keys(positions).length === 0) {
        doc.deleteIn(['Metadata', LAYOUT_KEY]);
      } else {
        doc.setIn(['Metadata', LAYOUT_KEY], positions);
      }
      return doc.toString();
    }
    default:
      return text;
  }
}

/**
 * Fast path for the most common edit: overwriting an existing scalar with
 * another primitive. Replaces just that scalar's characters, so the rest of the
 * file is byte-identical.
 */
function spliceScalar(
  text: string,
  doc: Document.Parsed,
  path: (string | number)[],
  value: unknown,
): string | null {
  if (value !== null && typeof value === 'object') return null;
  const node = doc.getIn(path, true);
  if (!isScalar(node) || !node.range) return null;
  if (node.tag) return null; // replacing an intrinsic needs the structural path

  const [start, end] = node.range;
  const raw = text.slice(start, end);
  const rendered = renderYamlScalar(value, raw);
  if (rendered === null) return null;
  return applyTextEdits(text, [{ start, end, text: rendered }]);
}

/**
 * Renders a primitive as YAML, keeping the original quoting style when the new
 * value is a string that does not require different quoting.
 */
function renderYamlScalar(value: unknown, raw: string): string | null {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') {
    if (!Number.isFinite(value as number) && typeof value === 'number') return null;
    return String(value);
  }
  if (typeof value !== 'string') return null;

  const quote = raw.startsWith("'") ? "'" : raw.startsWith('"') ? '"' : '';
  if (quote === "'" && !value.includes('\n')) return `'${value.replace(/'/g, "''")}'`;
  if (quote === '"' && !value.includes('\n')) return JSON.stringify(value);

  // Unquoted originally: only stay unquoted if the new value is plainly safe.
  if (/^[A-Za-z0-9_][A-Za-z0-9 _./:+@-]*$/.test(value) && !/^(true|false|null|yes|no|on|off|~)$/i.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

/** Rewrites a logical ID and every reference to it, byte-exactly. */
function renameYaml(text: string, from: string, to: string): string {
  const doc = reparse(text);
  const edits: TextEdit[] = [];

  const range = (n: unknown): [number, number] | null => {
    const r = (n as { range?: [number, number, number] })?.range;
    return r ? [r[0], r[1]] : null;
  };

  const replaceIdScalar = (node: unknown) => {
    if (!isScalar(node) || node.value !== from) return;
    const r = range(node);
    if (r) edits.push({ start: r[0], end: r[1], text: quoteLike(text.slice(r[0], r[1]), to) });
  };

  const replaceGetAttScalar = (node: unknown) => {
    if (!isScalar(node) || typeof node.value !== 'string') return;
    if (node.value !== from && !node.value.startsWith(`${from}.`)) return;
    const r = range(node);
    if (!r) return;
    const next = to + node.value.slice(from.length);
    edits.push({ start: r[0], end: r[1], text: quoteLike(text.slice(r[0], r[1]), next) });
  };

  const replaceSubScalar = (node: unknown) => {
    if (!isScalar(node) || typeof node.value !== 'string') return;
    const r = range(node);
    if (!r) return;
    const raw = text.slice(r[0], r[1]);
    const next = raw.replace(
      new RegExp(`\\$\\{\\s*${escapeRe(from)}(\\s*[.}])`, 'g'),
      (_m, tail: string) => `\${${to}${tail}`,
    );
    if (next !== raw) edits.push({ start: r[0], end: r[1], text: next });
  };

  /** Handles a reference value regardless of which intrinsic produced it. */
  const handleRefValue = (kind: 'Ref' | 'GetAtt' | 'Sub' | 'DependsOn', value: unknown) => {
    if (kind === 'Ref' || kind === 'DependsOn') {
      if (isSeq(value)) value.items.forEach(replaceIdScalar);
      else replaceIdScalar(value);
    } else if (kind === 'GetAtt') {
      if (isSeq(value)) replaceIdScalar(value.items[0]);
      else replaceGetAttScalar(value);
    } else {
      if (isSeq(value)) replaceSubScalar(value.items[0]);
      else replaceSubScalar(value);
    }
  };

  // Shorthand tags: !Ref / !GetAtt / !Sub on scalars and sequences.
  visit(doc, {
    Scalar(_key, node) {
      if (node.tag === '!Ref') replaceIdScalar(node);
      else if (node.tag === '!GetAtt') replaceGetAttScalar(node);
      else if (node.tag === '!Sub') replaceSubScalar(node);
    },
    Seq(_key, node) {
      if (node.tag === '!GetAtt') replaceIdScalar(node.items[0]);
      else if (node.tag === '!Sub') replaceSubScalar(node.items[0]);
    },
    Pair(_key, pair) {
      if (!isScalar(pair.key)) return;
      const k = String(pair.key.value);
      const kind = LONG_FORM_REF_KEYS[k];
      if (kind) handleRefValue(kind, pair.value);
    },
  });

  // The declaration itself.
  const resources = doc.getIn(['Resources'], true);
  if (isMap(resources)) {
    for (const pair of resources.items) {
      if (isPair(pair) && isScalar(pair.key) && pair.key.value === from) replaceIdScalar(pair.key);
    }
  }

  return applyTextEdits(text, dedupe(edits));
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Preserves the original scalar's quoting when substituting a new identifier. */
function quoteLike(raw: string, value: string): string {
  if (raw.startsWith("'")) return `'${value.replace(/'/g, "''")}'`;
  if (raw.startsWith('"')) return JSON.stringify(value);
  return value;
}

function dedupe(edits: TextEdit[]): TextEdit[] {
  const seen = new Set<string>();
  return edits.filter((e) => {
    const key = `${e.start}:${e.end}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ── JSON ────────────────────────────────────────────────────────────────────

function detectFormatting(text: string): FormattingOptions {
  const match = text.match(/\n([ \t]+)\S/);
  const indent = match?.[1] ?? '  ';
  return {
    tabSize: indent.startsWith('\t') ? 1 : indent.length,
    insertSpaces: !indent.startsWith('\t'),
    eol: text.includes('\r\n') ? '\r\n' : '\n',
  };
}

export function applyCfnJsonOps(text: string, _doc: unknown, ops: ModelOp[]): string {
  let out = text;
  for (const op of ops) out = applyJsonOp(out, op);
  return out;
}

function applyJsonOp(text: string, op: ModelOp): string {
  if (op.op === 'renameResource') return renameJson(text, op.from, op.to);

  const fmt = detectFormatting(text);
  const edit = (path: (string | number)[], value: unknown) =>
    applyEdits(text, modify(text, path, value, { formattingOptions: fmt }));

  switch (op.op) {
    case 'setProp':
      return edit(['Resources', op.id, 'Properties', ...op.path], op.value);
    case 'deleteProp':
      return edit(['Resources', op.id, 'Properties', ...op.path], undefined);
    case 'addResource': {
      const body: Record<string, unknown> = { Type: op.rawType };
      if (Object.keys(op.props).length > 0) body.Properties = op.props;
      return edit(['Resources', op.id], body);
    }
    case 'deleteResource':
      return edit(['Resources', op.id], undefined);
    case 'addRef':
      return edit(['Resources', op.fromId, 'Properties', ...op.path], { Ref: op.toId });
    case 'setLayout': {
      const positions = roundPositions(op.positions);
      return edit(
        ['Metadata', LAYOUT_KEY],
        Object.keys(positions).length === 0 ? undefined : positions,
      );
    }
    default:
      return text;
  }
}

function renameJson(text: string, from: string, to: string): string {
  const root = parseTree(text, [], { allowTrailingComma: true });
  if (!root) return text;
  const edits: TextEdit[] = [];

  const replaceString = (node: JsonNode | undefined, next: string) => {
    if (!node || node.type !== 'string') return;
    edits.push({ start: node.offset, end: node.offset + node.length, text: JSON.stringify(next) });
  };

  const walk = (node: JsonNode) => {
    if (node.type === 'object') {
      for (const prop of node.children ?? []) {
        const [keyNode, valueNode] = prop.children ?? [];
        if (!keyNode || !valueNode) continue;
        const kind = LONG_FORM_REF_KEYS[String(keyNode.value)];

        if (kind === 'Ref' || kind === 'DependsOn') {
          if (valueNode.type === 'string' && valueNode.value === from) replaceString(valueNode, to);
          else if (valueNode.type === 'array') {
            for (const item of valueNode.children ?? []) {
              if (item.type === 'string' && item.value === from) replaceString(item, to);
            }
          }
        } else if (kind === 'GetAtt') {
          if (valueNode.type === 'string' && typeof valueNode.value === 'string') {
            const v = valueNode.value as string;
            if (v === from || v.startsWith(`${from}.`)) replaceString(valueNode, to + v.slice(from.length));
          } else if (valueNode.type === 'array') {
            const first = valueNode.children?.[0];
            if (first?.type === 'string' && first.value === from) replaceString(first, to);
          }
        } else if (kind === 'Sub') {
          const target = valueNode.type === 'array' ? valueNode.children?.[0] : valueNode;
          if (target?.type === 'string' && typeof target.value === 'string') {
            const next = (target.value as string).replace(
              new RegExp(`\\$\\{\\s*${escapeRe(from)}(\\s*[.}])`, 'g'),
              (_m, tail: string) => `\${${to}${tail}`,
            );
            if (next !== target.value) replaceString(target, next);
          }
        }
        walk(valueNode);
      }
      return;
    }
    for (const child of node.children ?? []) walk(child);
  };

  walk(root);

  const resources = findNodeAtLocation(root, ['Resources']);
  if (resources?.type === 'object') {
    for (const prop of resources.children ?? []) {
      const keyNode = prop.children?.[0];
      if (keyNode?.type === 'string' && keyNode.value === from) replaceString(keyNode, to);
    }
  }

  return applyTextEdits(text, dedupe(edits));
}

export { getNodeValue };

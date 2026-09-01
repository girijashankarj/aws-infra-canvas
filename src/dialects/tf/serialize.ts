/**
 * Writes diagram edits back into Terraform source.
 *
 * The parser records a range for every attribute, so most edits are the same
 * single-value splice used for CloudFormation: changing `memory_size` rewrites
 * exactly those characters and leaves every comment in the file — including
 * comments inside the same block — untouched.
 *
 * Only two operations regenerate text: adding an attribute that does not exist
 * yet (a new line is inserted at the end of the block) and adding a resource
 * (a new block is appended).
 */

import type { ModelOp, PropPath } from '../../model/types';
import { parseHcl, TF_EXPR, TF_INTERP, TF_REF, type HclAttribute, type HclBlock } from './hcl';

interface TextEdit {
  start: number;
  end: number;
  text: string;
}

function applyTextEdits(text: string, edits: TextEdit[]): string {
  const sorted = [...edits].sort((a, b) => b.start - a.start);
  let out = text;
  let lastStart = Infinity;
  for (const edit of sorted) {
    if (edit.end > lastStart) continue;
    out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
    lastStart = edit.start;
  }
  return out;
}

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Renders a model value as an HCL expression. */
export function renderHcl(value: unknown, indent = ''): string {
  if (value === null) return 'null';
  if (typeof value === 'boolean' || typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const inner = value.map((v) => renderHcl(v, `${indent}  `));
    const oneLine = `[${inner.join(', ')}]`;
    if (oneLine.length <= 72 && !oneLine.includes('\n')) return oneLine;
    return `[\n${inner.map((v) => `${indent}  ${v}`).join(',\n')},\n${indent}]`;
  }

  if (isPlainObject(value)) {
    // Expression markers render as the raw expression they came from.
    if (typeof value[TF_REF] === 'string') return value[TF_REF] as string;
    if (typeof value[TF_EXPR] === 'string') return value[TF_EXPR] as string;
    if (typeof value[TF_INTERP] === 'string') return `"${value[TF_INTERP] as string}"`;

    const entries = Object.entries(value);
    if (entries.length === 0) return '{}';
    const lines = entries.map(
      ([k, v]) => `${indent}  ${quoteKeyIfNeeded(k)} = ${renderHcl(v, `${indent}  `)}`,
    );
    return `{\n${lines.join('\n')}\n${indent}}`;
  }

  return 'null';
}

const BARE_KEY = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const quoteKeyIfNeeded = (key: string): string => (BARE_KEY.test(key) ? key : JSON.stringify(key));

const samePath = (a: PropPath, b: PropPath): boolean =>
  a.length === b.length && a.every((seg, i) => seg === b[i]);

function findBlock(blocks: HclBlock[], id: string): HclBlock | undefined {
  return blocks.find((block) => {
    if (block.type === 'resource' && block.labels.length >= 2) {
      return `${block.labels[0]}.${block.labels[1]}` === id;
    }
    if (block.type === 'data' && block.labels.length >= 2) {
      return `data.${block.labels[0]}.${block.labels[1]}` === id;
    }
    return false;
  });
}

const findAttribute = (block: HclBlock, path: PropPath): HclAttribute | undefined =>
  block.attributes.find((attr) => samePath(attr.path, path));

/** The indentation used by the statements inside a block. */
function bodyIndent(text: string, block: HclBlock): string {
  const first = block.attributes[0];
  if (first) {
    const lineStart = text.lastIndexOf('\n', first.statement.start - 1) + 1;
    const prefix = text.slice(lineStart, first.statement.start);
    if (/^[ \t]*$/.test(prefix)) return prefix;
  }
  return '  ';
}

/** Removes an attribute's whole line, including its indentation and newline. */
function statementLineRange(text: string, attr: HclAttribute): { start: number; end: number } {
  const start = text.lastIndexOf('\n', attr.statement.start - 1) + 1;
  let end = attr.statement.end;
  while (end < text.length && text[end] !== '\n') end++;
  if (end < text.length) end++;
  return { start, end };
}

export function applyTerraformOps(text: string, _doc: unknown, ops: ModelOp[]): string {
  let out = text;
  for (const op of ops) out = applyOne(out, op);
  return out;
}

function applyOne(text: string, op: ModelOp): string {
  // Terraform has no inert place to record an arrangement, so positions stay
  // in the session rather than being written into the configuration.
  if (op.op === 'setLayout') return text;

  const file = parseHcl(text);

  if (op.op === 'renameResource') return renameTerraform(text, file.blocks, file.references, op.from, op.to);

  if (op.op === 'addResource') {
    const [type, name] = splitId(op.id);
    const body = Object.entries(op.props)
      .map(([k, v]) => `  ${quoteKeyIfNeeded(k)} = ${renderHcl(v, '  ')}`)
      .join('\n');
    const block = `resource "${op.rawType || type}" "${name}" {\n${body}${body ? '\n' : ''}}\n`;
    const separator = text.length === 0 || text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
    return `${text}${separator}${block}`;
  }

  const targetId = op.op === 'addRef' ? op.fromId : op.id;
  const block = findBlock(file.blocks, targetId);
  if (!block) return text;

  switch (op.op) {
    case 'deleteResource': {
      let start = text.lastIndexOf('\n', block.range.start - 1) + 1;
      let end = block.range.end;
      while (end < text.length && text[end] !== '\n') end++;
      if (end < text.length) end++;
      // Collapse the blank line the block leaves behind.
      while (end < text.length && /^[ \t]*\n/.test(text.slice(end, text.indexOf('\n', end) + 1 || undefined))) {
        const lineEnd = text.indexOf('\n', end);
        if (lineEnd === -1) break;
        end = lineEnd + 1;
        break;
      }
      if (start > 0 && text.slice(start, end).trim() === '') start = block.range.start;
      return applyTextEdits(text, [{ start, end, text: '' }]);
    }

    case 'deleteProp': {
      const attr = findAttribute(block, op.path);
      if (!attr) return text;
      const line = statementLineRange(text, attr);
      return applyTextEdits(text, [{ ...line, text: '' }]);
    }

    case 'setProp':
      return writeAttribute(text, block, op.path, op.value);

    case 'addRef':
      // A reference is written as the bare address of the target's `id`.
      return writeAttribute(text, block, op.path, { [TF_REF]: `${op.toId}.id` });

    default:
      return text;
  }
}

/** Replaces an attribute's value in place, or appends it if it is not there. */
function writeAttribute(text: string, block: HclBlock, path: PropPath, value: unknown): string {
  const attr = findAttribute(block, path);
  const indent = bodyIndent(text, block);

  if (attr) {
    return applyTextEdits(text, [
      { start: attr.value.start, end: attr.value.end, text: renderHcl(value, indent) },
    ]);
  }

  // Nested paths need their parent to exist; without it, write the whole
  // structure as a single top-level attribute.
  const [head, ...rest] = path;
  let literal: unknown = value;
  for (let i = rest.length - 1; i >= 0; i--) {
    const seg = rest[i];
    literal = typeof seg === 'number' ? [literal] : { [seg]: literal };
  }

  const parent = rest.length > 0 ? findAttribute(block, [head]) : undefined;
  if (parent && rest.length > 0) {
    // The parent exists but the leaf does not: rewrite the parent as a whole.
    const merged = mergeInto(readParent(text, parent), rest, value);
    return applyTextEdits(text, [
      { start: parent.value.start, end: parent.value.end, text: renderHcl(merged, indent) },
    ]);
  }

  const statement = `${indent}${quoteKeyIfNeeded(String(head))} = ${renderHcl(literal, indent)}`;
  const insertAt = block.body.end;
  const needsNewline = !text.slice(0, insertAt).endsWith('\n');
  return applyTextEdits(text, [
    { start: insertAt, end: insertAt, text: `${needsNewline ? '\n' : ''}${statement}\n` },
  ]);
}

/** Re-reads a parent attribute's current value so a nested write can merge. */
function readParent(text: string, attr: HclAttribute): unknown {
  const snippet = `x = ${text.slice(attr.value.start, attr.value.end)}\n`;
  const parsed = parseHcl(`wrapper {\n${snippet}}\n`);
  return parsed.blocks[0]?.value.x ?? {};
}

function mergeInto(base: unknown, path: PropPath, value: unknown): unknown {
  if (path.length === 0) return value;
  const [head, ...rest] = path;
  if (typeof head === 'number') {
    const list = Array.isArray(base) ? [...base] : [];
    list[head] = mergeInto(list[head], rest, value);
    return list;
  }
  const obj = isPlainObject(base) ? { ...base } : {};
  obj[head] = mergeInto(obj[head], rest, value);
  return obj;
}

/** `aws_lambda_function.api` → `['aws_lambda_function', 'api']`. */
function splitId(id: string): [string, string] {
  const idx = id.indexOf('.');
  return idx === -1 ? [id, id] : [id.slice(0, idx), id.slice(idx + 1)];
}

function renameTerraform(
  text: string,
  blocks: HclBlock[],
  references: { range: { start: number; end: number }; text: string }[],
  from: string,
  to: string,
): string {
  const [, toName] = splitId(to);
  const edits: TextEdit[] = [];

  const block = findBlock(blocks, from);
  if (block) {
    // The name is the last label; data sources and resources both put it there.
    const nameRange = block.labelRanges[block.labelRanges.length - 1];
    if (nameRange) edits.push({ start: nameRange.start, end: nameRange.end, text: toName });
  }

  for (const ref of references) {
    if (ref.text !== from && !ref.text.startsWith(`${from}.`)) continue;
    edits.push({
      start: ref.range.start,
      end: ref.range.end,
      text: to + ref.text.slice(from.length),
    });
  }

  return applyTextEdits(text, edits);
}

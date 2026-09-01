/**
 * A small HCL2 parser covering the subset Terraform configurations actually
 * use: blocks, attributes, objects, lists, strings with interpolation,
 * heredocs, numbers, booleans, and bare expressions.
 *
 * Why hand-written rather than `@cdktf/hcl2json`: that package (a Go binary
 * compiled to WebAssembly) returns positionless JSON. Every edit this app makes
 * is a byte-range splice, so source positions are not optional — without them
 * there is no way to change one attribute and leave the rest of the file alone.
 * Parsing here records a range for every block, attribute and reference, which
 * is what makes the Terraform round trip as surgical as the CloudFormation one.
 */

export interface Range {
  start: number;
  end: number;
}

export interface HclAttribute {
  /** Property path within the block, e.g. `['environment', 'variables', 'X']`. */
  path: (string | number)[];
  key: Range;
  value: Range;
  /** The whole `key = value` statement including its indentation. */
  statement: Range;
}

export interface HclBlock {
  type: string;
  labels: string[];
  labelRanges: Range[];
  /** The whole block, from its type keyword to the closing brace. */
  range: Range;
  /** Between the braces, exclusive. */
  body: Range;
  value: Record<string, unknown>;
  attributes: HclAttribute[];
}

/** A `type.name[.attr]` expression, wherever it appeared. */
export interface HclReference {
  range: Range;
  text: string;
}

export interface HclFile {
  blocks: HclBlock[];
  references: HclReference[];
  errors: { message: string; range: Range }[];
}

/** Marker shapes, so the graph builder can recognize Terraform expressions. */
export const TF_REF = 'Tf::Ref';
export const TF_INTERP = 'Tf::Interp';
export const TF_EXPR = 'Tf::Expr';

const IDENT_START = /[A-Za-z_]/;
const IDENT_CHAR = /[A-Za-z0-9_-]/;
/** `aws_s3_bucket.logs`, `var.stage`, `module.net.vpc_id`. */
const REFERENCE = /\b([A-Za-z_][A-Za-z0-9_]*)\.([A-Za-z_][A-Za-z0-9_-]*)((?:\.[A-Za-z_*][A-Za-z0-9_-]*)*)/g;

export function parseHcl(source: string): HclFile {
  const blocks: HclBlock[] = [];
  const references: HclReference[] = [];
  const errors: HclFile['errors'] = [];
  let i = 0;

  const atEnd = () => i >= source.length;

  function skipTrivia(): void {
    while (i < source.length) {
      const c = source[i];
      if (c === ' ' || c === '\t' || c === '\r' || c === '\n') {
        i++;
      } else if (c === '#' || (c === '/' && source[i + 1] === '/')) {
        while (i < source.length && source[i] !== '\n') i++;
      } else if (c === '/' && source[i + 1] === '*') {
        const close = source.indexOf('*/', i + 2);
        i = close === -1 ? source.length : close + 2;
      } else {
        return;
      }
    }
  }

  /** Skips spaces and comments but stops at a newline, which ends a statement. */
  function skipInlineTrivia(): void {
    while (i < source.length) {
      const c = source[i];
      if (c === ' ' || c === '\t' || c === '\r') i++;
      else if (c === '/' && source[i + 1] === '*') {
        const close = source.indexOf('*/', i + 2);
        i = close === -1 ? source.length : close + 2;
      } else return;
    }
  }

  function readIdent(): string | null {
    if (atEnd() || !IDENT_START.test(source[i])) return null;
    const start = i;
    while (i < source.length && IDENT_CHAR.test(source[i])) i++;
    return source.slice(start, i);
  }

  /** Records every `type.name` reference inside a span of raw source. */
  function collectReferences(start: number, end: number): void {
    const text = source.slice(start, end);
    REFERENCE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = REFERENCE.exec(text)) !== null) {
      references.push({
        range: { start: start + m.index, end: start + m.index + m[0].length },
        text: m[0],
      });
    }
  }

  function readQuotedString(): { value: string; interpolated: boolean; range: Range } {
    const start = i;
    i++; // opening quote
    let out = '';
    let interpolated = false;
    while (i < source.length && source[i] !== '"') {
      if (source[i] === '\\') {
        out += source[i] + (source[i + 1] ?? '');
        i += 2;
        continue;
      }
      if (source[i] === '$' && source[i + 1] === '{') {
        interpolated = true;
        let depth = 0;
        const exprStart = i + 2;
        i += 2;
        while (i < source.length && (depth > 0 || source[i] !== '}')) {
          if (source[i] === '{') depth++;
          else if (source[i] === '}') depth--;
          i++;
        }
        collectReferences(exprStart, i);
        out += source.slice(exprStart - 2, i + 1);
        i++; // closing brace
        continue;
      }
      out += source[i];
      i++;
    }
    i++; // closing quote
    return { value: out, interpolated, range: { start, end: i } };
  }

  function readHeredoc(): { value: string; range: Range } {
    const start = i;
    i += 2; // <<
    if (source[i] === '-') i++;
    const tag = readIdent() ?? '';
    while (i < source.length && source[i] !== '\n') i++;
    i++;
    const bodyStart = i;
    // The terminator is the tag alone on its own (possibly indented) line.
    const terminator = new RegExp(`^[ \\t]*${tag}[ \\t]*$`, 'm');
    const rest = source.slice(bodyStart);
    const match = terminator.exec(rest);
    if (!match) {
      i = source.length;
      return { value: rest, range: { start, end: i } };
    }
    const value = rest.slice(0, match.index);
    i = bodyStart + match.index + match[0].length;
    collectReferences(bodyStart, bodyStart + match.index);
    return { value, range: { start, end: i } };
  }

  /**
   * Reads an unquoted expression — a reference, a function call, a ternary —
   * up to the end of the statement, respecting nesting.
   */
  function readBareExpression(): { raw: string; range: Range } {
    const start = i;
    let depth = 0;
    while (i < source.length) {
      const c = source[i];
      if (c === '(' || c === '[' || c === '{') depth++;
      else if (c === ')' || c === ']' || c === '}') {
        if (depth === 0) break;
        depth--;
      } else if (c === '"') {
        readQuotedString();
        continue;
      } else if (c === '\n' && depth === 0) {
        break;
      } else if (c === ',' && depth === 0) {
        break;
      } else if (c === '#' || (c === '/' && source[i + 1] === '/')) {
        break;
      }
      i++;
    }
    const raw = source.slice(start, i).trim();
    const end = start + raw.length;
    collectReferences(start, end);
    return { raw, range: { start, end } };
  }

  function readList(path: (string | number)[], attrs: HclAttribute[]): { value: unknown[]; range: Range } {
    const start = i;
    i++; // [
    const items: unknown[] = [];
    for (;;) {
      skipTrivia();
      if (atEnd() || source[i] === ']') break;
      const itemStart = i;
      const item = readValue([...path, items.length], attrs);
      items.push(item);
      attrs.push({
        path: [...path, items.length - 1],
        key: { start: itemStart, end: itemStart },
        value: { start: itemStart, end: i },
        statement: { start: itemStart, end: i },
      });
      skipTrivia();
      if (source[i] === ',') i++;
    }
    i++; // ]
    return { value: items, range: { start, end: i } };
  }

  function readObject(path: (string | number)[], attrs: HclAttribute[]): { value: Record<string, unknown>; range: Range } {
    const start = i;
    i++; // {
    const obj = readBody(path, attrs, '}');
    if (source[i] === '}') i++;
    return { value: obj, range: { start, end: i } };
  }

  function readValue(path: (string | number)[], attrs: HclAttribute[]): unknown {
    skipInlineTrivia();
    const c = source[i];

    if (c === '"') {
      const { value, interpolated } = readQuotedString();
      return interpolated ? { [TF_INTERP]: value } : value;
    }
    if (c === '<' && source[i + 1] === '<') {
      return readHeredoc().value;
    }
    if (c === '[') return readList(path, attrs).value;
    if (c === '{') return readObject(path, attrs).value;

    if (/[-\d]/.test(c ?? '')) {
      const start = i;
      if (source[i] === '-') i++;
      while (i < source.length && /[\d._eE+-]/.test(source[i])) i++;
      const raw = source.slice(start, i);
      const n = Number(raw);
      if (Number.isFinite(n)) return n;
      return { [TF_EXPR]: raw };
    }

    const { raw } = readBareExpression();
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    // A lone `type.name[.attr]` is a reference; anything else stays opaque.
    if (/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_*][A-Za-z0-9_-]*)+$/.test(raw)) {
      return { [TF_REF]: raw };
    }
    return { [TF_EXPR]: raw };
  }

  /**
   * Reads attributes and nested blocks until `terminator`. Repeated nested
   * blocks of the same name collapse into a list, matching how Terraform
   * treats `ingress { … } ingress { … }`.
   */
  function readBody(
    path: (string | number)[],
    attrs: HclAttribute[],
    terminator: '}' | null,
  ): Record<string, unknown> {
    const obj: Record<string, unknown> = {};

    for (;;) {
      skipTrivia();
      if (atEnd()) break;
      if (terminator && source[i] === terminator) break;

      const statementStart = i;
      const keyStart = i;

      let key: string | null;
      if (source[i] === '"') {
        const str = readQuotedString();
        key = str.value;
      } else {
        key = readIdent();
      }
      if (key === null) {
        // Unrecognized character: skip it rather than spinning forever.
        i++;
        continue;
      }
      const keyEnd = i;

      skipInlineTrivia();

      if (source[i] === '=') {
        i++;
        const value = readValue([...path, key], attrs);
        const valueEnd = i;
        obj[key] = value;
        attrs.push({
          path: [...path, key],
          key: { start: keyStart, end: keyEnd },
          value: { start: valueStartOf(keyEnd), end: valueEnd },
          statement: { start: statementStart, end: valueEnd },
        });
        skipInlineTrivia();
        if (source[i] === ',') i++;
        continue;
      }

      if (source[i] === '{') {
        const nested = readObject([...path, key], attrs);
        mergeBlock(obj, key, nested.value);
        attrs.push({
          path: [...path, key],
          key: { start: keyStart, end: keyEnd },
          value: nested.range,
          statement: { start: statementStart, end: nested.range.end },
        });
        continue;
      }

      // `key "label" { … }` — a labelled nested block.
      if (source[i] === '"') {
        const label = readQuotedString();
        skipInlineTrivia();
        if (source[i] === '{') {
          const nested = readObject([...path, key, label.value], attrs);
          const container = (obj[key] ??= {}) as Record<string, unknown>;
          container[label.value] = nested.value;
          continue;
        }
      }

      // Anything else on this line is not something we model; skip the line.
      while (i < source.length && source[i] !== '\n') i++;
    }

    return obj;
  }

  /** Start of the value text, skipping the `=` and the spaces around it. */
  function valueStartOf(keyEnd: number): number {
    let j = keyEnd;
    while (j < source.length && /[ \t]/.test(source[j])) j++;
    if (source[j] === '=') j++;
    while (j < source.length && /[ \t]/.test(source[j])) j++;
    return j;
  }

  function mergeBlock(obj: Record<string, unknown>, key: string, value: Record<string, unknown>): void {
    const existing = obj[key];
    if (existing === undefined) {
      obj[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      obj[key] = [existing, value];
    }
  }

  // ── Top level ─────────────────────────────────────────────────────────────
  for (;;) {
    skipTrivia();
    if (atEnd()) break;

    const blockStart = i;
    const type = readIdent();
    if (type === null) {
      i++;
      continue;
    }

    const labels: string[] = [];
    const labelRanges: Range[] = [];
    skipInlineTrivia();
    while (source[i] === '"') {
      const str = readQuotedString();
      labels.push(str.value);
      // Exclude the surrounding quotes so a rename replaces only the name.
      labelRanges.push({ start: str.range.start + 1, end: str.range.end - 1 });
      skipInlineTrivia();
    }

    if (source[i] !== '{') {
      errors.push({
        message: `Expected "{" after ${type}${labels.map((l) => ` "${l}"`).join('')}.`,
        range: { start: blockStart, end: Math.min(i + 1, source.length) },
      });
      while (i < source.length && source[i] !== '\n') i++;
      continue;
    }

    i++; // {
    const bodyStart = i;
    const attributes: HclAttribute[] = [];
    const value = readBody([], attributes, '}');
    const bodyEnd = i;
    if (source[i] === '}') i++;

    blocks.push({
      type,
      labels,
      labelRanges,
      range: { start: blockStart, end: i },
      body: { start: bodyStart, end: bodyEnd },
      value,
      attributes,
    });
  }

  return { blocks, references, errors };
}

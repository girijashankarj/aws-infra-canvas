/**
 * Builds the resource graph from dialect-neutral, long-form resource data.
 *
 * Both CloudFormation dialects and Terraform normalize their references into
 * the same marker shapes before reaching here, so edge derivation is written
 * once.
 */

import type { Diagnostic, Edge, PropPath, ResourceNode, SourceRange, XY } from './types';
import {
  canonicalFromCfn,
  canonicalFromTf,
  lookupCanonical,
  lookupCfn,
  lookupTf,
} from './registry';

export type Flavor = 'cfn' | 'tf' | 'cdk';

/** What a parser hands to the graph builder, before typing and edge analysis. */
export interface RawResource {
  id: string;
  rawType: string;
  props: Record<string, unknown>;
  /** Explicit ordering dependencies (`DependsOn` / `depends_on`). */
  dependsOn?: string[];
  range: SourceRange;
  readOnly?: boolean;
  /** Overrides registry lookup; used by the CDK parser. */
  canonicalType?: string;
  label?: string;
}

interface FoundRef {
  target: string;
  kind: 'ref' | 'getatt';
  path: PropPath;
}

/** CFN pseudo-parameters never name a resource in the template. */
const PSEUDO = /^AWS::/;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `${Foo}` and `${Foo.Arn}` inside an `Fn::Sub` string. */
function scanSubString(str: string, path: PropPath, out: FoundRef[]): void {
  const re = /\$\{([^}!][^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) {
    const body = m[1].trim();
    if (PSEUDO.test(body)) continue;
    const dot = body.indexOf('.');
    if (dot === -1) out.push({ target: body, kind: 'ref', path });
    else out.push({ target: body.slice(0, dot), kind: 'getatt', path });
  }
}

/**
 * Terraform scopes that never name a resource: input variables, locals, and the
 * expression builtins.
 */
const TF_BUILTIN_SCOPES = new Set([
  'var',
  'local',
  'count',
  'each',
  'path',
  'terraform',
  'self',
]);

/** Terraform expression markers: `aws_lambda_function.api.arn`, `data.aws_ami.x.id`. */
function scanTfRef(expr: string, path: PropPath, out: FoundRef[]): void {
  const parts = expr.split('.');
  if (parts.length < 2 || TF_BUILTIN_SCOPES.has(parts[0])) return;
  // Data sources are addressed with three segments, everything else with two.
  const segments = parts[0] === 'data' ? 3 : 2;
  if (parts.length < segments) return;
  out.push({
    target: parts.slice(0, segments).join('.'),
    kind: parts.length > segments ? 'getatt' : 'ref',
    path,
  });
}

/** Pulls `${…}` expressions out of an interpolated Terraform string. */
function scanTfInterpolation(str: string, path: PropPath, out: FoundRef[]): void {
  const re = /\$\{([^}]*)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(str)) !== null) scanTfExpression(m[1], path, out);
}

/** Finds every `a.b[.c]` reference inside an arbitrary Terraform expression. */
function scanTfExpression(expr: string, path: PropPath, out: FoundRef[]): void {
  const re = /\b[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_*][A-Za-z0-9_-]*)+/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) scanTfRef(m[0], path, out);
}

/** Walks a property tree collecting every reference to another resource. */
export function collectRefs(value: unknown, path: PropPath = [], out: FoundRef[] = []): FoundRef[] {
  if (Array.isArray(value)) {
    value.forEach((v, i) => collectRefs(v, [...path, i], out));
    return out;
  }
  if (!isPlainObject(value)) return out;

  const keys = Object.keys(value);
  if (keys.length === 1) {
    const key = keys[0];
    const inner = value[key];

    if (key === 'Ref' && typeof inner === 'string') {
      if (!PSEUDO.test(inner)) out.push({ target: inner, kind: 'ref', path });
      return out;
    }
    if (key === 'Tf::Ref' && typeof inner === 'string') {
      scanTfRef(inner, path, out);
      return out;
    }
    if (key === 'Cdk::Ref' && typeof inner === 'string') {
      // The CDK parser resolves construct variables to node ids before storing.
      out.push({ target: inner, kind: 'ref', path });
      return out;
    }
    if (key === 'Tf::Interp' && typeof inner === 'string') {
      scanTfInterpolation(inner, path, out);
      return out;
    }
    if (key === 'Tf::Expr' && typeof inner === 'string') {
      scanTfExpression(inner, path, out);
      return out;
    }
    if (key === 'Fn::GetAtt') {
      if (typeof inner === 'string') {
        const target = inner.split('.')[0];
        if (!PSEUDO.test(target)) out.push({ target, kind: 'getatt', path });
      } else if (Array.isArray(inner) && typeof inner[0] === 'string') {
        out.push({ target: inner[0], kind: 'getatt', path });
      }
      return out;
    }
    if (key === 'Fn::Sub') {
      if (typeof inner === 'string') {
        scanSubString(inner, path, out);
      } else if (Array.isArray(inner)) {
        if (typeof inner[0] === 'string') scanSubString(inner[0], path, out);
        // The variable map may itself contain Ref/GetAtt.
        collectRefs(inner.slice(1), path, out);
      }
      return out;
    }
  }

  for (const [k, v] of Object.entries(value)) collectRefs(v, [...path, k], out);
  return out;
}

function getAtPath(obj: unknown, path: PropPath): unknown {
  let cur: unknown = obj;
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

/**
 * Resolves the containment parent of a resource: the first reference found at
 * any of the parent property paths declared in the registry.
 */
function resolveParent(
  res: RawResource,
  canonical: string,
  flavor: Flavor,
  known: Set<string>,
): string | undefined {
  const def = lookupCanonical(canonical);
  if (!def) return undefined;
  const paths = (flavor === 'tf' ? def.tfParentProps : def.parentProps) ?? [];
  for (const path of paths) {
    const sub = getAtPath(res.props, path);
    if (sub === undefined) continue;
    const refs = collectRefs(sub);
    const hit = refs.find((r) => known.has(r.target));
    if (hit) return hit.target;
    // A plain string may also name a resource directly (common in Terraform).
    if (typeof sub === 'string' && known.has(sub)) return sub;
  }
  return undefined;
}

function canonicalFor(res: RawResource, flavor: Flavor): string {
  if (res.canonicalType) return res.canonicalType;
  if (flavor === 'tf') return lookupTf(res.rawType)?.canonical ?? canonicalFromTf(res.rawType);
  return lookupCfn(res.rawType)?.canonical ?? canonicalFromCfn(res.rawType);
}

export interface GraphResult {
  nodes: ResourceNode[];
  edges: Edge[];
  /** Problems only visible once the whole graph is known, e.g. dangling refs. */
  diagnostics: Diagnostic[];
}

export interface GraphOptions {
  /**
   * Names that may legitimately be referenced but are not resources —
   * CloudFormation Parameters/Mappings/Conditions, Terraform variables/locals.
   * Without these, every `!Ref SomeParameter` would look like a dangling
   * reference.
   */
  otherNames?: Set<string>;
}

export function buildGraph(
  resources: RawResource[],
  flavor: Flavor,
  options: GraphOptions = {},
): GraphResult {
  const known = new Set(resources.map((r) => r.id));
  const otherNames = options.otherNames ?? new Set<string>();
  const nodes: ResourceNode[] = [];
  const edges: Edge[] = [];
  const diagnostics: Diagnostic[] = [];
  const seenEdge = new Set<string>();

  for (const res of resources) {
    const canonical = canonicalFor(res, flavor);
    nodes.push({
      id: res.id,
      canonicalType: canonical,
      rawType: res.rawType,
      label: res.label ?? res.id,
      props: res.props,
      parentId: resolveParent(res, canonical, flavor, known),
      range: res.range,
      readOnly: res.readOnly ?? false,
    });
  }

  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));

  const push = (from: string, to: string, kind: Edge['kind'], label?: string) => {
    if (from === to || !known.has(to)) return;
    // A containment relationship is drawn by nesting, not by an edge.
    if (parentOf.get(from) === to) return;
    const id = `${from}->${to}:${kind}`;
    if (seenEdge.has(id)) return;
    seenEdge.add(id);
    edges.push({ id, from, to, kind, label });
  };

  const reportDangling = (from: RawResource, target: string, where: string) => {
    if (known.has(target) || otherNames.has(target)) return;
    diagnostics.push({
      severity: 'warning',
      message: `"${from.id}" references "${target}" at ${where}, which is not defined in this file.`,
      range: from.range,
    });
  };

  for (const res of resources) {
    for (const ref of collectRefs(res.props)) {
      const where = ref.path.length ? ref.path.join('.') : 'its properties';
      push(res.id, ref.target, ref.kind, ref.path.join('.') || undefined);
      reportDangling(res, ref.target, where);
    }
    for (const dep of res.dependsOn ?? []) {
      push(res.id, dep, 'depends');
      reportDangling(res, dep, 'DependsOn');
    }
  }

  return { nodes, edges, diagnostics };
}

/** Reads persisted node positions out of a template's metadata block. */
export function readLayout(value: unknown): Record<string, XY> {
  if (!isPlainObject(value)) return {};
  const out: Record<string, XY> = {};
  for (const [id, pos] of Object.entries(value)) {
    if (isPlainObject(pos) && typeof pos.x === 'number' && typeof pos.y === 'number') {
      out[id] = { x: pos.x, y: pos.y };
    }
  }
  return out;
}

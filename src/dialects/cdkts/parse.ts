/**
 * AWS CDK (TypeScript) — import only.
 *
 * A CDK app is a program, not a description: the resources it produces depend
 * on control flow, helper functions, and construct libraries. This parser reads
 * the common, declarative shape — `new lambda.Function(this, 'Id', { … })` —
 * well enough to draw a useful picture, but it deliberately does not attempt to
 * write changes back. Turning a canvas edit into correct TypeScript is a
 * different problem, so these nodes are marked read-only and the UI points at
 * `cdk synth` output for editing.
 *
 * The TypeScript compiler is several megabytes, so it is loaded on demand via
 * the dialect's `prepare` hook rather than bundled into the main chunk.
 */

import type { Diagnostic, Model, ParseResult } from '../../model/types';
import { buildGraph, type RawResource } from '../../model/graph';
import { lookupCdk } from '../../model/registry';

type TS = typeof import('typescript');

let ts: TS | null = null;
let loading: Promise<void> | null = null;

export function prepare(): Promise<void> {
  loading ??= import('typescript').then((mod) => {
    ts = mod.default ?? (mod as unknown as TS);
  });
  return loading;
}

export const isReady = (): boolean => ts !== null;

/** Construct-instantiation call shapes we understand. */
interface Instantiation {
  /** Variable the construct was assigned to, if any. */
  variable?: string;
  /** The construct id string passed as the second argument. */
  constructId?: string;
  namespace?: string;
  className: string;
  props?: import('typescript').ObjectLiteralExpression;
  start: number;
  end: number;
}

export function parseCdkTypeScript(text: string): ParseResult {
  if (!ts) {
    return {
      model: {
        dialect: 'cdk-ts',
        nodes: [],
        edges: [],
        diagnostics: [{ severity: 'info', message: 'Loading the TypeScript parser…' }],
        layout: {},
      },
      doc: null,
    };
  }

  const compiler = ts;
  const source = compiler.createSourceFile(
    'stack.ts',
    text,
    compiler.ScriptTarget.Latest,
    true,
    compiler.ScriptKind.TS,
  );

  const diagnostics: Diagnostic[] = [];
  const instantiations: Instantiation[] = [];
  /**
   * `new` expressions already recorded through their enclosing declaration. The
   * walk still descends into them (their arguments may hold more constructs),
   * so without this they would be counted twice.
   */
  const consumed = new Set<import('typescript').Node>();
  /** Method calls between constructs, e.g. `table.grantReadData(fn)`. */
  const relations: { from: string; to: string; label: string }[] = [];

  const nameOf = (node: import('typescript').Node): string => node.getText(source);

  function readInstantiation(
    node: import('typescript').NewExpression,
    variable: string | undefined,
  ): void {
    let namespace: string | undefined;
    let className: string;

    if (compiler.isPropertyAccessExpression(node.expression)) {
      namespace = nameOf(node.expression.expression).split('.').pop();
      className = node.expression.name.text;
    } else if (compiler.isIdentifier(node.expression)) {
      className = node.expression.text;
    } else {
      return;
    }

    if (consumed.has(node)) return;
    consumed.add(node);

    const args = node.arguments ?? ([] as unknown as import('typescript').NodeArray<import('typescript').Expression>);
    const idArg = args[1];
    const constructId =
      idArg && compiler.isStringLiteralLike(idArg) ? idArg.text : undefined;
    const propsArg = args[2];

    instantiations.push({
      variable,
      constructId,
      namespace,
      className,
      props:
        propsArg && compiler.isObjectLiteralExpression(propsArg) ? propsArg : undefined,
      start: node.getStart(source),
      end: node.getEnd(),
    });
  }

  const visit = (node: import('typescript').Node): void => {
    if (compiler.isVariableDeclaration(node) && node.initializer && compiler.isNewExpression(node.initializer)) {
      readInstantiation(node.initializer, compiler.isIdentifier(node.name) ? node.name.text : undefined);
    } else if (
      compiler.isPropertyDeclaration(node) &&
      node.initializer &&
      compiler.isNewExpression(node.initializer)
    ) {
      readInstantiation(node.initializer, node.name.getText(source));
    } else if (
      compiler.isExpressionStatement(node) &&
      compiler.isBinaryExpression(node.expression) &&
      node.expression.operatorToken.kind === compiler.SyntaxKind.EqualsToken &&
      compiler.isNewExpression(node.expression.right)
    ) {
      // `this.table = new dynamodb.Table(...)`
      const left = node.expression.left;
      const variable = compiler.isPropertyAccessExpression(left) ? left.name.text : nameOf(left);
      readInstantiation(node.expression.right, variable);
    } else if (compiler.isNewExpression(node)) {
      readInstantiation(node, undefined);
    } else if (compiler.isCallExpression(node) && compiler.isPropertyAccessExpression(node.expression)) {
      // `table.grantReadWriteData(apiFn)` and friends.
      const receiver = rootIdentifier(compiler, node.expression.expression);
      const method = node.expression.name.text;
      for (const arg of node.arguments) {
        const target = rootIdentifier(compiler, arg);
        if (receiver && target && receiver !== target) {
          relations.push({ from: target, to: receiver, label: method });
        }
      }
    }
    compiler.forEachChild(node, visit);
  };

  visit(source);

  // Resolve construct variables to node ids so references become edges.
  const idOf = new Map<string, string>();
  const taken = new Set<string>();
  const resolved = instantiations.map((inst) => {
    const base = inst.constructId ?? inst.variable ?? inst.className;
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}${n}`;
    taken.add(id);
    if (inst.variable) idOf.set(inst.variable, id);
    return { inst, id };
  });

  const resources: RawResource[] = [];

  for (const { inst, id } of resolved) {
    const def = lookupCdk(inst.namespace, inst.className);
    if (!def) continue; // Not an AWS construct we know about.

    resources.push({
      id,
      rawType: `${inst.namespace ? `${inst.namespace}.` : ''}${inst.className}`,
      label: id,
      canonicalType: def.canonical,
      props: inst.props ? (readObject(compiler, source, inst.props, idOf) as Record<string, unknown>) : {},
      range: { start: inst.start, end: inst.end },
      readOnly: true,
    });
  }

  const known = new Set(resources.map((r) => r.id));
  const graph = buildGraph(resources, 'cdk', { otherNames: new Set(idOf.keys()) });

  // Method-call relationships (grants, subscriptions, targets) as extra edges.
  for (const relation of relations) {
    const from = idOf.get(relation.from);
    const to = idOf.get(relation.to);
    if (!from || !to || !known.has(from) || !known.has(to)) continue;
    const edgeId = `${from}->${to}:${relation.label}`;
    if (graph.edges.some((e) => e.id === edgeId)) continue;
    graph.edges.push({ id: edgeId, from, to, kind: 'ref', label: relation.label });
  }

  if (resources.length === 0 && instantiations.length > 0) {
    diagnostics.push({
      severity: 'info',
      message:
        'No recognized AWS constructs found. Constructs are matched by class name, so an unusual import alias may hide them.',
    });
  }

  const model: Model = {
    dialect: 'cdk-ts',
    nodes: graph.nodes,
    edges: graph.edges,
    diagnostics: [...diagnostics, ...graph.diagnostics],
    layout: {},
  };

  return { model, doc: source };
}

/** The leading identifier of an expression: `props.table.name` → `props`. */
function rootIdentifier(
  compiler: TS,
  node: import('typescript').Node,
): string | undefined {
  let current = node;
  while (compiler.isPropertyAccessExpression(current)) current = current.expression;
  return compiler.isIdentifier(current) ? current.text : undefined;
}

/** Converts a props object literal into plain values plus reference markers. */
function readObject(
  compiler: TS,
  source: import('typescript').SourceFile,
  node: import('typescript').ObjectLiteralExpression,
  idOf: Map<string, string>,
): unknown {
  const out: Record<string, unknown> = {};
  for (const property of node.properties) {
    if (compiler.isPropertyAssignment(property)) {
      const key = compiler.isIdentifier(property.name)
        ? property.name.text
        : compiler.isStringLiteralLike(property.name)
          ? property.name.text
          : property.name.getText(source);
      out[key] = readExpression(compiler, source, property.initializer, idOf);
    } else if (compiler.isShorthandPropertyAssignment(property)) {
      out[property.name.text] = readExpression(compiler, source, property.name, idOf);
    }
  }
  return out;
}

function readExpression(
  compiler: TS,
  source: import('typescript').SourceFile,
  node: import('typescript').Node,
  idOf: Map<string, string>,
): unknown {
  if (compiler.isStringLiteralLike(node)) return node.text;
  if (compiler.isNumericLiteral(node)) return Number(node.text);
  if (node.kind === compiler.SyntaxKind.TrueKeyword) return true;
  if (node.kind === compiler.SyntaxKind.FalseKeyword) return false;
  if (node.kind === compiler.SyntaxKind.NullKeyword) return null;
  if (compiler.isObjectLiteralExpression(node)) return readObject(compiler, source, node, idOf);
  if (compiler.isArrayLiteralExpression(node)) {
    return node.elements.map((el) => readExpression(compiler, source, el, idOf));
  }

  // An expression rooted at a known construct variable is a reference to it.
  const root = rootIdentifier(compiler, node);
  const target = root ? idOf.get(root) : undefined;
  if (target) return { 'Cdk::Ref': target };

  return { 'Cdk::Expr': node.getText(source) };
}

export function detectCdkTypeScript(text: string, filename?: string): number {
  let score = 0;
  if (/\bfrom\s+['"]aws-cdk-lib/.test(text)) score += 0.6;
  if (/\bnew\s+[a-zA-Z_$][\w$]*\.[A-Z]\w*\s*\(\s*(this|scope)\b/.test(text)) score += 0.3;
  if (/\bextends\s+(cdk\.)?Stack\b/.test(text)) score += 0.2;
  if (/\bimport\s/.test(text) && /\bconst\s|\blet\s/.test(text)) score += 0.05;
  if (filename && /\.(ts|tsx)$/.test(filename)) score += 0.15;
  return Math.min(score, 1);
}

/** CDK is read-only; the op list is accepted and ignored. */
export function applyCdkOps(text: string): string {
  return text;
}

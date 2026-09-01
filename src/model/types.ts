/**
 * Dialect-neutral model of an infrastructure template.
 *
 * Every parser produces a `Model`; every serializer consumes `ModelOp`s against
 * the original source text. The text is always the source of truth — the model
 * is a derived projection used for drawing and for describing edits.
 */

export type DialectId = 'cfn-yaml' | 'cfn-json' | 'tf' | 'cdk-ts';

/** Normalized cross-dialect service identity, e.g. "lambda.function". */
export type CanonicalType = string;

/** Character offsets into the source text. */
export interface SourceRange {
  start: number;
  end: number;
}

export interface ResourceNode {
  /** Logical id (CFN), `type.name` address (TF), or construct id (CDK). */
  id: string;
  canonicalType: CanonicalType;
  /** Dialect-native type string, e.g. "AWS::Lambda::Function". */
  rawType: string;
  /** Display label; usually the id, but TF/CDK may carry a friendlier name. */
  label: string;
  /** Plain JS view of the resource properties, for the inspector. */
  props: Record<string, unknown>;
  /** Containment parent (subnet → vpc, instance → subnet). */
  parentId?: string;
  range: SourceRange;
  /** True when the dialect cannot write this node back (CDK TypeScript). */
  readOnly: boolean;
}

export type EdgeKind = 'ref' | 'getatt' | 'depends';

export interface Edge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  /** The property path that produced this edge, e.g. "Environment.Variables.TABLE". */
  label?: string;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Diagnostic {
  severity: Severity;
  message: string;
  /** Absent when the problem is not tied to a specific span. */
  range?: SourceRange;
}

export interface Model {
  dialect: DialectId;
  nodes: ResourceNode[];
  edges: Edge[];
  diagnostics: Diagnostic[];
  /** Positions recovered from the document (CFN `Metadata.DiagramLayout`). */
  layout: Record<string, XY>;
}

export interface XY {
  x: number;
  y: number;
}

export const emptyModel = (dialect: DialectId): Model => ({
  dialect,
  nodes: [],
  edges: [],
  diagnostics: [],
  layout: {},
});

/** Path into a resource's properties. Numbers index into arrays. */
export type PropPath = (string | number)[];

export type ModelOp =
  | { op: 'setProp'; id: string; path: PropPath; value: unknown }
  | { op: 'deleteProp'; id: string; path: PropPath }
  | { op: 'addResource'; id: string; rawType: string; props: Record<string, unknown> }
  | { op: 'deleteResource'; id: string }
  | { op: 'renameResource'; from: string; to: string }
  | { op: 'addRef'; fromId: string; toId: string; path: PropPath }
  | { op: 'setLayout'; positions: Record<string, XY> };

export interface ParseResult {
  model: Model;
  /** Format-preserving CST retained by the dialect for surgical edits. */
  doc: unknown;
}

export interface Dialect {
  id: DialectId;
  label: string;
  /** Monaco language id for the left pane. */
  language: string;
  /** Confidence in [0, 1] that `text` is written in this dialect. */
  detect(text: string, filename?: string): number;
  /**
   * One-time asynchronous setup. `parse` may only be called once this resolves;
   * the CDK dialect uses it to load the TypeScript compiler on demand rather
   * than shipping it in the main bundle.
   */
  prepare?(): Promise<void>;
  /** False until `prepare` has resolved. Always true for dialects without one. */
  isReady?(): boolean;
  parse(text: string): ParseResult;
  canWriteBack: boolean;
  /**
   * Whether node positions can be stored in the document. CloudFormation has an
   * inert `Metadata` section for this; Terraform and CDK do not, so their
   * arrangements last only for the session.
   */
  supportsLayout: boolean;
  /** Applies ops to `text`, returning new text. Must be a no-op for `[]`. */
  applyOps(text: string, doc: unknown, ops: ModelOp[]): string;
}

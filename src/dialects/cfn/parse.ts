/**
 * CloudFormation template parsing, for both the YAML and JSON dialects.
 *
 * The two share everything downstream of "give me a list of resources with
 * long-form properties": type resolution, edge derivation, and containment all
 * live in `src/model/graph.ts`.
 */

import { parseDocument, isMap, isScalar, isSeq, type Document } from 'yaml';
import { parseTree, getNodeValue, findNodeAtLocation, type Node as JsonNode, type ParseError, printParseErrorCode } from 'jsonc-parser';

import type { Diagnostic, Model, ParseResult, SourceRange } from '../../model/types';
import { buildGraph, readLayout, type RawResource } from '../../model/graph';
import { astToPlain } from './intrinsics';
import { cfnCustomTags } from './intrinsics';

export const LAYOUT_KEY = 'DiagramLayout';

/** Top-level sections whose keys are legal `Ref` targets but are not resources. */
const NON_RESOURCE_SECTIONS = ['Parameters', 'Mappings', 'Conditions'] as const;

const asStringList = (v: unknown): string[] => {
  if (typeof v === 'string') return [v];
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
  return [];
};

// ── YAML ────────────────────────────────────────────────────────────────────

export function parseCfnYaml(text: string): ParseResult {
  const doc = parseDocument(text, { customTags: cfnCustomTags });

  const diagnostics: Diagnostic[] = doc.errors.map((e) => ({
    severity: 'error' as const,
    message: e.message,
    range: { start: e.pos[0], end: e.pos[1] },
  }));

  const resources: RawResource[] = [];
  const resourcesNode = doc.getIn(['Resources'], true);

  if (isMap(resourcesNode)) {
    for (const pair of resourcesNode.items) {
      if (!isScalar(pair.key)) continue;
      const id = String(pair.key.value);
      const body = pair.value;
      if (!isMap(body)) {
        diagnostics.push({
          severity: 'warning',
          message: `Resource "${id}" is not an object and was skipped.`,
          range: rangeOfPair(pair),
        });
        continue;
      }
      const typeNode = body.get('Type', true);
      const rawType = isScalar(typeNode) ? String(typeNode.value) : '';
      if (!rawType) {
        diagnostics.push({
          severity: 'warning',
          message: `Resource "${id}" has no Type.`,
          range: rangeOfPair(pair),
        });
      }
      const propsNode = body.get('Properties', true);
      const props = (astToPlain(propsNode) as Record<string, unknown>) ?? {};
      const dependsOn = asStringList(astToPlain(body.get('DependsOn', true)));

      resources.push({
        id,
        rawType,
        props: typeof props === 'object' && props !== null && !Array.isArray(props) ? props : {},
        dependsOn,
        range: rangeOfPair(pair),
      });
    }
  } else if (resourcesNode !== undefined && resourcesNode !== null) {
    diagnostics.push({ severity: 'error', message: 'Resources must be a mapping of logical IDs.' });
  } else if (text.trim().length > 0) {
    diagnostics.push({ severity: 'info', message: 'No Resources section found.' });
  }

  const otherNames = new Set<string>();
  for (const section of NON_RESOURCE_SECTIONS) {
    const node = doc.getIn([section], true);
    if (isMap(node)) {
      for (const pair of node.items) {
        if (isScalar(pair.key)) otherNames.add(String(pair.key.value));
      }
    }
  }

  const graph = buildGraph(resources, 'cfn', { otherNames });
  const layout = readLayout(astToPlain(doc.getIn(['Metadata', LAYOUT_KEY], true)));

  const model: Model = {
    dialect: 'cfn-yaml',
    nodes: graph.nodes,
    edges: graph.edges,
    diagnostics: [...diagnostics, ...graph.diagnostics],
    layout,
  };
  return { model, doc };
}

interface PairLike {
  key: unknown;
  value: unknown;
}

/** Selection range for a resource: from its logical ID through its last property. */
function rangeOfPair(pair: PairLike): SourceRange {
  const key = pair.key as { range?: [number, number, number] } | undefined;
  const value = pair.value as { range?: [number, number, number] } | undefined;
  const start = key?.range?.[0] ?? 0;
  const end = value?.range?.[1] ?? key?.range?.[1] ?? start;
  return { start, end: Math.max(start, end) };
}

// ── JSON ────────────────────────────────────────────────────────────────────

export function parseCfnJson(text: string): ParseResult {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true, disallowComments: false });

  const diagnostics: Diagnostic[] = errors.map((e) => ({
    severity: 'error' as const,
    message: printParseErrorCode(e.error),
    range: { start: e.offset, end: e.offset + e.length },
  }));

  const resources: RawResource[] = [];
  const resourcesNode = root ? findNodeAtLocation(root, ['Resources']) : undefined;

  if (resourcesNode?.type === 'object') {
    for (const prop of resourcesNode.children ?? []) {
      const [keyNode, valueNode] = prop.children ?? [];
      if (!keyNode || !valueNode) continue;
      const id = String(keyNode.value);
      const body = getNodeValue(valueNode) as Record<string, unknown> | undefined;
      const rawType = typeof body?.Type === 'string' ? body.Type : '';
      const props = body?.Properties;

      if (!rawType) {
        diagnostics.push({
          severity: 'warning',
          message: `Resource "${id}" has no Type.`,
          range: { start: prop.offset, end: prop.offset + prop.length },
        });
      }

      resources.push({
        id,
        rawType,
        props:
          typeof props === 'object' && props !== null && !Array.isArray(props)
            ? (props as Record<string, unknown>)
            : {},
        dependsOn: asStringList(body?.DependsOn),
        range: { start: prop.offset, end: prop.offset + prop.length },
      });
    }
  } else if (root && text.trim().length > 0) {
    diagnostics.push({ severity: 'info', message: 'No Resources section found.' });
  }

  const otherNames = new Set<string>();
  for (const section of NON_RESOURCE_SECTIONS) {
    const node = root ? findNodeAtLocation(root, [section]) : undefined;
    if (node?.type === 'object') {
      for (const prop of node.children ?? []) {
        const keyNode = prop.children?.[0];
        if (keyNode?.type === 'string') otherNames.add(String(keyNode.value));
      }
    }
  }

  const graph = buildGraph(resources, 'cfn', { otherNames });
  const layoutNode = root ? findNodeAtLocation(root, ['Metadata', LAYOUT_KEY]) : undefined;
  const layout = readLayout(layoutNode ? getNodeValue(layoutNode) : undefined);

  const model: Model = {
    dialect: 'cfn-json',
    nodes: graph.nodes,
    edges: graph.edges,
    diagnostics: [...diagnostics, ...graph.diagnostics],
    layout,
  };
  return { model, doc: root ?? null };
}

// ── Detection ───────────────────────────────────────────────────────────────

const CFN_MARKERS = /"?(AWSTemplateFormatVersion|Resources|Transform)"?\s*:/;

export function detectCfnJson(text: string, filename?: string): number {
  const trimmed = text.trimStart();
  if (!trimmed.startsWith('{')) return 0;
  let score = 0.5;
  if (CFN_MARKERS.test(text)) score += 0.3;
  if (/"Type"\s*:\s*"AWS::/.test(text)) score += 0.2;
  if (filename?.endsWith('.json')) score += 0.05;
  return Math.min(score, 1);
}

export function detectCfnYaml(text: string, filename?: string): number {
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) return 0;
  let score = 0;
  if (/^\s*AWSTemplateFormatVersion\s*:/m.test(text)) score += 0.5;
  if (/^\s*Resources\s*:/m.test(text)) score += 0.3;
  if (/Type\s*:\s*AWS::/.test(text)) score += 0.3;
  if (/!(Ref|GetAtt|Sub)\b/.test(text)) score += 0.1;
  if (filename && /\.(ya?ml|template)$/.test(filename)) score += 0.05;
  return Math.min(score, 1);
}

/** Narrow re-export so serializers can assert on the doc type. */
export type CfnYamlDoc = Document.Parsed;
export type CfnJsonDoc = JsonNode | null;
export { isSeq, isMap, isScalar };

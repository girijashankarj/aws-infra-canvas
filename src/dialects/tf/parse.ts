/**
 * Terraform configuration parsing.
 *
 * Resources and data sources become nodes; variables, locals, modules and
 * outputs are collected as legal reference targets so that using them does not
 * look like a dangling reference.
 */

import type { Diagnostic, Model, ParseResult } from '../../model/types';
import { buildGraph, type RawResource } from '../../model/graph';
import { parseHcl, TF_EXPR, TF_INTERP, TF_REF, type HclFile } from './hcl';

/** Block types that become diagram nodes. */
const NODE_BLOCKS = new Set(['resource', 'data']);

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `depends_on = [aws_iam_role.exec]` → `['aws_iam_role.exec']`. */
function readDependsOn(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === 'string') return item;
      if (isPlainObject(item)) {
        const raw = item[TF_REF] ?? item[TF_EXPR];
        if (typeof raw === 'string') return raw;
      }
      return null;
    })
    .filter((v): v is string => v !== null);
}

export function parseTerraform(text: string): ParseResult {
  const file = parseHcl(text);

  const diagnostics: Diagnostic[] = file.errors.map((e) => ({
    severity: 'error' as const,
    message: e.message,
    range: e.range,
  }));

  const resources: RawResource[] = [];
  const otherNames = new Set<string>();

  for (const block of file.blocks) {
    if (NODE_BLOCKS.has(block.type)) {
      if (block.labels.length < 2) {
        diagnostics.push({
          severity: 'warning',
          message: `A ${block.type} block needs a type and a name.`,
          range: block.range,
        });
        continue;
      }
      const [rawType, name] = block.labels;
      const id = block.type === 'data' ? `data.${rawType}.${name}` : `${rawType}.${name}`;
      const props = { ...block.value };
      delete props.depends_on;

      resources.push({
        id,
        rawType,
        label: name,
        props,
        dependsOn: readDependsOn(block.value.depends_on),
        range: block.range,
      });
      continue;
    }

    // Not a node, but a legal reference target.
    switch (block.type) {
      case 'variable':
        if (block.labels[0]) otherNames.add(`var.${block.labels[0]}`);
        break;
      case 'module':
        if (block.labels[0]) otherNames.add(`module.${block.labels[0]}`);
        break;
      case 'output':
        if (block.labels[0]) otherNames.add(`output.${block.labels[0]}`);
        break;
      case 'locals':
        for (const key of Object.keys(block.value)) otherNames.add(`local.${key}`);
        break;
      default:
        break;
    }
  }

  const graph = buildGraph(resources, 'tf', { otherNames });

  const model: Model = {
    dialect: 'tf',
    nodes: graph.nodes,
    edges: graph.edges,
    diagnostics: [...diagnostics, ...graph.diagnostics],
    // Terraform has no inert metadata section to hold an arrangement, so
    // positions live only for the session. See `supportsLayout` on the dialect.
    layout: {},
  };

  return { model, doc: file };
}

export function detectTerraform(text: string, filename?: string): number {
  if (text.trimStart().startsWith('{')) return 0;
  let score = 0;
  if (/^\s*resource\s+"[a-z][a-z0-9_]*"\s+"[^"]+"\s*\{/m.test(text)) score += 0.6;
  if (/^\s*(provider|terraform|variable|module|data|output|locals)\b/m.test(text)) score += 0.25;
  if (/\b(aws_[a-z0-9_]+)\./.test(text)) score += 0.1;
  if (filename?.endsWith('.tf')) score += 0.2;
  return Math.min(score, 1);
}

export type { HclFile };
export { TF_EXPR, TF_INTERP, TF_REF };

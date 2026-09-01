/**
 * CloudFormation intrinsic-function handling for the YAML dialect.
 *
 * CFN YAML uses shorthand tags (`!Ref`, `!GetAtt`, `!Sub`, …) that are not part
 * of the YAML core schema. We declare them as custom tags so that:
 *   - `yaml` does not emit "unresolved tag" warnings, and
 *   - the tag survives verbatim through `doc.toString()`.
 *
 * For analysis we convert the tagged AST into the *long form*
 * (`{ "Fn::GetAtt": [...] }`), so the graph builder can treat YAML and JSON
 * templates identically.
 */

import { isAlias, isMap, isScalar, isSeq, type Node as YamlNode } from 'yaml';
import type { Tags } from 'yaml';

/** Intrinsics that CFN allows in shorthand tag form. */
export const CFN_TAGS = [
  'Ref',
  'Condition',
  'GetAtt',
  'Sub',
  'Join',
  'Select',
  'Split',
  'FindInMap',
  'If',
  'Equals',
  'Not',
  'And',
  'Or',
  'Base64',
  'Cidr',
  'ImportValue',
  'GetAZs',
  'Transform',
  'Length',
  'ToJsonString',
] as const;

/** `!Ref` and `!Condition` are bare keys; everything else is namespaced `Fn::`. */
const BARE = new Set(['Ref', 'Condition']);

export const longFormKey = (tagName: string): string =>
  BARE.has(tagName) ? tagName : `Fn::${tagName}`;

/**
 * Tag definitions handed to `parseDocument`. Each intrinsic can appear as a
 * scalar, a sequence, or a map, so all three shapes are declared. `identify`
 * always returns false: these tags are only ever produced by the source
 * document, never inferred when creating new nodes.
 */
export const cfnCustomTags: Tags = CFN_TAGS.flatMap((name) => [
  { tag: `!${name}`, collection: 'seq' as const, identify: () => false },
  { tag: `!${name}`, collection: 'map' as const, identify: () => false },
  { tag: `!${name}`, resolve: (str: string) => str, identify: () => false },
]);

const tagName = (tag: string | undefined): string | undefined => {
  if (!tag || !tag.startsWith('!') || tag.startsWith('!!')) return undefined;
  const name = tag.slice(1);
  return (CFN_TAGS as readonly string[]).includes(name) ? name : undefined;
};

/**
 * Converts a YAML AST node to plain JS, rewriting shorthand intrinsic tags into
 * their long form. Aliases resolve to a placeholder rather than being expanded,
 * so a template using anchors does not blow up into duplicated data.
 */
export function astToPlain(node: unknown): unknown {
  if (node == null) return node;

  if (isAlias(node)) return { 'Fn::Alias': `*${node.source}` };

  if (isScalar(node)) {
    const name = tagName(node.tag);
    return name ? { [longFormKey(name)]: node.value } : node.value;
  }

  if (isSeq(node)) {
    const items = node.items.map((i) => astToPlain(i));
    const name = tagName(node.tag);
    return name ? { [longFormKey(name)]: items } : items;
  }

  if (isMap(node)) {
    const obj: Record<string, unknown> = {};
    for (const pair of node.items) {
      const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
      obj[key] = astToPlain(pair.value);
    }
    const name = tagName(node.tag);
    return name ? { [longFormKey(name)]: obj } : obj;
  }

  return node;
}

/** Character range of a YAML node's own text, or undefined for synthetic nodes. */
export function nodeRange(node: unknown): { start: number; end: number } | undefined {
  const range = (node as YamlNode | undefined)?.range;
  return range ? { start: range[0], end: range[1] } : undefined;
}

/**
 * Long-form property keys that carry a resource reference, mapped to the kind of
 * reference they hold. Used by the rename rewriter.
 */
export const LONG_FORM_REF_KEYS: Record<string, 'Ref' | 'GetAtt' | 'Sub' | 'DependsOn'> = {
  Ref: 'Ref',
  'Fn::GetAtt': 'GetAtt',
  'Fn::Sub': 'Sub',
  DependsOn: 'DependsOn',
};

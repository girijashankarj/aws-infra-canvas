/**
 * Dialect registry and auto-detection.
 *
 * `detect` returns the highest-confidence dialect for a piece of text. Ties fall
 * back to the order below, which puts the fully round-trippable dialects first.
 */

import type { Dialect, DialectId, ModelOp, ParseResult } from '../model/types';
import { detectCfnJson, detectCfnYaml, parseCfnJson, parseCfnYaml } from './cfn/parse';
import { applyCfnJsonOps, applyCfnYamlOps } from './cfn/serialize';
import { detectTerraform, parseTerraform } from './tf/parse';
import { applyTerraformOps } from './tf/serialize';
import {
  applyCdkOps,
  detectCdkTypeScript,
  isReady as cdkIsReady,
  parseCdkTypeScript,
  prepare as cdkPrepare,
} from './cdkts/parse';

export const cfnYaml: Dialect = {
  id: 'cfn-yaml',
  label: 'CloudFormation (YAML)',
  language: 'yaml',
  detect: detectCfnYaml,
  parse: parseCfnYaml,
  canWriteBack: true,
  supportsLayout: true,
  applyOps: applyCfnYamlOps,
};

export const cfnJson: Dialect = {
  id: 'cfn-json',
  label: 'CloudFormation (JSON)',
  language: 'json',
  detect: detectCfnJson,
  parse: parseCfnJson,
  canWriteBack: true,
  supportsLayout: true,
  applyOps: applyCfnJsonOps,
};

export const terraform: Dialect = {
  id: 'tf',
  label: 'Terraform (HCL)',
  language: 'hcl',
  detect: detectTerraform,
  parse: parseTerraform,
  canWriteBack: true,
  supportsLayout: false,
  applyOps: applyTerraformOps,
};

export const cdkTypeScript: Dialect = {
  id: 'cdk-ts',
  label: 'AWS CDK (TypeScript)',
  language: 'typescript',
  detect: detectCdkTypeScript,
  prepare: cdkPrepare,
  isReady: cdkIsReady,
  parse: parseCdkTypeScript,
  // Generating construct code from a diagram is out of scope; see cdkts/parse.
  canWriteBack: false,
  supportsLayout: false,
  applyOps: applyCdkOps,
};

const registry: Dialect[] = [cfnYaml, cfnJson, terraform, cdkTypeScript];

/** Registers a dialect at runtime; used by the lazily-loaded CDK parser. */
export function register(dialect: Dialect): void {
  const i = registry.findIndex((d) => d.id === dialect.id);
  if (i === -1) registry.push(dialect);
  else registry[i] = dialect;
}

export const dialects = (): readonly Dialect[] => registry;

export function getDialect(id: DialectId): Dialect | undefined {
  return registry.find((d) => d.id === id);
}

/** Picks the best dialect for `text`, or `undefined` when nothing scores. */
export function detectDialect(text: string, filename?: string): Dialect | undefined {
  let best: Dialect | undefined;
  let bestScore = 0;
  for (const d of registry) {
    const score = d.detect(text, filename);
    if (score > bestScore) {
      best = d;
      bestScore = score;
    }
  }
  return bestScore > 0 ? best : undefined;
}

/** Convenience wrapper used by the sync layer. */
export function parseWith(dialect: Dialect, text: string): ParseResult {
  try {
    return dialect.parse(text);
  } catch (err) {
    return {
      model: {
        dialect: dialect.id,
        nodes: [],
        edges: [],
        diagnostics: [
          { severity: 'error', message: err instanceof Error ? err.message : String(err) },
        ],
        layout: {},
      },
      doc: null,
    };
  }
}

export type { Dialect, ModelOp };

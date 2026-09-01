/**
 * Typed access to the AWS documentation links baked in at build time.
 *
 * The data in `aws-docs.generated.json` comes from the AWS Documentation MCP
 * server, driven by `scripts/fetch-aws-docs.mjs`. It is committed so that a
 * clone builds and runs without contacting anything; refresh it with
 * `npm run docs:fetch` when AWS reorganizes its documentation.
 */

import generated from './aws-docs.generated.json';
import type { CanonicalType } from './types';

export interface DocLink {
  title?: string;
  url: string;
}

interface Generated {
  generatedAt: string;
  source: { server: string; tools: string[]; note: string };
  services: Record<string, DocLink>;
  pillars: Record<string, { url: string; ok: boolean; title?: string }>;
  rules: Record<string, { url: string; ok: boolean; title?: string }>;
}

const data = generated as Generated;

export const DOCS_GENERATED_AT = data.generatedAt;
export const DOCS_SOURCE = data.source;

/** The CloudFormation resource reference page for a service, if we have one. */
export const serviceDocs = (canonical: CanonicalType): DocLink | undefined =>
  data.services[canonical];

/**
 * The page for a rule. Prefers the verified title from the generated file so
 * the link text matches what the reader will land on.
 */
export function ruleDocs(ruleId: string, fallbackUrl?: string): DocLink | undefined {
  const entry = data.rules[ruleId];
  if (entry?.ok) return { url: entry.url, title: entry.title };
  return fallbackUrl ? { url: fallbackUrl } : undefined;
}

export function pillarDocs(pillarId: string, fallbackUrl: string): DocLink {
  const entry = data.pillars[pillarId];
  return entry?.ok ? { url: entry.url, title: entry.title } : { url: fallbackUrl };
}

/**
 * Runs the rule set against a model and scores the result.
 *
 * Scoring gives every applicable rule partial credit: a rule that flags one of
 * five buckets scores 0.8, not zero. A pillar's score is the weighted mean over
 * the rules that applied to this document; rules with nothing to inspect, or
 * that the dialect cannot decide, are excluded rather than counted as passes —
 * a template with no databases should not score well on database encryption.
 */

import type { CanonicalType, Model, ResourceNode } from '../model/types';
import { PILLARS, type PillarId } from './pillars';
import { flavorOf, read, type PropSpec } from './props';
import { RULES, type Rule, type RuleContext, type Severity } from './rules';

export interface Finding {
  ruleId: string;
  pillar: PillarId;
  severity: Severity;
  title: string;
  rationale: string;
  remediation: string;
  docs?: string;
  /** The resource at fault, or undefined for whole-model findings. */
  nodeId?: string;
  nodeLabel?: string;
}

export interface PillarScore {
  pillar: PillarId;
  /** 0–100, or null when no rule in this pillar applied. */
  score: number | null;
  rulesApplied: number;
  findings: number;
}

export interface Review {
  /** 0–100 across all applicable rules, or null when nothing could be checked. */
  score: number | null;
  pillars: PillarScore[];
  findings: Finding[];
  /** Rules that ran and passed everywhere, worth showing as reassurance. */
  passed: { ruleId: string; title: string; pillar: PillarId }[];
  /** Rules skipped because this dialect cannot express the answer. */
  undecided: { ruleId: string; title: string; pillar: PillarId }[];
  checkedResources: number;
}

const SEVERITY_ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2 };

function makeContext(model: Model): RuleContext {
  const byId = new Map(model.nodes.map((n) => [n.id, n]));
  const flavor = flavorOf(model.dialect);

  return {
    model,
    get: (node: ResourceNode, spec: PropSpec) =>
      spec[flavor] === undefined ? undefined : read(model, node, spec),
    ofType: (...types: CanonicalType[]) => {
      const wanted = new Set(types);
      return model.nodes.filter((n) => wanted.has(n.canonicalType));
    },
    referencedBy: (node: ResourceNode, rawTypes: string[]) => {
      const wanted = new Set(rawTypes.map((t) => t.toLowerCase()));
      const sources = model.edges.filter((e) => e.to === node.id).map((e) => e.from);
      return sources
        .map((id) => byId.get(id))
        .filter(
          (n): n is ResourceNode => n !== undefined && wanted.has(n.rawType.toLowerCase()),
        );
    },
  };
}

export function reviewModel(model: Model): Review {
  const ctx = makeContext(model);
  const findings: Finding[] = [];
  const passed: Review['passed'] = [];
  const undecided: Review['undecided'] = [];

  /** Per-pillar accumulators of weight and earned credit. */
  const totals = new Map<PillarId, { weight: number; earned: number; rules: number }>();
  const checked = new Set<string>();

  for (const rule of RULES) {
    const targets = ctx.ofType(...rule.appliesTo);
    if (targets.length === 0) continue;

    let applicable = 0;
    let failed = 0;

    for (const node of targets) {
      let result: boolean | null;
      try {
        result = rule.check(ctx, node);
      } catch {
        // A malformed template should never take the whole review down.
        result = null;
      }
      if (result === null) continue;
      applicable++;
      checked.add(node.id);
      if (result) continue;

      failed++;
      findings.push({
        ruleId: rule.id,
        pillar: rule.pillar,
        severity: rule.severity,
        title: rule.title,
        rationale: rule.rationale,
        remediation: rule.remediation,
        docs: rule.docs,
        nodeId: node.id,
        nodeLabel: node.label,
      });
    }

    if (applicable === 0) {
      undecided.push({ ruleId: rule.id, title: rule.title, pillar: rule.pillar });
      continue;
    }
    if (failed === 0) {
      passed.push({ ruleId: rule.id, title: rule.title, pillar: rule.pillar });
    }

    const entry = totals.get(rule.pillar) ?? { weight: 0, earned: 0, rules: 0 };
    entry.weight += rule.weight;
    entry.earned += rule.weight * (1 - failed / applicable);
    entry.rules += 1;
    totals.set(rule.pillar, entry);
  }

  const pillars: PillarScore[] = PILLARS.map((pillar) => {
    const entry = totals.get(pillar.id);
    return {
      pillar: pillar.id,
      score: entry && entry.weight > 0 ? Math.round((entry.earned / entry.weight) * 100) : null,
      rulesApplied: entry?.rules ?? 0,
      findings: findings.filter((f) => f.pillar === pillar.id).length,
    };
  });

  let weight = 0;
  let earned = 0;
  for (const entry of totals.values()) {
    weight += entry.weight;
    earned += entry.earned;
  }

  findings.sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      a.ruleId.localeCompare(b.ruleId) ||
      (a.nodeId ?? '').localeCompare(b.nodeId ?? ''),
  );

  return {
    score: weight > 0 ? Math.round((earned / weight) * 100) : null,
    pillars,
    findings,
    passed,
    undecided,
    checkedResources: checked.size,
  };
}

/** Findings for one resource, for the badge on its node and its inspector. */
export function findingsByNode(review: Review): Map<string, Finding[]> {
  const map = new Map<string, Finding[]>();
  for (const finding of review.findings) {
    if (!finding.nodeId) continue;
    const list = map.get(finding.nodeId) ?? [];
    list.push(finding);
    map.set(finding.nodeId, list);
  }
  return map;
}

export const worstSeverity = (findings: Finding[]): Severity | null =>
  findings.length === 0
    ? null
    : findings.reduce<Severity>(
        (worst, f) => (SEVERITY_ORDER[f.severity] < SEVERITY_ORDER[worst] ? f.severity : worst),
        'low',
      );

export type { Rule };

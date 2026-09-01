/**
 * The six pillars of the AWS Well-Architected Framework.
 *
 * Documentation URLs are seeded here and can be refreshed from the AWS
 * Documentation MCP server — see `scripts/fetch-aws-docs.mjs`.
 */

export type PillarId =
  | 'operational-excellence'
  | 'security'
  | 'reliability'
  | 'performance-efficiency'
  | 'cost-optimization'
  | 'sustainability';

export interface Pillar {
  id: PillarId;
  name: string;
  /** Two-letter code used in rule ids, matching AWS's own convention. */
  code: string;
  description: string;
  docsUrl: string;
  color: string;
}

export const PILLARS: Pillar[] = [
  {
    id: 'operational-excellence',
    name: 'Operational Excellence',
    code: 'OPS',
    description: 'Running and monitoring systems, and continually improving how they are operated.',
    docsUrl:
      'https://docs.aws.amazon.com/wellarchitected/latest/operational-excellence-pillar/welcome.html',
    color: '#7aa116',
  },
  {
    id: 'security',
    name: 'Security',
    code: 'SEC',
    description: 'Protecting data and systems, and controlling who can reach them.',
    docsUrl: 'https://docs.aws.amazon.com/wellarchitected/latest/security-pillar/welcome.html',
    color: '#dd344c',
  },
  {
    id: 'reliability',
    name: 'Reliability',
    code: 'REL',
    description: 'Recovering from failure and meeting demand without disruption.',
    docsUrl: 'https://docs.aws.amazon.com/wellarchitected/latest/reliability-pillar/welcome.html',
    color: '#2e73b8',
  },
  {
    id: 'performance-efficiency',
    name: 'Performance Efficiency',
    code: 'PERF',
    description: 'Using compute resources efficiently as demand and technology change.',
    docsUrl:
      'https://docs.aws.amazon.com/wellarchitected/latest/performance-efficiency-pillar/welcome.html',
    color: '#8c4fff',
  },
  {
    id: 'cost-optimization',
    name: 'Cost Optimization',
    code: 'COST',
    description: 'Avoiding unnecessary costs and paying only for what is needed.',
    docsUrl:
      'https://docs.aws.amazon.com/wellarchitected/latest/cost-optimization-pillar/welcome.html',
    color: '#ed7100',
  },
  {
    id: 'sustainability',
    name: 'Sustainability',
    code: 'SUS',
    description: 'Reducing the energy and resources a workload consumes for the same result.',
    docsUrl:
      'https://docs.aws.amazon.com/wellarchitected/latest/sustainability-pillar/welcome.html',
    color: '#00a1c9',
  },
];

const byId = new Map(PILLARS.map((p) => [p.id, p]));
export const getPillar = (id: PillarId): Pillar => byId.get(id)!;

export const FRAMEWORK_URL = 'https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html';

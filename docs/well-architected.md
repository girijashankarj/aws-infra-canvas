# The Well-Architected review

The **Well-Architected** button in the toolbar scores the open template against
the mechanical best practices that are visible in infrastructure-as-code, and
lists what it found.

## What this is, and what it is not

The [AWS Well-Architected Framework][framework] is a set of questions answered by
the people who build and run a workload — *how do you evolve it?*, *how do you
know when it is failing?* Most of those questions have no answer in a template.

What a template *does* answer is the mechanical layer underneath: whether the
database is encrypted, whether the log group expires, whether a security group
opens SSH to the internet. Those are the checks here. A green score means the
mechanical layer looks right; it does not mean the workload is well-architected.
The panel says so, and links to the framework.

## Scoring

Every rule declares which canonical resource types it inspects and a weight
from 1 to 3. Against a given template each rule is evaluated per resource, and
each evaluation returns one of three things:

| Result | Meaning |
| --- | --- |
| pass | the practice is followed |
| fail | it is not — a finding is raised |
| **undecidable** | the dialect cannot express the answer |

The third case matters. CDK adds security-group rules with `addIngressRule()`
after construction and applies tags with an aspect, so neither is visible in the
constructor props. Counting those as failures would punish CDK users for their
tool's shape; counting them as passes would be a lie. They are excluded, and
listed separately as skipped.

A rule's score is `1 − failed / applicable`, so flagging one bucket out of five
scores 0.8 rather than zero. A pillar is the weighted mean over the rules that
applied to *this* template, and the overall score is the weighted mean across
all of them. A pillar with no applicable rules shows `n/a` rather than 100 — a
template with no databases has not earned a reliability score.

## Adding a rule

Rules live in `src/wellarchitected/rules.ts`. Each one is self-contained:

```ts
{
  id: 'COST-LOG-RETENTION',
  pillar: 'cost-optimization',
  title: 'Log group keeps logs forever',
  rationale: 'A log group with no retention period never expires anything…',
  remediation: 'Set a retention period. If logs must be kept for compliance…',
  severity: 'medium',
  weight: 2,
  appliesTo: ['logs.loggroup'],
  docs: 'https://docs.aws.amazon.com/…',
  check(ctx, node) {
    const value = ctx.get(node, {
      cfn: [['RetentionInDays']],
      tf:  [['retention_in_days']],
      cdk: [['retention']],
    });
    if (value === undefined) return false;
    if (isExpression(value)) return null;   // a parameter, not a literal
    return (asNumber(value) ?? 0) > 0;
  },
}
```

`ctx.get` takes the property path in each dialect and reads whichever one
matches the open document, so a rule is written once and applies to
CloudFormation, Terraform and CDK. Omit a dialect and the rule returns
`undefined` there — return `null` from `check` to skip rather than fail.

Two things are worth holding to when adding rules:

- **Return `null` when you are guessing.** A false positive costs more trust
  than a missed finding.
- **Write the rationale for someone who disagrees.** Every rule says *why* in
  its own terms, including when the practice is not worth it — Multi-AZ roughly
  doubles the bill, and development databases are a reasonable exception. That
  is the difference between advice and a lint rule.

The documentation link is verified against real AWS docs on every
`npm run docs:fetch` — see [mcp-enrichment.md](mcp-enrichment.md).

[framework]: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html

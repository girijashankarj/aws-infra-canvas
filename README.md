# AWS Infra Canvas

Paste, type, or open an infrastructure-as-code file on the left; an AWS
architecture diagram is drawn on the right. Edit the diagram — move, add,
delete, rename, change properties, draw connections — and the changes are
written back into the source.

A **Well-Architected review** scores the template as you edit it, with findings
that point back at the resource that caused them.

Runs entirely in the browser. No backend, no AWS credentials, no network calls.

```bash
npm install
npm run dev
```

## What it understands

| Format | Read | Write back | Layout stored in file |
| --- | --- | --- | --- |
| CloudFormation YAML | ✅ | ✅ | ✅ |
| CloudFormation JSON | ✅ | ✅ | ✅ |
| Terraform (HCL) | ✅ | ✅ | — |
| AWS CDK (TypeScript) | ✅ | — | — |

The format is detected from the content (and the filename, when there is one);
the dropdown in the toolbar overrides it.

CDK is **read-only by design**. A CDK app is a program rather than a
description — what it produces depends on control flow, helper functions, and
construct libraries — so the diagram is derived from the construct calls, but
edits are not translated back into TypeScript. To edit a CDK stack here, run
`cdk synth` and open the template it writes to `cdk.out/`.

## The Well-Architected review

The toolbar shows a score out of 100 across the six pillars of the
[AWS Well-Architected Framework][framework]. Opening the panel lists each
finding with why it matters, what to change, the resource responsible, and a
link into the AWS documentation. Nodes with findings get a badge on the canvas.

Rules are written once and read the right property spelling for whichever
dialect is open — `BackupRetentionPeriod`, `backup_retention_period`,
`backupRetention`. A rule that a dialect genuinely cannot answer is *skipped*,
not failed, so CDK is not marked down for adding security-group rules
imperatively.

This scores the mechanical layer a template can express — encryption at rest,
log retention, open administrative ports, wildcard IAM. It is a starting point
for a Well-Architected review, not a substitute for one; the framework's real
questions are answered by people, not parsers. See
[docs/well-architected.md](docs/well-architected.md) for the scoring model and
how to add a rule.

## How the round trip works

The **text is the only source of truth.** The diagram is a projection of it.
Canvas interactions never mutate a model and re-print the file — they emit a
`ModelOp` (`setProp`, `renameResource`, `addRef`, …), the dialect applies it to
the source, and the resulting text is parsed back into a new diagram. Divergence
between the two panes is therefore not something that has to be prevented; it
cannot arise.

Edits are applied as **byte-range splices** wherever a range is known. Changing
a Lambda's `MemorySize` rewrites exactly those digits: comments, blank lines,
key order, YAML anchors, `!Sub` shorthand, and indentation elsewhere in the file
are untouched because they are never re-serialized. This is what
`tests/roundtrip.test.ts` locks down — for every fixture, applying no operations
must return the file byte-for-byte, and a single property change must produce a
one-line diff.

Structural edits that have no existing range to replace — adding a resource,
creating a nested property — go through the document model instead. For YAML,
comment placement still survives; only whitespace directly before a trailing
comment may normalize.

## Layout

Node positions are the one thing not derived from the text. With **Save layout**
on, CloudFormation templates store the arrangement under
`Metadata.DiagramLayout` — a key CloudFormation itself ignores — so it survives
save and reload. Terraform and CDK have no comparable inert section, so their
positions last for the session and the toggle is disabled.

Opening a file never modifies it. The automatic first layout is not written
back, and neither is clicking a node; only dragging a node or pressing **Auto
layout** persists positions.

## AWS documentation, without an LLM

The **Docs ↗** button in the inspector and the link on every finding come from
the [AWS Documentation MCP server][mcp], queried at **build time** by
`scripts/fetch-aws-docs.mjs` and baked into a committed JSON file.

That server is stdio-only — no HTTP, no CORS — so a browser can never call it,
and this app has no backend. But an LLM was never needed to call it either: MCP
is JSON-RPC over a pipe, and its tools are ordinary functions. The script drives
them with fixed arguments and deterministic result-picking, so it resolves 54
resource reference pages and verifies all 30 hand-written rule links on every
run. It has already caught one broken link. Details, including why prose is
*not* generated this way, in
[docs/mcp-enrichment.md](docs/mcp-enrichment.md).

```bash
python3 -m venv .venv
.venv/bin/pip install awslabs.aws-documentation-mcp-server
npm run docs:fetch
```

## Architecture

```
src/
  model/            types, the service registry, graph and edge derivation
  dialects/         one folder per format: detect, parse, applyOps
  wellarchitected/  pillars, rules, and the scoring engine
  layout/           ELK, in a worker, with nested containers
  state/            the store and the text ⇄ diagram loop
  ui/               editor pane, canvas, inspector, palette, review panel
scripts/            build-time MCP client and doc generation
```

Everything downstream of parsing is shared. Each dialect's job is to produce a
list of resources with long-form properties and source ranges; type resolution,
reference extraction, containment, and layout are written once in `src/model`.

`src/model/registry.ts` is the table that drives the rest: it maps a canonical
type (`lambda.function`) to its CloudFormation type, Terraform type, CDK
constructs, icon, category color, containment parent, and palette defaults.
Supporting a new service is a one-entry change there.

## Known limitations

- CDK TypeScript is visualize-only, and constructs are matched by class name, so
  an unusual import alias can hide them.
- CloudFormation `Conditions`, `Fn::ForEach`, and nested stacks render as
  declared resources; they are not resolved. The diagram shows what the template
  declares, not what a deployment would produce.
- Terraform `count`/`for_each` resources appear once, as written.
- Nothing is validated against real AWS service constraints or live
  infrastructure.
- The Well-Architected score covers only what a template can express. It is not
  an AWS Well-Architected Tool review and does not inspect deployed resources.
- Icons are original glyphs, not AWS's official Architecture Icons. See
  [docs/icons.md](docs/icons.md).

## Development

```bash
npm test          # round-trip, graph, Terraform, CDK and rule tests
npm run typecheck
npm run lint
npm run build
npm run docs:fetch   # refresh AWS doc links via the MCP server
```

`window.store` is exposed in dev builds for poking at state from the console.

[framework]: https://docs.aws.amazon.com/wellarchitected/latest/framework/welcome.html
[mcp]: https://awslabs.github.io/mcp/servers/aws-documentation-mcp-server

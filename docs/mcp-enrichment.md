# Using the AWS Documentation MCP server without an LLM

Short answer: **yes, but at build time, not at runtime.**

## Why not at runtime

The [AWS Documentation MCP server][server] communicates over **stdio** — JSON-RPC
messages on a pipe to a child process. It exposes no HTTP endpoint and sends no
CORS headers, so a page running in a browser cannot reach it, and this app has
no backend to proxy through. Adding one would mean giving up the "static files,
no server" property that makes the app deployable anywhere.

## Why an LLM is not required

MCP is usually described as a way to give AI assistants tools, which makes it
sound as though a model is part of the protocol. It is not. The transport is
newline-delimited JSON-RPC 2.0, the handshake is three messages, and the tools
are ordinary functions with JSON Schema signatures. A language model is just the
usual *caller* — the thing that decides which tool to invoke and with what
arguments.

If you already know which tool to call and with what arguments, you can call it
yourself. That is exactly the situation here: for each entry in the service
registry we want the CloudFormation reference page, and the argument is the
resource type. No judgement is needed, so no model is needed.

`scripts/mcp-client.mjs` is a ~110-line MCP client with no dependencies:

```js
const client = new McpStdioClient('.venv/bin/awslabs.aws-documentation-mcp-server');
await client.initialize();
const result = await client.callTool('search_documentation', {
  search_phrase: 'AWS::Lambda::Function',
  limit: 6,
});
```

## What the build step produces

`scripts/fetch-aws-docs.mjs` runs the server once and writes
`src/model/aws-docs.generated.json`:

- **Service reference pages.** For every resource type in
  `src/model/registry.ts`, `search_documentation` finds candidates and a
  deterministic scoring function picks the resource's own reference page —
  preferring `aws-resource-*.html` over the `aws-properties-*.html` sub-pages
  that otherwise rank highly. This is what powers the **Docs ↗** button in the
  inspector.
- **Verified pillar and rule links.** Every hand-written documentation URL in
  the Well-Architected rules is fetched with `read_documentation` to confirm it
  still resolves, and the page's real heading is recorded. URL fragments are
  stripped before fetching, since `read_documentation` rejects anchored URLs
  while browsers handle them fine.

The output is committed, so a clone builds and runs without contacting anything.
Refresh it when AWS reorganizes its documentation:

```bash
python3 -m venv .venv
.venv/bin/pip install awslabs.aws-documentation-mcp-server
npm run docs:fetch
```

The script loads the app's TypeScript modules through Vite's `ssrLoadModule`, so
it always sees the same registry and rule set the app does — adding a service to
the registry is enough for the next run to pick up its documentation.

## It has already earned its keep

The first verification run failed on one link:

```
✗ SEC-IAM-WILDCARD
  https://docs.aws.amazon.com/IAM/latest/UserGuide/best-practices.html#grant-least-privilege
```

That turned out to be two separate things — `read_documentation` rejecting the
fragment, and a rule that was better pointed at the Well-Architected
best-practice page than at the IAM user guide. Both are fixed. A check that runs
against real AWS documentation catches link rot that no unit test would.

## What it deliberately does not do

It does not generate prose, summarize pages, or infer best practices from
documentation text — all of which would need a model and would produce output
that changes run to run. Every rule's rationale and remediation in
`src/wellarchitected/rules.ts` is written by hand and reviewed. The MCP server
supplies **links**, which are checkable facts.

[server]: https://awslabs.github.io/mcp/servers/aws-documentation-mcp-server

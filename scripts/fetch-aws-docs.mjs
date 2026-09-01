/**
 * Generates `src/model/aws-docs.generated.json` from the AWS Documentation MCP
 * server.
 *
 * ── Why this is a build step and not a feature ──────────────────────────────
 *
 * The AWS Documentation MCP server speaks JSON-RPC over stdio. It has no HTTP
 * endpoint and no CORS headers, so a page in a browser can never call it —
 * and this app deliberately has no backend to proxy through. What it *can* do
 * is run here, at build time, and leave its answers behind as a static file
 * that ships in the bundle.
 *
 * No language model is involved. MCP tools are ordinary functions behind a
 * JSON-RPC envelope; a model is only the usual caller. This script calls them
 * with fixed arguments and applies fixed rules to the results, so two runs on
 * the same day produce the same file.
 *
 * Usage:
 *   npm run docs:fetch            # refresh everything
 *   npm run docs:fetch -- --services-only
 *
 * Requires the server on PATH or in ./.venv:
 *   python3 -m venv .venv && .venv/bin/pip install awslabs.aws-documentation-mcp-server
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { McpStdioClient, jsonContent, textContent } from './mcp-client.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUTPUT = path.join(root, 'src/model/aws-docs.generated.json');

const SERVER_CANDIDATES = [
  path.join(root, '.venv/bin/awslabs.aws-documentation-mcp-server'),
  'awslabs.aws-documentation-mcp-server',
];

const args = new Set(process.argv.slice(2));
const servicesOnly = args.has('--services-only');
const linksOnly = args.has('--links-only');

function resolveServer() {
  for (const candidate of SERVER_CANDIDATES) {
    if (candidate.includes('/') ? existsSync(candidate) : true) return candidate;
  }
  return SERVER_CANDIDATES.at(-1);
}

/**
 * Loads the app's TypeScript modules through Vite, so the script always sees
 * the same registry and rule set the app does. Vite is already a dependency and
 * resolves imports exactly as the browser build does, which plain Node cannot.
 */
async function loadInputs() {
  const { createServer } = await import('vite');
  const server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  try {
    const [registry, rules, pillars] = await Promise.all([
      server.ssrLoadModule('/src/model/registry.ts'),
      server.ssrLoadModule('/src/wellarchitected/rules.ts'),
      server.ssrLoadModule('/src/wellarchitected/pillars.ts'),
    ]);
    return { registry, rules, pillars };
  } finally {
    await server.close();
  }
}

const CFN_REFERENCE = /docs\.aws\.amazon\.com\/AWSCloudFormation\/latest\/(TemplateReference|UserGuide)\//;

/**
 * Picks the documentation page for a CloudFormation resource type.
 * Prefers the resource's own reference page over property sub-pages and over
 * unrelated service guides.
 */
function pickResourcePage(results, cfnType) {
  if (!Array.isArray(results) || results.length === 0) return null;
  const wanted = cfnType.toLowerCase();
  const slug = wanted.replace(/aws::/, '').replace(/::/g, '-');

  const scored = results.map((result) => {
    const url = result.url ?? '';
    const title = (result.title ?? '').toLowerCase();
    let score = 0;
    if (CFN_REFERENCE.test(url)) score += 4;
    // "aws-resource-lambda-function.html" is the page we want; the
    // "aws-properties-..." pages document individual property types.
    if (url.includes(`aws-resource-${slug}.html`)) score += 6;
    else if (url.includes('aws-properties-')) score -= 3;
    if (title === wanted) score += 4;
    else if (title.startsWith(wanted)) score += 2;
    score -= (result.rank_order ?? 10) * 0.1;
    return { result, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score <= 0) return null;
  return { title: best.result.title, url: best.result.url };
}

async function withRetry(fn, label, attempts = 3) {
  let lastError;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      await new Promise((r) => setTimeout(r, 500 * (i + 1)));
    }
  }
  console.warn(`  ! ${label}: ${lastError?.message ?? lastError}`);
  return null;
}

/**
 * Confirms a hand-written link still resolves, and captures its real title.
 * The fragment is stripped before fetching — `read_documentation` rejects
 * anchored URLs, while a browser handles them fine — so the page is what gets
 * verified and the original link is what gets recorded.
 */
async function verifyLink(client, url) {
  const page = url.split('#')[0];
  const result = await withRetry(
    () => client.callTool('read_documentation', { url: page, max_length: 1200, start_index: 0 }),
    `verify ${page}`,
  );
  if (!result) return { url, ok: false };
  const text = textContent(result);
  const heading = text.match(/^#\s+(.+)$/m)?.[1]?.trim();
  return { url, ok: true, title: heading ?? undefined };
}

async function main() {
  const { registry, rules, pillars } = await loadInputs();
  const command = resolveServer();
  console.log(`Starting MCP server: ${command}`);

  const client = new McpStdioClient(command, [], {
    AWS_DOCUMENTATION_PARTITION: 'aws',
    FASTMCP_LOG_LEVEL: 'ERROR',
  });

  const info = await client.initialize();
  const tools = await client.listTools();
  console.log(
    `Connected to ${info.serverInfo?.name} — tools: ${tools.tools.map((t) => t.name).join(', ')}\n`,
  );

  const output = {
    generatedAt: new Date().toISOString().slice(0, 10),
    source: {
      server: info.serverInfo?.name ?? 'awslabs.aws-documentation-mcp-server',
      tools: tools.tools.map((t) => t.name),
      note: 'Generated at build time by scripts/fetch-aws-docs.mjs. No language model is involved.',
    },
    services: {},
    pillars: {},
    rules: {},
  };

  // ── Service reference pages ───────────────────────────────────────────────
  if (!linksOnly) {
    const services = registry.SERVICES.filter((s) => s.cfn);
    console.log(`Resolving ${services.length} resource reference pages…`);
    for (const [index, service] of services.entries()) {
      const result = await withRetry(
        () =>
          client.callTool('search_documentation', {
            search_phrase: service.cfn,
            search_intent: 'Find the CloudFormation resource reference page for this resource type',
            limit: 6,
          }),
        `search ${service.cfn}`,
      );
      const parsed = result ? jsonContent(result) : null;
      const page = pickResourcePage(parsed?.search_results ?? parsed, service.cfn);
      if (page) {
        output.services[service.canonical] = page;
        console.log(`  [${index + 1}/${services.length}] ${service.cfn} → ${page.url}`);
      } else {
        console.log(`  [${index + 1}/${services.length}] ${service.cfn} → (no confident match)`);
      }
    }
  }

  // ── Pillar and rule links ─────────────────────────────────────────────────
  if (!servicesOnly) {
    console.log(`\nVerifying ${pillars.PILLARS.length} pillar links…`);
    for (const pillar of pillars.PILLARS) {
      const check = await verifyLink(client, pillar.docsUrl);
      output.pillars[pillar.id] = check;
      console.log(`  ${check.ok ? '✓' : '✗'} ${pillar.id}`);
    }

    const ruleLinks = rules.RULES.filter((r) => r.docs);
    console.log(`\nVerifying ${ruleLinks.length} rule links…`);
    for (const rule of ruleLinks) {
      const check = await verifyLink(client, rule.docs);
      output.rules[rule.id] = check;
      console.log(`  ${check.ok ? '✓' : '✗'} ${rule.id}`);
    }
  }

  client.close();

  await writeFile(OUTPUT, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  const broken = [
    ...Object.entries(output.pillars),
    ...Object.entries(output.rules),
  ].filter(([, v]) => v && v.ok === false);

  console.log(`\nWrote ${path.relative(root, OUTPUT)}`);
  console.log(
    `  ${Object.keys(output.services).length} service pages, ` +
      `${Object.keys(output.pillars).length} pillars, ${Object.keys(output.rules).length} rules`,
  );
  if (broken.length) {
    console.log(`  ${broken.length} link(s) did not resolve: ${broken.map(([k]) => k).join(', ')}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

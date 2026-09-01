/**
 * A minimal MCP client speaking JSON-RPC 2.0 over stdio.
 *
 * MCP is often described as "a protocol for connecting LLMs to tools", which
 * makes it sound as though a model is required. It is not: the transport is
 * newline-delimited JSON-RPC over a pipe, and the tools are ordinary functions.
 * A language model is just the usual *caller*. This client calls them directly,
 * with fixed arguments, so the results are deterministic and reproducible.
 */

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

const PROTOCOL_VERSION = '2024-11-05';

export class McpStdioClient {
  #child;
  #pending = new Map();
  #nextId = 1;
  #stderr = [];

  constructor(command, args = [], env = {}) {
    this.#child = spawn(command, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...env },
    });

    createInterface({ input: this.#child.stdout }).on('line', (line) => {
      if (!line.trim()) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return; // Servers sometimes log plain text to stdout; ignore it.
      }
      const pending = this.#pending.get(message.id);
      if (!pending) return;
      this.#pending.delete(message.id);
      if (message.error) pending.reject(new Error(message.error.message ?? 'MCP error'));
      else pending.resolve(message.result);
    });

    createInterface({ input: this.#child.stderr }).on('line', (line) => {
      this.#stderr.push(line);
    });

    this.#child.on('exit', (code) => {
      for (const [, pending] of this.#pending) {
        pending.reject(new Error(`MCP server exited (${code}):\n${this.#stderr.slice(-8).join('\n')}`));
      }
      this.#pending.clear();
    });
  }

  #send(message) {
    this.#child.stdin.write(`${JSON.stringify(message)}\n`);
  }

  request(method, params, timeoutMs = 45_000) {
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`MCP request "${method}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.#pending.set(id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
      this.#send({ jsonrpc: '2.0', id, method, params });
    });
  }

  async initialize(clientName = 'infra-canvas-docgen') {
    const result = await this.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: clientName, version: '1.0.0' },
    });
    this.#send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    return result;
  }

  listTools() {
    return this.request('tools/list', {});
  }

  async callTool(name, args) {
    const result = await this.request('tools/call', { name, arguments: args });
    if (result?.isError) {
      throw new Error(`Tool "${name}" failed: ${JSON.stringify(result.content)}`);
    }
    return result;
  }

  close() {
    this.#child.stdin.end();
    this.#child.kill();
  }
}

/** Tool results arrive as content blocks; most of ours are JSON in a text block. */
export function textContent(result) {
  return (result?.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\n');
}

export function jsonContent(result) {
  const text = textContent(result);
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

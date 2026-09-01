import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const fixture = (name: string): string =>
  readFileSync(join(import.meta.dirname, 'fixtures', name), 'utf8');

/** Lines that differ between two versions, for asserting a minimal diff. */
export function changedLines(before: string, after: string): string[] {
  const a = before.split('\n');
  const b = after.split('\n');
  const out: string[] = [];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) out.push(`${a[i] ?? '<none>'} => ${b[i] ?? '<none>'}`);
  }
  return out;
}

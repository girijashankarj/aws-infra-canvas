/**
 * Property panel for the selected resource.
 *
 * Every control here emits a `ModelOp`; none of them touch the model. Editing a
 * value rewrites exactly that scalar in the source, so comments and formatting
 * around it survive.
 */

import { useState } from 'react';

import { getDialect } from '../../dialects';
import { ServiceIcon } from '../../icons';
import { serviceDocs } from '../../model/docs';
import { getPillar } from '../../wellarchitected/pillars';
import { findingsByNode } from '../../wellarchitected/review';
import { CATEGORY_COLORS, fallbackName, lookupCanonical } from '../../model/registry';
import type { PropPath } from '../../model/types';
import { useStore } from '../../state/store';

/** Depth beyond which nested objects are shown as raw JSON instead of rows. */
const MAX_DEPTH = 5;
const MAX_ROWS = 120;

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `{ Ref: "X" }`, `{ "Fn::GetAtt": [...] }` — shown whole, never split apart. */
function intrinsicOf(value: unknown): string | null {
  if (!isPlainObject(value)) return null;
  const keys = Object.keys(value);
  if (keys.length !== 1) return null;
  const key = keys[0];
  if (key === 'Ref' || key === 'Condition' || key.startsWith('Fn::') || key === 'Tf::Ref') {
    const inner = value[key];
    return `${key}: ${typeof inner === 'string' ? inner : JSON.stringify(inner)}`;
  }
  return null;
}

interface Row {
  path: PropPath;
  key: string;
  value: unknown;
  /** Editable primitives get an input; everything else is displayed as-is. */
  editable: boolean;
  display: string;
}

function flatten(value: unknown, path: PropPath, out: Row[], depth = 0): void {
  if (out.length >= MAX_ROWS) return;

  const label = path.join('.');
  const intrinsic = intrinsicOf(value);

  if (intrinsic !== null) {
    out.push({ path, key: label, value, editable: false, display: intrinsic });
    return;
  }
  if (value === null || typeof value !== 'object') {
    out.push({
      path,
      key: label,
      value,
      editable: true,
      display: value === null ? 'null' : String(value),
    });
    return;
  }
  if (depth >= MAX_DEPTH) {
    out.push({ path, key: label, value, editable: false, display: JSON.stringify(value, null, 1) });
    return;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push({ path, key: label, value, editable: false, display: '[]' });
      return;
    }
    value.forEach((item, i) => flatten(item, [...path, i], out, depth + 1));
    return;
  }
  const entries = Object.entries(value);
  if (entries.length === 0) {
    out.push({ path, key: label, value, editable: false, display: '{}' });
    return;
  }
  for (const [k, v] of entries) flatten(v, [...path, k], out, depth + 1);
}

/**
 * Identifier rules differ by dialect: CloudFormation logical IDs are strictly
 * alphanumeric, Terraform addresses are `type.name` with a laxer name.
 */
function isValidId(next: string, current: string): boolean {
  if (!current.includes('.')) return /^[A-Za-z0-9]+$/.test(next);
  const [type, ...rest] = next.split('.');
  const name = rest.join('.');
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(type) && /^[A-Za-z_][A-Za-z0-9_-]*$/.test(name);
}

/** Turns an input string back into the JSON-ish type CloudFormation expects. */
function coerce(input: string, previous: unknown): unknown {
  if (typeof previous === 'number') {
    const n = Number(input);
    return input.trim() !== '' && Number.isFinite(n) ? n : input;
  }
  if (typeof previous === 'boolean') {
    if (/^(true|false)$/i.test(input.trim())) return input.trim().toLowerCase() === 'true';
    return input;
  }
  return input;
}

export function Inspector() {
  const node = useStore((s) => s.model.nodes.find((n) => n.id === s.selectedId));
  const dialectId = useStore((s) => s.dialectId);
  const applyOps = useStore((s) => s.applyOps);
  const select = useStore((s) => s.select);
  const review = useStore((s) => s.review);
  const setReviewOpen = useStore((s) => s.setReviewOpen);

  /**
   * The in-progress rename, tagged with the resource it belongs to. Deriving
   * the field's value during render means switching selection resets the draft
   * without an effect round-trip.
   */
  const [draft, setDraft] = useState<{ for: string; value: string } | null>(null);

  if (!node) return null;

  const draftId = draft?.for === node.id ? draft.value : node.id;
  const setDraftId = (value: string) => setDraft({ for: node.id, value });

  const def = lookupCanonical(node.canonicalType);
  const tint = def ? CATEGORY_COLORS[def.category] : 'var(--edge)';
  const writable = (dialectId && getDialect(dialectId)?.canWriteBack) === true && !node.readOnly;

  const rows: Row[] = [];
  flatten(node.props, [], rows);
  const shown = rows.filter((r) => r.path.length > 0);
  const docs = serviceDocs(node.canonicalType);
  const nodeFindings = findingsByNode(review).get(node.id) ?? [];

  const commitRename = () => {
    const next = draftId.trim();
    setDraft(null);
    if (!next || next === node.id) return;
    if (!isValidId(next, node.id)) {
      useStore.getState().setNotice(
        node.id.includes('.')
          ? 'A Terraform resource name may contain letters, digits, underscores and dashes.'
          : 'A CloudFormation logical ID must be alphanumeric.',
      );
      return;
    }
    applyOps([{ op: 'renameResource', from: node.id, to: next }]);
    select(next);
  };

  return (
    <aside className="inspector" style={{ '--tint': tint } as React.CSSProperties}>
      <header>
        <span className="glyph">
          <ServiceIcon icon={def?.icon ?? 'generic'} size={22} />
        </span>
        <div className="hid">
          <input
            value={draftId}
            disabled={!writable}
            onChange={(e) => setDraftId(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') e.currentTarget.blur();
              if (e.key === 'Escape') {
                setDraft(null);
                e.currentTarget.blur();
              }
            }}
            aria-label="Logical ID"
            spellCheck={false}
          />
          <div className="type">{def?.name ?? fallbackName(node.rawType)} · {node.rawType}</div>
        </div>
      </header>

      {nodeFindings.length > 0 && (
        <button type="button" className="note findings-note" onClick={() => setReviewOpen(true)}>
          {nodeFindings.length} Well-Architected finding{nodeFindings.length === 1 ? '' : 's'}:{' '}
          {[...new Set(nodeFindings.map((f) => getPillar(f.pillar).name))].join(', ')} →
        </button>
      )}

      {node.readOnly && (
        <div className="note">
          Parsed from CDK source, which this editor does not write back to. Export the synthesized
          template to edit it here.
        </div>
      )}

      <div className="rows">
        {shown.length === 0 && (
          <div className="note" style={{ borderBottom: 'none' }}>
            No properties set.
          </div>
        )}
        {shown.map((row) => (
          <div className="row" key={row.key}>
            <div className="k">{row.key}</div>
            {writable && (
              <button
                type="button"
                className="del"
                title={`Remove ${row.key}`}
                aria-label={`Remove ${row.key}`}
                onClick={() => applyOps([{ op: 'deleteProp', id: node.id, path: row.path }])}
              >
                ×
              </button>
            )}
            {row.editable && writable ? (
              <input
                className="v"
                defaultValue={row.display}
                key={`${node.id}:${row.key}:${row.display}`}
                spellCheck={false}
                onBlur={(e) => {
                  if (e.target.value === row.display) return;
                  applyOps([
                    {
                      op: 'setProp',
                      id: node.id,
                      path: row.path,
                      value: coerce(e.target.value, row.value),
                    },
                  ]);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur();
                }}
              />
            ) : (
              <div className="ro v">{row.display}</div>
            )}
          </div>
        ))}
      </div>

      <footer>
        <button type="button" className="btn" onClick={() => select(node.id, { reveal: true })}>
          Reveal in source
        </button>
        {docs && (
          <a
            className="btn"
            href={docs.url}
            target="_blank"
            rel="noreferrer noopener"
            title={`AWS documentation for ${node.rawType}`}
          >
            Docs ↗
          </a>
        )}
        <span className="spacer" />
        <button
          type="button"
          className="btn"
          disabled={!writable}
          onClick={() => applyOps([{ op: 'deleteResource', id: node.id }])}
        >
          Delete
        </button>
      </footer>
    </aside>
  );
}

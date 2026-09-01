import { useEffect, useRef, useState } from 'react';

import { lookupCanonical } from '../../model/registry';
import type { ResourceNode } from '../../model/types';
import { suggestPropertyPath } from './suggest';

export interface PendingConnection {
  from: ResourceNode;
  to: ResourceNode;
}

interface Props {
  pending: PendingConnection;
  onConfirm(path: string): void;
  onCancel(): void;
}

/**
 * A drawn edge has to become a real property somewhere. Rather than guessing
 * silently, we show the suggestion and let the user correct it.
 */
export function ConnectDialog({ pending, onConfirm, onCancel }: Props) {
  const { from, to } = pending;
  const [path, setPath] = useState(() =>
    suggestPropertyPath(from.canonicalType, to.canonicalType),
  );
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.select();
  }, []);

  const toName = lookupCanonical(to.canonicalType)?.name ?? to.rawType;

  return (
    <div className="backdrop" onClick={onCancel} role="presentation">
      <div
        className="dialog"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Add reference"
      >
        <h3>Reference {to.id}</h3>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onConfirm(path);
          }}
        >
          <div className="body">
            <p>
              Adds <code>!Ref {to.id}</code> to <code>{from.id}</code> at the property below.
              Use dots for nesting and a number for a list index.
            </p>
            <input
              ref={inputRef}
              value={path}
              onChange={(e) => setPath(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && onCancel()}
              aria-label="Property path"
              spellCheck={false}
            />
            <p style={{ fontSize: 11 }}>
              Target is a {toName}.
            </p>
          </div>
          <div className="actions">
            <button type="button" className="btn" onClick={onCancel}>
              Cancel
            </button>
            <button type="submit" className="btn primary" disabled={!path.trim()}>
              Add reference
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

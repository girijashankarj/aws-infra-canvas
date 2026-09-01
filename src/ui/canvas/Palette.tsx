import { useState } from 'react';

import { CATEGORY_COLORS, paletteServices } from '../../model/registry';
import { ServiceIcon } from '../../icons';
import { useStore } from '../../state/store';
import { getDialect } from '../../dialects';

/**
 * Drag a service onto the canvas to add it to the template. Hidden for dialects
 * that cannot be written back to, where there is nothing useful to drop.
 */
export function Palette() {
  const dialectId = useStore((s) => s.dialectId);
  const [open, setOpen] = useState(true);

  const dialect = dialectId ? getDialect(dialectId) : undefined;
  if (!dialect?.canWriteBack) return null;

  return (
    <div className="palette">
      <header>
        Add resource
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          style={{ border: 'none', background: 'none', cursor: 'pointer', color: 'inherit' }}
        >
          {open ? '–' : '+'}
        </button>
      </header>
      {open && (
        <ul>
          {paletteServices().map((service) => (
            <li
              key={service.canonical}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData('application/x-aws-service', service.canonical);
                e.dataTransfer.effectAllowed = 'copy';
              }}
              style={{ '--tint': CATEGORY_COLORS[service.category] } as React.CSSProperties}
              title={service.cfn}
            >
              <span className="glyph">
                <ServiceIcon icon={service.icon} size={16} />
              </span>
              <span>{service.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

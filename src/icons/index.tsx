/**
 * Service glyphs.
 *
 * These are original, deliberately simple line glyphs — not AWS's official
 * Architecture Icons, which are licensed separately and are not redistributed
 * here. See `docs/icons.md` for swapping in the official pack.
 *
 * Every glyph draws on a 24×24 grid using `currentColor`, so the node component
 * can tint it by service category.
 */

import type { JSX } from 'react';
import type { IconKey } from '../model/registry';

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
} as const;

const glyphs: Record<IconKey, JSX.Element> = {
  lambda: (
    <g {...S}>
      <path d="M5 20 13.5 4h2.2" />
      <path d="M9.6 12.5 14 20" />
      <path d="M4 4h4" />
    </g>
  ),
  server: (
    <g {...S}>
      <rect x="3.5" y="4.5" width="17" height="6" rx="1.5" />
      <rect x="3.5" y="13.5" width="17" height="6" rx="1.5" />
      <path d="M6.5 7.5h.01M6.5 16.5h.01" />
      <path d="M10 7.5h6M10 16.5h6" />
    </g>
  ),
  container: (
    <g {...S}>
      <path d="M12 3.2 20 7.5v9L12 20.8 4 16.5v-9z" />
      <path d="M4 7.5 12 12l8-4.5M12 12v8.8" />
    </g>
  ),
  bucket: (
    <g {...S}>
      <path d="M4.5 6h15l-1.6 12.2a1.5 1.5 0 0 1-1.5 1.3H7.6a1.5 1.5 0 0 1-1.5-1.3z" />
      <ellipse cx="12" cy="6" rx="7.5" ry="2.2" />
      <path d="M8.4 11.5h7.2" />
    </g>
  ),
  database: (
    <g {...S}>
      <ellipse cx="12" cy="6.2" rx="7.5" ry="2.8" />
      <path d="M4.5 6.2v11.6c0 1.55 3.36 2.8 7.5 2.8s7.5-1.25 7.5-2.8V6.2" />
      <path d="M19.5 12c0 1.55-3.36 2.8-7.5 2.8S4.5 13.55 4.5 12" />
    </g>
  ),
  table: (
    <g {...S}>
      <rect x="3.5" y="4.5" width="17" height="15" rx="1.5" />
      <path d="M3.5 9.5h17M3.5 14.5h17M9.5 9.5v10" />
    </g>
  ),
  cloud: (
    <g {...S}>
      <path d="M7.4 18.5A4.4 4.4 0 0 1 7 9.75a5.6 5.6 0 0 1 10.7 1.05 3.9 3.9 0 0 1-.8 7.7z" />
    </g>
  ),
  subnet: (
    <g {...S}>
      <rect x="3.5" y="5.5" width="17" height="13" rx="2" strokeDasharray="3 2.5" />
      <path d="M8 12h.01M12 12h.01M16 12h.01" strokeWidth="2.6" />
    </g>
  ),
  gateway: (
    <g {...S}>
      <path d="M12 3.4 20 8v8l-8 4.6L4 16V8z" />
      <path d="M8.5 12h7M13 9.5l2.5 2.5L13 14.5" />
    </g>
  ),
  router: (
    <g {...S}>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 3.5v5.3M12 15.2v5.3M3.5 12h5.3M15.2 12h5.3" />
    </g>
  ),
  loadbalancer: (
    <g {...S}>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="5" cy="19" r="2.2" />
      <circle cx="12" cy="19" r="2.2" />
      <circle cx="19" cy="19" r="2.2" />
      <path d="M12 7.2v3.3M5 16.8v-2.3h14v2.3M12 14.5v2.3" />
    </g>
  ),
  cdn: (
    <g {...S}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M3.8 12h16.4" />
      <path d="M12 3.8c2.2 2.3 3.3 5.1 3.3 8.2s-1.1 5.9-3.3 8.2c-2.2-2.3-3.3-5.1-3.3-8.2S9.8 6.1 12 3.8z" />
    </g>
  ),
  queue: (
    <g {...S}>
      <rect x="3.5" y="6.5" width="4.5" height="11" rx="1" />
      <rect x="9.8" y="6.5" width="4.5" height="11" rx="1" />
      <rect x="16.1" y="6.5" width="4.4" height="11" rx="1" />
    </g>
  ),
  topic: (
    <g {...S}>
      <circle cx="12" cy="12" r="2.4" />
      <path d="M7.6 7.6a6.2 6.2 0 0 0 0 8.8M16.4 16.4a6.2 6.2 0 0 0 0-8.8" />
      <path d="M4.8 4.8a10.2 10.2 0 0 0 0 14.4M19.2 19.2a10.2 10.2 0 0 0 0-14.4" />
    </g>
  ),
  statemachine: (
    <g {...S}>
      <circle cx="5.6" cy="7" r="2.4" />
      <circle cx="18.4" cy="7" r="2.4" />
      <circle cx="12" cy="18" r="2.4" />
      <path d="M8 7h8M17.2 9.2 13.4 15.8M10.6 15.8 6.8 9.2" />
    </g>
  ),
  key: (
    <g {...S}>
      <circle cx="8" cy="12" r="3.6" />
      <path d="M11.6 12h8.9M17.6 12v3.2M14.8 12v2.4" />
    </g>
  ),
  shield: (
    <g {...S}>
      <path d="M12 3.4 19 6v5.6c0 4.1-2.8 7.5-7 8.9-4.2-1.4-7-4.8-7-8.9V6z" />
      <path d="M9.2 12.1 11.3 14l3.6-4" />
    </g>
  ),
  user: (
    <g {...S}>
      <circle cx="12" cy="8.4" r="3.6" />
      <path d="M4.8 20a7.2 7.2 0 0 1 14.4 0" />
    </g>
  ),
  clock: (
    <g {...S}>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7v5.3l3.4 2" />
    </g>
  ),
  log: (
    <g {...S}>
      <path d="M6 3.5h8.5L19 8v12.5H6z" />
      <path d="M14 3.5V8h5" />
      <path d="M9 12.5h7M9 16h5" />
    </g>
  ),
  stream: (
    <g {...S}>
      <path d="M3.5 8.5c3-2.4 5.9-2.4 8.8 0s5.8 2.4 8.7 0" />
      <path d="M3.5 13.5c3-2.4 5.9-2.4 8.8 0s5.8 2.4 8.7 0" />
      <path d="M3.5 18.5c3-2.4 5.9-2.4 8.8 0s5.8 2.4 8.7 0" />
    </g>
  ),
  generic: (
    <g {...S}>
      <rect x="4" y="4" width="16" height="16" rx="3" />
      <path d="M8.5 12h7" />
    </g>
  ),
};

export interface ServiceIconProps {
  icon: IconKey;
  size?: number;
  className?: string;
}

export function ServiceIcon({ icon, size = 24, className }: ServiceIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="presentation"
      aria-hidden="true"
    >
      {glyphs[icon] ?? glyphs.generic}
    </svg>
  );
}

import { useRef } from 'react';

const ACCEPT = '.yaml,.yml,.json,.template,.tf,.ts';

/**
 * Hidden `<input type="file">` used as the fallback on browsers without the
 * File System Access API.
 */
export function FileInput({
  onPick,
  ref,
}: {
  onPick: (file: File) => void;
  ref?: React.Ref<HTMLInputElement>;
}) {
  const fallbackRef = useRef<HTMLInputElement>(null);
  return (
    <input
      ref={ref ?? fallbackRef}
      type="file"
      accept={ACCEPT}
      style={{ display: 'none' }}
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) onPick(file);
        e.target.value = '';
      }}
    />
  );
}

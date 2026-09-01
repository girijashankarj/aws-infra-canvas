/**
 * Opening a template: a file picker, drag-and-drop onto the editor pane, and
 * saving back out.
 *
 * Uses the File System Access API when the browser has it, so "Save" can write
 * straight back to the file the user opened; otherwise it falls back to a
 * download and a plain `<input type="file">`.
 */

import { useCallback, useRef, useState } from 'react';

import { useStore } from '../state/store';

interface FileSystemHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string): Promise<void>; close(): Promise<void> }>;
}

interface PickerWindow {
  showOpenFilePicker?: (options?: unknown) => Promise<FileSystemHandle[]>;
  showSaveFilePicker?: (options?: unknown) => Promise<FileSystemHandle>;
}

const picker = window as unknown as PickerWindow;
export const hasFileSystemAccess = typeof picker.showOpenFilePicker === 'function';

const PICKER_TYPES = [
  {
    description: 'Infrastructure as code',
    accept: {
      'text/yaml': ['.yaml', '.yml', '.template'],
      'application/json': ['.json'],
      'text/plain': ['.tf', '.ts'],
    },
  },
];

export function useFileOpen() {
  const loadFile = useStore((s) => s.loadFile);
  const setNotice = useStore((s) => s.setNotice);
  const handleRef = useRef<FileSystemHandle | null>(null);

  const openFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      loadFile(file.name, text);
    },
    [loadFile],
  );

  const open = useCallback(async () => {
    if (!picker.showOpenFilePicker) return false;
    try {
      const [handle] = await picker.showOpenFilePicker({ types: PICKER_TYPES, multiple: false });
      if (!handle) return true;
      handleRef.current = handle;
      await openFile(await handle.getFile());
      return true;
    } catch (err) {
      // An aborted picker is a normal user action, not an error worth showing.
      if ((err as DOMException)?.name !== 'AbortError') {
        setNotice(`Could not open that file: ${err instanceof Error ? err.message : err}`);
      }
      return true;
    }
  }, [openFile, setNotice]);

  const save = useCallback(async () => {
    const { text, filename } = useStore.getState();
    const name = filename ?? 'template.yaml';

    if (picker.showSaveFilePicker) {
      try {
        const handle =
          handleRef.current ??
          (await picker.showSaveFilePicker({ suggestedName: name, types: PICKER_TYPES }));
        const writable = await handle.createWritable();
        await writable.write(text);
        await writable.close();
        handleRef.current = handle;
        setNotice(`Saved ${handle.name}.`);
        return;
      } catch (err) {
        if ((err as DOMException)?.name === 'AbortError') return;
        setNotice(`Could not save: ${err instanceof Error ? err.message : err}`);
        return;
      }
    }

    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    link.click();
    URL.revokeObjectURL(url);
  }, [setNotice]);

  /** Clears the saved handle so the next Save asks for a destination. */
  const forgetHandle = useCallback(() => {
    handleRef.current = null;
  }, []);

  return { open, openFile, save, forgetHandle };
}

/** Drag-and-drop overlay for the editor pane. */
export function useDropTarget(onFile: (file: File) => void) {
  const [over, setOver] = useState(false);

  const handlers = {
    onDragOver: (e: React.DragEvent) => {
      if (!e.dataTransfer.types.includes('Files')) return;
      e.preventDefault();
      setOver(true);
    },
    onDragLeave: (e: React.DragEvent) => {
      if (e.currentTarget.contains(e.relatedTarget as globalThis.Node)) return;
      setOver(false);
    },
    onDrop: (e: React.DragEvent) => {
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      e.preventDefault();
      setOver(false);
      onFile(file);
    },
  };

  return { over, handlers };
}

/**
 * The left pane: the source of truth.
 *
 * Beyond plain editing it does three sync jobs:
 *   - publishes every edit to the store (debounced, so parsing does not run on
 *     each keystroke);
 *   - renders the model's diagnostics as markers;
 *   - keeps selection in step with the diagram in both directions.
 */

import Editor, { type OnMount } from '@monaco-editor/react';
import { useCallback, useEffect, useRef } from 'react';

import { getDialect } from '../../dialects';
import { useStore } from '../../state/store';
import { defineThemes, monaco, THEME_DARK, THEME_LIGHT } from './setup';

type Editor = monaco.editor.IStandaloneCodeEditor;

const PARSE_DEBOUNCE_MS = 250;
const MARKER_OWNER = 'iac-diagram';

const severityOf = (s: string): monaco.MarkerSeverity =>
  s === 'error'
    ? monaco.MarkerSeverity.Error
    : s === 'warning'
      ? monaco.MarkerSeverity.Warning
      : monaco.MarkerSeverity.Info;

export function MonacoPane({ dark }: { dark: boolean }) {
  const text = useStore((s) => s.text);
  const dialectId = useStore((s) => s.dialectId);
  const diagnostics = useStore((s) => s.model.diagnostics);
  const nodes = useStore((s) => s.model.nodes);
  const selectedId = useStore((s) => s.selectedId);
  const reveal = useStore((s) => s.reveal);
  const setText = useStore((s) => s.setText);
  const selectAtOffset = useStore((s) => s.selectAtOffset);

  const editorRef = useRef<Editor | null>(null);
  const decorationsRef = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Text this pane last pushed, so store-driven updates are not echoed back. */
  const localRef = useRef<string>('');
  /** Suppresses selection sync while we are the ones moving the cursor. */
  const programmaticRef = useRef(false);

  const language = (dialectId && getDialect(dialectId)?.language) || 'yaml';

  const onMount = useCallback<OnMount>(
    (editor, m) => {
      editorRef.current = editor;
      defineThemes(m);
      m.editor.setTheme(dark ? THEME_DARK : THEME_LIGHT);
      decorationsRef.current = editor.createDecorationsCollection();

      editor.onDidChangeCursorPosition((e) => {
        if (programmaticRef.current) return;
        const model = editor.getModel();
        if (model) selectAtOffset(model.getOffsetAt(e.position));
      });
    },
    [dark, selectAtOffset],
  );

  // Debounce parsing: typing stays responsive on large templates.
  const onChange = useCallback(
    (value: string | undefined) => {
      const next = value ?? '';
      localRef.current = next;
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => setText(next), PARSE_DEBOUNCE_MS);
    },
    [setText],
  );

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  // The store may replace the text (diagram edit, file open, sample). Only push
  // it into the editor when it genuinely differs from what is on screen, so the
  // cursor and undo stack survive our own round-trips.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || text === localRef.current) return;
    localRef.current = text;

    const position = editor.getPosition();
    programmaticRef.current = true;
    // `pushEditOperations` keeps this in the undo stack, so ⌘Z undoes a
    // diagram edit just like a typed one.
    model.pushEditOperations(
      null,
      [{ range: model.getFullModelRange(), text }],
      () => null,
    );
    if (position) editor.setPosition(position);
    programmaticRef.current = false;
  }, [text]);

  useEffect(() => {
    const model = editorRef.current?.getModel();
    if (!model) return;
    monaco.editor.setModelMarkers(
      model,
      MARKER_OWNER,
      diagnostics.map((d) => {
        const start = model.getPositionAt(d.range?.start ?? 0);
        const end = model.getPositionAt(d.range?.end ?? 0);
        return {
          severity: severityOf(d.severity),
          message: d.message,
          startLineNumber: start.lineNumber,
          startColumn: start.column,
          endLineNumber: end.lineNumber,
          endColumn: end.column,
        };
      }),
    );
  }, [diagnostics]);

  // Highlight the selected resource's block.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    const collection = decorationsRef.current;
    if (!editor || !model || !collection) return;

    const node = nodes.find((n) => n.id === selectedId);
    if (!node) {
      collection.clear();
      return;
    }
    const start = model.getPositionAt(node.range.start);
    const end = model.getPositionAt(node.range.end);
    collection.set([
      {
        range: new monaco.Range(start.lineNumber, 1, end.lineNumber, 1),
        options: {
          isWholeLine: true,
          className: 'sel-block',
          overviewRuler: {
            color: '#5b93ff',
            position: monaco.editor.OverviewRulerLane.Left,
          },
        },
      },
    ]);
  }, [selectedId, nodes]);

  // Scroll to a resource when the diagram asks for it.
  useEffect(() => {
    const editor = editorRef.current;
    const model = editor?.getModel();
    if (!editor || !model || !reveal) return;
    const position = model.getPositionAt(reveal.offset);
    programmaticRef.current = true;
    editor.revealLineInCenterIfOutsideViewport(position.lineNumber, 0);
    editor.setPosition(position);
    programmaticRef.current = false;
  }, [reveal]);

  useEffect(() => {
    monaco.editor.setTheme(dark ? THEME_DARK : THEME_LIGHT);
  }, [dark]);

  return (
    <Editor
      language={language}
      defaultValue={text}
      onMount={onMount}
      onChange={onChange}
      options={{
        fontSize: 12.5,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderWhitespace: 'selection',
        tabSize: 2,
        automaticLayout: true,
        smoothScrolling: true,
        padding: { top: 10, bottom: 10 },
        bracketPairColorization: { enabled: false },
      }}
    />
  );
}

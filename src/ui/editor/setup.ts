/**
 * Wires @monaco-editor/react to the locally bundled Monaco.
 *
 * By default the React wrapper fetches Monaco from a CDN, which would make the
 * app fail offline and under a strict CSP. Configuring the loader with the
 * bundled instance — and registering Vite-built web workers — keeps everything
 * self-contained.
 *
 * Monaco already ships grammars for every dialect we support, but importing the
 * `monaco-editor` barrel would pull in all ~80 of them. Only the four we can
 * actually open are registered, which roughly halves the bundle.
 */

import { loader } from '@monaco-editor/react';
import * as monaco from 'monaco-editor/editor/editor.api';

// Syntax highlighting for the dialects we parse. Each `register` module only
// declares the language; its grammar is fetched lazily when first used.
import 'monaco-editor/languages/definitions/yaml/register';
import 'monaco-editor/languages/definitions/hcl/register';
import 'monaco-editor/languages/definitions/typescript/register';
import 'monaco-editor/languages/definitions/javascript/register';

// JSON and TypeScript additionally have real language services (folding,
// validation, hovers), contributed separately from the grammars above.
import 'monaco-editor/language/json/monaco.contribution';
import 'monaco-editor/language/typescript/monaco.contribution';
import EditorWorker from 'monaco-editor/editor/editor.worker?worker';
import JsonWorker from 'monaco-editor/language/json/json.worker?worker';
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker';
import { jsonDefaults } from 'monaco-editor/language/json/monaco.contribution';

declare global {
  interface Window {
    MonacoEnvironment?: monaco.Environment;
  }
}

window.MonacoEnvironment = {
  getWorker(_id, label) {
    if (label === 'json') return new JsonWorker();
    if (label === 'typescript' || label === 'javascript') return new TsWorker();
    return new EditorWorker();
  },
};

// The dialect owns all diagnostics, so Monaco's own JSON validation is turned
// off to avoid double-reporting the same syntax error. `enableSchemaRequest`
// stays false so the editor never reaches out to the network.
jsonDefaults.setDiagnosticsOptions({
  validate: false,
  allowComments: true,
  schemas: [],
  enableSchemaRequest: false,
});

loader.config({ monaco });

export const THEME_DARK = 'iac-dark';
export const THEME_LIGHT = 'iac-light';

let themesDefined = false;

/** Editor themes tuned to match the app's surface colors. */
export function defineThemes(m: typeof monaco): void {
  if (themesDefined) return;
  themesDefined = true;

  m.editor.defineTheme(THEME_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#14171d',
      'editorGutter.background': '#14171d',
      'editor.lineHighlightBackground': '#1b1f27',
      'editorLineNumber.foreground': '#4b5464',
      'editorLineNumber.activeForeground': '#a2abba',
      'editor.selectionBackground': '#2b3a5c',
      'editorIndentGuide.background1': '#252a34',
      'editorWidget.background': '#1b1f27',
      'editorWidget.border': '#2b313c',
    },
  });

  m.editor.defineTheme(THEME_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [],
    colors: {
      'editor.background': '#ffffff',
      'editorGutter.background': '#ffffff',
      'editor.lineHighlightBackground': '#f4f5f7',
      'editorLineNumber.foreground': '#b3bac5',
      'editorLineNumber.activeForeground': '#5b6472',
      'editorIndentGuide.background1': '#eceef1',
    },
  });
}

export { monaco };

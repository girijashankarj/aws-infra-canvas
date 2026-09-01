/**
 * Monaco 0.56 moved the per-language service defaults out of the
 * `monaco.languages.*` namespaces and into the contribution modules, which ship
 * without type declarations. Only the piece we use is declared here.
 */
declare module 'monaco-editor/language/json/monaco.contribution' {
  export const jsonDefaults: {
    setDiagnosticsOptions(options: {
      validate?: boolean;
      allowComments?: boolean;
      schemas?: unknown[];
      enableSchemaRequest?: boolean;
    }): void;
  };
}

/**
 * Application state and the text ⇄ diagram sync loop.
 *
 * The rule that keeps the two panes honest: **the text is the only source of
 * truth.** The diagram never mutates the model directly. Canvas interactions
 * emit `ModelOp`s, the dialect rewrites the source, and the new text is parsed
 * back into a model. Because the round trip is synchronous and one-directional,
 * there is no echo to guard against — feeding identical text back in is a
 * cheap no-op.
 *
 * Node positions are the one piece of state that is *not* derived from the
 * text, unless layout persistence is on, in which case they round-trip through
 * the template's `Metadata` block like everything else.
 */

import { create } from 'zustand';

import { detectDialect, getDialect, parseWith } from '../dialects';
import { autoLayout, placeNewNodes } from '../layout/elk';
import { emptyModel, type DialectId, type Model, type ModelOp, type XY } from '../model/types';
import { reviewModel, type Review } from '../wellarchitected/review';

export interface AppState {
  filename: string | null;
  text: string;
  dialectId: DialectId | null;
  /** Set when the user picks a dialect by hand; suppresses auto-detection. */
  dialectLocked: boolean;
  model: Model;
  doc: unknown;
  /** Well-Architected findings for the current model. */
  review: Review;

  positions: Record<string, XY>;
  sizes: Record<string, { width: number; height: number }>;
  selectedId: string | null;
  /** Character offset the editor should reveal, bumped to retrigger. */
  reveal: { offset: number; token: number } | null;

  persistLayout: boolean;
  layoutPending: boolean;
  /**
   * Bumped whenever the arrangement changes wholesale (new file, auto layout).
   * The canvas watches it to re-fit the viewport, which cannot happen at mount
   * because layout is asynchronous.
   */
  fitToken: number;
  /** Transient, user-facing notice (e.g. "this dialect is read-only"). */
  notice: string | null;

  setText(text: string, opts?: { filename?: string | null; redetect?: boolean }): void;
  loadFile(name: string, text: string): void;
  setDialect(id: DialectId): void;
  applyOps(ops: ModelOp[]): void;
  select(id: string | null, opts?: { reveal?: boolean }): void;
  selectAtOffset(offset: number): void;
  moveNodes(positions: Record<string, XY>, commit: boolean): void;
  /**
   * @param persist write the resulting positions into the document. False for
   * the pass that runs automatically on open, so merely viewing a template
   * never modifies it.
   */
  runAutoLayout(persist?: boolean): Promise<void>;
  setPersistLayout(on: boolean): void;
  setNotice(notice: string | null): void;
  setReviewOpen(open: boolean): void;
  reviewOpen: boolean;
}

/** Guards against a slow layout run overwriting a newer one. */
let layoutToken = 0;

/** True when node positions can be stored in the document itself. */
const canPersistLayout = (id: DialectId | null): boolean => {
  const dialect = id ? getDialect(id) : undefined;
  return (dialect?.canWriteBack && dialect.supportsLayout) === true;
};

export const useStore = create<AppState>((set, get) => {
  /** Re-parses `text` and reconciles derived state around the new model. */
  function ingest(text: string, dialectId: DialectId | null, filename: string | null) {
    if (!dialectId) {
      const empty = emptyModel('cfn-yaml');
      set({
        text,
        filename,
        dialectId: null,
        model: empty,
        review: reviewModel(empty),
        doc: null,
        positions: {},
        sizes: {},
      });
      return;
    }

    const dialect = getDialect(dialectId);
    if (!dialect) return;

    // Some dialects need an asynchronous one-time setup (the CDK parser loads
    // the TypeScript compiler). Show the text immediately, then re-ingest.
    if (dialect.prepare && dialect.isReady?.() === false) {
      const pendingModel: Model = {
        ...emptyModel(dialectId),
        diagnostics: [{ severity: 'info', message: `Loading the ${dialect.label} parser…` }],
      };
      set({
        text,
        filename,
        dialectId,
        model: pendingModel,
        review: reviewModel(pendingModel),
        doc: null,
      });
      void dialect.prepare().then(() => {
        // Only continue if the user has not moved on to something else.
        if (get().text === text && get().dialectId === dialectId) {
          ingest(text, dialectId, filename);
        }
      });
      return;
    }

    const { model, doc } = parseWith(dialect, text);
    const prev = get();

    // Keep the arrangement the user already has; the document's stored layout
    // seeds anything we have not positioned yet.
    const merged: Record<string, XY> = {};
    for (const node of model.nodes) {
      const pos = prev.positions[node.id] ?? model.layout[node.id];
      if (pos) merged[node.id] = pos;
    }

    const missing = model.nodes.filter((n) => !merged[n.id]);
    const selectedStillExists =
      prev.selectedId !== null && model.nodes.some((n) => n.id === prev.selectedId);

    set({
      text,
      filename,
      dialectId,
      model,
      // Recomputed here rather than in a selector: the review is a pure
      // function of the model, so it changes exactly when the model does.
      review: reviewModel(model),
      doc,
      positions: missing.length === 0 ? merged : placeNewNodes(model.nodes, merged),
      selectedId: selectedStillExists ? prev.selectedId : null,
    });

    // A file with no arrangement at all gets one computed for it, but that
    // initial layout is not written back — opening a file must not change it.
    if (Object.keys(merged).length === 0 && model.nodes.length > 0) {
      void get().runAutoLayout(false);
    }
  }

  return {
    filename: null,
    text: '',
    dialectId: null,
    dialectLocked: false,
    model: emptyModel('cfn-yaml'),
    doc: null,
    review: reviewModel(emptyModel('cfn-yaml')),
    reviewOpen: false,
    positions: {},
    sizes: {},
    selectedId: null,
    reveal: null,
    persistLayout: true,
    layoutPending: false,
    fitToken: 0,
    notice: null,

    setText(text, opts = {}) {
      const state = get();
      const filename = opts.filename !== undefined ? opts.filename : state.filename;
      if (text === state.text && !opts.redetect && filename === state.filename) return;

      const shouldDetect = opts.redetect || !state.dialectLocked || state.dialectId === null;
      const dialectId = shouldDetect
        ? (detectDialect(text, filename ?? undefined)?.id ?? state.dialectId)
        : state.dialectId;

      ingest(text, dialectId, filename);
    },

    loadFile(name, text) {
      set({
        positions: {},
        sizes: {},
        selectedId: null,
        dialectLocked: false,
        notice: null,
        fitToken: get().fitToken + 1,
      });
      get().setText(text, { filename: name, redetect: true });
    },

    setDialect(id) {
      set({ dialectLocked: true });
      ingest(get().text, id, get().filename);
    },

    applyOps(ops) {
      if (ops.length === 0) return;
      const { text, doc, dialectId, filename } = get();
      const dialect = dialectId ? getDialect(dialectId) : undefined;
      if (!dialect) return;

      if (!dialect.canWriteBack) {
        set({ notice: `${dialect.label} is read-only — export to CloudFormation to edit.` });
        return;
      }

      let next: string;
      try {
        next = dialect.applyOps(text, doc, ops);
      } catch (err) {
        set({ notice: `Could not apply that edit: ${err instanceof Error ? err.message : err}` });
        return;
      }
      if (next === text) return;
      ingest(next, dialectId, filename);
    },

    select(id, opts = {}) {
      const node = id ? get().model.nodes.find((n) => n.id === id) : undefined;
      set({
        selectedId: id,
        reveal:
          opts.reveal && node
            ? { offset: node.range.start, token: (get().reveal?.token ?? 0) + 1 }
            : get().reveal,
      });
    },

    /** Selects whichever resource's source range contains `offset`. */
    selectAtOffset(offset) {
      const { model, selectedId } = get();
      // Innermost match wins, so a nested range beats its enclosing one.
      let best: string | null = null;
      let bestSize = Infinity;
      for (const node of model.nodes) {
        if (offset >= node.range.start && offset <= node.range.end) {
          const size = node.range.end - node.range.start;
          if (size < bestSize) {
            best = node.id;
            bestSize = size;
          }
        }
      }
      if (best !== selectedId) set({ selectedId: best });
    },

    moveNodes(positions, commit) {
      set({ positions: { ...get().positions, ...positions } });
      if (commit && get().persistLayout && canPersistLayout(get().dialectId)) {
        get().applyOps([{ op: 'setLayout', positions: get().positions }]);
      }
    },

    async runAutoLayout(persist = true) {
      const token = ++layoutToken;
      const { model } = get();
      if (model.nodes.length === 0) return;

      set({ layoutPending: true });
      try {
        const { positions, sizes } = await autoLayout(model.nodes, model.edges);
        if (token !== layoutToken) return;
        set({ positions, sizes, layoutPending: false, fitToken: get().fitToken + 1 });
        if (persist && get().persistLayout && canPersistLayout(get().dialectId)) {
          get().applyOps([{ op: 'setLayout', positions }]);
        }
      } catch (err) {
        if (token !== layoutToken) return;
        set({
          layoutPending: false,
          notice: `Layout failed: ${err instanceof Error ? err.message : err}`,
        });
      }
    },

    setPersistLayout(on) {
      set({ persistLayout: on });
      if (!on && canPersistLayout(get().dialectId)) {
        get().applyOps([{ op: 'setLayout', positions: {} }]);
      } else if (on && canPersistLayout(get().dialectId)) {
        get().applyOps([{ op: 'setLayout', positions: get().positions }]);
      }
    },

    setNotice(notice) {
      set({ notice });
    },

    setReviewOpen(open) {
      set({ reviewOpen: open });
    },
  };
});

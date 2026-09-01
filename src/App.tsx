import { useCallback, useEffect, useRef, useState } from 'react';

import { dialects, getDialect } from './dialects';
import { SAMPLES } from './samples';
import { useStore } from './state/store';
import { DiagramPane } from './ui/canvas/DiagramPane';
import { MonacoPane } from './ui/editor/MonacoPane';
import { FileInput } from './ui/FileInput';
import { hasFileSystemAccess, useDropTarget, useFileOpen } from './ui/useFileOpen';
import { useTheme } from './ui/useTheme';
import { ReviewPanel } from './ui/review/ReviewPanel';
import type { DialectId } from './model/types';

const MIN_PANE = 260;

export default function App() {
  const { dark, toggle } = useTheme();

  const text = useStore((s) => s.text);
  const filename = useStore((s) => s.filename);
  const dialectId = useStore((s) => s.dialectId);
  const model = useStore((s) => s.model);
  const notice = useStore((s) => s.notice);
  const review = useStore((s) => s.review);
  const reviewOpen = useStore((s) => s.reviewOpen);
  const setReviewOpen = useStore((s) => s.setReviewOpen);
  const persistLayout = useStore((s) => s.persistLayout);
  const layoutPending = useStore((s) => s.layoutPending);
  const setNotice = useStore((s) => s.setNotice);
  const setDialect = useStore((s) => s.setDialect);
  const loadFile = useStore((s) => s.loadFile);
  const runAutoLayout = useStore((s) => s.runAutoLayout);
  const setPersistLayout = useStore((s) => s.setPersistLayout);
  const select = useStore((s) => s.select);
  const selectAtOffset = useStore((s) => s.selectAtOffset);

  const { open, openFile, save } = useFileOpen();
  const { over, handlers } = useDropTarget(openFile);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [leftWidth, setLeftWidth] = useState(480);
  const [dragging, setDragging] = useState(false);
  const [showProblems, setShowProblems] = useState(false);
  const splitRef = useRef<HTMLDivElement>(null);

  // Start on a sample so the app is never a blank slate.
  useEffect(() => {
    if (useStore.getState().text === '') {
      loadFile(SAMPLES[0].filename, SAMPLES[0].text);
    }
  }, [loadFile]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 6000);
    return () => clearTimeout(timer);
  }, [notice, setNotice]);

  const onGutterDown = useCallback((event: React.PointerEvent) => {
    event.preventDefault();
    setDragging(true);
    const move = (e: PointerEvent) => {
      const bounds = splitRef.current?.getBoundingClientRect();
      if (!bounds) return;
      const next = e.clientX - bounds.left;
      setLeftWidth(Math.max(MIN_PANE, Math.min(next, bounds.width - MIN_PANE)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, []);

  const pickFile = useCallback(async () => {
    if (!(await open())) fileInputRef.current?.click();
  }, [open]);

  const errors = model.diagnostics.filter((d) => d.severity === 'error');
  const warnings = model.diagnostics.filter((d) => d.severity === 'warning');
  const dialect = dialectId ? getDialect(dialectId) : undefined;
  const scoreBand =
    review.score === null ? 'none' : review.score >= 85 ? 'good' : review.score >= 60 ? 'fair' : 'poor';
  const layoutStorable = (dialect?.canWriteBack && dialect.supportsLayout) === true;

  return (
    <div className="app">
      <header className="toolbar">
        <div className="brand">
          <strong>Infra Canvas</strong>
          <span>template ⇄ diagram</span>
        </div>

        <button type="button" className="btn" onClick={pickFile}>
          Open file
        </button>
        <FileInput onPick={openFile} ref={fileInputRef} />

        <button type="button" className="btn" onClick={() => void save()}>
          {hasFileSystemAccess ? 'Save' : 'Download'}
        </button>

        <select
          className="select"
          value=""
          onChange={(e) => {
            const sample = SAMPLES.find((s) => s.filename === e.target.value);
            if (sample) loadFile(sample.filename, sample.text);
          }}
          aria-label="Load a sample template"
        >
          <option value="">Samples…</option>
          {SAMPLES.map((s) => (
            <option key={s.filename} value={s.filename} title={s.description}>
              {s.name}
            </option>
          ))}
        </select>

        {filename && <span className="filename" title={filename}>{filename}</span>}

        <span className="spacer" />

        <select
          className="select"
          value={dialectId ?? ''}
          onChange={(e) => setDialect(e.target.value as DialectId)}
          aria-label="Template format"
        >
          {!dialectId && <option value="">Unrecognized format</option>}
          {dialects().map((d) => (
            <option key={d.id} value={d.id}>
              {d.label}
            </option>
          ))}
        </select>

        <button
          type="button"
          className="btn"
          onClick={() => void runAutoLayout()}
          disabled={layoutPending || model.nodes.length === 0}
        >
          {layoutPending ? 'Laying out…' : 'Auto layout'}
        </button>

        <label
          className="toggle"
          title={
            layoutStorable
              ? "Store node positions in the template's Metadata block"
              : `${dialect?.label ?? 'This format'} has nowhere to store an arrangement, so positions last for this session only.`
          }
          style={layoutStorable ? undefined : { opacity: 0.5 }}
        >
          <input
            type="checkbox"
            checked={persistLayout && layoutStorable}
            disabled={!layoutStorable}
            onChange={(e) => setPersistLayout(e.target.checked)}
          />
          Save layout
        </label>

        <button
          type="button"
          className={`scorechip${reviewOpen ? ' on' : ''}`}
          onClick={() => setReviewOpen(!reviewOpen)}
          aria-pressed={reviewOpen}
          title={
            review.score === null
              ? 'No Well-Architected check applies to this template yet'
              : `${review.findings.length} finding${review.findings.length === 1 ? '' : 's'} — open the Well-Architected review`
          }
        >
          Well-Architected
          <span className={`val ${scoreBand}`}>{review.score === null ? '—' : review.score}</span>
        </button>

        <button
          type="button"
          className="btn icon"
          onClick={toggle}
          aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
          title={dark ? 'Light theme' : 'Dark theme'}
        >
          {dark ? '☀' : '☾'}
        </button>
      </header>

      <div className="split" ref={splitRef}>
        <section
          className="pane left"
          style={{ width: leftWidth, flex: 'none' }}
          {...handlers}
        >
          <div className="pane-head">
            Source
            <span className="spacer" />
            <span>{dialect?.label ?? 'Paste or open a template'}</span>
          </div>
          <div className="pane-body">
            <MonacoPane dark={dark} />
            {over && <div className="dropzone">Drop to open</div>}
          </div>
          {showProblems && model.diagnostics.length > 0 && (
            <div className="problems">
              {model.diagnostics.map((d, i) => (
                <div
                  key={i}
                  onClick={() => d.range && selectAtOffset(d.range.start)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && d.range) selectAtOffset(d.range.start);
                  }}
                >
                  <span className={`sev ${d.severity}`}>{d.severity}</span>
                  <span>{d.message}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <div
          className={`gutter${dragging ? ' active' : ''}`}
          onPointerDown={onGutterDown}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panes"
        />

        <section className="pane right">
          <div className="pane-head">
            Architecture
            <span className="spacer" />
            <span>
              {model.nodes.length} resource{model.nodes.length === 1 ? '' : 's'} ·{' '}
              {model.edges.length} link{model.edges.length === 1 ? '' : 's'}
            </span>
          </div>
          <div className={`pane-body${reviewOpen ? ' with-review' : ''}`}>
            <DiagramPane dark={dark} />
            {reviewOpen && <ReviewPanel review={review} onClose={() => setReviewOpen(false)} />}
            {model.nodes.length === 0 && (
              <div className="empty">
                <h2>Nothing to draw yet</h2>
                <p>
                  Paste a CloudFormation template on the left, drop a file onto the editor, or
                  load one of the samples.
                </p>
              </div>
            )}
            {notice && (
              <div className="toast" role="status">
                <span>{notice}</span>
                <button type="button" onClick={() => setNotice(null)} aria-label="Dismiss">
                  ×
                </button>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="status">
        <span className="dot" style={{ background: errors.length ? 'var(--danger)' : 'var(--edge)' }} />
        <span>{dialect?.label ?? 'No format detected'}</span>
        <span>{text.length.toLocaleString()} chars</span>
        {model.diagnostics.length > 0 ? (
          <button type="button" onClick={() => setShowProblems((v) => !v)}>
            <span className={errors.length ? 'err' : 'warn'}>
              {errors.length} error{errors.length === 1 ? '' : 's'}, {warnings.length} warning
              {warnings.length === 1 ? '' : 's'}
            </span>
          </button>
        ) : (
          <span>No problems</span>
        )}
        {review.score !== null && (
          <button type="button" onClick={() => setReviewOpen(!reviewOpen)}>
            Well-Architected {review.score}/100
          </button>
        )}
        <span className="spacer" />
        {dialect && !dialect.canWriteBack && <span className="warn">Read-only format</span>}
        <button type="button" onClick={() => select(null)}>
          Clear selection
        </button>
      </footer>
    </div>
  );
}

/**
 * The Well-Architected review panel.
 *
 * Scores are computed from the template alone, so the panel is careful to say
 * what it is: a static pass over the mechanical best practices that show up in
 * infrastructure-as-code. The framework's real value is in questions no parser
 * can answer, and the header links out to them.
 */

import { useMemo, useState } from 'react';

import { pillarDocs, ruleDocs } from '../../model/docs';
import { useStore } from '../../state/store';
import { FRAMEWORK_URL, getPillar, type PillarId } from '../../wellarchitected/pillars';
import type { Finding, Review } from '../../wellarchitected/review';
import type { Severity } from '../../wellarchitected/rules';

const SEVERITY_LABEL: Record<Severity, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

/** Score bands, chosen so "no findings at all" is the only way to reach green. */
function band(score: number): 'good' | 'fair' | 'poor' {
  if (score >= 85) return 'good';
  if (score >= 60) return 'fair';
  return 'poor';
}

function ScoreRing({ score }: { score: number | null }) {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const fraction = score === null ? 0 : score / 100;

  return (
    <div className={`ring ${score === null ? 'none' : band(score)}`}>
      <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
        <circle cx="38" cy="38" r={radius} className="track" />
        <circle
          cx="38"
          cy="38"
          r={radius}
          className="value"
          strokeDasharray={`${circumference * fraction} ${circumference}`}
          transform="rotate(-90 38 38)"
        />
      </svg>
      <div className="num">{score === null ? '—' : score}</div>
    </div>
  );
}

function PillarBar({
  pillarId,
  score,
  findings,
  rulesApplied,
  active,
  onToggle,
}: {
  pillarId: PillarId;
  score: number | null;
  findings: number;
  rulesApplied: number;
  active: boolean;
  onToggle(): void;
}) {
  const pillar = getPillar(pillarId);
  const link = pillarDocs(pillar.id, pillar.docsUrl);

  return (
    <div className={`pillar${active ? ' active' : ''}`}>
      <button
        type="button"
        className="pillar-main"
        onClick={onToggle}
        disabled={score === null}
        title={
          score === null
            ? `No ${pillar.name} check applies to this template.`
            : `${rulesApplied} check${rulesApplied === 1 ? '' : 's'} applied · ${findings} finding${findings === 1 ? '' : 's'}`
        }
      >
        <span className="pname">{pillar.name}</span>
        <span className="pscore">{score === null ? 'n/a' : score}</span>
        <span className="track">
          <span
            className={`fill ${score === null ? 'none' : band(score)}`}
            style={{ width: `${score ?? 0}%`, background: score === null ? undefined : pillar.color }}
          />
        </span>
      </button>
      <a href={link.url} target="_blank" rel="noreferrer noopener" title={`${pillar.name} pillar documentation`}>
        ↗
      </a>
    </div>
  );
}

function FindingRow({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const select = useStore((s) => s.select);
  const pillar = getPillar(finding.pillar);
  const link = ruleDocs(finding.ruleId, finding.docs);

  return (
    <div className={`finding sev-${finding.severity}${open ? ' open' : ''}`}>
      <button type="button" className="fhead" onClick={() => setOpen((v) => !v)}>
        <span className="sev" style={{ background: pillar.color }} title={pillar.name}>
          {SEVERITY_LABEL[finding.severity]}
        </span>
        <span className="ftitle">{finding.title}</span>
        {finding.nodeLabel && <span className="fnode">{finding.nodeLabel}</span>}
        <span className="chev">{open ? '▾' : '▸'}</span>
      </button>
      {open && (
        <div className="fbody">
          <p>{finding.rationale}</p>
          <p className="fix">
            <strong>Fix</strong> {finding.remediation}
          </p>
          <div className="factions">
            {finding.nodeId && (
              <button type="button" className="btn" onClick={() => select(finding.nodeId!, { reveal: true })}>
                Show resource
              </button>
            )}
            {link && (
              <a className="btn" href={link.url} target="_blank" rel="noreferrer noopener">
                AWS docs ↗
              </a>
            )}
            <span className="rid">{finding.ruleId}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function ReviewPanel({ review, onClose }: { review: Review; onClose(): void }) {
  const [pillarFilter, setPillarFilter] = useState<PillarId | null>(null);
  const [showPassed, setShowPassed] = useState(false);

  const findings = useMemo(
    () => (pillarFilter ? review.findings.filter((f) => f.pillar === pillarFilter) : review.findings),
    [review.findings, pillarFilter],
  );

  const counts = useMemo(() => {
    const out = { high: 0, medium: 0, low: 0 };
    for (const f of review.findings) out[f.severity]++;
    return out;
  }, [review.findings]);

  return (
    <aside className="review" aria-label="Well-Architected review">
      <header>
        <div className="rtitle">
          <strong>Well-Architected review</strong>
          <a href={FRAMEWORK_URL} target="_blank" rel="noreferrer noopener">
            Framework ↗
          </a>
        </div>
        <button type="button" className="close" onClick={onClose} aria-label="Close review panel">
          ×
        </button>
      </header>

      <div className="summary">
        <ScoreRing score={review.score} />
        <div className="stats">
          {review.score === null ? (
            <p>Nothing in this template matches a check yet.</p>
          ) : (
            <>
              <p>
                <strong>{review.findings.length}</strong> finding
                {review.findings.length === 1 ? '' : 's'} across{' '}
                <strong>{review.checkedResources}</strong> checked resource
                {review.checkedResources === 1 ? '' : 's'}.
              </p>
              <p className="sevline">
                {counts.high > 0 && <span className="pill high">{counts.high} high</span>}
                {counts.medium > 0 && <span className="pill medium">{counts.medium} medium</span>}
                {counts.low > 0 && <span className="pill low">{counts.low} low</span>}
                {review.findings.length === 0 && <span className="pill none">All checks passed</span>}
              </p>
            </>
          )}
        </div>
      </div>

      <div className="pillars">
        {review.pillars.map((p) => (
          <PillarBar
            key={p.pillar}
            pillarId={p.pillar}
            score={p.score}
            findings={p.findings}
            rulesApplied={p.rulesApplied}
            active={pillarFilter === p.pillar}
            onToggle={() => setPillarFilter(pillarFilter === p.pillar ? null : p.pillar)}
          />
        ))}
      </div>

      <div className="findings">
        {pillarFilter && (
          <button type="button" className="clearfilter" onClick={() => setPillarFilter(null)}>
            Showing {getPillar(pillarFilter).name} only — show all
          </button>
        )}
        {findings.map((f, i) => (
          <FindingRow key={`${f.ruleId}:${f.nodeId ?? i}`} finding={f} />
        ))}
        {findings.length === 0 && review.score !== null && (
          <p className="allclear">
            No findings{pillarFilter ? ` for ${getPillar(pillarFilter).name}` : ''}.
          </p>
        )}

        {review.passed.length > 0 && (
          <div className="passed">
            <button type="button" onClick={() => setShowPassed((v) => !v)}>
              {showPassed ? '▾' : '▸'} {review.passed.length} check
              {review.passed.length === 1 ? '' : 's'} passed
            </button>
            {showPassed && (
              <ul>
                {review.passed.map((p) => (
                  <li key={p.ruleId}>
                    <span className="dot" style={{ background: getPillar(p.pillar).color }} />
                    {p.title}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <footer>
        Static checks against the mechanical best practices visible in a template.
        A full review answers questions no parser can — start from the{' '}
        <a href={FRAMEWORK_URL} target="_blank" rel="noreferrer noopener">
          framework
        </a>
        .
      </footer>
    </aside>
  );
}

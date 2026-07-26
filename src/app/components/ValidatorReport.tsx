import type { ValidationReport } from '../../engine/types';

interface ValidatorReportProps {
  readonly report: ValidationReport;
}

const SYMBOL = { pass: '✓', fail: '✕', skipped: '–' } as const;

/**
 * The pass/fail checklist for a finished export.
 *
 * This is the part of the product an artist is actually buying: the assurance
 * that the file will not come back rejected. It is shown in full, passes
 * included, because the value is in seeing the whole list satisfied.
 */
export function ValidatorReport({ report }: ValidatorReportProps) {
  const failures = report.checks.filter((check) => check.status === 'fail').length;

  return (
    <section className={`report${report.ok ? ' is-ok' : ' is-failing'}`} aria-label="Export checks">
      <h2>
        {report.ok ? 'Ready for Spotify Canvas' : `${failures} problem${failures === 1 ? '' : 's'} found`}
      </h2>
      <ul>
        {report.checks.map((check) => (
          <li key={check.id} className={`check is-${check.status}`}>
            <span className="check-mark" aria-hidden="true">
              {SYMBOL[check.status]}
            </span>
            <span className="check-body">
              <span className="check-label">
                {check.label}
                <span className="visually-hidden">
                  {check.status === 'pass' ? ' — passed' : check.status === 'fail' ? ' — failed' : ' — skipped'}
                </span>
              </span>
              {check.detail ? <span className="check-detail">{check.detail}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

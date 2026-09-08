import type { BulletDiff } from '@lib/generation/importResult';
import type { ResumeVersion } from '@lib/schema/resumeVersion';

/**
 * The review step for a pasted resume: which bullets the model rewrote
 * (where fabrication risk lives), the rendered preview, and any validation
 * problems from the last approval attempt.
 */
export function ResumeReview({
  version,
  diff,
  busy,
  problems,
  previewUrl,
  onApprove,
}: {
  version: ResumeVersion;
  diff: BulletDiff;
  busy: string;
  problems: string[];
  previewUrl: string;
  onApprove: () => void;
}) {
  const rewritten = [...diff.known.entries()].filter(([, kept]) => !kept).map(([text]) => text);

  return (
    <div className="resume-review">
      <div className="hint" style={{ margin: '8px 0 4px' }}>
        {version.experience.length} positions · {diff.keptCount} bullets kept verbatim ·{' '}
        {diff.rewrittenCount} rewritten
      </div>
      {rewritten.length > 0 && (
        <div className="diff-box">
          <div className="diff-title">Rewritten bullets — read each one, this is where models invent things:</div>
          <ul className="problem-list">
            {rewritten.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </div>
      )}
      {previewUrl && (
        <iframe className="pdf-preview" src={previewUrl} title="Resume preview" />
      )}
      {problems.length > 0 && (
        <div className="warn-box" style={{ marginTop: 8 }}>
          <div>
            <strong>Validation failed — version not stored:</strong>
            <ul className="problem-list">
              {problems.map((problem, i) => (
                <li key={i}>{problem}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
      <button className="primary" style={{ marginTop: 8 }} onClick={onApprove} disabled={!!busy}>
        {busy || 'Approve → validate + store PDF & DOCX'}
      </button>
    </div>
  );
}

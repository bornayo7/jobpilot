import { useState } from 'react';
import type { Profile } from '@lib/schema/profile';
import { buildProfileImportPrompt } from '@lib/prompts/promptStudio/builders';
import {
  mergeProfileImport,
  parseProfilePaste,
  type ProfileImportOutcome,
} from '@lib/generation/importProfile';

/**
 * Onboarding shortcut: copy a conversion prompt, paste your existing resume
 * into claude.ai / ChatGPT under it, paste the JSON reply back here — profile
 * seeded in two minutes instead of typed by hand.
 */
export function ImportProfileCard({
  profile,
  update,
}: {
  profile: Profile;
  update: (patch: Partial<Profile>) => void;
}) {
  const [copied, setCopied] = useState(false);
  const [pasted, setPasted] = useState('');
  const [outcome, setOutcome] = useState<ProfileImportOutcome | null>(null);
  const [applied, setApplied] = useState(false);

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(buildProfileImportPrompt());
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const runParse = () => {
    setApplied(false);
    setOutcome(parseProfilePaste(pasted));
  };

  const apply = () => {
    if (!outcome?.ok) return;
    update(mergeProfileImport(profile, outcome.imported));
    setApplied(true);
    setPasted('');
    setOutcome(null);
  };

  return (
    <section className="card">
      <h2>Import from your existing resume</h2>
      <p className="hint">
        1) Copy the prompt · 2) paste it into claude.ai or ChatGPT, then paste your resume text
        under it · 3) paste the JSON reply back here. Work history, education, projects, and skills
        are filled in; visa/EEO/salary answers are never imported (a resume can't know them).
      </p>
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        <button className="primary" onClick={copyPrompt}>
          {copied ? 'Copied ✓' : 'Copy conversion prompt'}
        </button>
        <a href="https://claude.ai/new" target="_blank" rel="noreferrer" style={{ alignSelf: 'center' }}>
          Open claude.ai
        </a>
      </div>
      <label className="field">
        Paste the JSON reply
        <textarea
          rows={4}
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="```json … ```"
        />
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 8, alignItems: 'center' }}>
        <button onClick={runParse} disabled={!pasted.trim()}>
          Validate
        </button>
        {outcome?.ok && (
          <>
            <span className="hint">{outcome.summary}. Replaces those sections — review before saving.</span>
            <button className="primary" onClick={apply}>
              Apply to profile
            </button>
          </>
        )}
        {applied && <span className="hint">Applied — review below, then Save profile.</span>}
      </div>
      {outcome && !outcome.ok && (
        <ul className="problem-list" style={{ color: 'var(--fail)' }}>
          {outcome.errors.map((error, i) => (
            <li key={i}>{error}</li>
          ))}
        </ul>
      )}
    </section>
  );
}

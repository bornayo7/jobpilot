import { useEffect, useRef, useState } from 'react';
import {
  deleteAnswer,
  listAnswers,
  saveAnswer,
  patchAnswer,
  type AnswerRecord,
} from '@lib/memory/answers';
import { useCollection } from './useCollection';

/**
 * The answers bank. Populated automatically when you submit applications
 * (free-text values are captured at submit time); everything is editable here.
 * `reusable` gates whether an answer can be suggested on OTHER companies'
 * applications — the anti-answer-bleed control.
 */
export function AnswersTab({ active = true }: { active?: boolean }) {
  const { items: bank, loading, error: loadError, refresh } = useCollection(listAnswers);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');

  // The tab stays mounted while hidden; reload when it comes into view so
  // answers captured at submit time show up.
  useEffect(() => {
    if (active) void refresh();
  }, [active]);

  const visible = bank.filter((record) => {
    if (!filter.trim()) return true;
    const needle = filter.toLowerCase();
    return (
      record.questionRaw.toLowerCase().includes(needle) ||
      record.answer.toLowerCase().includes(needle) ||
      record.company.toLowerCase().includes(needle)
    );
  });

  const addManual = async () => {
    if (!newQuestion.trim() || !newAnswer.trim() || saving) return;
    setSaving(true); setError('');
    try {
      await saveAnswer({ questionRaw: newQuestion.trim(), answer: newAnswer.trim(), jobId: '', company: '', reusable: false, origin: 'manual' });
      setNewQuestion(''); setNewAnswer(''); await refresh();
    } catch (err) { setError(`Answer was not saved. ${String(err)}`); }
    finally { setSaving(false); }
  };
  const patch = async (record: AnswerRecord, changes: Parameters<typeof patchAnswer>[1], base: Partial<AnswerRecord> = record) => {
    setError('');
    try { await patchAnswer(record.id, changes, base); await refresh(); return true; }
    catch (err) { setError(`Answer was not updated. ${String(err)}`); return false; }
  };

  return (
    <div className="answers-tab">
      <p className="hint">
        Saved answers stay with their original application until you explicitly allow reuse.
        Reusable answers appear as suggestions for similar questions.
      </p>
      {(error || loadError) && <div className="warn-box" role="alert">{error || loadError}<button onClick={() => void refresh()}>Refresh answers</button></div>}

      <input
        aria-label="Search saved answers"
        placeholder="Search questions, answers, companies…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="search-input"
      />

      {visible.length === 0 && <div className="placeholder"><p role="status">{loading ? 'Loading answers…' : filter ? 'No answers match your search.' : 'No saved answers yet. Add one below.'}</p></div>}

      {visible.map((record) => (
        <AnswerCard
          key={record.id}
          record={record}
          onPatch={(changes, base) => patch(record, changes, base)}
          onDelete={async () => {
            try { await deleteAnswer(record.id); await refresh(); }
            catch (err) { setError(`Answer was not removed. ${String(err)}`); }
          }}
        />
      ))}

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: 13, margin: '0 0 6px' }}>Add an answer manually</h2>
        <input
          aria-label="New answer question"
          disabled={saving}
          placeholder="Question"
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          className="search-input"
        />
        <textarea
          aria-label="New answer text"
          disabled={saving}
          className="paste-area"
          rows={3}
          placeholder="Your answer"
          value={newAnswer}
          onChange={(e) => setNewAnswer(e.target.value)}
        />
        <button className="primary" onClick={() => void addManual()} disabled={saving || !newQuestion.trim() || !newAnswer.trim()}>
          {saving ? 'Saving…' : 'Save answer'}
        </button>
      </div>
    </div>
  );
}

function AnswerCard({
  record,
  onPatch,
  onDelete,
}: {
  record: AnswerRecord;
  onPatch: (patch: Parameters<typeof patchAnswer>[1], base?: Partial<AnswerRecord>) => Promise<boolean>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(record.answer);
  const [dirty, setDirty] = useState(false);
  const baseAnswer = useRef(record.answer);
  const edit = useRef(0);
  useEffect(() => { if (!dirty) setDraft(record.answer); }, [record.answer, dirty]);

  return (
    <div className="review-row" style={{ marginBottom: 8 }}>
      <div className="review-top">
        <span className="field-label" title={record.questionRaw}>
          {record.questionRaw}
        </span>
        <div className="field-meta">
          {record.company && <span className="chip">{record.company}</span>}
          <button className="entry-remove" aria-label={`Delete answer to ${record.questionRaw}`} onClick={onDelete}>Delete</button>
        </div>
      </div>
      <textarea
        aria-label={`Answer to ${record.questionRaw}`}
        className="paste-area"
        rows={3}
        value={draft}
        onChange={(e) => { if (!dirty) baseAnswer.current = record.answer; edit.current++; setDraft(e.target.value); setDirty(true); }}
        onBlur={async () => {
          const revision = edit.current;
          if (dirty && draft.trim() && await onPatch({ answer: draft.trim() }, { answer: baseAnswer.current })) {
            baseAnswer.current = draft.trim();
            if (edit.current === revision) setDirty(false);
          }
        }}
      />
      <label className="include" style={{ fontSize: 12 }}>
        <input
          type="checkbox"
          checked={record.reusable && record.reuseConfirmed === true}
          onChange={(e) => void onPatch({ reusable: e.target.checked })}
        />
        Reusable on other companies' applications
      </label>
      {record.reusable && !record.reuseConfirmed && <p className="hint">This older answer needs your approval before it can be suggested elsewhere. Select reuse after checking its details.</p>}
    </div>
  );
}

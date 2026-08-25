import { useEffect, useState } from 'react';
import {
  deleteAnswer,
  listAnswers,
  saveAnswer,
  updateAnswer,
  type AnswerRecord,
} from '@lib/memory/answers';

/**
 * The answers bank. Populated automatically when you submit applications
 * (free-text values are captured at submit time); everything is editable here.
 * `reusable` gates whether an answer can be suggested on OTHER companies'
 * applications — the anti-answer-bleed control.
 */
export function AnswersTab() {
  const [bank, setBank] = useState<AnswerRecord[]>([]);
  const [filter, setFilter] = useState('');
  const [newQuestion, setNewQuestion] = useState('');
  const [newAnswer, setNewAnswer] = useState('');

  const refresh = () => void listAnswers().then(setBank);
  useEffect(refresh, []);

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
    if (!newQuestion.trim() || !newAnswer.trim()) return;
    await saveAnswer({
      questionRaw: newQuestion.trim(),
      answer: newAnswer.trim(),
      jobId: '',
      company: '',
      reusable: true,
    });
    setNewQuestion('');
    setNewAnswer('');
    refresh();
  };

  return (
    <div className="answers-tab">
      <p className="hint">
        Answers are captured automatically when you submit an application. “Reusable” answers get
        suggested (never auto-filled) when a similar question appears elsewhere.
      </p>

      <input
        placeholder="Search questions, answers, companies…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="search-input"
      />

      {visible.length === 0 && <div className="placeholder"><p>No saved answers yet.</p></div>}

      {visible.map((record) => (
        <AnswerCard
          key={record.id}
          record={record}
          onChange={async (updated) => {
            await updateAnswer(updated);
            refresh();
          }}
          onDelete={async () => {
            await deleteAnswer(record.id);
            refresh();
          }}
        />
      ))}

      <div className="card" style={{ marginTop: 14 }}>
        <h2 style={{ fontSize: 13, margin: '0 0 6px' }}>Add an answer manually</h2>
        <input
          placeholder="Question"
          value={newQuestion}
          onChange={(e) => setNewQuestion(e.target.value)}
          className="search-input"
        />
        <textarea
          className="paste-area"
          rows={3}
          placeholder="Your answer"
          value={newAnswer}
          onChange={(e) => setNewAnswer(e.target.value)}
        />
        <button className="primary" onClick={addManual} disabled={!newQuestion.trim() || !newAnswer.trim()}>
          Save answer
        </button>
      </div>
    </div>
  );
}

function AnswerCard({
  record,
  onChange,
  onDelete,
}: {
  record: AnswerRecord;
  onChange: (record: AnswerRecord) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(record.answer);

  return (
    <div className="review-row" style={{ marginBottom: 8 }}>
      <div className="review-top">
        <span className="field-label" title={record.questionRaw}>
          {record.questionRaw}
        </span>
        <div className="field-meta">
          {record.company && <span className="chip">{record.company}</span>}
          <button className="entry-remove" onClick={onDelete}>✕</button>
        </div>
      </div>
      <textarea
        className="paste-area"
        rows={3}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          if (draft.trim() && draft !== record.answer) onChange({ ...record, answer: draft.trim() });
        }}
      />
      <label className="include" style={{ fontSize: 12 }}>
        <input
          type="checkbox"
          checked={record.reusable}
          onChange={(e) => onChange({ ...record, reusable: e.target.checked })}
        />
        Reusable on other companies' applications
      </label>
    </div>
  );
}

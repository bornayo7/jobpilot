import { Fragment } from 'react';
import type { PanelState } from '@hooks/useBackgroundPort';
import type { FramePlan } from '@hooks/useFillPlan';
import { ALL_FIELD_KINDS, type FieldKind } from '@lib/schema/fieldKind';
import { unmatchedRow, type ReviewRow } from '@lib/fill/resolver';
import { rankAnswers, type AnswerRecord } from '@lib/memory/answers';

interface RowCallbacks {
  onHover: (fieldId: string) => void;
  onToggle: (fieldId: string) => void;
  onValue: (fieldId: string, text: string) => void;
  onKind: (fieldId: string, kind: FieldKind) => void;
}

/**
 * One frame's review table: the rows the bulk fill will write, the rows that
 * need a human first, and the fields nothing could classify.
 */
export function FramePlanView({
  frameLabel,
  plan,
  fillResults,
  answerBank,
  ...callbacks
}: RowCallbacks & {
  frameLabel: string | null;
  plan: FramePlan;
  fillResults: PanelState['fillResults'];
  answerBank: AnswerRecord[];
}) {
  const autoRows = plan.rows.filter((row) => !row.requiresReview);
  const reviewRows = plan.rows.filter((row) => row.requiresReview);

  const renderRow = (row: ReviewRow) => (
    <RowView
      key={row.field.fieldId}
      row={row}
      result={fillResults.get(row.field.fieldId)}
      answerBank={answerBank}
      {...callbacks}
    />
  );

  return (
    <Fragment>
      {frameLabel && <div className="frame-header">{frameLabel}</div>}
      {autoRows.map(renderRow)}
      {reviewRows.length > 0 && <div className="frame-header">Needs your review</div>}
      {reviewRows.map(renderRow)}
      {plan.unmatched.length > 0 && (
        <>
          <div className="frame-header">Unrecognized — choose a mapping or enter a value</div>
          {plan.unmatched.map((field) => renderRow(unmatchedRow(field)))}
        </>
      )}
    </Fragment>
  );
}

function RowView({
  row,
  result,
  answerBank,
  onHover,
  onToggle,
  onValue,
  onKind,
}: RowCallbacks & {
  row: ReviewRow;
  result?: { ok: boolean; error?: string };
  answerBank: AnswerRecord[];
}) {
  const fieldId = row.field.fieldId;
  const valueText = instructionDisplay(row);
  const fillable = row.instruction !== null;
  const isQuestion = row.kind === 'question.freeText' || row.kind === 'question.choice';
  const suggestions = isQuestion
    ? rankAnswers(row.field.label || row.field.ariaLabel || '', answerBank, '')
    : [];

  return (
    <div
      id={`row-${fieldId}`}
      className={`review-row${row.sensitive ? ' sensitive' : ''}${row.include ? '' : ' excluded'}`}
      onMouseEnter={() => onHover(fieldId)}
    >
      <div className="review-top">
        <label className="include">
          <input type="checkbox" checked={row.include} disabled={!fillable} onChange={() => onToggle(fieldId)} />
          <span className="field-label" title={row.field.label}>
            {row.field.label || row.field.name || '(unlabeled)'}
          </span>
          {row.field.required && <span className="req">*</span>}
        </label>
        <div className="field-meta">
          <span className={`chip source-${row.source}`}>{row.source}</span>
          {row.sensitive && <span className="chip warn">verify</span>}
          {result && (
            <span className={result.ok ? 'chip ok' : 'chip fail'} title={result.error}>
              {result.ok ? '✓ filled' : `✗ ${result.error ?? 'failed'}`}
            </span>
          )}
        </div>
      </div>
      <div className="review-controls">
        {row.field.control === 'file' || row.instruction?.action === 'attachFile' ? (
          <span className="value-static">{valueText || 'no file'}</span>
        ) : row.field.control === 'checkbox' ? (
          <select
            value={valueText === 'checked' ? 'checked' : 'unchecked'}
            onChange={(e) => onValue(fieldId, e.target.value === 'checked' ? 'yes' : 'no')}
          >
            <option value="checked">checked</option>
            <option value="unchecked">unchecked</option>
          </select>
        ) : (row.field.control === 'select' || row.field.control === 'radio') && row.field.options?.length ? (
          <select
            value={typeof row.instruction?.value === 'string' ? row.instruction.value : ''}
            onChange={(e) => onValue(fieldId, e.target.value)}
          >
            <option value="">(leave blank)</option>
            {row.field.options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        ) : isQuestion ? (
          <textarea
            className="paste-area"
            rows={2}
            value={valueText}
            placeholder="(type an answer, or use a saved one below)"
            onChange={(e) => onValue(fieldId, e.target.value)}
          />
        ) : (
          <input
            value={valueText}
            placeholder="(no value — type to fill)"
            onChange={(e) => onValue(fieldId, e.target.value)}
          />
        )}
        <select className="kind-select" value={row.kind} onChange={(e) => onKind(fieldId, e.target.value as FieldKind)}>
          {ALL_FIELD_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </div>
      {suggestions.length > 0 && (
        <div className="suggestion-row">
          {suggestions.map(({ record, score }) => (
            <button
              key={record.id}
              className="suggestion"
              title={record.answer}
              onClick={() => onValue(fieldId, record.answer)}
            >
              ↳ {Math.round(score * 100)}% · {record.company || 'saved'} · {record.answer.slice(0, 44)}…
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function instructionDisplay(row: ReviewRow): string {
  const instruction = row.instruction;
  if (!instruction) return '';
  switch (instruction.action) {
    case 'setChecked':
      return instruction.value ? 'checked' : 'unchecked';
    case 'attachFile':
      return instruction.value.filename;
    default:
      return instruction.value;
  }
}

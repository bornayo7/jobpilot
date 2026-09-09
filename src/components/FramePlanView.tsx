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
  applicationId,
  disabled = false,
  ...callbacks
}: RowCallbacks & {
  frameLabel: string | null;
  plan: FramePlan;
  fillResults: PanelState['fillResults'];
  answerBank: AnswerRecord[];
  applicationId: string;
  disabled?: boolean;
}) {
  const autoRows = plan.rows.filter((row) => !row.requiresReview);
  const reviewRows = plan.rows.filter((row) => row.requiresReview);

  const renderRow = (row: ReviewRow) => (
    <RowView
      key={row.field.fieldId}
      row={row}
      result={fillResults.get(row.field.fieldId)}
      answerBank={answerBank}
      applicationId={applicationId}
      disabled={disabled}
      {...callbacks}
    />
  );

  return (
    <Fragment>
      {frameLabel && <div className="frame-header">{frameLabel}</div>}
      {reviewRows.length > 0 && <div className="frame-header">Needs your review</div>}
      {reviewRows.map(renderRow)}
      {plan.unmatched.length > 0 && (
        <>
          <div className="frame-header">Unrecognized — choose a mapping or enter a value</div>
          {plan.unmatched.map((field) => renderRow(unmatchedRow(field)))}
        </>
      )}
      {autoRows.length > 0 && <div className="frame-header">Ready to fill</div>}
      {autoRows.map(renderRow)}
    </Fragment>
  );
}

function RowView({
  row,
  result,
  answerBank,
  applicationId,
  disabled,
  onHover,
  onToggle,
  onValue,
  onKind,
}: RowCallbacks & {
  row: ReviewRow;
  result?: { ok: boolean; error?: string };
  answerBank: AnswerRecord[];
  applicationId: string;
  disabled: boolean;
}) {
  const fieldId = row.field.fieldId;
  const valueText = instructionDisplay(row);
  const fillable = row.instruction !== null;
  const isQuestion = row.kind === 'question.freeText' || row.kind === 'question.choice';
  const suggestions = isQuestion
    ? rankAnswers(row.field.label || row.field.ariaLabel || '', answerBank, applicationId)
    : [];

  return (
    <div
      id={`row-${fieldId}`}
      className={`review-row${row.sensitive ? ' sensitive' : ''}${row.include ? '' : ' excluded'}`}
      onMouseEnter={() => onHover(fieldId)}
      onFocus={() => onHover(fieldId)}
    >
      <div className="review-top">
        <label className="include">
          <input type="checkbox" checked={row.include} disabled={!fillable || disabled} onChange={() => onToggle(fieldId)} />
          <span className="field-label" title={row.field.label}>
            {row.field.label || row.field.name || '(unlabeled)'}
          </span>
          {row.field.required && <span className="req">*</span>}
        </label>
        <div className="field-meta">
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
            aria-label={`Answer for ${row.field.label || row.field.name}`} disabled={disabled}
            value={valueText === 'checked' ? 'checked' : 'unchecked'}
            onChange={(e) => onValue(fieldId, e.target.value === 'checked' ? 'yes' : 'no')}
          >
            <option value="checked">checked</option>
            <option value="unchecked">unchecked</option>
          </select>
        ) : (row.field.control === 'select' || row.field.control === 'radio') && row.field.options?.length ? (
          <select
            aria-label={`Answer for ${row.field.label || row.field.name}`} disabled={disabled}
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
            aria-label={`Answer for ${row.field.label || row.field.name}`} disabled={disabled}
            className="paste-area"
            rows={2}
            value={valueText}
            placeholder="(type an answer, or use a saved one below)"
            onChange={(e) => onValue(fieldId, e.target.value)}
          />
        ) : (
          <input
            aria-label={`Answer for ${row.field.label || row.field.name}`} disabled={disabled}
            value={valueText}
            placeholder="(no value — type to fill)"
            onChange={(e) => onValue(fieldId, e.target.value)}
          />
        )}
      </div>
      {row.sensitive && !row.instruction && <p className="hint">Answer manually. The saved profile does not safely answer this question's wording or jurisdiction.</p>}
      <details className="field-mapping">
        <summary>Correct field mapping</summary>
        <p className="hint">Matched by {row.source}. Changing this mapping is remembered for similar fields.</p>
        <select aria-label={`Field mapping for ${row.field.label || row.field.name}`} disabled={disabled} className="kind-select" value={row.kind} onChange={(e) => onKind(fieldId, e.target.value as FieldKind)}>
          {ALL_FIELD_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {kind}
            </option>
          ))}
        </select>
      </details>
      {suggestions.length > 0 && (
        <div className="suggestion-row">
          {suggestions.map(({ record, score }) => (
            <button
              key={record.id}
              disabled={disabled}
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

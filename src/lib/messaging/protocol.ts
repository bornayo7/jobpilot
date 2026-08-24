import type { FieldKind } from '../schema/fieldKind';
import type { AtsId } from '../fill/adapters/ids';

/** What the content script reports about one form control. The owning frame is
 *  identified by the bg/frameEvent envelope, not the descriptor itself. */
export interface FormFieldDescriptor {
  /** nanoid stamped on the element as data-jobpilot-id */
  fieldId: string;
  control: 'text' | 'textarea' | 'select' | 'combobox' | 'radio' | 'checkbox' | 'file' | 'date';
  label: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  autocomplete?: string;
  required: boolean;
  options?: { value: string; label: string }[];
  sectionHint?: 'work' | 'education' | 'eeo' | 'auth';
  sectionIndex?: number;
  /** Adapter-known key, e.g. 'question_12345', '_systemfield_email', a data-automation-id. */
  atsFieldKey?: string;
  /** Stable hash for the mapping cache — see fill/signature.ts. */
  signature: string;
  currentValue?: string;
}

export type FillAction =
  | 'setText'
  | 'selectOption'
  | 'setChecked'
  | 'attachFile'
  | 'pickListbox'
  | 'setDate';

export type FillSource = 'adapter' | 'heuristic' | 'cache' | 'llm' | 'answerBank' | 'user';

/** Files cross runtime ports as base64 — port messages are JSON-serialized,
 *  so ArrayBuffers would silently arrive empty. */
export interface SerializedFile {
  name: string;
  type: string;
  dataBase64: string;
}

export interface FillInstruction {
  fieldId: string;
  frameId: number;
  action: FillAction;
  value: string | boolean | { blobKey: string; filename: string };
  kind: FieldKind;
  source: FillSource;
  confidence: number;
  /** Always true for question.freeText, answer-bank hits, and low confidence. */
  requiresReview: boolean;
}

export interface FillResult {
  fieldId: string;
  ok: boolean;
  /** Value read back from the DOM after filling — verification, not hope. */
  verifiedValue?: string;
  error?: string;
}

/* ---------- Port message unions ---------- */

/** Content script → background. */
export type CsToBg =
  | { t: 'cs/ready'; atsId: AtsId | null; url: string }
  | { t: 'cs/fields'; fields: FormFieldDescriptor[] }
  | { t: 'cs/fillResults'; results: FillResult[] }
  | { t: 'cs/wizardStep'; stepId: string }
  | { t: 'cs/submitDetected'; url: string; confirmationText: string }
  | { t: 'cs/jdText'; text: string; title: string };

/** Background → content script. */
export type BgToCs =
  | { t: 'bg/scan' }
  | { t: 'bg/execute'; instructions: FillInstruction[]; files?: SerializedFile[] }
  | { t: 'bg/highlight'; fieldId: string }
  | { t: 'bg/extractJd' }
  | { t: 'bg/wizardNext' };

/** Side panel → background. */
export type PanelToBg =
  | { t: 'panel/attach'; tabId: number | null }
  | { t: 'panel/scan'; tabId: number }
  | { t: 'panel/execute'; tabId: number; frameId: number; instructions: FillInstruction[]; files?: SerializedFile[] }
  | { t: 'panel/highlight'; tabId: number; frameId: number; fieldId: string }
  | { t: 'panel/extractJd'; tabId: number }
  /** Persist content-script injection for a user-enabled origin (permission
   *  must already be granted by the panel — the gesture lives there). */
  | { t: 'panel/registerSite'; origin: string; tabId: number };

/** Background → side panel. */
export type BgToPanel =
  | { t: 'bg/frameEvent'; tabId: number; frameId: number; event: CsToBg }
  | { t: 'bg/frameGone'; tabId: number; frameId: number }
  | { t: 'bg/tabChanged'; tabId: number; url: string };

export const CS_PORT = 'jobpilot-cs';
export const PANEL_PORT = 'jobpilot-panel';

import type { FieldKind } from '../schema/fieldKind';
import type { AtsId } from '../fill/adapters/ids';

/** What the content script reports about one form control. The owning frame is
 *  identified by the bg/frameEvent envelope, not the descriptor itself. */
export interface FormFieldDescriptor {
  /** Id stamped on the element as data-jobpilot-id. */
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
  /** Adapter-known key, e.g. 'question_12345', '_systemfield_email', a data-automation-id. */
  atsFieldKey?: string;
  /** Stable hash for the mapping cache — see fill/signature.ts. */
  signature: string;
  currentValue?: string;
}

/** A stored document to attach; its bytes travel separately as a SerializedFile. */
export interface FileRef {
  blobKey: string;
  filename: string;
}

/**
 * What to do to a control, with the value shaped for that action. Keyed on
 * `action` so the executor can narrow the value instead of casting it.
 */
export type FillPayload =
  | { action: 'setText' | 'selectOption' | 'pickListbox'; value: string }
  | { action: 'setChecked'; value: boolean }
  | { action: 'attachFile'; value: FileRef };

export type FillSource = 'adapter' | 'heuristic' | 'cache' | 'llm' | 'user';

/** Files cross runtime ports as base64 — port messages are JSON-serialized,
 *  so ArrayBuffers would silently arrive empty. */
export interface SerializedFile {
  name: string;
  type: string;
  dataBase64: string;
}

export type FillInstruction = FillPayload & {
  fieldId: string;
  frameId: number;
  kind: FieldKind;
  source: FillSource;
  confidence: number;
  /** Always true for question.freeText, answer-bank hits, and low confidence. */
  requiresReview: boolean;
};

/** What happened when one instruction ran, before it is tagged with its field. */
export interface FillOutcome {
  ok: boolean;
  /** Value read back from the DOM after filling — verification, not hope. */
  verifiedValue?: string;
  error?: string;
}

export type FillResult = FillOutcome & { fieldId: string };

/* ---------- Port message unions ---------- */

/** A free-text value snapshotted at submit time, for the answers bank. */
export interface CapturedAnswer {
  label: string;
  value: string;
}

/** Content script → background. */
export type CsToBg =
  | { t: 'cs/ready'; atsId: AtsId | null; url: string }
  | { t: 'cs/fields'; fields: FormFieldDescriptor[] }
  | { t: 'cs/fillResults'; results: FillResult[] }
  /** User activated a submit-looking control — answers snapshotted NOW,
   *  before navigation destroys the form. */
  | { t: 'cs/submitAttempt'; url: string; title: string; answers: CapturedAnswer[] }
  /** A confirmation page/modal appeared — the application really went through. */
  | { t: 'cs/submitDetected'; url: string; title: string; confirmationText: string }
  /** The element the user right-clicked resolves to this field. */
  | { t: 'cs/contextField'; fieldId: string }
  | { t: 'cs/jdText'; text: string; title: string };

/** Background → content script. */
export type BgToCs =
  | { t: 'bg/scan' }
  | { t: 'bg/execute'; instructions: FillInstruction[]; files?: SerializedFile[] }
  | { t: 'bg/highlight'; fieldId: string }
  | { t: 'bg/extractJd' }
  /** Resolve the last right-clicked element to a discovered field. */
  | { t: 'bg/identifyContext' };

/** Side panel → background. */
export type PanelToBg =
  /** windowId scopes the panel: tab activations in OTHER windows must not
   *  repoint it (side panels are per-window). */
  | { t: 'panel/attach'; tabId: number | null; windowId?: number }
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
  | { t: 'bg/tabChanged'; tabId: number; url: string; reset?: boolean };

export const CS_PORT = 'jobpilot-cs';
export const PANEL_PORT = 'jobpilot-panel';

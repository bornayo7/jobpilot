import type { ResumeVersion } from '../schema/resumeVersion';
import { resumeContent } from './resumeContent';
import { PDF_TOKEN_LIMIT } from './pdfText';

export interface PdfValidation { ok: boolean; problems: string[] }

export async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  // Build-time SSR pruning keeps the Node compatibility bundle out of the
  // extension. Both adapters are lazy; ordinary panel startup loads neither.
  const { pdfjs } = import.meta.env.SSR && typeof window === 'undefined'
    ? await import('./pdfNode')
    : await import('./pdfBrowser');
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
  try {
    const doc = await loadingTask.promise;
    const parts: string[] = [];
    for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
      const page = await doc.getPage(pageNum);
      const content = await page.getTextContent();
      for (const item of content.items) if ('str' in item && item.str) parts.push(item.str);
    }
    return parts.join(' ');
  } finally {
    await loadingTask.destroy();
  }
}

/** Complete content/order check, shared with DOCX verification. This tests the
 * text layer, not the behavior of every ATS parser or the visual page layout. */
export function validateExtractedText(text: string, version: ResumeVersion): PdfValidation {
  const problems: string[] = [];
  const normalized = normalize(text);
  let cursor = 0;
  for (const item of resumeContent(version)) {
    const value = normalize(item.text);
    const limit = item.label === 'name' ? 26 : PDF_TOKEN_LIMIT;
    const match = findValue(normalized, value, cursor, limit);
    if (match) cursor = match.end;
    else if (findValue(normalized, value, 0, limit)) problems.push(`Reading order or repeated content broken: ${item.label} "${item.text.slice(0, 60)}"`);
    else problems.push(`Missing from extracted text: ${item.label} "${item.text.slice(0, 60)}"`);
  }
  if (/[\u00ad\ufffd]/u.test(text)) problems.push('Text layer contains soft hyphens or replacement characters');
  return { ok: problems.length === 0, problems };
}
export async function validateResumePdf(bytes: ArrayBuffer, version: ResumeVersion): Promise<PdfValidation> {
  try { return validateExtractedText(await extractPdfText(bytes), version); }
  catch (error) { return { ok: false, problems: [`PDF text extraction failed: ${String(error).slice(0, 200)}`] }; }
}
function normalize(text: string): string { return text.normalize('NFKC').toLowerCase().replace(/\s+/gu, ' ').trim(); }
function findValue(text: string, value: string, start: number, limit: number): { end: number } | null {
  if (!value) return { end: start };
  // Technical tokens must not turn C into C#, Go into Google, or 40 into 40%.
  const word = /[\p{L}\p{N}+#.%]/u;
  const escape = (part: string) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Only overlong original tokens can acquire line breaks. Ordinary words and
  // short technical tokens still require their exact original separation.
  const pattern = value.split(' ').map(token => Array.from(token).length > limit
    ? Array.from(token).map(escape).join('\\s*') : escape(token)).join(' ');
  const expression = new RegExp(pattern, 'gu');
  expression.lastIndex = start;
  for (let match = expression.exec(text); match; match = expression.exec(text)) {
    const found = match.index;
    const before = text[found - 1]; const after = text[found + match[0].length];
    if ((!before || !word.test(before) || !word.test(value[0]!)) &&
      (!after || !word.test(after) || !word.test(value[value.length - 1]!))) return { end: found + match[0].length };
  }
  return null;
}

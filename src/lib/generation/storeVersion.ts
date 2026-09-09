import type { Profile } from '../schema/profile';
import type { ResumeVersion } from '../schema/resumeVersion';
import { commitVersion, type PreparedVersion, type VersionRecord } from '../storage/versions';
export type { PreparedVersion } from '../storage/versions';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export function storePreparedVersion(prepared: PreparedVersion): Promise<VersionRecord> { return commitVersion(prepared); }

export function storeResumeVersion(input: {
  version: ResumeVersion; jobUrl: string; fallbackName: string; pdfBytes: ArrayBuffer; docxBytes: ArrayBuffer;
  profileId?: string; profileRevision?: number;
}): Promise<VersionRecord> {
  const { version, jobUrl, fallbackName, pdfBytes, docxBytes, profileId, profileRevision } = input;
  const baseName = fileBaseName(version.meta.company || fallbackName || 'resume');
  return storePreparedVersion({
    record: { kind: 'resume', label: version.meta.label || version.meta.role || baseName, company: version.meta.company,
      jobUrl, data: version, ...(profileId ? { profileId, profileRevision } : {}) },
    artifacts: [
      { format: 'pdf', name: `${baseName}.pdf`, type: 'application/pdf', bytes: pdfBytes },
      { format: 'docx', name: `${baseName}.docx`, type: DOCX_TYPE, bytes: docxBytes },
    ],
  });
}
export interface CoverLetterInput {
  text: string; profile: Profile; company: string; jobUrl: string; profileId?: string; profileRevision?: number;
}

/** Preparation has no persistence side effects. The caller may reject an
 * obsolete result before committing it without leaving orphaned files. */
export async function prepareCoverLetter(input: CoverLetterInput): Promise<PreparedVersion> {
  const { text, profile, company, jobUrl, profileId, profileRevision } = input;
  const { basics } = profile;
  const contactLine = [[basics.location.city, basics.location.state].filter(Boolean).join(', '), basics.email, basics.phone].filter(Boolean).join('  |  ');
  const { renderCoverLetterPdf } = await import('./renderCoverLetterPdf');
  const bytes = await renderCoverLetterPdf({ name: `${basics.firstName} ${basics.lastName}`.trim() || 'Cover letter',
    contactLine, company, date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }), body: text });
  return { record: { kind: 'coverLetter', label: 'Cover letter', company, jobUrl, data: { text },
    ...(profileId ? { profileId, profileRevision } : {}) },
    artifacts: [{ format: 'pdf', name: `${fileBaseName(company || 'cover-letter')}-cover-letter.pdf`, type: 'application/pdf', bytes }] };
}
export async function storeCoverLetter(input: CoverLetterInput): Promise<VersionRecord> {
  return storePreparedVersion(await prepareCoverLetter(input));
}
export function fileBaseName(raw: string): string {
  const cleaned = raw.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 40);
  return cleaned || 'resume';
}

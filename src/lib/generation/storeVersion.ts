import type { Profile } from '../schema/profile';
import type { ResumeVersion } from '../schema/resumeVersion';
import { renderCoverLetterPdf } from './renderCoverLetterPdf';
import { saveVersion, storeRenderedBlob, type VersionRecord } from '../storage/versions';

const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/**
 * File an approved, validated resume in the version library: the JSON it
 * came from plus both rendered twins, named after the target company.
 */
export async function storeResumeVersion(input: {
  version: ResumeVersion;
  jobUrl: string;
  /** Used for the filename when the version carries no company. */
  fallbackName: string;
  pdfBytes: ArrayBuffer;
  docxBytes: ArrayBuffer;
}): Promise<VersionRecord> {
  const { version, jobUrl, fallbackName, pdfBytes, docxBytes } = input;
  const baseName = fileBaseName(version.meta.company || fallbackName || 'resume');
  const pdfBlobId = await storeRenderedBlob(`${baseName}.pdf`, 'application/pdf', pdfBytes);
  const docxBlobId = await storeRenderedBlob(`${baseName}.docx`, DOCX_TYPE, docxBytes);
  return saveVersion({
    kind: 'resume',
    label: version.meta.label || version.meta.role || baseName,
    company: version.meta.company,
    jobUrl,
    data: version,
    pdfBlobId,
    docxBlobId,
  });
}

/**
 * File an approved cover letter: the text as pasted, plus a rendered PDF twin
 * headed with the profile's name and contact line.
 */
export async function storeCoverLetter(input: {
  text: string;
  profile: Profile;
  company: string;
  jobUrl: string;
}): Promise<VersionRecord> {
  const { text, profile, company, jobUrl } = input;
  const { basics } = profile;
  const contactLine = [
    [basics.location.city, basics.location.state].filter(Boolean).join(', '),
    basics.email,
    basics.phone,
  ]
    .filter(Boolean)
    .join('  |  ');
  const pdfBytes = await renderCoverLetterPdf({
    name: `${basics.firstName} ${basics.lastName}`.trim() || 'Cover letter',
    contactLine,
    company,
    date: new Date().toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }),
    body: text,
  });
  const pdfBlobId = await storeRenderedBlob(
    `${fileBaseName(company || 'cover-letter')}-cover-letter.pdf`,
    'application/pdf',
    pdfBytes,
  );
  return saveVersion({ kind: 'coverLetter', label: 'Cover letter', company, jobUrl, data: { text }, pdfBlobId });
}

/** A filename-safe stem: letters, digits, dashes; never empty. */
export function fileBaseName(raw: string): string {
  const cleaned = raw.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-').slice(0, 40);
  return cleaned || 'resume';
}

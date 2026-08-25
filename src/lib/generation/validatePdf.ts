import type { ResumeVersion } from '../schema/resumeVersion';

export interface PdfValidation {
  ok: boolean;
  problems: string[];
}

/**
 * Extract the PDF's text layer in reading order via pdf.js. This is the cheap,
 * reliable proxy for "an ATS can parse this": if select-all-copy-paste yields
 * the content in order, parsers handle it.
 */
export async function extractPdfText(bytes: ArrayBuffer): Promise<string> {
  // Browser: modern build + real worker via Vite's asset URL. Node (tests):
  // the legacy build, which ships DOMMatrix/Path2D shims and a fake worker.
  const pdfjs =
    typeof window === 'undefined'
      ? ((await import('pdfjs-dist/legacy/build/pdf.mjs')) as typeof import('pdfjs-dist'))
      : await import('pdfjs-dist');
  if (typeof window !== 'undefined' && !pdfjs.GlobalWorkerOptions.workerSrc) {
    pdfjs.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
  }

  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(bytes) });
  const doc = await loadingTask.promise;
  const parts: string[] = [];
  for (let pageNum = 1; pageNum <= doc.numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    for (const item of content.items) {
      if ('str' in item && item.str) parts.push(item.str);
    }
  }
  await loadingTask.destroy();
  return parts.join(' ');
}

/**
 * Assert the rendered PDF actually carries the version's content, in order.
 * Runs at generation time — a version that fails cannot be marked usable.
 */
export function validateExtractedText(text: string, version: ResumeVersion): PdfValidation {
  const problems: string[] = [];
  const normalized = normalize(text);

  const mustContain: { what: string; value: string }[] = [
    { what: 'name', value: version.basics.name },
    ...(version.basics.email ? [{ what: 'email', value: version.basics.email }] : []),
    ...version.experience.map((e) => ({ what: `company "${e.company}"`, value: e.company })),
    ...version.experience.flatMap((e) =>
      e.bullets.map((b) => ({ what: `bullet "${b.slice(0, 40)}…"`, value: b })),
    ),
    ...version.education.map((e) => ({ what: `school "${e.school}"`, value: e.school })),
    ...version.skills.flatMap((g) => g.items.slice(0, 3).map((s) => ({ what: `skill "${s}"`, value: s }))),
  ];

  for (const { what, value } of mustContain) {
    if (value && !normalized.includes(normalize(value))) {
      problems.push(`Missing from extracted text: ${what}`);
    }
  }

  // Reading order: name before experience content, experience before education
  // (when both exist) — a scrambled text layer breaks this immediately.
  const nameIdx = normalized.indexOf(normalize(version.basics.name));
  const firstBullet = version.experience[0]?.bullets[0];
  if (firstBullet) {
    const bulletIdx = normalized.indexOf(normalize(firstBullet));
    if (bulletIdx !== -1 && nameIdx > bulletIdx) {
      problems.push('Reading order broken: name appears after experience content');
    }
  }
  const firstSchool = version.education[0]?.school;
  if (firstBullet && firstSchool) {
    const bulletIdx = normalized.indexOf(normalize(firstBullet));
    const schoolIdx = normalized.indexOf(normalize(firstSchool));
    if (bulletIdx !== -1 && schoolIdx !== -1 && schoolIdx < bulletIdx) {
      problems.push('Reading order broken: education precedes experience in the text layer');
    }
  }

  // Soft hyphens or replacement chars in the layer = font/hyphenation problem.
  if (/[­�]/.test(text)) {
    problems.push('Text layer contains soft hyphens or replacement characters');
  }

  return { ok: problems.length === 0, problems };
}

export async function validateResumePdf(bytes: ArrayBuffer, version: ResumeVersion): Promise<PdfValidation> {
  try {
    const text = await extractPdfText(bytes);
    return validateExtractedText(text, version);
  } catch (err) {
    return { ok: false, problems: [`PDF text extraction failed: ${String(err).slice(0, 200)}`] };
  }
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

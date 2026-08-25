// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { ResumeVersionSchema, type ResumeVersion } from '@lib/schema/resumeVersion';
import { renderResumePdf } from '@lib/generation/renderPdf';
import { renderResumeDocx } from '@lib/generation/renderDocx';
import { extractPdfText, validateExtractedText } from '@lib/generation/validatePdf';

const VERSION: ResumeVersion = ResumeVersionSchema.parse({
  meta: { label: 'Acme SWE', company: 'Acme', role: 'Software Engineer' },
  basics: {
    name: 'Ada Lovelace',
    email: 'ada@example.com',
    phone: '(512) 555-0100',
    location: 'Austin, TX',
    links: ['github.com/ada', 'linkedin.com/in/ada'],
  },
  summary: 'CS student building developer tools.',
  experience: [
    {
      company: 'Orchard Robotics',
      title: 'Software Engineering Intern',
      location: 'Remote',
      dates: 'Jun 2025 - Aug 2025',
      bullets: [
        'Cut CI build times from 12 to 4 minutes by adding a content-addressed cache',
        'Wrote the deploy runbook used by the platform team',
      ],
    },
  ],
  projects: [
    {
      name: 'CallCoach',
      tech: 'TypeScript, WebAudio',
      url: 'github.com/ada/callcoach',
      bullets: ['Live interview copilot with local voice-activity detection'],
    },
  ],
  education: [
    { school: 'UT Austin', degree: 'B.S. Computer Science', dates: 'Aug 2023 - May 2027', details: 'GPA 3.8' },
  ],
  skills: [
    { category: 'Languages', items: ['TypeScript', 'Python'] },
    { category: 'Tools', items: ['React', 'Node', 'Postgres', 'Docker'] },
  ],
});

describe('PDF render → extract → validate roundtrip', () => {
  it('produces a text layer containing every bullet, in reading order', async () => {
    const pdfBytes = await renderResumePdf(VERSION);
    expect(pdfBytes.byteLength).toBeGreaterThan(1000);

    const text = await extractPdfText(pdfBytes);
    const validation = validateExtractedText(text, VERSION);
    expect(validation.problems).toEqual([]);
    expect(validation.ok).toBe(true);

    // Order spot-checks: name first, then experience, then education.
    const nameIdx = text.indexOf('Ada Lovelace');
    const bulletIdx = text.indexOf('content-addressed cache');
    const schoolIdx = text.indexOf('UT Austin');
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(bulletIdx).toBeGreaterThan(nameIdx);
    expect(schoolIdx).toBeGreaterThan(bulletIdx);
  }, 30_000);

  it('validateExtractedText catches missing content', () => {
    const validation = validateExtractedText('Ada Lovelace but nothing else', VERSION);
    expect(validation.ok).toBe(false);
    expect(validation.problems.join(' ')).toContain('Missing from extracted text');
  });
});

describe('DOCX render', () => {
  it('produces a real zip container of meaningful size', async () => {
    const bytes = await renderResumeDocx(VERSION);
    const head = new Uint8Array(bytes.slice(0, 2));
    // 'PK' zip magic
    expect(head[0]).toBe(0x50);
    expect(head[1]).toBe(0x4b);
    expect(bytes.byteLength).toBeGreaterThan(2000);
  }, 30_000);
});

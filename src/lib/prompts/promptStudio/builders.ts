import type { Profile } from '../../schema/profile';
import { RESUME_JSON_SPEC } from '../../schema/resumeVersion';
import { HUMANIZE_STYLE_GUIDE } from './humanize';

export interface JobContext {
  title: string;
  text: string;
  url: string;
}

export interface StylePrefs {
  tone: string;
  notes: string;
}

/**
 * Prompt Studio builders. These produce COMPLETE, self-contained prompts the
 * user pastes into claude.ai / ChatGPT — the strong models they already pay
 * for do the writing there, at zero API cost and fully within both vendors'
 * terms. No model is ever called from here.
 */

export function buildResumePrompt(profile: Profile, job: JobContext, style: StylePrefs): string {
  return [
    'You are tailoring a resume to one specific job posting. Work only from the candidate data below — rephrasing and reordering is your job, inventing facts is forbidden.',
    '',
    '== JOB POSTING ==',
    `URL: ${job.url}`,
    job.text.trim(),
    '',
    '== CANDIDATE DATA (the only source of truth) ==',
    JSON.stringify(profileForPrompt(profile), null, 2),
    '',
    '== TAILORING RULES ==',
    '- Extract the must-have skills, tools, and qualifications from the posting first; select and order experience bullets to cover as many must-haves as the data honestly supports.',
    "- Mirror the posting's exact terminology where the candidate data supports it (include both acronym and expansion once, e.g. \"Search Engine Optimization (SEO)\"), inside achievement bullets — not as a keyword dump.",
    '- Rewrite bullets for impact but keep every fact traceable to the data. Never add numbers, teams, or tools that are not there.',
    '- Bullets from tagged data: prefer bullets whose tags overlap the must-haves.',
    '- Single-column, standard sections only (the renderer enforces layout; you produce content).',
    '- Keep it to one page of content: at most ~5 bullets for the most relevant position, fewer for older ones. Drop what does not serve this application.',
    `- Style preferences from the candidate: tone "${style.tone}".${style.notes ? ` Additional notes: ${style.notes}` : ''}`,
    '',
    HUMANIZE_STYLE_GUIDE,
    '',
    '== OUTPUT FORMAT (strict) ==',
    'Reply with a SINGLE fenced json code block and nothing else. It must match this shape exactly:',
    '```json',
    RESUME_JSON_SPEC,
    '```',
    'Every key shown must be present (use empty strings/arrays when not applicable). No commentary before or after the block.',
  ].join('\n');
}

export function buildCoverLetterPrompt(profile: Profile, job: JobContext, style: StylePrefs): string {
  return [
    'Write a cover letter for the job posting below, using only the candidate data provided. Every claim must trace to the data; do not invent projects, numbers, or motivations.',
    '',
    '== JOB POSTING ==',
    `URL: ${job.url}`,
    job.text.trim(),
    '',
    '== CANDIDATE DATA (the only source of truth) ==',
    JSON.stringify(profileForPrompt(profile), null, 2),
    '',
    `== STYLE ==`,
    `Tone: ${style.tone}.${style.notes ? ` Notes: ${style.notes}` : ''}`,
    '',
    HUMANIZE_STYLE_GUIDE,
    '',
    '== OUTPUT FORMAT (strict) ==',
    'Reply with ONLY the letter body text (no JSON, no markdown headers, no signature placeholders like "[Your Name]" — end with the candidate\'s actual name). No commentary.',
  ].join('\n');
}

export function buildAnswerPrompt(
  profile: Profile,
  job: JobContext,
  style: StylePrefs,
  question: string,
): string {
  return [
    'Answer one screening question from a job application, as the candidate, using only the candidate data provided. Do not invent experiences.',
    '',
    `== QUESTION ==`,
    question.trim(),
    '',
    '== JOB POSTING (context) ==',
    `URL: ${job.url}`,
    job.text.trim().slice(0, 6000),
    '',
    '== CANDIDATE DATA (the only source of truth) ==',
    JSON.stringify(profileForPrompt(profile), null, 2),
    '',
    `== STYLE ==`,
    `Tone: ${style.tone}. Length: as short as a strong answer allows — 60 to 150 words unless the question demands more.${style.notes ? ` Notes: ${style.notes}` : ''}`,
    '',
    HUMANIZE_STYLE_GUIDE,
    '',
    '== OUTPUT FORMAT (strict) ==',
    'Reply with ONLY the answer text. No preamble, no commentary.',
  ].join('\n');
}

export interface FollowUpJob {
  company: string;
  title: string;
  url: string;
  appliedAt?: number;
}

export function buildFollowUpPrompt(
  profile: Profile,
  job: FollowUpJob,
  style: StylePrefs,
  variant: 'followUp' | 'thankYou',
): string {
  const appliedLine = job.appliedAt
    ? `Applied on: ${new Date(job.appliedAt).toDateString()}`
    : 'Applied recently.';
  const task =
    variant === 'followUp'
      ? 'Write a short follow-up email to the recruiting team about an application that has had no response yet. Goal: polite signal of continued interest plus one concrete reason the fit is real. 90-130 words.'
      : 'Write a short thank-you email to send after an interview for this role. Reference the role specifically; one line may mention looking forward to next steps. 80-120 words.';

  return [
    task,
    '',
    '== APPLICATION ==',
    `Company: ${job.company}`,
    `Role: ${job.title}`,
    `Posting: ${job.url}`,
    appliedLine,
    '',
    '== CANDIDATE (the only source of truth — never invent facts) ==',
    JSON.stringify(profileForPrompt(profile), null, 2),
    '',
    `== STYLE ==`,
    `Tone: ${style.tone}.${style.notes ? ` Notes: ${style.notes}` : ''}`,
    '',
    HUMANIZE_STYLE_GUIDE,
    '',
    '== OUTPUT FORMAT (strict) ==',
    'Reply with ONLY the email: first line "Subject: ...", blank line, then the body, ending with the candidate\'s actual name. No commentary, no placeholders.',
  ].join('\n');
}

export const PROFILE_JSON_SPEC = `{
  "basics": { "firstName": "...", "lastName": "...", "email": "...", "phone": "...",
    "location": { "city": "...", "state": "...", "country": "...", "postal": "..." } },
  "links": { "linkedin": "", "github": "", "portfolio": "", "other": [] },
  "work": [
    { "company": "...", "title": "...", "location": "...", "start": "Jun 2024", "end": "Aug 2026",
      "current": false, "bullets": [ { "text": "achievement bullet", "tags": ["react", "testing"] } ] }
  ],
  "education": [
    { "school": "...", "degree": "B.S.", "field": "Computer Science", "gpa": "3.8",
      "start": "Aug 2023", "end": "May 2027" }
  ],
  "projects": [
    { "name": "...", "url": "", "description": "one line", "bullets": [ { "text": "...", "tags": [] } ] }
  ],
  "skills": [ { "name": "TypeScript", "category": "Languages" } ]
}`;

/**
 * Onboarding shortcut: convert an existing resume into profile JSON via the
 * user's own claude.ai / ChatGPT, then paste the JSON back into the options
 * page. No job context needed.
 */
export function buildProfileImportPrompt(): string {
  return [
    'Convert the resume text below into structured JSON. Transcribe faithfully — do not embellish, invent, or omit content. Where the resume gives a date range, keep its wording (e.g. "Jun 2024 - Present" becomes start "Jun 2024", current true).',
    '',
    'For each work/project bullet, add 1-4 lowercase "tags" naming the skills or tools that bullet demonstrates (these drive later resume tailoring).',
    '',
    '== OUTPUT FORMAT (strict) ==',
    'Reply with a SINGLE fenced json code block matching this shape exactly (every key present; empty strings/arrays where the resume has nothing):',
    '```json',
    PROFILE_JSON_SPEC,
    '```',
    'No commentary before or after the block.',
    '',
    '== RESUME TEXT (paste yours below this line) ==',
  ].join('\n');
}

/** The profile minus data an external chat has no business seeing. */
function profileForPrompt(profile: Profile) {
  const { eeo: _eeo, documents: _docs, schemaVersion: _v, ...rest } = profile;
  return rest;
}

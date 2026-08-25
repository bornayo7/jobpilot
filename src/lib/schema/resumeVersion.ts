import { z } from 'zod';

/**
 * The JSON contract between the Prompt Studio and the external model
 * (claude.ai / ChatGPT). Deliberately forgiving: dates are display strings,
 * optional sections may be omitted. The paste-back importer validates against
 * this and the renderers consume it — PDF and DOCX can never drift apart.
 */
export const ResumeVersionSchema = z.object({
  meta: z.object({
    label: z.string().default(''),
    company: z.string().default(''),
    role: z.string().default(''),
  }),
  basics: z.object({
    name: z.string(),
    email: z.string().default(''),
    phone: z.string().default(''),
    location: z.string().default(''),
    /** Display strings, e.g. "linkedin.com/in/ada" or "github.com/ada". */
    links: z.array(z.string()).default([]),
  }),
  summary: z.string().optional(),
  experience: z
    .array(
      z.object({
        company: z.string(),
        title: z.string(),
        location: z.string().default(''),
        dates: z.string().default(''),
        bullets: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string(),
        tech: z.string().default(''),
        url: z.string().default(''),
        bullets: z.array(z.string()).default([]),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        school: z.string(),
        degree: z.string().default(''),
        dates: z.string().default(''),
        details: z.string().default(''),
      }),
    )
    .default([]),
  skills: z
    .array(
      z.object({
        category: z.string().default(''),
        items: z.array(z.string()).default([]),
      }),
    )
    .default([]),
});

export type ResumeVersion = z.infer<typeof ResumeVersionSchema>;

/**
 * The schema as shown to the external model inside the prompt. Kept in sync
 * with ResumeVersionSchema by the roundtrip unit test.
 */
export const RESUME_JSON_SPEC = `{
  "meta": { "label": "short version label", "company": "target company", "role": "target role title" },
  "basics": {
    "name": "Full Name", "email": "...", "phone": "...", "location": "City, ST",
    "links": ["linkedin.com/in/...", "github.com/..."]
  },
  "summary": "1-3 sentence professional summary (optional — omit if weak)",
  "experience": [
    { "company": "...", "title": "...", "location": "City, ST", "dates": "Jun 2024 - Aug 2026",
      "bullets": ["achievement bullet", "..."] }
  ],
  "projects": [
    { "name": "...", "tech": "React, TypeScript", "url": "github.com/...", "bullets": ["..."] }
  ],
  "education": [
    { "school": "...", "degree": "B.S. Computer Science", "dates": "Aug 2023 - May 2027", "details": "GPA 3.8" }
  ],
  "skills": [
    { "category": "Languages", "items": ["TypeScript", "Python"] }
  ]
}`;

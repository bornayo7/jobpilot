import { z } from 'zod';

export const CURRENT_SCHEMA_VERSION = 1;

const TaggedBulletSchema = z.object({
  text: z.string(),
  // Tags drive resume tailoring: bullets are selected by how well their tags
  // cover a job's must-have requirements.
  tags: z.array(z.string()).default([]),
});

const WorkEntrySchema = z.object({
  id: z.string(),
  company: z.string().default(''),
  title: z.string().default(''),
  location: z.string().default(''),
  start: z.string().default(''), // "Month YYYY" — ATS-friendly date format
  end: z.string().default(''),
  current: z.boolean().default(false),
  bullets: z.array(TaggedBulletSchema).default([]),
});

const EduEntrySchema = z.object({
  id: z.string(),
  school: z.string().default(''),
  degree: z.string().default(''),
  field: z.string().default(''),
  gpa: z.string().default(''),
  start: z.string().default(''),
  end: z.string().default(''),
});

const ProjectEntrySchema = z.object({
  id: z.string(),
  name: z.string().default(''),
  url: z.string().default(''),
  description: z.string().default(''),
  bullets: z.array(TaggedBulletSchema).default([]),
});

const SkillSchema = z.object({
  name: z.string(),
  category: z.string().default(''),
  years: z.number().optional(),
});

// EEO/demographic answers are sensitive: they live only in chrome.storage.local,
// are never sent to any model, and are only ever filled by adapter/heuristic
// tiers with the review UI flagging them for explicit verification.
const EeoSchema = z.object({
  gender: z.string().default(''),
  race: z.string().default(''),
  veteran: z.string().default(''),
  disability: z.string().default(''),
  pronouns: z.string().default(''),
});

const WorkAuthSchema = z.object({
  authorizedUS: z.boolean().default(false),
  needsSponsorship: z.boolean().default(false),
  visaNote: z.string().default(''),
});

export const ProfileSchema = z.object({
  schemaVersion: z.number().default(CURRENT_SCHEMA_VERSION),
  basics: z
    .object({
      firstName: z.string().default(''),
      lastName: z.string().default(''),
      email: z.string().default(''),
      phone: z.string().default(''),
      location: z
        .object({
          city: z.string().default(''),
          state: z.string().default(''),
          country: z.string().default(''),
          postal: z.string().default(''),
        })
        .default({}),
    })
    .default({}),
  links: z
    .object({
      linkedin: z.string().default(''),
      github: z.string().default(''),
      portfolio: z.string().default(''),
      other: z.array(z.object({ label: z.string(), url: z.string() })).default([]),
    })
    .default({}),
  work: z.array(WorkEntrySchema).default([]),
  education: z.array(EduEntrySchema).default([]),
  projects: z.array(ProjectEntrySchema).default([]),
  skills: z.array(SkillSchema).default([]),
  eeo: EeoSchema.default({}),
  workAuth: WorkAuthSchema.default({}),
  preferences: z
    .object({
      expectedSalary: z.string().default(''),
      availableStart: z.string().default(''),
      locations: z.array(z.string()).default([]),
    })
    .default({}),
  documents: z
    .object({
      defaultResumeId: z.string().nullable().default(null),
      defaultCoverLetterId: z.string().nullable().default(null),
    })
    .default({}),
});

export type Profile = z.infer<typeof ProfileSchema>;
export type WorkEntry = z.infer<typeof WorkEntrySchema>;
export type EduEntry = z.infer<typeof EduEntrySchema>;
export type ProjectEntry = z.infer<typeof ProjectEntrySchema>;
export type TaggedBullet = z.infer<typeof TaggedBulletSchema>;
export type Skill = z.infer<typeof SkillSchema>;

export function emptyProfile(): Profile {
  return ProfileSchema.parse({});
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

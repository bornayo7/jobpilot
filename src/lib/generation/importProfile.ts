import { z } from 'zod';
import { newId, ProfileSchema, type Profile } from '../schema/profile';
import { extractJsonBlock } from './importResult';

/**
 * Paste-back importer for the profile-onboarding flow: the external model
 * returns profile JSON WITHOUT ids (and without eeo/documents — those never
 * leave the machine). We validate, assign ids, and merge into the active
 * profile.
 */
const TaggedBulletIn = z.object({ text: z.string(), tags: z.array(z.string()).default([]) });

const ProfileImportSchema = z.object({
  basics: ProfileSchema.shape.basics,
  links: ProfileSchema.shape.links,
  work: z
    .array(
      z.object({
        company: z.string().default(''),
        title: z.string().default(''),
        location: z.string().default(''),
        start: z.string().default(''),
        end: z.string().default(''),
        current: z.boolean().default(false),
        bullets: z.array(TaggedBulletIn).default([]),
      }),
    )
    .default([]),
  education: z
    .array(
      z.object({
        school: z.string().default(''),
        degree: z.string().default(''),
        field: z.string().default(''),
        gpa: z.string().default(''),
        start: z.string().default(''),
        end: z.string().default(''),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        name: z.string().default(''),
        url: z.string().default(''),
        description: z.string().default(''),
        bullets: z.array(TaggedBulletIn).default([]),
      }),
    )
    .default([]),
  skills: z.array(z.object({ name: z.string(), category: z.string().default('') })).default([]),
  // workAuth / preferences / eeo are deliberately NOT importable: a resume
  // cannot tell the model your visa status or salary floor, and defaulted
  // booleans would silently overwrite real answers.
});

export type ProfileImport = z.infer<typeof ProfileImportSchema>;

export type ProfileImportOutcome =
  | { ok: true; imported: ProfileImport; summary: string }
  | { ok: false; errors: string[] };

export function parseProfilePaste(pasted: string): ProfileImportOutcome {
  const jsonText = extractJsonBlock(pasted);
  if (!jsonText) return { ok: false, errors: ['No JSON found — paste the full ```json block from the chat.'] };

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    return { ok: false, errors: [`JSON does not parse: ${String(err).slice(0, 200)}`] };
  }

  const result = ProfileImportSchema.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.slice(0, 8).map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }

  const data = result.data;
  const bulletCount =
    data.work.reduce((n, w) => n + w.bullets.length, 0) +
    data.projects.reduce((n, p) => n + p.bullets.length, 0);
  const summary = `${data.work.length} positions, ${data.education.length} education entries, ${data.projects.length} projects, ${data.skills.length} skills, ${bulletCount} bullets`;
  return { ok: true, imported: data, summary };
}

/**
 * Merge policy: imported non-empty scalars overwrite; non-empty imported lists
 * REPLACE the profile's lists (fresh ids assigned). eeo and documents are
 * untouched — the import prompt never carries them.
 */
export function mergeProfileImport(current: Profile, imported: ProfileImport): Profile {
  return {
    ...current,
    basics: {
      ...current.basics,
      ...pickNonEmpty(imported.basics),
      location: { ...current.basics.location, ...pickNonEmpty(imported.basics.location) },
    },
    links: {
      ...current.links,
      ...pickNonEmpty({ linkedin: imported.links.linkedin, github: imported.links.github, portfolio: imported.links.portfolio }),
      other: imported.links.other.length > 0 ? imported.links.other : current.links.other,
    },
    work: imported.work.length > 0 ? imported.work.map((w) => ({ ...w, id: newId() })) : current.work,
    education:
      imported.education.length > 0 ? imported.education.map((e) => ({ ...e, id: newId() })) : current.education,
    projects:
      imported.projects.length > 0 ? imported.projects.map((p) => ({ ...p, id: newId() })) : current.projects,
    skills: imported.skills.length > 0 ? imported.skills : current.skills,
  };
}

function pickNonEmpty<T extends Record<string, unknown>>(obj: T): Partial<T> {
  const out: Partial<T> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string' && value.trim() === '') continue;
    if (typeof value === 'object') continue; // handled explicitly by caller
    out[key as keyof T] = value as T[keyof T];
  }
  return out;
}

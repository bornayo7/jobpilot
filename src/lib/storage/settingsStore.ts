import { browser } from '#imports';
import { z } from 'zod';
import { withStorageRead, withStorageWrite } from './coordination';

export const ModelRefSchema = z.object({
  provider: z.enum(['anthropic', 'openai', 'openrouter', 'ollama', 'lmstudio', 'chrome-ai']),
  model: z.string(),
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

/**
 * In-app models handle classification-scale work only (field mapping, keyword
 * extraction). All long-form writing goes through the Prompt Studio copy-paste
 * flow to the user's own claude.ai / ChatGPT — never through these keys.
 */
export const SettingsSchema = z.object({
  anthropicKey: z.string().default(''),
  openaiKey: z.string().default(''),
  openrouterKey: z.string().default(''),
  ollamaBaseUrl: z.string().default('http://localhost:11434'),
  lmstudioBaseUrl: z.string().default('http://localhost:1234'),
  routing: z
    .object({
      mapping: ModelRefSchema.default({ provider: 'anthropic', model: 'claude-haiku-4-5' }),
      extraction: ModelRefSchema.default({ provider: 'anthropic', model: 'claude-haiku-4-5' }),
    })
    .default({}),
  promptStyle: z
    .object({
      tone: z.string().default('professional but personable'),
      notes: z.string().default(''),
    })
    .default({}),
  dealbreakers: z
    .object({
      enabled: z.boolean().default(true),
      /** Warn when the posting says it cannot sponsor a visa. */
      noSponsorship: z.boolean().default(false),
      /** Warn on citizenship / security-clearance requirements. */
      clearance: z.boolean().default(false),
      /** Warn when the posted salary tops out below this (null = off). */
      minSalary: z.number().nullable().default(null),
      /** Custom warn-if-mentioned terms. */
      terms: z.array(z.string()).default([]),
    })
    .default({}),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const SETTINGS_KEY = 'jobpilot:settings';
export const SETTINGS_REVISION_KEY = 'jobpilot:settings:revision';
export interface SettingsSnapshot { revision: number; settings: Settings }
type DeepPartial<T> = T extends readonly unknown[] ? T : T extends object ? { [K in keyof T]?: DeepPartial<T[K]> } : T;
export type SettingsPatch = DeepPartial<Settings>;
export class SettingsConflictError extends Error {
  constructor(public readonly current: SettingsSnapshot) {
    super('The same setting changed elsewhere. Review the saved value and retry.');
    this.name = 'SettingsConflictError';
  }
}

export async function loadSettings(): Promise<Settings> {
  return (await loadSettingsSnapshot()).settings;
}

async function readSnapshot(): Promise<SettingsSnapshot> {
  const stored = await browser.storage.local.get([SETTINGS_KEY, SETTINGS_REVISION_KEY]);
  return { revision: typeof stored[SETTINGS_REVISION_KEY] === 'number' ? stored[SETTINGS_REVISION_KEY] : 0,
    settings: parseSettings(stored[SETTINGS_KEY]) };
}
export function loadSettingsSnapshot(): Promise<SettingsSnapshot> {
  return withStorageRead(readSnapshot);
}

export function patchSettings(patch: SettingsPatch, base?: SettingsSnapshot): Promise<SettingsSnapshot> {
  return withStorageWrite(async () => {
    const current = await readSnapshot();
    const settings = SettingsSchema.parse(mergePatch(current.settings, patch, base?.settings, current));
    const next = { revision: current.revision + 1, settings };
    await browser.storage.local.set({ [SETTINGS_KEY]: settings, [SETTINGS_REVISION_KEY]: next.revision });
    return next;
  });
}

function mergePatch(current: unknown, patch: unknown, base: unknown, snapshot: SettingsSnapshot): unknown {
  if (patch && typeof patch === 'object' && !Array.isArray(patch)) {
    const result = { ...(current as Record<string, unknown>) };
    for (const [key, value] of Object.entries(patch)) {
      if (value !== undefined) result[key] = mergePatch(result[key], value, (base as Record<string, unknown> | undefined)?.[key], snapshot);
    }
    return result;
  }
  if (base !== undefined) {
    // A full editor draft may include unchanged fields. Leave those at their
    // latest values; only an actual edit participates in conflict detection.
    if (JSON.stringify(patch) === JSON.stringify(base)) return current;
    if (JSON.stringify(current) !== JSON.stringify(base) && JSON.stringify(current) !== JSON.stringify(patch)) throw new SettingsConflictError(snapshot);
  }
  return patch;
}

/** Fires whenever settings are saved from any extension page. */
export function watchSettings(cb: (settings: Settings) => void): () => void {
  return watchSettingsSnapshot((snapshot) => cb(snapshot.settings));
}
export function watchSettingsSnapshot(cb: (snapshot: SettingsSnapshot) => void, onError: (error: unknown) => void = console.error): () => void {
  let active = true;
  const listener = (changes: Record<string, unknown>, area: string) => {
    if (area !== 'local' || (!changes[SETTINGS_KEY] && !changes[SETTINGS_REVISION_KEY])) return;
    void loadSettingsSnapshot().then((snapshot) => { if (active) cb(snapshot); }, (error) => { if (active) onError(error); });
  };
  browser.storage.onChanged.addListener(listener);
  return () => { active = false; browser.storage.onChanged.removeListener(listener); };
}

function parseSettings(raw: unknown): Settings {
  const parsed = SettingsSchema.safeParse(raw ?? {});
  if (!parsed.success) throw new Error('Saved settings are invalid. Export a backup before repairing them.');
  return parsed.data;
}

import { browser } from '#imports';
import { z } from 'zod';

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
});
export type Settings = z.infer<typeof SettingsSchema>;

const KEY = 'jobpilot:settings';

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  const parsed = SettingsSchema.safeParse(stored[KEY] ?? {});
  return parsed.success ? parsed.data : SettingsSchema.parse({});
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [KEY]: settings });
}

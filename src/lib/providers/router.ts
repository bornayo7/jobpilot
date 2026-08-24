import type { Settings, ModelRef } from '../storage/settingsStore';
import type { ChatProvider } from './types';
import { ProviderError } from './types';
import { anthropicProvider } from './anthropic';
import { ollamaProvider } from './ollama';
import { openaiCompatibleProvider } from './openaiCompatible';

export type LlmTask = 'mapping' | 'extraction';

export function providerFor(settings: Settings, ref: ModelRef): ChatProvider {
  switch (ref.provider) {
    case 'anthropic':
      return anthropicProvider(settings.anthropicKey);
    case 'openai':
      return openaiCompatibleProvider({
        id: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        apiKey: settings.openaiKey,
        healthHint: (s) => (s === 401 ? 'OpenAI API key rejected (401).' : undefined),
      });
    case 'openrouter':
      return openaiCompatibleProvider({
        id: 'openrouter',
        baseUrl: 'https://openrouter.ai/api/v1',
        apiKey: settings.openrouterKey,
        extraHeaders: { 'x-title': 'JobPilot' },
        healthHint: (s) => (s === 401 ? 'OpenRouter key rejected (401). Use Connect or paste a key.' : undefined),
      });
    case 'ollama':
      return ollamaProvider(settings.ollamaBaseUrl);
    case 'lmstudio':
      return openaiCompatibleProvider({
        id: 'lmstudio',
        baseUrl: `${settings.lmstudioBaseUrl.replace(/\/$/, '')}/v1`,
        healthHint: (s) =>
          s === 'network'
            ? 'Cannot reach LM Studio — start its server (Developer tab) and enable CORS.'
            : undefined,
      });
    case 'chrome-ai':
      // Chrome built-in Prompt API adapter lands with the fill engine polish;
      // routing to it before then is a configuration error, not a crash.
      throw new ProviderError('Chrome built-in AI adapter not wired up yet');
  }
}

/** Resolve the provider+model configured for a task (mapping, extraction). */
export function routeTask(settings: Settings, task: LlmTask): { provider: ChatProvider; model: string } {
  const ref = settings.routing[task];
  return { provider: providerFor(settings, ref), model: ref.model };
}

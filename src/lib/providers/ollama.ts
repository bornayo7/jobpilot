import type { ChatProvider } from './types';
import { openaiCompatibleProvider } from './openaiCompatible';

/**
 * Ollama via its OpenAI-compatible /v1 endpoint. Ollama validates the Origin
 * header SERVER-SIDE — extension host_permissions cannot bypass it. A 403 means
 * the user must set the OLLAMA_ORIGINS environment variable and restart Ollama;
 * health() surfaces exactly that fix.
 */
export const OLLAMA_ORIGINS_HINT =
  'Ollama rejected the extension (403). Set the Windows user environment variable ' +
  'OLLAMA_ORIGINS to chrome-extension://* then fully quit and restart the Ollama tray app.';

export function ollamaProvider(baseUrl: string): ChatProvider {
  return openaiCompatibleProvider({
    id: 'ollama',
    baseUrl: `${baseUrl.replace(/\/$/, '')}/v1`,
    healthHint: (status) => {
      if (status === 'network') return 'Cannot reach Ollama — is it running? (default http://localhost:11434)';
      if (status === 403) return OLLAMA_ORIGINS_HINT;
      return undefined;
    },
  });
}

import type { ChatOptions, ChatProvider, ChatRequest, ChatResponse, ProviderId } from './types';
import { ProviderError } from './types';
import { sseEvents } from './sse';

interface CompatConfig {
  id: ProviderId;
  baseUrl: string; // e.g. https://api.openai.com/v1
  apiKey?: string;
  extraHeaders?: Record<string, string>;
  /** Provider-specific hint mapper for health failures. */
  healthHint?: (status: number | 'network') => string | undefined;
}

/**
 * Shared core for every OpenAI-chat-completions-compatible backend:
 * OpenAI, OpenRouter, LM Studio, and (via /v1) Ollama.
 */
export function openaiCompatibleProvider(config: CompatConfig): ChatProvider {
  const chatUrl = `${config.baseUrl.replace(/\/$/, '')}/chat/completions`;
  const modelsUrl = `${config.baseUrl.replace(/\/$/, '')}/models`;

  const headers = (): Record<string, string> => ({
    'content-type': 'application/json',
    ...(config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {}),
    ...config.extraHeaders,
  });

  return {
    id: config.id,

    async chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse> {
      const streaming = !!opts?.onToken && !req.jsonSchema;
      const body: Record<string, unknown> = {
        model: req.model,
        messages: req.messages,
        ...(req.maxTokens !== undefined ? { max_tokens: req.maxTokens } : {}),
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        ...(streaming ? { stream: true } : {}),
      };

      if (req.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: { name: 'output', strict: true, schema: req.jsonSchema },
        };
      }

      const res = await fetch(chatUrl, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify(body),
        signal: opts?.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new ProviderError(`${config.id} ${res.status}: ${detail.slice(0, 300)}`, res.status);
      }

      if (streaming) {
        let text = '';
        for await (const data of sseEvents(res)) {
          if (data === '[DONE]') break;
          let event: any;
          try {
            event = JSON.parse(data);
          } catch {
            continue;
          }
          const delta: string | undefined = event.choices?.[0]?.delta?.content;
          if (delta) {
            text += delta;
            opts.onToken?.(delta);
          }
        }
        return { text };
      }

      const json: any = await res.json();
      return {
        text: json.choices?.[0]?.message?.content ?? '',
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens,
        },
      };
    },

    async listModels() {
      const res = await fetch(modelsUrl, { headers: headers() });
      if (!res.ok) throw new ProviderError(`${config.id} models ${res.status}`, res.status);
      const json: any = await res.json();
      return (json.data ?? []).map((m: any) => ({ id: m.id, label: m.id }));
    },

    async health() {
      const res = await fetch(modelsUrl, { headers: headers() }).catch(() => null);
      if (!res) return { ok: false, hint: config.healthHint?.('network') ?? 'Network error.' };
      if (!res.ok) return { ok: false, hint: config.healthHint?.(res.status) ?? `HTTP ${res.status}` };
      return { ok: true };
    },
  };
}

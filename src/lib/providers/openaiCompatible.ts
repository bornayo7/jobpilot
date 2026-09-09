import type { ChatOptions, ChatProvider, ChatRequest, ChatResponse, ProviderId } from './types';
import { ProviderError } from './types';
import { sseEvents } from './sse';
import { z } from 'zod';

const Choice = z.object({
  message: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }).optional(),
  delta: z.object({ content: z.string().nullable().optional(), refusal: z.string().nullable().optional() }).optional(),
  finish_reason: z.string().nullable().optional(),
});
const Payload = z.object({
  choices: z.array(Choice).optional(),
  error: z.object({ message: z.string().optional() }).optional(),
  usage: z.object({ prompt_tokens: z.number().optional(), completion_tokens: z.number().optional() }).optional(),
});
function parsePayload(raw: unknown) {
  const parsed = Payload.safeParse(raw);
  if (!parsed.success) throw new ProviderError('Provider returned a malformed response.');
  if (parsed.data.error) throw new ProviderError(parsed.data.error.message ?? 'Provider request failed.');
  return parsed.data;
}
function checkChoice(choice: z.infer<typeof Choice>) {
  if (choice.message?.refusal || choice.delta?.refusal) throw new ProviderError('Provider declined this request.');
  if (choice.finish_reason && choice.finish_reason !== 'stop') throw new ProviderError(`Provider output is incomplete (${choice.finish_reason}).`);
}

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
        let completed = false;
        for await (const data of sseEvents(res)) {
          if (data === '[DONE]') { completed = true; break; }
          let raw: unknown;
          try {
            raw = JSON.parse(data);
          } catch {
            throw new ProviderError('Provider returned a malformed stream event.');
          }
          const event = parsePayload(raw);
          const choice = event.choices?.[0];
          if (choice) checkChoice(choice);
          if (choice?.finish_reason === 'stop') completed = true;
          const delta = choice?.delta?.content;
          if (delta) {
            text += delta;
            opts.onToken?.(delta);
          }
        }
        if (!completed || !text) throw new ProviderError('Provider stream ended before a complete response.');
        return { text };
      }

      const json = parsePayload(await res.json());
      const choice = json.choices?.[0];
      if (!choice) throw new ProviderError('Provider returned no response choice.');
      checkChoice(choice);
      if (typeof choice.message?.content !== 'string' || !choice.message.content.trim()) throw new ProviderError('Provider returned no text output.');
      return {
        text: choice.message.content,
        usage: {
          inputTokens: json.usage?.prompt_tokens,
          outputTokens: json.usage?.completion_tokens,
        },
      };
    },

    async health() {
      const res = await fetch(modelsUrl, { headers: headers() }).catch(() => null);
      if (!res) return { ok: false, hint: config.healthHint?.('network') ?? 'Network error.' };
      if (!res.ok) return { ok: false, hint: config.healthHint?.(res.status) ?? `HTTP ${res.status}` };
      return { ok: true };
    },
  };
}

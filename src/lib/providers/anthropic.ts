import type { ChatOptions, ChatProvider, ChatRequest, ChatResponse } from './types';
import { ProviderError } from './types';
import { sseEvents } from './sse';
import { z } from 'zod';

const Block = z.object({ type: z.string(), name: z.string().optional(), text: z.string().optional(), input: z.record(z.unknown()).optional() });
const Payload = z.object({
  content: z.array(Block), stop_reason: z.string().nullable().optional(),
  usage: z.object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() }).optional(),
});
const StreamEvent = z.object({
  type: z.string(), error: z.object({ message: z.string().optional() }).optional(),
  delta: z.object({ type: z.string().optional(), text: z.string().optional(), stop_reason: z.string().nullable().optional() }).optional(),
});
function checkStop(reason: string | null | undefined) {
  if (reason && !['end_turn', 'stop_sequence', 'tool_use'].includes(reason)) throw new ProviderError(`Anthropic output is incomplete (${reason}).`);
}

const API_URL = 'https://api.anthropic.com/v1/messages';
const VERSION = '2023-06-01';

/**
 * Native Messages API (not the OpenAI-compat shim) so prompt caching and
 * tool-forced JSON output stay available. Called from extension pages
 * (side panel) where host_permissions make CORS a non-issue.
 */
export function anthropicProvider(apiKey: string): ChatProvider {
  return {
    id: 'anthropic',

    async chat(req: ChatRequest, opts?: ChatOptions): Promise<ChatResponse> {
      if (!apiKey) throw new ProviderError('Anthropic API key not set');

      const system = req.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
      const messages = req.messages
        .filter((m) => m.role !== 'system')
        .map((m) => ({ role: m.role, content: m.content }));

      const body: Record<string, unknown> = {
        model: req.model,
        max_tokens: req.maxTokens ?? 1024,
        ...(system ? { system } : {}),
        messages,
        ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      };

      // Structured output: force a tool call whose input IS the payload.
      if (req.jsonSchema) {
        body.tools = [
          {
            name: 'output',
            description: 'Return the structured result.',
            input_schema: req.jsonSchema,
          },
        ];
        body.tool_choice = { type: 'tool', name: 'output' };
      }

      const streaming = !!opts?.onToken && !req.jsonSchema;
      if (streaming) body.stream = true;

      const res = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': VERSION,
        },
        body: JSON.stringify(body),
        signal: opts?.signal,
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new ProviderError(`Anthropic ${res.status}: ${detail.slice(0, 300)}`, res.status);
      }

      if (streaming) {
        let text = '';
        let completed = false;
        for await (const data of sseEvents(res)) {
          let raw: unknown;
          try {
            raw = JSON.parse(data);
          } catch {
            throw new ProviderError('Anthropic returned a malformed stream event.');
          }
          const parsed = StreamEvent.safeParse(raw);
          if (!parsed.success) throw new ProviderError('Anthropic returned a malformed stream event.');
          const event = parsed.data;
          if (event.type === 'error') throw new ProviderError(event.error?.message ?? 'Anthropic streaming failed.');
          checkStop(event.delta?.stop_reason);
          if (event.type === 'message_stop') { completed = true; break; }
          if (event.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            if (typeof event.delta.text !== 'string') throw new ProviderError('Anthropic returned an invalid text delta.');
            text += event.delta.text;
            opts.onToken?.(event.delta.text);
          }
        }
        if (!completed || !text) throw new ProviderError('Anthropic stream ended before a complete response.');
        return { text };
      }

      const parsed = Payload.safeParse(await res.json());
      if (!parsed.success) throw new ProviderError('Anthropic returned a malformed response.');
      const json = parsed.data;
      checkStop(json.stop_reason);
      const usage = {
        inputTokens: json.usage?.input_tokens,
        outputTokens: json.usage?.output_tokens,
      };

      if (req.jsonSchema) {
        const toolUse = json.content.find((block) => block.type === 'tool_use' && block.name === 'output');
        if (!toolUse?.input) throw new ProviderError('Anthropic returned no structured output block');
        return { text: JSON.stringify(toolUse.input), usage };
      }

      const text = json.content
        .filter((block) => block.type === 'text')
        .map((block) => block.text ?? '')
        .join('');
      if (!text.trim()) throw new ProviderError('Anthropic returned no text output.');
      return { text, usage };
    },

    async health() {
      if (!apiKey) return { ok: false, hint: 'Add an Anthropic API key.' };
      // Cheap authenticated call: list models.
      const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
        headers: { 'x-api-key': apiKey, 'anthropic-version': VERSION },
      }).catch(() => null);
      if (!res) return { ok: false, hint: 'Network error reaching api.anthropic.com.' };
      if (res.status === 401) return { ok: false, hint: 'API key rejected (401).' };
      return { ok: res.ok };
    },
  };
}

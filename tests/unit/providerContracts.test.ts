// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { anthropicProvider } from '@lib/providers/anthropic';
import { openaiCompatibleProvider } from '@lib/providers/openaiCompatible';
import { ollamaProvider, OLLAMA_ORIGINS_HINT } from '@lib/providers/ollama';
import type { ChatProvider, ChatRequest } from '@lib/providers/types';

const request: ChatRequest = { model: 'fixture-model', messages: [{ role: 'system', content: 'Classify fields' }, { role: 'user', content: 'Name' }], temperature: 0, maxTokens: 100 };
const schema = { type: 'object', properties: { kind: { type: 'string' } }, required: ['kind'], additionalProperties: false };
const compat = () => openaiCompatibleProvider({ id: 'openai', baseUrl: 'https://provider.invalid/v1/', apiKey: 'synthetic-key' });
const anthropic = () => anthropicProvider('synthetic-key');
afterEach(() => vi.unstubAllGlobals());

function mockResponse(body: unknown, status = 200) {
  const fetcher = vi.fn().mockResolvedValue(Response.json(body, { status }));
  vi.stubGlobal('fetch', fetcher);
  return fetcher;
}
function stream(events: unknown[]) {
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(new TextEncoder().encode(`data: ${typeof event === 'string' ? event : JSON.stringify(event)}\n\n`));
      // Keep transport open: terminal-event consumers must cancel the reader.
    }, cancel,
  });
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  return cancel;
}

describe('provider HTTP contracts', () => {
  it('sends compatible strict schema, headers and cancellation without streaming structured output', async () => {
    const fetcher = mockResponse({ choices: [{ message: { content: '{"kind":"name"}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 11, completion_tokens: 7 } });
    const controller = new AbortController();
    const onToken = vi.fn();
    expect(await compat().chat({ ...request, jsonSchema: schema }, { signal: controller.signal, onToken })).toEqual({ text: '{"kind":"name"}', usage: { inputTokens: 11, outputTokens: 7 } });
    const [url, init] = fetcher.mock.calls[0]!;
    expect(url).toBe('https://provider.invalid/v1/chat/completions');
    expect(init.signal).toBe(controller.signal);
    expect(init.headers.authorization).toBe('Bearer synthetic-key');
    expect(JSON.parse(init.body)).toEqual({ model: 'fixture-model', messages: request.messages, max_tokens: 100, temperature: 0, response_format: { type: 'json_schema', json_schema: { name: 'output', strict: true, schema } } });
    expect(onToken).not.toHaveBeenCalled();
  });

  it('moves Anthropic system text and requires the named output tool', async () => {
    const fetcher = mockResponse({ content: [{ type: 'tool_use', name: 'output', input: { kind: 'name' } }], stop_reason: 'tool_use', usage: { input_tokens: 5, output_tokens: 3 } });
    expect((await anthropic().chat({ ...request, jsonSchema: schema })).text).toBe('{"kind":"name"}');
    const [, init] = fetcher.mock.calls[0]!;
    expect(JSON.parse(init.body)).toMatchObject({ system: 'Classify fields', messages: [{ role: 'user', content: 'Name' }], tools: [{ name: 'output', input_schema: schema }], tool_choice: { type: 'tool', name: 'output' } });
    mockResponse({ content: [{ type: 'tool_use', name: 'unrequested', input: { kind: 'name' } }] });
    await expect(anthropic().chat({ ...request, jsonSchema: schema })).rejects.toThrow('no structured output');
  });

  it.each([null, {}, { choices: [] }, { choices: [{ message: { content: 42 } }] }, { choices: [{ message: { refusal: 'Declined' } }] }, { choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }])('rejects malformed/refused/truncated compatible output: %j', async (payload) => {
    mockResponse(payload);
    await expect(compat().chat(request)).rejects.toThrow();
  });

  it.each([{}, { content: [] }, { content: [{ type: 'text', text: 'partial' }], stop_reason: 'max_tokens' }])('rejects invalid Anthropic text output: %j', async (payload) => {
    mockResponse(payload);
    await expect(anthropic().chat(request)).rejects.toThrow();
  });

  it('reports HTTP failures and preserves status', async () => {
    mockResponse({ error: 'rate limit' }, 429);
    await expect(compat().chat(request)).rejects.toMatchObject({ name: 'ProviderError', status: 429 });
  });

  it.each([compat, anthropic])('propagates cancellation rather than returning output', async (factory: () => ChatProvider) => {
    vi.stubGlobal('fetch', vi.fn((_url, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    })));
    const controller = new AbortController();
    const result = factory().chat(request, { signal: controller.signal });
    controller.abort();
    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('distinguishes Ollama origin rejection from a healthy server', async () => {
    const fetcher = mockResponse({}, 403);
    expect(await ollamaProvider('http://localhost:11434/').health!()).toEqual({ ok: false, hint: OLLAMA_ORIGINS_HINT });
    expect(fetcher.mock.calls[0]![0]).toBe('http://localhost:11434/v1/models');
  });
});

describe('provider streaming contracts', () => {
  it('delivers tokens and cancels compatible transport at DONE', async () => {
    const cancel = stream([{ choices: [{ delta: { content: 'Hello' } }] }, { choices: [{ delta: { content: ' world' }, finish_reason: 'stop' }] }, '[DONE]']);
    const onToken = vi.fn();
    expect(await compat().chat(request, { onToken })).toEqual({ text: 'Hello world' });
    expect(onToken.mock.calls.flat()).toEqual(['Hello', ' world']);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('delivers Anthropic tokens and cancels at message_stop', async () => {
    const cancel = stream([{ type: 'ping' }, { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hello' } }, { type: 'message_delta', delta: { stop_reason: 'end_turn' } }, { type: 'message_stop' }]);
    expect(await anthropic().chat(request, { onToken: vi.fn() })).toEqual({ text: 'Hello' });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([compat, anthropic])('surfaces stream errors and closes the reader', async (factory: () => ChatProvider) => {
    const cancel = stream([{ type: 'error', error: { message: 'Overloaded' } }]);
    await expect(factory().chat(request, { onToken: vi.fn() })).rejects.toThrow('Overloaded');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([compat, anthropic])('rejects malformed stream events', async (factory: () => ChatProvider) => {
    const cancel = stream(['not-json']);
    await expect(factory().chat(request, { onToken: vi.fn() })).rejects.toThrow('malformed');
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each([compat, anthropic])('rejects EOF without a terminal event', async (factory: () => ChatProvider) => {
    const provider = factory();
    const event = provider.id === 'anthropic'
      ? { type: 'content_block_delta', delta: { type: 'text_delta', text: 'partial' } }
      : { choices: [{ delta: { content: 'partial' } }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(`data: ${JSON.stringify(event)}\n\n`)));
    await expect(provider.chat(request, { onToken: vi.fn() })).rejects.toThrow('before a complete response');
  });
});

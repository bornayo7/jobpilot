import { describe, expect, it } from 'vitest';
import { ndjsonLines, sseEvents } from '@lib/providers/sse';

function responseFromChunks(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream);
}

async function collect<T>(gen: AsyncGenerator<T>): Promise<T[]> {
  const out: T[] = [];
  for await (const item of gen) out.push(item);
  return out;
}

describe('sseEvents', () => {
  it('parses events split across chunk boundaries', async () => {
    const res = responseFromChunks(['data: {"a":', '1}\n\ndata: {"b":2}\n', '\n']);
    expect(await collect(sseEvents(res))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('handles CRLF separators and event: lines', async () => {
    const res = responseFromChunks(['event: message_start\r\ndata: one\r\n\r\ndata: [DONE]\r\n\r\n']);
    expect(await collect(sseEvents(res))).toEqual(['one', '[DONE]']);
  });

  it('yields a final event that has no trailing blank line', async () => {
    const res = responseFromChunks(['data: one\n\ndata: two\n']);
    expect(await collect(sseEvents(res))).toEqual(['one', 'two']);
  });

  it('joins multi-line data payloads', async () => {
    const res = responseFromChunks(['data: line1\ndata: line2\n\n']);
    expect(await collect(sseEvents(res))).toEqual(['line1\nline2']);
  });
});

describe('ndjsonLines', () => {
  it('yields complete lines including an unterminated tail', async () => {
    const res = responseFromChunks(['{"x":1}\n{"y"', ':2}\n{"z":3}']);
    expect(await collect(ndjsonLines(res))).toEqual(['{"x":1}', '{"y":2}', '{"z":3}']);
  });
});

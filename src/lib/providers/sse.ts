/**
 * Minimal Server-Sent Events parser over a fetch Response body.
 * Yields the `data:` payload of each event (multi-line data joined by \n).
 * We deliberately skip vendor SDKs — this plus fetch is all an extension needs.
 */
export async function* sseEvents(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // Events are separated by a blank line. Handle \r\n and \n uniformly.
      let sepIndex: number;
      while ((sepIndex = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const rawEvent = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex).replace(/^\r?\n\r?\n/, '');

        const dataLines = rawEvent
          .split(/\r?\n/)
          .filter((line) => line.startsWith('data:'))
          .map((line) => line.slice(5).trimStart());
        if (dataLines.length > 0) {
          yield dataLines.join('\n');
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

/** Parse newline-delimited JSON streams (Ollama's native format). */
export async function* ndjsonLines(response: Response): AsyncGenerator<string> {
  const body = response.body;
  if (!body) return;

  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex).trim();
        buffer = buffer.slice(newlineIndex + 1);
        if (line) yield line;
      }
    }
    const tail = buffer.trim();
    if (tail) yield tail;
  } finally {
    reader.releaseLock();
  }
}

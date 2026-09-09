import type { ReactElement } from 'react';
import * as reactPdf from '@react-pdf/renderer';
import type { DocumentProps } from '@react-pdf/renderer';

type PdfDocument = ReactElement<DocumentProps>;

/**
 * Render a @react-pdf document to bytes in both environments the project runs
 * in: the extension page, which only ships `pdf().toBlob()`, and Node under
 * Vitest. The browser build exposes a throwing renderToBuffer stub too, so
 * function presence cannot identify the environment. Vite prunes the SSR path
 * from the extension; Node tests use the buffer implementation.
 *
 * Shared by the resume and cover-letter renderers so the two cannot diverge on
 * how they reach bytes.
 */
export async function renderPdfToBytes(doc: PdfDocument): Promise<ArrayBuffer> {
  const renderToBuffer = (
    reactPdf as { renderToBuffer?: (d: PdfDocument) => Promise<Uint8Array> }
  ).renderToBuffer;
  if (import.meta.env.SSR && typeof window === 'undefined' && typeof renderToBuffer === 'function') {
    const buffer = await renderToBuffer(doc);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }
  const blob = await reactPdf.pdf(doc).toBlob();
  return blob.arrayBuffer();
}

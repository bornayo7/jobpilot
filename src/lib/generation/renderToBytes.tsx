import type { ReactElement } from 'react';
import type { DocumentProps } from '@react-pdf/renderer';

type PdfDocument = ReactElement<DocumentProps>;

/**
 * Render a @react-pdf document to bytes in both environments the project runs
 * in: the extension page (Blob via `pdf().toBlob()`) and Node under Vitest
 * (`renderToBuffer`, which the browser build does not expose).
 *
 * Shared by the resume and cover-letter renderers so the two can never diverge
 * on how they reach bytes.
 */
export async function renderPdfToBytes(doc: PdfDocument): Promise<ArrayBuffer> {
  const mod = await import('@react-pdf/renderer');
  const renderToBuffer = (mod as { renderToBuffer?: (d: PdfDocument) => Promise<Uint8Array> })
    .renderToBuffer;
  if (typeof renderToBuffer === 'function') {
    const buffer = await renderToBuffer(doc);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }
  const blob = await mod.pdf(doc).toBlob();
  return blob.arrayBuffer();
}

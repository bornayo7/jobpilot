import type { ReactElement } from 'react';
import * as reactPdf from '@react-pdf/renderer';
import type { DocumentProps } from '@react-pdf/renderer';

type PdfDocument = ReactElement<DocumentProps>;

/**
 * Render a @react-pdf document to bytes in both environments the project runs
 * in: the extension page, which only ships `pdf().toBlob()`, and Node under
 * Vitest, whose build also exposes `renderToBuffer`. The probe is a runtime
 * one because the two builds export different surfaces — the module itself is
 * imported statically, since every caller pulls it in for the JSX components
 * anyway and a dynamic import here would not split anything.
 *
 * Shared by the resume and cover-letter renderers so the two cannot diverge on
 * how they reach bytes.
 */
export async function renderPdfToBytes(doc: PdfDocument): Promise<ArrayBuffer> {
  const renderToBuffer = (
    reactPdf as { renderToBuffer?: (d: PdfDocument) => Promise<Uint8Array> }
  ).renderToBuffer;
  if (typeof renderToBuffer === 'function') {
    const buffer = await renderToBuffer(doc);
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;
  }
  const blob = await reactPdf.pdf(doc).toBlob();
  return blob.arrayBuffer();
}

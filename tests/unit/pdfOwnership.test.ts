import { beforeEach, expect, it, vi } from 'vitest';
const pdf = vi.hoisted(() => ({ getDocument: vi.fn(), destroy: vi.fn() }));
vi.mock('pdfjs-dist', () => ({
  getDocument: pdf.getDocument,
  GlobalWorkerOptions: { workerSrc: 'test-worker' },
}));
import { extractPdfText } from '@lib/generation/validatePdf';

beforeEach(() => { pdf.getDocument.mockReset(); pdf.destroy.mockReset().mockResolvedValue(undefined); });

it('keeps the original PDF usable after the worker takes ownership of its input', async () => {
  const original = new Uint8Array([37, 80, 68, 70]).buffer;
  pdf.getDocument.mockImplementation(({ data }: { data: Uint8Array }) => {
    structuredClone(data, { transfer: [data.buffer] });
    return { promise: Promise.resolve({ numPages: 0 }), destroy: pdf.destroy };
  });
  await extractPdfText(original);
  expect([...new Uint8Array(original)]).toEqual([37, 80, 68, 70]);
  expect(pdf.destroy).toHaveBeenCalledOnce();
});

it('destroys the worker when extraction fails', async () => {
  pdf.getDocument.mockReturnValue({ promise: Promise.reject(new Error('bad PDF')), destroy: pdf.destroy });
  await expect(extractPdfText(new ArrayBuffer(4))).rejects.toThrow('bad PDF');
  expect(pdf.destroy).toHaveBeenCalledOnce();
});

// @vitest-environment node
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { pdfjs } from '@lib/generation/pdfNode';
import { renderResumePdf } from '@lib/generation/renderPdf';
import { renderResumeDocx } from '@lib/generation/renderDocx';
import { validateExtractedText } from '@lib/generation/validatePdf';
import { layoutStressResume } from '../fixtures/resumeLayout';
import { resumeContent } from '@lib/generation/resumeContent';
import { wrapPdfText } from '@lib/generation/pdfText';
import JSZip from 'jszip';

describe('long resume layout', () => {
  it('keeps all text in reading order and within page margins across a long entry', async () => {
    const bytes = await renderResumePdf(layoutStressResume);
    const task = pdfjs.getDocument({ data: new Uint8Array(bytes.slice(0)) });
    const text: string[] = [];
    const defects: string[] = [];
    try {
      const document = await task.promise;
      expect(document.numPages).toBeGreaterThan(1);
      for (let number = 1; number <= document.numPages; number++) {
        const page = await document.getPage(number);
        const viewport = page.getViewport({ scale: 1 });
        const content = await page.getTextContent();
        const rows: Array<{ text: string; x: number; y: number; width: number; height: number }> = [];
        for (const item of content.items) {
          if (!('str' in item) || !item.str.trim()) continue;
          text.push(item.str);
          const x = item.transform[4]; const y = viewport.height - item.transform[5];
          if (x < 43 || x + item.width > viewport.width - 43 || y - item.height < 25 || y > viewport.height - 30) {
            defects.push(`page ${number}: outside margins: ${item.str}`);
          }
          for (const previous of rows) {
            if (Math.abs(previous.y - y) < Math.min(previous.height, item.height) * 0.5 &&
              Math.min(previous.x + previous.width, x + item.width) - Math.max(previous.x, x) > 0.7) {
              defects.push(`page ${number}: overlapping text: ${previous.text} / ${item.str}`);
            }
          }
          rows.push({ text: item.str, x, y, width: item.width, height: item.height });
        }
      }
    } finally { await task.destroy(); }
    if (process.env.JOBPILOT_DOCUMENT_QA) {
      await mkdir(process.env.JOBPILOT_DOCUMENT_QA, { recursive: true });
      await writeFile(join(process.env.JOBPILOT_DOCUMENT_QA, 'resume-stress.pdf'), new Uint8Array(bytes));
      await writeFile(join(process.env.JOBPILOT_DOCUMENT_QA, 'resume-stress.docx'), new Uint8Array(await renderResumeDocx(layoutStressResume)));
      await writeFile(join(process.env.JOBPILOT_DOCUMENT_QA, 'layout-results.json'), JSON.stringify({ defects, text }, null, 2));
    }
    expect(defects).toEqual([]);
    expect(validateExtractedText(text.join(' '), layoutStressResume).problems).toEqual([]);
  }, 30_000);

  it('allows long-token line breaks while rejecting missing or reordered URL characters', () => {
    const content = resumeContent(layoutStressResume).map(item => item.text).join(' ');
    const url = layoutStressResume.basics.links[0]!;
    expect(validateExtractedText(content.replace(url, wrapPdfText(url)), layoutStressResume).ok).toBe(true);
    expect(validateExtractedText(content.replace(url, url.replace('accessibility', 'accessbility')), layoutStressResume).ok).toBe(false);
    expect(validateExtractedText(content.replace(url, url.replace('accessibility', 'accessibiltiy')), layoutStressResume).ok).toBe(false);
    expect(validateExtractedText(content.replace('Platform engineer', 'Platformengineer'), layoutStressResume).ok).toBe(false);
  });

  it('keeps all DOCX values in body reading order with explicit Letter pages and flowing paragraphs', async () => {
    const zip = await JSZip.loadAsync(await renderResumeDocx(layoutStressResume));
    const xml = await zip.file('word/document.xml')!.async('string');
    const text = [...xml.matchAll(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g)].map(match => match[1]!
      .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")).join(' ');
    expect(validateExtractedText(text, layoutStressResume).problems).toEqual([]);
    expect(xml).toContain('w:w="12240" w:h="15840"');
    expect(xml).toContain('<w:keepNext/>');
    expect(xml).not.toContain('<w:tab/>');
    expect(xml).not.toContain('<w:keepLines/>');
  });
});

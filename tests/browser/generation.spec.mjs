import { test, expect } from './fixtures.mjs';
import { prepare } from './workflow-helpers.mjs';
import { readFile } from 'node:fs/promises';
import JSZip from 'jszip';

test('review renders and validates a resume, files both formats, and downloads the real artifacts', async ({ context, extensionId }, testInfo) => {
  const { panel } = await prepare(context, extensionId);
  await panel.setViewportSize({ width: 320, height: 900 });
  await panel.getByRole('tab', { name: 'Generate', exact: true }).click();
  const version = {
    meta: { label: 'Acme Software Engineer', company: 'Acme', role: 'Software Engineer' },
    basics: { name: 'Ada Lovelace', email: 'ada@example.invalid', phone: '555-0100', location: 'Austin, TX', links: ['github.com/example'] },
    summary: 'Engineer building reliable application tools.',
    experience: [{ company: 'Example Systems', title: 'Software Engineer', location: 'Remote', dates: '2024 - 2026', bullets: ['Improved C++ performance by 40% with a 3.5 ms latency budget.'] }],
    projects: [{ name: 'Field Review', tech: 'TypeScript, C#', url: 'example.invalid/project', bullets: ['Built reviewed application workflows.'] }],
    education: [{ school: 'Example University', degree: 'B.S. Computer Science', dates: '2022 - 2026', details: 'GPA 3.8' }],
    skills: [{ category: 'Languages', items: ['TypeScript', 'C++', 'C#'] }],
  };
  await panel.getByLabel('Generated result', { exact: true }).fill(JSON.stringify(version));
  await panel.getByRole('button', { name: 'Validate & review', exact: true }).click();
  const approve = panel.getByRole('button', { name: 'Approve and save PDF + DOCX', exact: true });
  await expect(approve).toBeEnabled();
  await expect(panel.getByTitle('Resume preview', { exact: true })).toBeVisible();
  await approve.click();
  await expect(panel.getByText('Resume saved for Acme.', { exact: true })).toBeVisible();
  await expect(panel.getByLabel('Generated result', { exact: true })).toHaveValue('');

  const pdfEvent = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download PDF of Acme Software Engineer', exact: true }).click();
  const pdf = await pdfEvent;
  await pdf.saveAs(testInfo.outputPath('approved.pdf'));
  expect((await readFile(testInfo.outputPath('approved.pdf'))).subarray(0, 5).toString()).toBe('%PDF-');
  const docxEvent = panel.waitForEvent('download');
  await panel.getByRole('button', { name: 'Download DOCX of Acme Software Engineer', exact: true }).click();
  await (await docxEvent).saveAs(testInfo.outputPath('approved.docx'));
  const zip = await JSZip.loadAsync(await readFile(testInfo.outputPath('approved.docx')));
  const document = await zip.file('word/document.xml').async('string');
  expect(document).toContain('Improved C++ performance by 40% with a 3.5 ms latency budget.');
  expect(document).toContain('TypeScript, C#');
  await panel.getByRole('button', { name: 'Use as default', exact: true }).click();
  await expect(panel.locator('.application-context')).toContainText('Acme.pdf');
  expect(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await panel.screenshot({ path: testInfo.outputPath('version-library-320.png'), fullPage: true });
});

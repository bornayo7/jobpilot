import { test, expect } from './fixtures.mjs';

import { prepare } from './workflow-helpers.mjs';

test('reviewed fill waits for real controls and attaches the selected file on its first run', async ({ context, extensionId }) => {
  const { panel, job } = await prepare(context, extensionId);
  await expect(panel.getByLabel('Answer for First name', { exact: true })).toHaveValue('Ada');
  await panel.getByLabel('Answer for First name', { exact: true }).fill('Reviewed Ada');
  await panel.getByLabel('Will you require visa sponsorship?', { exact: true }).check();
  await panel.getByRole('button', { name: /^Fill \d+ fields?$/ }).click();
  await expect(panel.getByRole('button', { name: 'Cancel fill', exact: true })).toBeVisible();
  await expect(panel.getByText(/fields verified.*Review the application/)).toBeVisible();
  await expect(job.getByLabel('First name', { exact: true })).toHaveValue('Reviewed Ada');
  await expect(job.getByLabel('Email', { exact: true })).toHaveValue('ada@example.invalid');
  await expect(job.getByRole('radio', { name: 'Yes', exact: true })).toBeChecked();
  expect(await job.locator('input[type="file"]').evaluate(async input => ({ name: input.files[0]?.name, text: await input.files[0]?.text() }))).toEqual({ name: 'fixture-resume.pdf', text: 'Synthetic attachment bytes for transport verification' });
  await expect(panel.getByRole('button', { name: 'Cancel fill', exact: true })).toHaveCount(0);
});

test('same-URL form replacement clears the old review and pending controls', async ({ context, extensionId }) => {
  const { panel, job } = await prepare(context, extensionId);
  await panel.getByLabel('Answer for First name', { exact: true }).fill('Belongs to old form');
  await job.evaluate(() => document.querySelector('form').remove());
  await expect(panel.getByLabel('Answer for First name', { exact: true })).toHaveCount(0);
  await job.evaluate(() => {
    const form = document.createElement('form');
    form.innerHTML = '<label>First name<input autocomplete="given-name"></label>';
    document.querySelector('main').append(form);
  });
  await expect(panel.getByLabel('Answer for First name', { exact: true })).toHaveValue('Ada');
  await expect(job.getByLabel('First name', { exact: true })).toHaveValue('');
});

test('workbench tabs work by keyboard and panels fit narrow viewports', async ({ context, extensionId }) => {
  const { panel, requestedScripts } = await prepare(context, extensionId);
  for (const width of [320, 360, 400]) {
    await panel.setViewportSize({ width, height: 850 });
    const fill = panel.getByRole('tab', { name: 'Fill', exact: true });
    await fill.focus();
    await fill.press('ArrowRight');
    await expect(panel.getByRole('tab', { name: 'Generate', exact: true })).toBeFocused();
    await expect(panel.getByRole('tab', { name: 'Generate', exact: true })).toHaveAttribute('aria-selected', 'true');
    await panel.getByRole('tab', { name: 'Generate', exact: true }).press('End');
    await expect(panel.getByRole('tab', { name: 'Settings', exact: true })).toBeFocused();
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.getByRole('tab', { name: 'Settings', exact: true }).press('Home');
    expect(await panel.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.screenshot({ path: `test-results/workbench-${width}.png`, fullPage: true });
  }
  expect(requestedScripts.length).toBeGreaterThan(0);
  expect(requestedScripts.some(name => /renderToBytes|renderDocx|renderPdf|pdfBrowser|pdfNode/.test(name))).toBe(false);
});

import { test, expect, applicationHtml } from './fixtures.mjs';

test('production extension loads its worker and options page', async ({ context, extensionId, page }) => {
  const worker = context.serviceWorkers()[0];
  const manifest = await worker.evaluate(() => chrome.runtime.getManifest());
  expect(manifest.name).toBe('JobPilot');
  expect(manifest.content_scripts).toHaveLength(2);
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.locator('h1')).toBeVisible();
  await expect(page.getByLabel('First name', { exact: true })).toBeVisible();
});

test('ATS runtime discovers real browser controls and LinkedIn remains narrowly scoped', async ({ context, page }) => {
  await context.route('https://jobs.lever.co/acme/**', route => route.fulfill({ contentType: 'text/html', body: applicationHtml }));
  await page.goto('https://jobs.lever.co/acme/engineer/apply');
  await expect(page.locator('input[autocomplete="given-name"]')).toHaveAttribute('data-jobpilot-id', /.+/);
  await expect(page.locator('textarea')).toHaveAttribute('data-jobpilot-id', /.+/);
  await context.route('https://www.linkedin.com/**', route => route.fulfill({ contentType: 'text/html', body: applicationHtml }));
  await page.goto('https://www.linkedin.com/feed/');
  expect(await page.locator('[data-jobpilot-id]').count()).toBe(0);
  await page.goto('https://www.linkedin.com/jobs/view/fixture');
  await expect(page.locator('input[autocomplete="given-name"]')).toHaveAttribute('data-jobpilot-id', /.+/);
});

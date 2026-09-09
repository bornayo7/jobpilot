import { chromium } from '@playwright/test';
import { readFile, readdir, stat } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Compare production artifacts with cold, empty extension profiles. This is a
// local diagnostic, not a timing assertion whose noise can fail CI.
const directory = resolve(process.argv[2] ?? '.output/chrome-mv3');
const channel = process.argv[3] ?? 'chromium';
const runs = [];
async function bytesUnder(path) {
  const entries = await readdir(path, { withFileTypes: true });
  const sizes = await Promise.all(entries.map(async entry => entry.isDirectory()
    ? bytesUnder(join(path, entry.name)) : (await stat(join(path, entry.name))).size));
  return sizes.reduce((sum, size) => sum + size, 0);
}
for (let run = 0; run < 5; run++) {
  const context = await chromium.launchPersistentContext('', { channel, headless: true,
    args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`] });
  try {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker', { timeout: 10_000 });
    const id = new URL(worker.url()).host;
    const page = await context.newPage();
    const requestedScripts = new Set();
    page.on('request', request => {
      const url = new URL(request.url());
      if (url.host === id && /\.js$/.test(url.pathname)) requestedScripts.add(url.pathname);
    });
    const start = performance.now();
    await page.goto(`chrome-extension://${id}/sidepanel.html`);
    await page.getByRole('tab', { name: 'Fill', exact: true }).or(page.getByRole('button', { name: 'Fill', exact: true })).first().waitFor();
    const readyMs = performance.now() - start;
    const scripts = [...requestedScripts].sort();
    if (!scripts.length) throw new Error('No startup module requests were observed; a zero-byte result would be misleading.');
    const jsBytes = (await Promise.all(scripts.map(async path => (await readFile(join(directory, path))).length))).reduce((sum, size) => sum + size, 0);
    runs.push({ readyMs: Math.round(readyMs), jsBytes, scripts });
  } finally { await context.close(); }
}
const sorted = runs.map(run => run.readyMs).sort((a, b) => a - b);
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), directory, channel,
  totalBytes: await bytesUnder(directory), medianReadyMs: sorted[2], runs }, null, 2));

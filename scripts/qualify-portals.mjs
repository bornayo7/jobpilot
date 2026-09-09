import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

// Explicit release qualification only, never a CI dependency or a submission.
const urls = process.argv.slice(2);
if (!urls.length) throw new Error('Pass public application URLs to inspect.');
const directory = resolve('.output/chrome-mv3');
const context = await chromium.launchPersistentContext('', { channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${directory}`, `--load-extension=${directory}`] });
const report = { checkedAt: new Date().toISOString(), browser: context.browser()?.version(), submitted: false, pages: [] };
try {
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const panel = await context.newPage();
  await panel.goto(`chrome-extension://${id}/sidepanel.html`);
  for (const url of urls) {
    const result = { url };
    let page;
    try {
      const opened = context.waitForEvent('page');
      const tabId = await panel.evaluate(async () => (await chrome.tabs.create({ url: 'about:blank' })).id);
      page = await opened;
      const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      result.httpStatus = response?.status();
      result.title = await page.title();
      // Ashby exposes its form through a navigation tab. This never activates Submit.
      if (new URL(url).hostname === 'jobs.ashbyhq.com') {
        await page.locator('a, button, [role="tab"]').filter({ hasText: /^Application$|^Apply for this Job$/ }).first().waitFor({ timeout: 15_000 });
        const application = page.getByRole('tab', { name: 'Application', exact: true });
        const link = page.getByRole('link', { name: 'Application', exact: true });
        const button = page.getByRole('button', { name: 'Apply for this Job', exact: true });
        if (await application.count()) await application.click();
        else if (await link.count()) await link.click();
        else if (await button.count()) await button.click();
      }
      await page.locator('[data-jobpilot-id]').first().waitFor({ timeout: 15_000 });
      await panel.evaluate((tabId) => {
        window.probe?.port.disconnect();
        const probe = { frames: {}, completions: {}, port: chrome.runtime.connect({ name: 'jobpilot-panel' }) };
        window.probe = probe;
        probe.port.onMessage.addListener(msg => {
          if (msg.t !== 'bg/frameEvent') return;
          const event = msg.event;
          const frame = probe.frames[msg.frameId] ??= {};
          if (event.t === 'cs/ready') Object.assign(frame, event);
          if (event.t === 'cs/fields') Object.assign(frame, { fields: event.fields, documentId: event.documentId });
          if (event.t === 'cs/fillResults') probe.completions[event.runId] = event.results;
        });
        probe.port.postMessage({ t: 'panel/attach', tabId });
      }, tabId);
      await panel.waitForFunction(() => Object.values(window.probe.frames).some(frame => frame.fields?.length), null, { timeout: 10_000 });
      const frames = await panel.evaluate(() => window.probe.frames);
      result.frames = Object.entries(frames).map(([frameId, frame]) => ({ frameId, atsId: frame.atsId, count: frame.fields?.length ?? 0,
        controls: [...new Set(frame.fields?.map(field => field.control) ?? [])] }));
      const candidate = Object.entries(frames).flatMap(([frameId, frame]) => (frame.fields ?? []).map(field => ({ field, frameId: Number(frameId), documentId: frame.documentId })))
        .find(({ field }) => field.control === 'text' && /^(?:first|full)?\s*name\s*[*✱]?$/i.test(field.label.trim()) && !field.currentValue);
      if (candidate) {
        const execute = async (value) => {
          const runId = crypto.randomUUID();
          await panel.evaluate(({ tabId, runId, candidate, value }) => window.probe.port.postMessage({ t: 'panel/execute', tabId, runId,
            frameId: candidate.frameId, documentId: candidate.documentId, instructions: [{ fieldId: candidate.field.fieldId, frameId: candidate.frameId,
              action: 'setText', value, kind: 'name.first', source: 'user', confidence: 1, requiresReview: false }] }), { tabId, runId, candidate, value });
          await panel.waitForFunction((runId) => window.probe.completions[runId], runId, { timeout: 12_000 });
          return panel.evaluate((runId) => window.probe.completions[runId], runId);
        };
        result.syntheticNameFill = await execute('JobPilot Test');
        result.clearSyntheticName = await execute('');
      }
      result.finalUrl = page.url();
      result.outcome = 'inspected before submission';
    } catch (error) { result.error = String(error); result.outcome = 'not qualified'; }
    finally { await page?.close(); }
    report.pages.push(result);
    console.log(JSON.stringify(result));
  }
} finally {
  await context.close();
  await mkdir('test-results', { recursive: true });
  await writeFile('test-results/public-portals.json', JSON.stringify(report, null, 2));
}

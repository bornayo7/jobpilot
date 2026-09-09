import { test as base, chromium, expect } from '@playwright/test';
import { resolve } from 'node:path';

export const test = base.extend({
  context: async ({}, use) => {
    const extensionPath = resolve('.output/chrome-mv3');
    const context = await chromium.launchPersistentContext('', {
      channel: 'chromium',
      headless: true,
      args: [`--disable-extensions-except=${extensionPath}`, `--load-extension=${extensionPath}`],
    });
    try { await use(context); } finally { await context.close(); }
  },
  extensionId: async ({ context }, use) => {
    const worker = context.serviceWorkers()[0] ?? await context.waitForEvent('serviceworker');
    await use(new URL(worker.url()).host);
  },
});

export { expect };

export const applicationHtml = `<!doctype html><html><head><title>Software Engineer - Acme</title></head>
<body><main><h1>Software Engineer</h1><p>Build reliable software at Acme. TypeScript and testing are required.</p>
<form><label>First name<input name="firstName" autocomplete="given-name"></label>
<label>Email<input name="email" type="email" autocomplete="email"></label>
<label>Resume<input type="file" name="resume"></label>
<fieldset><legend>Will you require visa sponsorship?</legend>
<label><input type="radio" name="sponsor" value="yes">Yes</label>
<label><input type="radio" name="sponsor" value="no">No</label></fieldset>
<label>Why this company?<textarea name="answer"></textarea></label>
<button type="button">Submit application</button></form></main></body></html>`;

import { expect, applicationHtml } from './fixtures.mjs';

export async function prepare(context, extensionId, html = applicationHtml) {
  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(options.getByLabel('First name', { exact: true })).toBeVisible();
  await options.locator('input[type="file"][accept="application/json"]').setInputFiles({ name: 'profile.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ schemaVersion: 1, basics: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.invalid' }, workAuth: { authorizedUS: true, needsSponsorship: true } })) });
  await expect(options.getByLabel('First name', { exact: true })).toHaveValue('Ada');
  const chooser = options.waitForEvent('filechooser');
  await options.getByRole('button', { name: 'Upload document', exact: true }).click();
  await (await chooser).setFiles({ name: 'fixture-resume.pdf', mimeType: 'application/pdf', buffer: Buffer.from('Synthetic attachment bytes for transport verification') });
  await expect(options.getByRole('radio', { name: /fixture-resume.pdf/ })).toBeChecked();
  await options.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(options.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await options.close();

  await context.route('https://jobs.lever.co/acme/**', route => route.fulfill({ contentType: 'text/html', body: html }));
  const panel = await context.newPage();
  const requestedScripts = [];
  panel.on('request', request => { if (/\.js($|\?)/.test(request.url())) requestedScripts.push(request.url()); });
  await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`);
  const newPage = context.waitForEvent('page');
  await panel.evaluate(() => chrome.tabs.create({ url: 'about:blank', active: true }));
  const job = await newPage;
  await job.goto('https://jobs.lever.co/acme/engineer/apply');
  await expect(job.locator('input[autocomplete="given-name"]')).toHaveAttribute('data-jobpilot-id', /.+/);
  await expect(panel.getByText('Lever detected', { exact: true })).toBeVisible();
  return { panel, job, requestedScripts };
}

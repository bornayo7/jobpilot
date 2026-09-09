import { test, expect } from './fixtures.mjs';
import { prepare } from './workflow-helpers.mjs';

test('fills open-shadow controls and a separately injected cross-origin application frame', async ({ context, extensionId }) => {
  await context.route('https://boards.greenhouse.io/fixture/**', route => route.fulfill({ contentType: 'text/html', body:
    '<!doctype html><title>Embedded application</title><form><label>Work email<input name="email" type="email"></label></form>' }));
  const { panel, job } = await prepare(context, extensionId, `<!doctype html><title>Embedded application - Acme</title>
    <form><label>First name<input autocomplete="given-name"></label><div id="host"></div></form>
    <iframe title="Embedded application" src="https://boards.greenhouse.io/fixture/apply"></iframe>
    <script>document.querySelector('#host').attachShadow({mode:'open'}).innerHTML = '<label>Last name<input autocomplete="family-name"></label>';</script>`);
  await expect(panel.getByLabel('Answer for Last name', { exact: true })).toHaveValue('Lovelace');
  await expect(panel.getByLabel('Answer for Work email', { exact: true })).toHaveValue('ada@example.invalid');
  await panel.getByRole('button', { name: /^Fill 3 fields$/ }).click();
  await expect(panel.getByText(/3 fields verified.*Review the application/)).toBeVisible();
  await expect(job.getByLabel('Last name', { exact: true })).toHaveValue('Lovelace');
  await expect(job.frameLocator('iframe').getByLabel('Work email', { exact: true })).toHaveValue('ada@example.invalid');
});

test('reports delayed framework reversion while verifying retained custom selections', async ({ context, extensionId }) => {
  const { panel, job } = await prepare(context, extensionId, `<!doctype html><title>Controlled application - Acme</title><form>
    <label>First name<input autocomplete="given-name" oninput="setTimeout(() => { this.value = ''; }, 150)"></label>
    <label>Country<input role="combobox" aria-controls="countries" aria-expanded="true"></label>
    <ul id="countries" role="listbox"><li role="option" onclick="const input=document.querySelector('[aria-controls=countries]');input.value='Canada';input.setAttribute('aria-expanded','false');this.parentElement.remove();">Canada</li></ul>
    <label>Rejected city<input role="combobox" aria-controls="cities" aria-expanded="true"></label>
    <ul id="cities" role="listbox"><li role="option" onclick="this.setAttribute('aria-selected','true');setTimeout(() => {document.querySelector('[aria-controls=cities]').value='';},150);">Toronto</li></ul>
    </form>`);
  await panel.getByLabel('Answer for Country', { exact: true }).fill('Canada');
  await panel.getByLabel('Answer for Rejected city', { exact: true }).fill('Toronto');
  await panel.getByRole('button', { name: /^Fill 3 fields$/ }).click();
  await expect(panel.getByRole('button', { name: 'Cancel fill', exact: true })).toBeVisible();
  await expect(panel.getByRole('button', { name: 'Cancel fill', exact: true })).toHaveCount(0);
  await expect(panel.locator('.review-row').filter({ has: panel.getByLabel('Answer for First name', { exact: true }) })).toContainText('Page did not retain the value');
  await expect(panel.locator('.review-row').filter({ has: panel.getByLabel('Answer for Country', { exact: true }) })).toContainText('✓ filled');
  await expect(panel.locator('.review-row').filter({ has: panel.getByLabel('Answer for Rejected city', { exact: true }) })).toContainText('Option activation was not confirmed');
  await expect(job.getByLabel('Country', { exact: true })).toHaveValue('Canada');
  await expect(job.getByLabel('First name', { exact: true })).toHaveValue('');
  await expect(job.getByLabel('Rejected city', { exact: true })).toHaveValue('');
});

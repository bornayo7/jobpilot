import { test, expect } from './fixtures.mjs';

async function options(context, extensionId) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await expect(page.getByLabel('First name', { exact: true })).toBeVisible();
  return page;
}

test('dirty profile survives rename and switching to another profile', async ({ context, extensionId }) => {
  const page = await options(context, extensionId);
  await page.getByLabel('First name', { exact: true }).fill('Draft Ada');
  page.once('dialog', dialog => dialog.accept('Engineering'));
  await page.getByRole('button', { name: 'Rename', exact: true }).click();
  await expect(page.getByLabel('Active profile')).toHaveText('Engineering');
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Draft Ada');
  page.once('dialog', dialog => dialog.accept('Research'));
  await page.getByRole('button', { name: 'New', exact: true }).click();
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('');
  await page.getByLabel('Active profile').selectOption({ label: 'Engineering' });
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Draft Ada');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await page.reload();
  await expect(page.getByLabel('First name', { exact: true })).toHaveValue('Draft Ada');
});

test('two extension pages preserve a conflicting draft and expose recovery', async ({ context, extensionId }) => {
  const first = await options(context, extensionId);
  const second = await options(context, extensionId);
  await first.getByLabel('First name', { exact: true }).fill('Saved elsewhere');
  await second.getByLabel('First name', { exact: true }).fill('Local draft');
  await first.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(second.getByRole('alert')).toContainText('Your draft is preserved');
  await expect(second.getByLabel('First name', { exact: true })).toHaveValue('Local draft');
  await expect(second.getByRole('button', { name: 'Save profile', exact: true })).toBeDisabled();
  await second.getByRole('button', { name: 'Use saved profile', exact: true }).click();
  await expect(second.getByLabel('First name', { exact: true })).toHaveValue('Saved elsewhere');
  await second.getByLabel('Last name', { exact: true }).fill('Lovelace');
  await second.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(first.getByLabel('Last name', { exact: true })).toHaveValue('Lovelace');
});

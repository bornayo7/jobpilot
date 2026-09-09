import { beforeEach, describe, expect, it } from 'vitest';
import { discoverFields } from '@lib/fill/discovery';
import { executeInstructions } from '@lib/fill/executor';
import type { FillInstruction } from '@lib/messaging/protocol';

function instruction(partial: Partial<FillInstruction> & Pick<FillInstruction, 'fieldId' | 'action' | 'value'>): FillInstruction {
  return { frameId: 0, kind: 'unknown', source: 'user', confidence: 1, requiresReview: false, ...partial };
}

describe('executeInstructions', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('fills text inputs via the native setter and verifies by readback', async () => {
    document.body.innerHTML = `<label>Email <input name="email" /></label>`;
    const [field] = discoverFields(null);
    const results = await executeInstructions([
      instruction({ fieldId: field!.fieldId, action: 'setText', value: 'ada@example.com' }),
    ]);
    expect(results[0]).toMatchObject({ ok: true, verifiedValue: 'ada@example.com' });
    expect(document.querySelector('input')!.value).toBe('ada@example.com');
  });

  it('selects options by value or label', async () => {
    document.body.innerHTML = `
      <label>Sponsorship
        <select name="visa">
          <option value="">--</option>
          <option value="y">Yes</option>
          <option value="n">No</option>
        </select>
      </label>`;
    const [field] = discoverFields(null);
    const results = await executeInstructions([
      instruction({ fieldId: field!.fieldId, action: 'selectOption', value: 'No' }),
    ]);
    expect(results[0]!.ok).toBe(true);
    expect(document.querySelector('select')!.value).toBe('n');
  });

  it('reports failure when the element vanished', async () => {
    const results = await executeInstructions([
      instruction({ fieldId: 'jp-gone', action: 'setText', value: 'x' }),
    ]);
    expect(results[0]).toMatchObject({ ok: false, error: 'element not found' });
  });

  it('rejects a control that became disabled after discovery', async () => {
    document.body.innerHTML = '<input name="email" />';
    const [field] = discoverFields(null);
    const input = document.querySelector('input')!; input.disabled = true;
    const results = await executeInstructions([instruction({ fieldId: field!.fieldId, action: 'setText', value: 'Ada' })]);
    expect(results[0]!.ok).toBe(false);
    expect(input.value).toBe('');
  });

  it('does not bypass disabled radio options with the native setter', async () => {
    document.body.innerHTML = '<fieldset><legend>Authorized?</legend><label><input type="radio" name="a" value="y" />Yes</label><label><input type="radio" name="a" value="n" disabled />No</label></fieldset>';
    const [field] = discoverFields(null);
    const result = await executeInstructions([instruction({ fieldId: field!.fieldId, action: 'selectOption', value: 'n' })]);
    expect(result[0]!.ok).toBe(false);
    expect(document.querySelector<HTMLInputElement>('input[value="n"]')!.checked).toBe(false);
  });

  it('selects a radio group member by value or by label', async () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Authorized to work?</legend>
          <label><input type="radio" name="auth" value="1" /> Yes</label>
          <label><input type="radio" name="auth" value="0" /> No</label>
        </fieldset>
      </form>`;
    const [field] = discoverFields(null);
    const yes = document.querySelector<HTMLInputElement>('input[value="1"]')!;
    const no = document.querySelector<HTMLInputElement>('input[value="0"]')!;

    const byValue = await executeInstructions([
      instruction({ fieldId: field!.fieldId, action: 'selectOption', value: '0' }),
    ]);
    expect(byValue[0]).toMatchObject({ ok: true, verifiedValue: 'No' });
    expect(no.checked).toBe(true);

    const byLabel = await executeInstructions([
      instruction({ fieldId: field!.fieldId, action: 'pickListbox', value: 'yes' }),
    ]);
    expect(byLabel[0]).toMatchObject({ ok: true, verifiedValue: 'Yes' });
    expect(yes.checked).toBe(true);
    expect(no.checked).toBe(false);
    // The value attributes were never touched.
    expect(yes.value).toBe('1');
    expect(no.value).toBe('0');

    const missing = await executeInstructions([
      instruction({ fieldId: field!.fieldId, action: 'selectOption', value: 'maybe' }),
    ]);
    expect(missing[0]!.ok).toBe(false);
  });

  it('sets checkboxes to the requested state', async () => {
    document.body.innerHTML = `<label><input type="checkbox" name="agree" /> I agree</label>`;
    const [field] = discoverFields(null);
    const results = await executeInstructions([
      instruction({ fieldId: field!.fieldId, action: 'setChecked', value: true }),
    ]);
    expect(results[0]!.ok).toBe(true);
    expect(document.querySelector('input')!.checked).toBe(true);
  });

  it('reports a framework value revert during the bounded settling window', async () => {
    document.body.innerHTML = '<label>Name<input name="name" /></label>';
    const input = document.querySelector('input')!;
    input.addEventListener('input', () => setTimeout(() => { input.value = ''; }, 150));
    const [field] = discoverFields(null);
    const results = await executeInstructions([instruction({fieldId:field!.fieldId,action:'setText',value:'Ada'})]);
    expect(results[0]).toMatchObject({ok:false,error:'Page did not retain the value'});
  });

  it('does not write any field after cancellation', async () => {
    document.body.innerHTML = '<label>Name<input name="name" /></label>';
    const [field] = discoverFields(null); const controller = new AbortController();controller.abort();
    const results = await executeInstructions([instruction({fieldId:field!.fieldId,action:'setText',value:'Ada'})],[],controller.signal);
    expect(results[0]!.ok).toBe(false);expect(document.querySelector('input')!.value).toBe('');
  });
});

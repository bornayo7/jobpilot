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

  it('sets checkboxes to the requested state', async () => {
    document.body.innerHTML = `<label><input type="checkbox" name="agree" /> I agree</label>`;
    const [field] = discoverFields(null);
    const results = await executeInstructions([
      instruction({ fieldId: field!.fieldId, action: 'setChecked', value: true }),
    ]);
    expect(results[0]!.ok).toBe(true);
    expect(document.querySelector('input')!.checked).toBe(true);
  });
});

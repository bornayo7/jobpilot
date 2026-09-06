import { beforeEach, describe, expect, it } from 'vitest';
import { discoverFields } from '@lib/fill/discovery';

describe('discoverFields', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('describes labeled inputs with control types and options', () => {
    document.body.innerHTML = `
      <form>
        <label for="fn">First name *</label>
        <input id="fn" name="first_name" autocomplete="given-name" required />
        <label>Cover letter <textarea name="cover_letter"></textarea></label>
        <label for="auth">Are you authorized to work?</label>
        <select id="auth" name="work_auth">
          <option value="">Select…</option>
          <option value="yes">Yes</option>
          <option value="no">No</option>
        </select>
        <input type="hidden" name="csrf" value="x" />
        <input type="submit" value="Apply" />
      </form>
    `;

    const fields = discoverFields('greenhouse');
    expect(fields).toHaveLength(3);

    const [first, cover, auth] = fields;
    expect(first).toMatchObject({
      control: 'text',
      label: 'First name',
      name: 'first_name',
      autocomplete: 'given-name',
      required: true,
    });
    expect(cover).toMatchObject({ control: 'textarea', label: 'Cover letter' });
    expect(auth).toMatchObject({ control: 'select', label: 'Are you authorized to work?' });
    expect(auth!.options).toEqual([
      { value: 'yes', label: 'Yes' },
      { value: 'no', label: 'No' },
    ]);
  });

  it('keeps stamped ids stable across rescans', () => {
    document.body.innerHTML = `<label>Email <input name="email" /></label>`;
    const [a] = discoverFields(null);
    const [b] = discoverFields(null);
    expect(a!.fieldId).toBe(b!.fieldId);
  });

  it('skips disabled, read-only and password controls and unavailable options', () => {
    document.body.innerHTML = `
      <input name="email" disabled /><input name="name" readonly />
      <input name="password" type="password" />
      <fieldset disabled><input name="phone" /></fieldset>
      <select name="country"><option value="x" disabled>X</option>
        <optgroup disabled><option value="z">Z</option></optgroup><option value="y">Y</option></select>`;
    const fields = discoverFields(null);
    expect(fields).toHaveLength(1);
    expect(fields[0]!.options).toEqual([{ value: 'y', label: 'Y' }]);
  });

  it('skips unlabeled unnamed controls but keeps hidden file inputs', () => {
    document.body.innerHTML = `
      <input />
      <input type="file" name="resume" style="display:none" />
    `;
    const fields = discoverFields(null);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ control: 'file', name: 'resume' });
  });

  it('reports a named radio group as one field with the buttons as options', () => {
    document.body.innerHTML = `
      <form>
        <fieldset>
          <legend>Are you legally authorized to work in the United States? *</legend>
          <label><input type="radio" name="auth" value="1" required /> Yes</label>
          <label><input type="radio" name="auth" value="0" /> No</label>
        </fieldset>
        <div class="field">
          <div>Will you now or in the future require sponsorship?</div>
          <input type="radio" id="sp-y" name="sponsor" value="yes" /><label for="sp-y">Yes</label>
          <input type="radio" id="sp-n" name="sponsor" value="no" checked /><label for="sp-n">No</label>
        </div>
      </form>
    `;

    const fields = discoverFields(null);
    expect(fields).toHaveLength(2);

    const [auth, sponsor] = fields;
    expect(auth).toMatchObject({
      control: 'radio',
      name: 'auth',
      label: 'Are you legally authorized to work in the United States?',
      required: true,
      options: [
        { value: '1', label: 'Yes' },
        { value: '0', label: 'No' },
      ],
    });
    expect(auth!.currentValue).toBeUndefined();

    expect(sponsor).toMatchObject({
      control: 'radio',
      name: 'sponsor',
      label: 'Will you now or in the future require sponsorship?',
      currentValue: 'no',
    });

    // Every button in a group carries the group's id, and rescans keep it.
    const ids = Array.from(document.querySelectorAll('input[name="auth"]')).map((r) =>
      r.getAttribute('data-jobpilot-id'),
    );
    expect(new Set(ids).size).toBe(1);
    expect(discoverFields(null)[0]!.fieldId).toBe(auth!.fieldId);
  });

  it('surfaces Workday-style data-automation-id as atsFieldKey', () => {
    document.body.innerHTML = `
      <div data-automation-id="legalNameSection_firstName">
        <label>First Name <input /></label>
      </div>
    `;
    const [field] = discoverFields('workday');
    expect(field!.atsFieldKey).toBe('legalNameSection_firstName');
  });
});

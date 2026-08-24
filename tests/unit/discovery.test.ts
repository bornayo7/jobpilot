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

  it('skips unlabeled unnamed controls but keeps hidden file inputs', () => {
    document.body.innerHTML = `
      <input />
      <input type="file" name="resume" style="display:none" />
    `;
    const fields = discoverFields(null);
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ control: 'file', name: 'resume' });
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

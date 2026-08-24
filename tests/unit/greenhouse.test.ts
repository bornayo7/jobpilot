import { afterEach, describe, expect, it, vi } from 'vitest';
import { greenhouseAdapter, parseBoardUrl } from '@lib/fill/adapters/greenhouse';
import type { FormFieldDescriptor } from '@lib/messaging/protocol';

function field(partial: Partial<FormFieldDescriptor>): FormFieldDescriptor {
  return { fieldId: 'f', control: 'text', label: '', required: false, signature: 's', ...partial };
}

describe('parseBoardUrl', () => {
  it('parses board, embed, and legacy urls', () => {
    expect(parseBoardUrl('https://job-boards.greenhouse.io/acme/jobs/4141345')).toEqual({
      boardToken: 'acme',
      jobId: '4141345',
    });
    expect(parseBoardUrl('https://boards.greenhouse.io/acme/jobs/123?utm=x')).toEqual({
      boardToken: 'acme',
      jobId: '123',
    });
    expect(
      parseBoardUrl('https://job-boards.greenhouse.io/embed/job_app?for=acme&token=999'),
    ).toEqual({ boardToken: 'acme', jobId: '999' });
  });

  it('rejects non-greenhouse urls', () => {
    expect(parseBoardUrl('https://jobs.lever.co/acme/1')).toBeNull();
    expect(parseBoardUrl('not a url')).toBeNull();
  });
});

describe('greenhouseAdapter.classify', () => {
  it('maps stable names including the compliance block', () => {
    expect(greenhouseAdapter.classify(field({ name: 'first_name' }))).toBe('name.first');
    expect(greenhouseAdapter.classify(field({ name: 'resume', control: 'file' }))).toBe('docs.resume');
    expect(greenhouseAdapter.classify(field({ name: 'veteran_status' }))).toBe('eeo.veteran');
    expect(greenhouseAdapter.classify(field({ name: 'question_12345' }))).toBeNull();
  });
});

describe('greenhouseAdapter.prefetchSchema', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('flattens questions into name-keyed fields with server option values', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            questions: [
              {
                label: 'Are you authorized to work in the U.S.?',
                required: true,
                fields: [
                  {
                    name: 'question_777',
                    type: 'multi_value_single_select',
                    values: [
                      { value: 0, label: 'No' },
                      { value: 1, label: 'Yes' },
                    ],
                  },
                ],
              },
            ],
          }),
          { status: 200 },
        ),
      ),
    );

    const fields = await greenhouseAdapter.prefetchSchema!(
      'https://job-boards.greenhouse.io/acme/jobs/42',
    );
    expect(fields).toEqual([
      {
        name: 'question_777',
        label: 'Are you authorized to work in the U.S.?',
        required: true,
        type: 'multi_value_single_select',
        options: [
          { value: '0', label: 'No' },
          { value: '1', label: 'Yes' },
        ],
      },
    ]);
    expect(fetch).toHaveBeenCalledWith(
      'https://boards-api.greenhouse.io/v1/boards/acme/jobs/42?questions=true',
    );
  });

  it('returns null on API failure (degrades to DOM path)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 404 })));
    expect(await greenhouseAdapter.prefetchSchema!('https://job-boards.greenhouse.io/acme/jobs/42')).toBeNull();
  });
});

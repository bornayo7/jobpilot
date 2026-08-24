import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import type { ChatRequest } from '@lib/providers/types';

const chatMock = vi.fn();
vi.mock('@lib/providers/router', () => ({
  routeTask: () => ({ provider: { id: 'anthropic', chat: chatMock }, model: 'test-model' }),
  providerFor: vi.fn(),
}));

import { resolveFields } from '@lib/fill/resolver';
import { emptyProfile } from '@lib/schema/profile';
import { SettingsSchema } from '@lib/storage/settingsStore';
import type { FormFieldDescriptor } from '@lib/messaging/protocol';

function field(partial: Partial<FormFieldDescriptor> & { fieldId: string; signature: string }): FormFieldDescriptor {
  return { control: 'text', label: '', required: false, ...partial };
}

function profileFixture() {
  const profile = emptyProfile();
  profile.basics.firstName = 'Ada';
  profile.basics.lastName = 'Lovelace';
  profile.basics.email = 'ada@example.com';
  return profile;
}

const baseInput = {
  atsId: 'lever' as const,
  frameId: 0,
  frameUrl: 'https://jobs.lever.co/acme/uuid/apply',
  profile: profileFixture(),
  settings: SettingsSchema.parse({}),
  resume: null,
  llmEnabled: true,
};

describe('resolveFields', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    chatMock.mockReset();
  });

  it('tier precedence: adapter beats heuristics; heuristics beat LLM; LLM only sees leftovers', async () => {
    chatMock.mockResolvedValue({
      text: JSON.stringify({ mappings: [{ i: 0, kind: 'question.freeText', confidence: 0.9 }] }),
    });

    const outcome = await resolveFields({
      ...baseInput,
      fields: [
        // Lever adapter key:
        field({ fieldId: 'a', signature: 's-a', name: 'email', label: 'Email' }),
        // Heuristic-only:
        field({ fieldId: 'b', signature: 's-b', label: 'First name' }),
        // Neither -> LLM:
        field({ fieldId: 'c', signature: 's-c', label: 'Describe a project you are proud of', control: 'text' }),
      ],
    });

    const byId = new Map(outcome.rows.map((row) => [row.field.fieldId, row]));
    expect(byId.get('a')).toMatchObject({ kind: 'contact.email', source: 'adapter', confidence: 1 });
    expect(byId.get('b')).toMatchObject({ kind: 'name.first', source: 'heuristic' });
    expect(byId.get('c')).toMatchObject({ kind: 'question.freeText', source: 'llm' });

    // Exactly one batched call, containing ONLY the leftover field.
    expect(chatMock).toHaveBeenCalledTimes(1);
    const request = chatMock.mock.calls[0]![0] as ChatRequest;
    expect(request.messages.find((m) => m.role === 'user')!.content).toContain('Describe a project');
    expect(request.messages.find((m) => m.role === 'user')!.content).not.toContain('First name');
  });

  it('enforces the allowlist: a model answering contact.email is discarded', async () => {
    chatMock.mockResolvedValue({
      text: JSON.stringify({ mappings: [{ i: 0, kind: 'contact.email', confidence: 0.99 }] }),
    });

    const outcome = await resolveFields({
      ...baseInput,
      fields: [field({ fieldId: 'x', signature: 's-x', label: 'Some mystery field' })],
    });

    expect(outcome.rows).toHaveLength(0);
    expect(outcome.unmatched.map((f) => f.fieldId)).toEqual(['x']);
  });

  it('caches LLM results — the second resolve makes zero LLM calls', async () => {
    chatMock.mockResolvedValue({
      text: JSON.stringify({ mappings: [{ i: 0, kind: 'misc.referralSource', confidence: 0.8 }] }),
    });
    const fields = [field({ fieldId: 'r', signature: 's-r', label: 'Who told you about us' })];

    const first = await resolveFields({ ...baseInput, fields });
    expect(first.llmCalls).toBe(1);
    expect(first.rows[0]).toMatchObject({ kind: 'misc.referralSource', source: 'llm' });

    const second = await resolveFields({ ...baseInput, fields });
    expect(chatMock).toHaveBeenCalledTimes(1); // no new call
    expect(second.rows[0]).toMatchObject({ kind: 'misc.referralSource', source: 'cache' });
  });

  it('LLM failure degrades gracefully to unmatched', async () => {
    chatMock.mockRejectedValue(new Error('network down'));
    const outcome = await resolveFields({
      ...baseInput,
      fields: [field({ fieldId: 'z', signature: 's-z', label: 'Mystery' })],
    });
    expect(outcome.rows).toHaveLength(0);
    expect(outcome.unmatched).toHaveLength(1);
  });

  it('llmEnabled=false skips tier 4 entirely', async () => {
    const outcome = await resolveFields({
      ...baseInput,
      llmEnabled: false,
      fields: [field({ fieldId: 'z', signature: 's-z2', label: 'Mystery' })],
    });
    expect(chatMock).not.toHaveBeenCalled();
    expect(outcome.unmatched).toHaveLength(1);
  });

  it('sensitive kinds are review-gated even at adapter confidence', async () => {
    const outcome = await resolveFields({
      ...baseInput,
      atsId: 'greenhouse',
      frameUrl: 'https://example.com/not-a-board', // prefetch skipped
      llmEnabled: false,
      fields: [
        field({
          fieldId: 'v',
          signature: 's-v',
          name: 'veteran_status',
          label: 'Veteran Status',
          control: 'select',
          options: [
            { value: '1', label: 'I am not a protected veteran' },
            { value: '2', label: 'I identify as a protected veteran' },
          ],
        }),
      ],
    });

    // Profile has no veteran answer -> no instruction, but the row is present,
    // review-gated, and never auto-included.
    const row = outcome.rows[0]!;
    expect(row.kind).toBe('eeo.veteran');
    expect(row.requiresReview).toBe(true);
    expect(row.include).toBe(false);
  });
});

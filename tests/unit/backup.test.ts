// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { decryptBackup, encryptBackup } from '@lib/util/backup';

describe('encrypted backup', () => {
  const payload = { exportedAt: 1, local: { 'jobpilot:settings': { a: 1 } }, idb: { answers: [{ id: 'x' }] } };

  it('round-trips with the right passphrase', async () => {
    const envelope = await encryptBackup(payload, 'correct horse battery');
    expect(envelope.format).toBe('jobpilot-backup');
    expect(envelope.payloadB64).not.toContain('jobpilot:settings');
    const restored = await decryptBackup(envelope, 'correct horse battery');
    expect(restored).toEqual(payload);
  });

  it('rejects a wrong passphrase with a readable error', async () => {
    const envelope = await encryptBackup(payload, 'right');
    await expect(decryptBackup(envelope, 'wrong')).rejects.toThrow(/passphrase/i);
  });

  it('rejects non-backup files', async () => {
    await expect(
      decryptBackup({ format: 'other' } as never, 'x'),
    ).rejects.toThrow(/not a jobpilot backup/i);
  });

  it('uses a fresh salt and iv every time', async () => {
    const a = await encryptBackup(payload, 'pass');
    const b = await encryptBackup(payload, 'pass');
    expect(a.kdf.saltB64).not.toBe(b.kdf.saltB64);
    expect(a.cipher.ivB64).not.toBe(b.cipher.ivB64);
    expect(a.payloadB64).not.toBe(b.payloadB64);
  });
});

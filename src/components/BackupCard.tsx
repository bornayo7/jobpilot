import { useRef, useState } from 'react';
import { decryptBackup, encryptBackup, type BackupEnvelope } from '@lib/util/backup';
import { gatherBackupPayload, restoreBackupPayload, type BackupPayload } from '@lib/util/backupStore';

/**
 * Encrypted full backup/restore: one passphrase-protected .jpbak file holding
 * profiles, settings (including API keys), answers, tracker, versions, and
 * document blobs. Restore replaces everything after an explicit confirm.
 */
export function BackupCard() {
  const [passphrase, setPassphrase] = useState('');
  const [status, setStatus] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    if (passphrase.length < 8) {
      setStatus('Use a passphrase of at least 8 characters.');
      return;
    }
    setStatus('Encrypting…');
    try {
      const payload = await gatherBackupPayload();
      const envelope = await encryptBackup(payload, passphrase);
      const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `jobpilot-backup-${new Date().toISOString().slice(0, 10)}.jpbak`;
      a.click();
      // Revoking synchronously races the download the click just started.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setStatus('Backup downloaded. The passphrase is NOT stored anywhere — keep it.');
    } catch (err) {
      setStatus(`Export failed: ${String(err).slice(0, 200)}`);
    }
  };

  const importAll = async (file: File) => {
    if (!passphrase) {
      setStatus('Enter the backup passphrase first.');
      return;
    }
    if (!confirm('Restoring REPLACES all current JobPilot data (profiles, answers, tracker, documents). Continue?')) {
      return;
    }
    setStatus('Decrypting…');
    try {
      const envelope = JSON.parse(await file.text()) as BackupEnvelope;
      const payload = (await decryptBackup(envelope, passphrase)) as BackupPayload;
      await restoreBackupPayload(payload);
      setStatus('Restored. Reload the extension pages to see the data.');
    } catch (err) {
      setStatus(String(err).slice(0, 200));
    }
  };

  return (
    <section className="card">
      <h2>Backup &amp; restore</h2>
      <p className="hint">
        Everything (profiles, settings incl. API keys, answers, tracker, generated documents) in one
        AES-encrypted file. Insurance against a Chrome profile wipe.
      </p>
      <label className="field">
        Passphrase
        <input
          type="password"
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="min 8 characters — not stored anywhere"
        />
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button className="primary" onClick={() => void exportAll()}>
          Export encrypted backup
        </button>
        <button onClick={() => fileRef.current?.click()}>Restore from file…</button>
        <input
          ref={fileRef}
          type="file"
          accept=".jpbak,application/json"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void importAll(file);
            e.target.value = '';
          }}
        />
      </div>
      {status && <p className="hint" style={{ marginTop: 8 }}>{status}</p>}
    </section>
  );
}

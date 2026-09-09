import { useRef, useState } from 'react';
import { decryptBackup, encryptBackup, type BackupEnvelope } from '@lib/util/backup';
import { gatherBackupPayload, inspectBackupPayload, restoreBackupPayload, type BackupPayload } from '@lib/storage/backupStore';
import { downloadFile } from '@lib/util/download';

/**
 * Encrypted full backup/restore: one passphrase-protected .jpbak file holding
 * profiles, settings (including API keys), answers, tracker, versions, and
 * document blobs. Restore replaces everything after an explicit confirm.
 */
export function BackupCard() {
  const [passphrase, setPassphrase] = useState('');
  const [status, setStatus] = useState('');
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<{ payload: BackupPayload; warnings: string[] } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const exportAll = async () => {
    if (passphrase.length < 8) {
      setStatus('Use a passphrase of at least 8 characters.');
      return;
    }
    setStatus('Encrypting…');
    setBusy(true);
    try {
      const payload = await gatherBackupPayload();
      const envelope = await encryptBackup(payload, passphrase);
      downloadFile(
        new Blob([JSON.stringify(envelope)], { type: 'application/json' }),
        `jobpilot-backup-${new Date().toISOString().slice(0, 10)}.jpbak`,
      );
      setStatus('Backup downloaded. The passphrase is NOT stored anywhere — keep it.');
    } catch (err) {
      setStatus(`Export failed: ${String(err).slice(0, 200)}`);
    } finally { setBusy(false); }
  };

  const importAll = async (file: File) => {
    if (!passphrase) {
      setStatus('Enter the backup passphrase first.');
      return;
    }
    setPending(null); setBusy(true);
    setStatus('Decrypting…');
    try {
      const envelope = JSON.parse(await file.text()) as BackupEnvelope;
      const payload = (await decryptBackup(envelope, passphrase)) as BackupPayload;
      const inspection = inspectBackupPayload(payload);
      setPending({ payload, warnings: inspection.warnings });
      setStatus('Backup decrypted and validated. Review the restore below.');
    } catch (err) {
      setStatus(String(err).slice(0, 200));
    } finally { setBusy(false); }
  };
  const restore = async () => {
    if (!pending || busy) return;
    setBusy(true); setStatus('Restoring data…');
    try {
      const result = await restoreBackupPayload(pending.payload);
      setPending(null);
      setStatus(`Backup restored.${result.warnings.length ? ` ${result.warnings.join(' ')}` : ''}`);
    } catch (err) { setStatus(`Restore did not finish. ${String(err)}`); }
    finally { setBusy(false); }
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
          disabled={busy}
          value={passphrase}
          onChange={(e) => setPassphrase(e.target.value)}
          placeholder="min 8 characters — not stored anywhere"
        />
      </label>
      <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
        <button disabled={busy} className="primary" onClick={() => void exportAll()}>
          Export encrypted backup
        </button>
        <button disabled={busy} onClick={() => fileRef.current?.click()}>Inspect backup…</button>
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
      {pending && <div className="warn-box"><div><strong>Replace all current JobPilot data?</strong><p>This replaces saved profiles, settings, answers, applications and documents. Export a backup first if you need the current data.</p>{pending.warnings.length > 0 && <ul>{pending.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul>}</div><button disabled={busy} onClick={() => void restore()}>Replace data with this backup</button><button disabled={busy} onClick={() => setPending(null)}>Cancel restore</button></div>}
      {status && <p className="hint" role="status" style={{ marginTop: 8 }}>{status}</p>}
    </section>
  );
}

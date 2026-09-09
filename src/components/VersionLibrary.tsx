import type { VersionRecord } from '@lib/storage/versions';
import { getDocument } from '@lib/storage/documents';
import { downloadFile, openInNewTab } from '@lib/util/download';
import { useState } from 'react';

/** Every approved resume and cover letter, newest first, with its rendered files. */
export function VersionLibrary({
  versions,
  defaultResumeBlobId,
  onSetDefault,
  onDelete,
}: {
  versions: VersionRecord[];
  defaultResumeBlobId: string | null;
  onSetDefault: (record: VersionRecord) => void | Promise<void>;
  onDelete: (record: VersionRecord) => void | Promise<void>;
}) {
  return (
    <section>
      <h2 className="gen-h">Version library</h2>
      {versions.length === 0 && <p className="hint">Approved resumes and cover letters will appear here with their files.</p>}
      {versions.map((record) => (
        <VersionRow
          key={record.id}
          record={record}
          isDefault={!!record.pdfBlobId && record.pdfBlobId === defaultResumeBlobId}
          onSetDefault={() => onSetDefault(record)}
          onDelete={() => onDelete(record)}
        />
      ))}
    </section>
  );
}

function VersionRow({
  record,
  isDefault,
  onSetDefault,
  onDelete,
}: {
  record: VersionRecord;
  isDefault: boolean;
  onSetDefault: () => void | Promise<void>;
  onDelete: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const run = async (action: () => void | Promise<void>) => {
    setBusy(true); setError('');
    try { await action(); } catch (err) { setError(String(err)); }
    finally { setBusy(false); }
  };
  return (
    <div className="version-row">
      <div className="version-main">
        <span className="field-label">{record.label}</span>
        <span className="hint">
          {record.company} · {new Date(record.createdAt).toLocaleDateString()}
        </span>
      </div>
      <div className="field-meta">
        {record.pdfBlobId && <button disabled={busy} onClick={() => void run(() => openStoredDocument(record.pdfBlobId!))}>Preview</button>}
        {record.pdfBlobId && <button disabled={busy} aria-label={`Download PDF of ${record.label}`} onClick={() => void run(() => downloadStoredDocument(record.pdfBlobId!))}>PDF</button>}
        {record.docxBlobId && <button disabled={busy} aria-label={`Download DOCX of ${record.label}`} onClick={() => void run(() => downloadStoredDocument(record.docxBlobId!))}>DOCX</button>}
        {record.kind === 'coverLetter' && (
          <button disabled={busy} onClick={() => void run(() => navigator.clipboard.writeText((record.data as { text: string }).text))}>
            Copy text
          </button>
        )}
        {record.pdfBlobId &&
          record.kind === 'resume' &&
          (isDefault ? (
            <span className="chip ok">default</span>
          ) : (
            <button disabled={busy} onClick={() => void run(onSetDefault)}>Use as default</button>
          ))}
        <button disabled={busy} className="entry-remove" aria-label={`Delete ${record.label}`} onClick={() => void run(onDelete)}>
          Delete
        </button>
      </div>
      {error && <p role="alert" className="error-text">{error}</p>}
    </div>
  );
}

async function openStoredDocument(blobId: string): Promise<void> {
  const doc = await getDocument(blobId);
  if (!doc) throw new Error('The saved file is missing. Remove this version or restore it from a backup.');
  openInNewTab(new Blob([doc.bytes], { type: doc.type }));
}

async function downloadStoredDocument(blobId: string): Promise<void> {
  const doc = await getDocument(blobId);
  if (!doc) throw new Error('The saved file is missing. Remove this version or restore it from a backup.');
  downloadFile(new Blob([doc.bytes], { type: doc.type }), doc.name);
}

import type { VersionRecord } from '@lib/storage/versions';
import { getDocument } from '@lib/storage/documents';
import { downloadFile, openInNewTab } from '@lib/util/download';

/** Every approved resume and cover letter, newest first, with its rendered files. */
export function VersionLibrary({
  versions,
  defaultResumeBlobId,
  onSetDefault,
  onDelete,
}: {
  versions: VersionRecord[];
  defaultResumeBlobId: string | null;
  onSetDefault: (record: VersionRecord) => void;
  onDelete: (record: VersionRecord) => void;
}) {
  if (versions.length === 0) return null;
  return (
    <section>
      <h2 className="gen-h">Version library</h2>
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
  onSetDefault: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="version-row">
      <div className="version-main">
        <span className="field-label">{record.label}</span>
        <span className="hint">
          {record.company} · {new Date(record.createdAt).toLocaleDateString()}
        </span>
      </div>
      <div className="field-meta">
        {record.pdfBlobId && <button onClick={() => void openStoredDocument(record.pdfBlobId!)}>Preview</button>}
        {record.pdfBlobId && <button onClick={() => void downloadStoredDocument(record.pdfBlobId!)}>PDF</button>}
        {record.docxBlobId && <button onClick={() => void downloadStoredDocument(record.docxBlobId!)}>DOCX</button>}
        {record.kind === 'coverLetter' && (
          <button onClick={() => void navigator.clipboard.writeText((record.data as { text: string }).text)}>
            Copy text
          </button>
        )}
        {record.pdfBlobId &&
          record.kind === 'resume' &&
          (isDefault ? (
            <span className="chip ok">default</span>
          ) : (
            <button onClick={onSetDefault}>Set default</button>
          ))}
        <button className="entry-remove" onClick={onDelete}>
          ✕
        </button>
      </div>
    </div>
  );
}

async function openStoredDocument(blobId: string): Promise<void> {
  const doc = await getDocument(blobId);
  if (doc) openInNewTab(new Blob([doc.bytes], { type: doc.type }));
}

async function downloadStoredDocument(blobId: string): Promise<void> {
  const doc = await getDocument(blobId);
  if (doc) downloadFile(new Blob([doc.bytes], { type: doc.type }), doc.name);
}

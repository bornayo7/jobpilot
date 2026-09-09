import { useRef, useState } from 'react';
import {
  deleteDocument,
  listDocuments,
  storeDocument,
  DocumentInUseError,
} from '@lib/storage/documents';
import type { CardProps } from './fields';
import { useCollection } from '../useCollection';

export function DocumentsCard({ profile, update }: CardProps) {
  const { items: docs, error: loadError, refresh } = useCollection(listDocuments);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const upload = async (file: File) => {
    setBusy(true); setError('');
    try {
      const meta = await storeDocument(file);
      update((current) => current.documents.defaultResumeId ? {} : { documents: { ...current.documents, defaultResumeId: meta.id } });
      await refresh();
    } catch (err) { setError(`Upload failed. ${String(err)}`); }
    finally { setBusy(false); }
  };

  const remove = async (id: string) => {
    setBusy(true); setError('');
    try {
      try { await deleteDocument(id); }
      catch (err) {
        if (!(err instanceof DocumentInUseError)) throw err;
        if (!confirm(`This file is selected by ${err.references.map((ref) => ref.profileName).join(', ')}. Remove the file and clear those selections?`)) return;
        await deleteDocument(id, { clearDefaults: true });
      }
      update((current) => current.documents.defaultResumeId === id ? { documents: { ...current.documents, defaultResumeId: null } } : {});
      await refresh();
    } catch (err) { setError(`Document was not removed. ${String(err)}`); }
    finally { setBusy(false); }
  };

  return (
    <section className="card">
      <h2>Documents</h2>
      <p className="hint">
        Upload your resume (PDF or DOCX). The default is what autofill attaches to file fields.
        Tailored versions generated via the Prompt Studio will appear here too.
      </p>
      {(error || loadError) && <div className="warn-box" role="alert">{error || loadError}<button onClick={() => void refresh()}>Refresh documents</button></div>}
      {docs.map((doc) => (
        <div className="entry" key={doc.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <label className="field checkbox" style={{ flex: 1 }}>
            <input
              type="radio"
              name="default-resume"
              checked={profile.documents.defaultResumeId === doc.id}
              onChange={() => update({ documents: { ...profile.documents, defaultResumeId: doc.id } })}
            />
            {doc.name}
            <span className="hint" style={{ marginLeft: 6 }}>
              {(doc.size / 1024).toFixed(0)} KB
            </span>
          </label>
          <button className="entry-remove" disabled={busy} aria-label={`Remove ${doc.name}`} onClick={() => void remove(doc.id)}>
            Remove
          </button>
        </div>
      ))}
      <button disabled={busy} onClick={() => fileRef.current?.click()}>{busy ? 'Updating documents…' : 'Upload document'}</button>
      <input
        ref={fileRef}
        type="file"
        accept=".pdf,.doc,.docx,application/pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
          e.target.value = '';
        }}
      />
    </section>
  );
}

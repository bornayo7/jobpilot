import { useEffect, useRef, useState } from 'react';
import type { Profile } from '@lib/schema/profile';
import {
  deleteDocument,
  listDocuments,
  storeDocument,
  type StoredDocMeta,
} from '@lib/storage/documents';

export function DocumentsCard({
  profile,
  update,
}: {
  profile: Profile;
  update: (patch: Partial<Profile>) => void;
}) {
  const [docs, setDocs] = useState<StoredDocMeta[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () => void listDocuments().then(setDocs);
  useEffect(refresh, []);

  const upload = async (file: File) => {
    const meta = await storeDocument(file);
    // First upload becomes the default automatically.
    if (!profile.documents.defaultResumeId) {
      update({ documents: { ...profile.documents, defaultResumeId: meta.id } });
    }
    refresh();
  };

  const remove = async (id: string) => {
    await deleteDocument(id);
    if (profile.documents.defaultResumeId === id) {
      update({ documents: { ...profile.documents, defaultResumeId: null } });
    }
    refresh();
  };

  return (
    <section className="card">
      <h2>Documents</h2>
      <p className="hint">
        Upload your resume (PDF or DOCX). The default is what autofill attaches to file fields.
        Tailored versions generated via the Prompt Studio will appear here too.
      </p>
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
          <button className="entry-remove" onClick={() => void remove(doc.id)}>
            Remove
          </button>
        </div>
      ))}
      <button onClick={() => fileRef.current?.click()}>+ Upload document</button>
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

import { beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDb } from '@lib/storage/db';
import { storeDocument, deleteDocument, listDocuments, DocumentInUseError, GeneratedDocumentError } from '@lib/storage/documents';
import { storeResumeVersion } from '@lib/generation/storeVersion';
import { deleteVersion, listVersions } from '@lib/storage/versions';
import { createProfile, loadProfileSnapshot, saveProfileSnapshot } from '@lib/storage/profileStore';
import { ResumeVersionSchema } from '@lib/schema/resumeVersion';

beforeEach(async () => { vi.restoreAllMocks();fakeBrowser.reset();const db=await getDb();for(const name of [...db.objectStoreNames]) await db.clear(name); });
const version = ResumeVersionSchema.parse({meta:{company:'Acme'},basics:{name:'Ada'}});
const file = () => new File(['example'], 'resume.pdf',{type:'application/pdf'});
const storeVersion = () => storeResumeVersion({version,jobUrl:'https://example.com',fallbackName:'resume',pdfBytes:new ArrayBuffer(4),docxBytes:new ArrayBuffer(5)});

it('stores a version and both twins atomically when the final write fails', async () => {
  const put = IDBObjectStore.prototype.put;
  const spy = vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,...args) {
    if(this.name === 'resumeVersions') throw new Error('metadata rejected');
    return put.apply(this,args);
  });
  await expect(storeVersion()).rejects.toThrow('metadata rejected');
  spy.mockRestore();
  const db=await getDb();
  for(const name of ['blobs','documentMeta','resumeVersions'] as const) expect(await db.count(name)).toBe(0);
});

it('never loads file bytes while listing document summaries', async () => {
  await storeDocument(file()); await storeVersion();
  const getAll=IDBObjectStore.prototype.getAll;
  const spy=vi.spyOn(IDBObjectStore.prototype,'getAll').mockImplementation(function(this:IDBObjectStore,...args) {
    if(this.name === 'blobs') throw new Error('listing loaded bytes');
    return getAll.apply(this,args);
  });
  const docs = await listDocuments();
  expect(docs).toHaveLength(3);
  expect(docs.filter((doc)=>doc.source==='generated')).toHaveLength(2);
  expect(docs.find((doc)=>doc.source==='upload')).toMatchObject({size:7});
  spy.mockRestore();
});

it('rejects deletion of an individual generated twin and removes complete versions', async () => {
  const record = await storeVersion();
  await expect(deleteDocument(record.pdfBlobId!)).rejects.toBeInstanceOf(GeneratedDocumentError);
  expect(await listVersions()).toHaveLength(1);
  await deleteVersion(record.id);
  expect(await listVersions()).toHaveLength(0); expect(await listDocuments()).toHaveLength(0);
});

it('requires explicit clearing of every profile default then updates all references', async () => {
  const doc = await storeDocument(file());
  const first=await loadProfileSnapshot();first.profile.documents.defaultResumeId=doc.id;
  await saveProfileSnapshot(first,first.profile);
  const secondId=await createProfile('Copy',true);
  await expect(deleteDocument(doc.id)).rejects.toBeInstanceOf(DocumentInUseError);
  expect(await listDocuments()).toHaveLength(1);
  await deleteDocument(doc.id,{clearDefaults:true});
  expect((await loadProfileSnapshot(first.id)).profile.documents.defaultResumeId).toBeNull();
  expect((await loadProfileSnapshot(secondId)).profile.documents.defaultResumeId).toBeNull();
  expect(await listDocuments()).toHaveLength(0);
});

it('rolls document removal and profile-default changes back together on local failure', async () => {
  const doc = await storeDocument(file());
  const base=await loadProfileSnapshot();base.profile.documents.defaultResumeId=doc.id;
  await saveProfileSnapshot(base,base.profile);
  const spy=vi.spyOn(fakeBrowser.storage.local,'set').mockRejectedValueOnce(new Error('local write rejected'));
  await expect(deleteDocument(doc.id,{clearDefaults:true})).rejects.toThrow('local write rejected');
  spy.mockRestore();
  expect((await loadProfileSnapshot()).profile.documents.defaultResumeId).toBe(doc.id);
  expect(await listDocuments()).toHaveLength(1);
  expect(await (await getDb()).count('recoveryJournal')).toBe(0);
});

it('rolls back complete version deletion when deleting a later artifact fails', async () => {
  const record = await storeVersion();
  const remove=IDBObjectStore.prototype.delete;
  const spy=vi.spyOn(IDBObjectStore.prototype,'delete').mockImplementation(function(this:IDBObjectStore,...args) {
    if(this.name === 'documentMeta') throw new Error('delete rejected');
    return remove.apply(this,args);
  });
  await expect(deleteVersion(record.id)).rejects.toThrow('delete rejected');spy.mockRestore();
  expect(await listVersions()).toHaveLength(1);expect(await listDocuments()).toHaveLength(2);
});

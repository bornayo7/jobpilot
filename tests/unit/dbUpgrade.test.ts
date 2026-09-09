import { expect, it } from 'vitest';
import { openDB } from 'idb';
import { getDb } from '@lib/storage/db';

it('upgrades v1 documents to metadata without losing generated ownership or bytes',async()=>{
  const old=await openDB('jobpilot',1,{upgrade(db){
    db.createObjectStore('blobs',{keyPath:'id'});
    const versions=db.createObjectStore('resumeVersions',{keyPath:'id'});versions.createIndex('byCreatedAt','createdAt');
    const answers=db.createObjectStore('answers',{keyPath:'id'});answers.createIndex('byNormalized','questionNormalized');
    const tracker=db.createObjectStore('trackerJobs',{keyPath:'id'});tracker.createIndex('byStatus','status');tracker.createIndex('byCreatedAt','createdAt');
    db.createObjectStore('unmatchedLog',{keyPath:'id'});
  }});
  await old.put('blobs',{id:'upload',name:'upload.pdf',type:'application/pdf',bytes:new Uint8Array([1,2]).buffer,createdAt:1});
  await old.put('blobs',{id:'generated',name:'cover.pdf',type:'application/pdf',bytes:new Uint8Array([3,4,5]).buffer,createdAt:2});
  await old.put('resumeVersions',{id:'version',kind:'coverLetter',label:'Letter',company:'Acme',data:{text:'hello'},pdfBlobId:'generated',createdAt:2});
  await old.put('answers',{id:'legacy',questionRaw:'Why?',questionNormalized:'why',answer:'Because',jobId:'',company:'',reusable:true,createdAt:1});
  old.close();
  const upgraded=await getDb();
  expect(upgraded.version).toBe(2);
  expect(await upgraded.getAll('documentMeta')).toEqual(expect.arrayContaining([
    expect.objectContaining({id:'upload',size:2,source:'upload'}),
    expect.objectContaining({id:'generated',size:3,source:'generated',versionId:'version'}),
  ]));
  expect([...new Uint8Array((await upgraded.get('blobs','generated'))!.bytes)]).toEqual([3,4,5]);
  expect(await upgraded.get('answers','legacy')).toMatchObject({reusable:true});
  expect((await upgraded.get('answers','legacy'))?.reuseConfirmed).toBeUndefined();
  expect(upgraded.objectStoreNames.contains('recoveryJournal')).toBe(true);
});

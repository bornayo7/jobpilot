import 'fake-indexeddb/auto';
import { beforeEach, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { getDb } from '@lib/storage/db';
import { SubmissionTracker } from '@lib/tracker/submissions';
import { createJob, listJobs } from '@lib/tracker/store';
import { listAnswers } from '@lib/memory/answers';
let clock = 0;
const tracker = () => new SubmissionTracker(60_000, () => clock);
const attempt = { documentId:'form-a', url:'https://jobs.lever.co/acme/123/apply', title:'Engineer - Job Application',
  profileId:'profile-a',profileRevision:3,resumeName:'actual-resume.pdf',
  answers:[{label:'Why Acme?',value:'Because of the mission and the team.'}] };
const confirmation = {url:'https://jobs.lever.co/acme/123/thanks',title:'Thanks for applying'};
beforeEach(async()=>{fakeBrowser.reset();clock=1_000_000;const db=await getDb();for(const store of [...db.objectStoreNames]) await db.clear(store);});
it('records a correlated application and its scoped answers with actual provenance',async()=>{
 const submissions=tracker();await submissions.attempted(7,attempt);expect(await listJobs()).toEqual([]);
 expect((await submissions.confirmed(7,confirmation)).status).toBe('recorded');
 const [job]=await listJobs();expect(job).toMatchObject({company:'Acme',title:'Engineer',url:attempt.url,status:'applied',profileId:'profile-a',profileRevision:3,resumeName:'actual-resume.pdf'});
 expect((await listAnswers())[0]).toMatchObject({jobId:job!.id,company:'Acme',reusable:false,reuseConfirmed:false,origin:'captured',applicationId:'lever:acme:123'});
});
it('does not record confirmation without a matching attempt',async()=>{
 expect((await tracker().confirmed(7,confirmation)).status).toBe('ignored');expect(await listJobs()).toEqual([]);
});
it('does not consume a different application attempt in the same tab',async()=>{
 const submissions=tracker();await submissions.attempted(7,attempt);
 await submissions.confirmed(7,{url:'https://jobs.lever.co/other/456/thanks',title:'Thanks'});
 expect(await listJobs()).toEqual([]);expect((await submissions.confirmed(7,confirmation)).status).toBe('recorded');
});
it('survives a worker restart but never revives expired evidence',async()=>{
 await tracker().attempted(7,attempt);expect((await tracker().confirmed(7,confirmation)).status).toBe('recorded');
 await tracker().attempted(8,{...attempt,url:'https://jobs.lever.co/acme/789/apply'});clock+=61_000;
 expect((await tracker().confirmed(8,{...confirmation,url:'https://jobs.lever.co/acme/789/thanks'})).status).toBe('ignored');expect(await listJobs()).toHaveLength(1);
});
it('forgets closed tabs and consumes each attempt once even with concurrent confirmations',async()=>{
 const submissions=tracker();await submissions.attempted(7,attempt);await submissions.forget(7);await submissions.confirmed(7,confirmation);expect(await listJobs()).toEqual([]);
 await submissions.attempted(8,attempt);await Promise.all([submissions.confirmed(8,confirmation),submissions.confirmed(8,confirmation)]);
 expect(await listJobs()).toHaveLength(1);expect(await listAnswers()).toHaveLength(1);
});
it('keeps distinct requisitions but deduplicates a concurrent manual creation',async()=>{
 const base={company:'Acme',title:'Engineer',url:'https://jobs.lever.co/acme/1'};
 await Promise.all([createJob(base),createJob(base),createJob({...base,url:'https://jobs.lever.co/acme/2'})]);
 expect(await listJobs()).toHaveLength(2);
});
it('ordinary posting text cannot confirm even after an Apply navigation click',async()=>{
 const submissions=tracker();await submissions.attempted(7,attempt);
 const result=await submissions.confirmed(7,{url:attempt.url,title:attempt.title,confirmationText:'Please save a copy after your application has been submitted.'});
 expect(result.status).toBe('ignored');expect(await listJobs()).toEqual([]);
});

it('rolls back the job when answer filing fails and retains retryable evidence',async()=>{
 const submissions=tracker();await submissions.attempted(7,attempt);
 const put=IDBObjectStore.prototype.put;
 const spy=vi.spyOn(IDBObjectStore.prototype,'put').mockImplementation(function(this:IDBObjectStore,value:unknown,key?:IDBValidKey){
   if(this.name==='answers') throw new DOMException('Injected answer write failure','DataError');
   return key===undefined ? put.call(this,value) : put.call(this,value,key);
 });
 try { expect((await submissions.confirmed(7,confirmation)).status).toBe('failed'); } finally { spy.mockRestore(); }
 expect(await listJobs()).toEqual([]);expect(await listAnswers()).toEqual([]);
 expect((await submissions.confirmed(7,confirmation)).status).toBe('recorded');
});

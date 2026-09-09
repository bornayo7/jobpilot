import { afterEach, expect, it, vi } from 'vitest';
import { FillRuns } from '@lib/messaging/fillRuns';
import type { PanelToBg } from '@lib/messaging/protocol';

const input = {tabId:1,frameId:0,documentId:'document-a',instructions:[]};
afterEach(() => vi.useRealTimers());
it('waits for the matching document and run acknowledgement', async () => {
  const messages: PanelToBg[]=[]; const runs=new FillRuns((message)=>messages.push(message));
  const pending=runs.execute(input); let finished=false;void pending.then(()=>{finished=true;});
  const message=messages[0];if(message?.t!=='panel/execute') throw Error('execute expected');
  expect(runs.accept({t:'bg/frameEvent',tabId:1,frameId:0,event:{t:'cs/fillResults',documentId:'old',runId:message.runId,results:[]}})).toBe(false);
  await Promise.resolve();expect(finished).toBe(false);
  expect(runs.accept({t:'bg/frameEvent',tabId:1,frameId:0,event:{t:'cs/fillResults',documentId:'document-a',runId:message.runId,results:[{fieldId:'name',ok:true}]}})).toBe(true);
  expect(await pending).toEqual([{fieldId:'name',ok:true}]);
});
it('cancels a replaced document and sends a cancellation command', async () => {
  const send=vi.fn();const runs=new FillRuns(send);const pending=runs.execute(input);const assertion=expect(pending).rejects.toThrow('document changed');
  runs.accept({t:'bg/frameEvent',tabId:1,frameId:0,event:{t:'cs/ready',documentId:'replacement',atsId:null,url:'https://example.com'}});
  await assertion;expect(send.mock.calls.at(-1)?.[0].t).toBe('panel/cancel');
});
it('rejects overlapping runs and settles on disconnect',async()=>{
  const runs=new FillRuns(vi.fn());const first=runs.execute(input);const done=expect(first).rejects.toThrow('Connection closed');
  await expect(runs.execute(input)).rejects.toThrow('already running');runs.cancelAll();await done;
});
it('times out an unacknowledged run without leaving it busy',async()=>{
  vi.useFakeTimers();const runs=new FillRuns(vi.fn());const pending=runs.execute(input);const done=expect(pending).rejects.toThrow('did not acknowledge');
  await vi.advanceTimersByTimeAsync(5100);await done;
  const next=runs.execute(input);const nextDone=expect(next).rejects.toThrow();runs.cancelAll();await nextDone;
});

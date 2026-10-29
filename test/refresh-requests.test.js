import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, mkdir, writeFile, utimes, stat } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { register } from 'tsx/esm/api';
register();
const { submitRefresh, watchRefreshRequests, waitRefreshResult } = await import('../src/collection/refresh-requests.ts');
const {writePrivateJson} = await import('../src/collection/private-files.ts');
test('requests are correlated, deduplicated and reject traversal, expired or future input', async t => {
  const root = await mkdtemp('/tmp/opencode/requests-'); t.after(() => rm(root, { recursive: true, force: true }));
  let calls = 0;
  const watcher = await watchRefreshRequests(root, async r => { calls++; return { id: r.id, completedAt: new Date().toISOString(), accounts: [{ accountId: 'a', outcome: 'blocked', nextRetryAt: '2026-10-22T00:00:00Z' }] }; }); t.after(() => watcher.close());
  const request = { version: 1, id: randomUUID(), createdAt: new Date().toISOString() };
  await submitRefresh(root, request); const result = await waitRefreshResult(root, request.id, 2000);
  assert.equal(result.id, request.id); assert.equal(result.accounts[0].outcome, 'blocked');
  await submitRefresh(root, request); await waitRefreshResult(root, request.id, 2000); assert.equal(calls, 1);
  await assert.rejects(submitRefresh(root, { ...request, id: '../escape' }));
  await assert.rejects(submitRefresh(root, { ...request, createdAt: '2000-01-01T00:00:00Z' }));
  await assert.rejects(submitRefresh(root, { ...request, createdAt: '2999-01-01T00:00:00Z' }));
});

test('bounded scans eventually process and clean entries beyond the first 256 files',async t=>{
  const root=await mkdtemp('/tmp/opencode/request-batches-');t.after(()=>rm(root,{recursive:true,force:true}));
  await mkdir(`${root}/requests`,{mode:0o700});
  await Promise.all(Array.from({length:150},async(_,i)=>{
    const id=`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
    await writePrivateJson(`${root}/requests/${id}.json`,{version:1,id,createdAt:new Date().toISOString()});
    await writePrivateJson(`${root}/requests/${id}.result.json`,{id,accounts:[],completedAt:new Date().toISOString()});
  }));
  const expired=`${root}/requests/eeee-expired.json`;await writeFile(expired,'{}',{mode:0o600});await utimes(expired,1,1);
  const request={version:1,id:'ffffffff-ffff-4fff-8fff-ffffffffffff',createdAt:new Date().toISOString()};
  await submitRefresh(root,request);
  const watcher=await watchRefreshRequests(root,async r=>({id:r.id,completedAt:new Date().toISOString(),accounts:[]}));t.after(()=>watcher.close());
  assert.equal((await waitRefreshResult(root,request.id,2000)).id,request.id);
  await new Promise(r=>setTimeout(r,300));
  await assert.rejects(stat(expired));
});

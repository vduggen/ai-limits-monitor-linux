import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, writeFile, chmod, rm } from 'node:fs/promises';
import { register } from 'tsx/esm/api';
register();
const { readCodexUsage } = await import('../src/providers/codex.ts');
test('Codex reads may take more than 3 seconds within configured timeout and omit credit details', async t => {
  const dir = await mkdtemp('/tmp/opencode/codex-bin-'); t.after(() => rm(dir, { recursive: true, force: true }));
  const bin = `${dir}/codex`;
  await writeFile(bin, `#!${process.execPath}\nconst rl=require('readline').createInterface({input:process.stdin});rl.on('line',s=>{const m=JSON.parse(s);if(!m.id)return;let result={};if(m.method==='account/read')result={account:{type:'chatgpt'}};if(m.method==='account/rateLimits/read'){if(!m.params?.excludeResetCreditDetails){console.log(JSON.stringify({id:m.id,error:{message:'missing credit omission'}}));return;}result={rateLimits:{primary:{usedPercent:37,windowDurationMins:300}}};setTimeout(()=>console.log(JSON.stringify({id:m.id,result})),3100);return;}console.log(JSON.stringify({id:m.id,result}));});`);
  await chmod(bin, 0o700);
  const usage = await readCodexUsage({ id: 'a', label: 'A', provider: 'codex', binaryPath: bin, homeDir: dir }, 5);
  assert.equal(usage.status, 'ok'); assert.equal(usage.windows[0].usedPercent, 37);
});

test('Claude provider carries only non-secret identity evidence into quota results', async () => {
  const {parseClaudeUsage}=await import('../src/providers/claude.ts');
  const usage=parseClaudeUsage({id:'a',label:'A',provider:'claude'}, {account:{email:'person@example.test'}}, {rate_limits_available:true,rate_limits:{five_hour:{utilization:37}}},new Date().toISOString());
  assert.equal(usage.identityId,'email:person@example.test');
});

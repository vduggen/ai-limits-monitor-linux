import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';
import {spawn} from 'node:child_process';
import {register} from 'tsx/esm/api';
register();
const {writePrivateJson}=await import('../src/collection/private-files.ts');
const {resolveBinding}=await import('../src/collection/identity.ts');
async function setup(t) {
  const root=await mkdtemp('/tmp/opencode/cli-');t.after(()=>rm(root,{recursive:true,force:true}));
  const a={id:'a',label:'A',provider:'claude',configDir:`${root}/profile`,collectionMode:'local-only'};
  await mkdir(a.configDir,{mode:0o700}); await writePrivateJson(`${root}/accounts.json`,{accounts:[a]});
  const env={...process.env,AI_LIMITS_CONFIG:`${root}/accounts.json`,AI_LIMITS_CACHE:`${root}/cache/usage.json`};
  const run=(args)=>new Promise(resolve=>{const c=spawn(process.execPath,['--import','tsx','src/index.ts',...args],{env,stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>c.kill('SIGKILL'),5000);let out='',err='';c.stdout.on('data',b=>out+=b);c.stderr.on('data',b=>err+=b);c.on('close',code=>{clearTimeout(timer);resolve({code,out,err});});});
  return {root,a,env,run};
}
test('integration install without collector binding refuses to create an orphan generation',async t=>{
  const {a,run}=await setup(t);
  const r=await run(['integration','install','--account','a','--confirm']);
  assert.notEqual(r.code,0);assert.match(r.err,/coletor|inicializ/i);
  await assert.rejects(readFile(`${a.configDir}/settings.json`));
});
test('installation consumes the approved preview and rejects settings or profile changes since confirmation',async t=>{
  const {root,a,run}=await setup(t);const b=resolveBinding(a);
  await writePrivateJson(`${root}/cache/runtime-state.json`,[{binding:b,windows:[],revision:0,rateLimitLevel:0}]);
  await writePrivateJson(`${a.configDir}/settings.json`,{statusLine:{type:'command',command:'cat'}});
  const p=await run(['integration','preview','--account','a']);assert.equal(p.code,0,p.err);
  const preview=JSON.parse(p.out);assert.equal(typeof preview.previewId,'string');
  await writePrivateJson(`${a.configDir}/settings.json`,{statusLine:{type:'command',command:'printf changed'}});
  const changed=await run(['integration','install','--account','a','--confirm','--preview',preview.previewId]);
  assert.notEqual(changed.code,0);assert.match(changed.err,/alterad|preview/i);
  assert.equal(JSON.parse(await readFile(`${a.configDir}/settings.json`)).statusLine.command,'printf changed');
  const second=JSON.parse((await run(['integration','preview','--account','a'])).out);
  await writePrivateJson(`${root}/accounts.json`,{accounts:[{...a,configDir:`${root}/newprofile`}]});
  const rebound=await run(['integration','install','--account','a','--confirm','--preview',second.previewId]);
  assert.notEqual(rebound.code,0);
  await writePrivateJson(`${root}/accounts.json`,{accounts:[a]});
  const approved=JSON.parse((await run(['integration','preview','--account','a'])).out);
  const installed=await run(['integration','install','--account','a','--confirm','--preview',approved.previewId]);
  assert.equal(installed.code,0,installed.err);
  assert.match(JSON.parse(await readFile(`${a.configDir}/settings.json`)).statusLine.command,/statusline\.js/);
});

test('standalone check recovers a verified dead-owner lock rather than waiting for a nonexistent daemon',async t=>{
  const {root,run}=await setup(t);
  await writePrivateJson(`${root}/cache/collector.lock/owner.json`,{pid:2147483647,start:'dead',uid:process.getuid(),token:'old'});
  const result=await run(['check','--json']);assert.equal(result.code,0,result.err);
  assert.equal(JSON.parse(result.out).version,1);
});

test('check --json has the same usage-snapshot schema with and without an active daemon',async t=>{
  const {root,env,run}=await setup(t);
  const alone=await run(['check','--json']);assert.equal(alone.code,0,alone.err);
  const {runDaemon}=await import('../src/collection/daemon.ts'); const abort=new AbortController();
  const daemon=runDaemon(`${root}/accounts.json`,env.AI_LIMITS_CACHE,abort.signal);t.after(async()=>{abort.abort();await daemon;});
  for(let i=0;i<100;i++) {try{await readFile(`${root}/cache/collector.lock/owner.json`);break;}catch{await new Promise(r=>setTimeout(r,20));}}
  const active=await run(['check','--json']);assert.equal(active.code,0,active.err);
  const a=JSON.parse(alone.out),b=JSON.parse(active.out);
  assert.equal(b.version,1);assert.equal(b.accounts[0].id,a.accounts[0].id);assert.ok(Array.isArray(b.accounts[0].windows));
});

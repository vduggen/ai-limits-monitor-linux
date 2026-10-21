import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { register } from 'tsx/esm/api';
register();
const { previewClaudeIntegration, installClaudeIntegration, removeClaudeIntegration } = await import('../src/collection/claude-install.ts');
const binding = { accountId: 'a', profilePath: '/profile', generation: 'g', boundAt: '2026-10-21T12:00:00Z' };
test('preview, install, remove preserve original statusline options and concurrent edits', async t => {
  const root = await mkdtemp('/tmp/opencode/install-'); t.after(() => rm(root, { recursive: true, force: true }));
  const file = `${root}/settings.json`;
  const original = { other: true, statusLine: { type: 'command', command: 'cat', padding: 2 } };
  await writeFile(file, JSON.stringify(original), { mode: 0o600 });
  const preview = await previewClaudeIntegration(file, binding, '/path with spaces/statusline.js', root);
  assert.equal((JSON.parse(await readFile(file))).statusLine.command, 'cat');
  assert.equal(JSON.parse(preview.proposed).statusLine.padding, 2);
  await installClaudeIntegration(preview);
  assert.equal((JSON.parse(await readFile(file))).other, true);
  await removeClaudeIntegration(file, root);
  assert.deepEqual(JSON.parse(await readFile(file)), original);
  await writeFile(file, JSON.stringify({ ...original, changed: true }));
  await assert.rejects(installClaudeIntegration(preview), /alterad|concorr/i);
});
test('missing settings and unknown statuslines do not cause destructive restoration', async t => {
  const root = await mkdtemp('/tmp/opencode/install-'); t.after(() => rm(root, { recursive: true, force: true }));
  const file = `${root}/settings.json`;
  const p = await previewClaudeIntegration(file, binding, '/bridge.js', root); assert.equal(p.original, null);
  await installClaudeIntegration(p);
  const changed = { statusLine: { type: 'command', command: 'my-new-command' }, preserved: true };
  await writeFile(file, JSON.stringify(changed));
  await assert.rejects(removeClaudeIntegration(file, root), /alterad/i);
  assert.deepEqual(JSON.parse(await readFile(file)), changed);
  await writeFile(file, JSON.stringify({ statusLine: { type: 'unknown' } }));
  await assert.rejects(previewClaudeIntegration(file, binding, '/bridge.js', root));
});

test('reinstall after reformat or executable upgrade preserves the original command and unrelated edits', async t => {
  const root=await mkdtemp('/tmp/opencode/reinstall-'); t.after(()=>rm(root,{recursive:true,force:true}));
  const file=`${root}/settings.json`; const original={statusLine:{type:'command',command:'cat',padding:2},unrelated:1};
  await writeFile(file,JSON.stringify(original),{mode:0o600});
  await installClaudeIntegration(await previewClaudeIntegration(file,binding,'/bridge.js',root));
  const formatted=JSON.parse(await readFile(file)); formatted.unrelated=2;
  await writeFile(file,JSON.stringify(formatted,null,4));
  await installClaudeIntegration(await previewClaudeIntegration(file,binding,'/new path/bridge.js',root));
  const {integrationManifestPath}=await import('../src/collection/claude-install.ts');
  const manifest=JSON.parse(await readFile(integrationManifestPath(file,root)));
  assert.equal(manifest.previousCommand,'cat');
  await removeClaudeIntegration(file,root);
  assert.deepEqual(JSON.parse(await readFile(file)),{...original,unrelated:2});
});

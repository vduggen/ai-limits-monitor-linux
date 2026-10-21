import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp, readFile, stat, rm, writeFile, symlink, mkdir} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
test('GJS transport writes a private correlated request and rejects traversal or symlinked input', async t => {
  const root = await mkdtemp('/tmp/opencode/gjs-refresh-'); t.after(() => rm(root, {recursive: true, force: true}));
  const helper = pathToFileURL(`${process.cwd()}/gnome/refresh-request.js`).href;
  const id = 'cfb74467-4d34-4c12-9187-6b71a1f61111';
  await mkdir(`${root}/requests`, {mode: 0o700});
  await writeFile(`${root}/outside.json`, JSON.stringify({id, accounts: []}), {mode: 0o600});
  await symlink(`${root}/outside.json`, `${root}/requests/${id}.result.json`);
  const script = `${root}/run.js`;
  await writeFile(script, `import GLib from 'gi://GLib'; import System from 'system'; import {submitRefreshRequest, readRefreshResult} from '${helper}';
const loop = new GLib.MainLoop(null, false);
submitRefreshRequest(${JSON.stringify(root)}, {version:1,id:'${id}',createdAt:new Date().toISOString()}, async error => {
  try { if(error) throw error; let rejected=false; try { await readRefreshResult(${JSON.stringify(root)}, '../escape'); } catch { rejected=true; } if(!rejected) throw Error('traversal accepted');
    rejected=false; try { await readRefreshResult(${JSON.stringify(root)}, '${id}'); } catch { rejected=true; } if(!rejected) throw Error('symlink accepted');
  } catch(e) { printerr(e.stack); System.exit(1); } loop.quit();
}); loop.run();`);
  const result = spawnSync('gjs', ['-m', script], {encoding: 'utf8', timeout: 5000});
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(await readFile(`${root}/requests/${id}.json`)).id, id);
  assert.equal((await stat(`${root}/requests/${id}.json`)).mode & 511, 384);
});

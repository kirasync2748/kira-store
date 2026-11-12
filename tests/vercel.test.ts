import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
test('Vercel runtime adjustment changes Node functions and preserves edge configuration', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'kira-vercel-'));
  try {
    const root = join(dir, '.vercel/output/functions');
    await mkdir(join(root, 'nested/app.func'), { recursive: true });
    await mkdir(join(root, 'edge.func'), { recursive: true });
    await writeFile(
      join(root, 'nested/app.func/.vc-config.json'),
      JSON.stringify({ runtime: 'nodejs24.x', handler: 'app.mjs' }),
    );
    await writeFile(
      join(root, 'edge.func/.vc-config.json'),
      JSON.stringify({ runtime: 'edge', entrypoint: 'app.js' }),
    );
    execFileSync(process.execPath, [resolve('scripts/set-vercel-runtime.mjs')], { cwd: dir });
    assert.deepEqual(
      JSON.parse(await readFile(join(root, 'nested/app.func/.vc-config.json'), 'utf8')),
      { runtime: 'nodejs26.x', handler: 'app.mjs' },
    );
    assert.equal(
      JSON.parse(await readFile(join(root, 'edge.func/.vc-config.json'), 'utf8')).runtime,
      'edge',
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

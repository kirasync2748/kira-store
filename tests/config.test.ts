import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const configUrl = new URL('../astro.config.mjs', import.meta.url).href;

test('Astro config reads .env, preserves exported values, and allows a missing file', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'kira-config-'));
  const env = { ...process.env };
  delete env.DEPLOY_TARGET;
  delete env.SITE_URL;
  const read = (overrides = {}) =>
    JSON.parse(
      execFileSync(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          `const {default: c} = await import(${JSON.stringify(configUrl)}); console.log(JSON.stringify({site:c.site,adapter:c.adapter.name}));`,
        ],
        { cwd, env: { ...env, ...overrides }, encoding: 'utf8' },
      ),
    );
  try {
    assert.equal(read().adapter, '@astrojs/node');
    writeFileSync(join(cwd, '.env'), 'DEPLOY_TARGET=cloudflare\nSITE_URL=https://file.example\n');
    assert.deepEqual(read(), { site: 'https://file.example', adapter: '@astrojs/cloudflare' });
    assert.deepEqual(read({ DEPLOY_TARGET: 'vercel', SITE_URL: 'https://exported.example' }), {
      site: 'https://exported.example',
      adapter: '@astrojs/vercel',
    });
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});

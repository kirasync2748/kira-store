import test from 'node:test';
import assert from 'node:assert/strict';
import { createCatalog } from '../src/lib/cache.ts';
import { loadProvider, PartialProviderError, ProviderError } from '../src/lib/providers.ts';
import type { Project } from '../src/lib/types.ts';
const project = {
  id: 'npm:maker:tool',
  source: 'npm',
  owner: 'maker',
  slug: 'tool',
  name: 'tool',
  description: 'A tool',
  url: 'https://npmjs.com/package/tool',
} as Project;
test('concurrent requests share discovery; expiry picks up newly published projects', async () => {
  let time = 0,
    calls = 0;
  const accounts = [{ provider: 'npm' as const, username: 'maker' }];
  let rows = [project];
  const catalog = createCatalog(
    accounts,
    async () => {
      calls++;
      await Promise.resolve();
      return rows;
    },
    () => time,
    300_000,
  );
  const first = await Promise.all([catalog(), catalog(), catalog()]);
  assert.equal(calls, 1);
  assert.equal(first[0][0].items.length, 1);
  rows = [project, { ...project, id: 'npm:maker:new', slug: 'new', name: 'New project' }];
  time = 299_999;
  assert.equal((await catalog())[0].items.length, 1);
  time = 300_001;
  assert.equal((await catalog())[0].items.length, 2);
  assert.equal(calls, 2);
});
test('a failed source retains previous data and does not hide healthy accounts', async () => {
  let time = 0,
    failed = false;
  const catalog = createCatalog(
    [
      { provider: 'npm', username: 'maker' },
      { provider: 'github', username: 'maker' },
    ],
    async (a) => {
      if (a.provider === 'npm' && failed) throw new ProviderError('rate limited');
      return a.provider === 'npm' ? [project] : [];
    },
    () => time,
    100,
  );
  const before = await catalog();
  failed = true;
  time = 101;
  const after = await catalog();
  assert.equal(after[0].state, 'stale');
  assert.equal(after[0].items[0].name, 'tool');
  assert.equal(after[0].checked, before[0].checked);
  assert.equal(after[1].state, 'empty');
});
test('cold source failure is explicit and recovers after cache expiry', async () => {
  let time = 0,
    failed = true;
  const catalog = createCatalog(
    [{ provider: 'npm', username: 'maker' }],
    async () => {
      if (failed) throw new Error('sensitive internal message');
      return [project];
    },
    () => time,
    100,
  );
  const result = await catalog();
  assert.equal(result[0].state, 'error');
  assert.ok(!result[0].message?.includes('sensitive'));
  failed = false;
  time = 101;
  assert.equal((await catalog())[0].state, 'ok');
});

test('partial package discovery retains successes, flags cached data, and recovers', async () => {
  let time = 0,
    failing = true,
    calls = 0;
  const names = Array.from({ length: 8 }, (_, i) => `package-${i}`);
  const catalog = createCatalog(
    [{ provider: 'python', username: 'maker' }],
    (account) =>
      loadProvider(account, async (url) => {
        if (String(url) === 'https://pypi.org/pypi') {
          calls++;
          return new Response(
            `<methodResponse><params>${names.map((name) => `<string>Owner</string><string>${name}</string>`).join('')}</params></methodResponse>`,
          );
        }
        const name = String(url).split('/').at(-2)!;
        if (failing && name === 'package-0') return new Response('', { status: 503 });
        return Response.json({ info: { name, version: '1' }, urls: [] });
      }),
    () => time,
    100,
  );
  const partial = (await catalog())[0];
  assert.equal(partial.state, 'degraded');
  assert.equal(partial.items.length, 7);
  assert.deepEqual(
    partial.items.map((p) => p.name),
    names.slice(1),
  );
  assert.equal((await catalog())[0].state, 'degraded');
  assert.equal(calls, 1);
  failing = false;
  time = 101;
  assert.equal((await catalog())[0].state, 'ok');
  assert.equal((await catalog())[0].items.length, 8);
  failing = true;
  time = 202;
  const warmPartial = (await catalog())[0];
  assert.equal(warmPartial.state, 'degraded');
  assert.equal(warmPartial.items.length, 8);
});
test('all failed package operations remain degraded instead of a successful empty listing', async () => {
  const catalog = createCatalog([{ provider: 'python', username: 'maker' }], async () => {
    throw new PartialProviderError([], ['failed-package']);
  });
  assert.equal((await catalog())[0].state, 'degraded');
});

test('partial refresh removes unowned packages and retains only failed owned packages', async () => {
  let time = 0;
  const catalog = createCatalog(
    [{ provider: 'python', username: 'maker' }],
    (account) =>
      loadProvider(account, async (url) => {
        if (String(url) === 'https://pypi.org/pypi') {
          const names =
            time === 0
              ? ['removed', 'failed_package', 'healthy']
              : ['failed-package', 'healthy', 'new-failure'];
          return new Response(
            `<methodResponse><params>${names.map((name) => `<string>Owner</string><string>${name}</string>`).join('')}</params></methodResponse>`,
          );
        }
        const name = String(url).split('/').at(-2)!;
        if (time > 0 && name !== 'healthy') return new Response('', { status: 404 });
        return Response.json({
          info: {
            name: name === 'failed_package' ? 'Failed.Package' : name,
            version: time === 0 ? '1' : '2',
          },
          urls: [],
        });
      }),
    () => time,
    100,
  );
  assert.equal((await catalog())[0].items.length, 3);
  time = 101;
  const refreshed = (await catalog())[0];
  assert.equal(refreshed.state, 'degraded');
  assert.deepEqual(
    refreshed.items.map((p) => [p.slug, p.version]),
    [
      ['healthy', '2'],
      ['Failed.Package', '1'],
    ],
  );
  assert.deepEqual((await catalog())[0], refreshed);
});

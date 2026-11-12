import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAccounts } from '../src/lib/accounts.ts';
import { loadProvider } from '../src/lib/providers.ts';
import { safeUrl, projectPath, decodeParam, type Account, type Project } from '../src/lib/types.ts';
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const account = (provider: Account['provider']): Account => ({ provider, username: 'maker' });
test('accounts supports multiple names, comments, CRLF, and case insensitive duplicates', () => {
  assert.deepEqual(
    parseAccounts('# hi\r\nvscode: maker\r\nvscode: other\nnpm: maker # note\nnpm: MAKER\n'),
    [account('vscode'), { provider: 'vscode', username: 'other' }, account('npm')],
  );
  assert.throws(() => parseAccounts('# comment\nnpm: maker\nconstructor: maker'), /line 3/);
  for (const text of ['github: ../bad', 'unknown: maker', 'python: <xml>', 'npm: abc:xyz'])
    assert.throws(() => parseAccounts(text), /line 1/);
});
test('untrusted URLs reject executable schemes and normalize protocol relative icons', () => {
  assert.equal(safeUrl('javascript:alert(1)'), undefined);
  assert.equal(safeUrl('data:image/svg+xml,abc'), undefined);
  assert.equal(safeUrl('//store.example/icon'), 'https://store.example/icon');
});
test('routes encode scoped npm packages and repository names', () => {
  const p = { source: 'npm', owner: 'maker', slug: '@scope/name' } as Project;
  assert.equal(projectPath(p), '/projects/npm/maker/%40scope%2Fname');
  assert.equal(projectPath({ ...p, source: 'github', slug: 'app' }), '/repositories/maker/app');
});
test('GitHub pagination preserves archive, fork, and repository metadata', async () => {
  let calls = 0;
  const f: typeof fetch = async () => {
    calls++;
    return reply(
      calls === 1
        ? Array.from({ length: 100 }, (_, i) => ({
            name: `repo-${i}`,
            owner: { login: 'maker', avatar_url: 'https://example.com/avatar' },
            html_url: 'https://github.com/maker/app',
            description: null,
            pushed_at: '2026-01-01',
            language: 'Rust',
            stargazers_count: 3,
            forks_count: 1,
            archived: i === 0,
            fork: false,
            topics: ['tool'],
            license: { spdx_id: 'MIT' },
          }))
        : [],
    );
  };
  const rows = await loadProvider(account('github'), f);
  assert.equal(calls, 2);
  assert.equal(rows.length, 100);
  assert.equal(rows[0].archived, true);
  assert.equal(rows[0].license, 'MIT');
});
test('VS Code keeps exact publisher matches and the provider icon', async () => {
  const ext = (publisher: string) => ({
    publisher: { publisherName: publisher },
    extensionName: 'theme',
    displayName: 'Theme',
    shortDescription: 'A theme',
    lastUpdated: '2026-01-01',
    versions: [
      {
        version: '1.0',
        files: [
          {
            assetType: 'Microsoft.VisualStudio.Services.Icons.Default',
            source: 'https://example.com/icon.png',
          },
        ],
      },
    ],
    statistics: [{ statisticName: 'install', value: 7 }],
  });
  const rows = await loadProvider(account('vscode'), async (_url, init) => {
    assert.equal(init?.method, 'POST');
    assert.deepEqual(JSON.parse(String(init?.body)), {
      filters: [
        {
          criteria: [
            { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
            { filterType: 18, value: 'maker' },
          ],
          pageNumber: 1,
          pageSize: 100,
        },
      ],
      flags: 914,
    });
    return reply({ results: [{ extensions: [ext('Maker'), ext('not-maker')] }] });
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].icon, 'https://example.com/icon.png');
  assert.equal(rows[0].downloads, 7);
});
test('Edge paginates and excludes fuzzy publisher matches', async () => {
  let calls = 0;
  const rows = await loadProvider(account('edge'), async (url) => {
    assert.ok(String(url).includes('filteredCategories=Edge-Extensions'));
    calls++;
    return reply({
      extensionList:
        calls === 1
          ? [
              {
                developerName: 'maker',
                name: 'Exporter',
                crxId: 'abc',
                logoUrl: '//example.com/icon',
                shortDescription: 'Export',
                activeInstallCount: 4,
              },
              { developerName: 'someone', name: 'No', crxId: 'bad' },
            ]
          : [],
      hasMorePages: calls === 1,
    });
  });
  assert.equal(calls, 2);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].icon, 'https://example.com/icon');
});
test('npm validates maintainer and supports scoped packages', async () => {
  const pack = (username: string) => ({
    package: {
      name: '@scope/tool',
      version: '2.0',
      description: 'Tool',
      date: '2026-01-01',
      maintainers: [{ username }],
      links: { npm: 'https://www.npmjs.com/package/@scope/tool' },
    },
  });
  const rows = await loadProvider(account('npm'), async () =>
    reply({ total: 2, objects: [pack('maker'), pack('other')] }),
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].version, '2.0');
});
test('crates.io resolves account ID before requesting crates', async () => {
  let calls = 0;
  const rows = await loadProvider(account('rust'), async (url) => {
    calls++;
    if (calls === 1) return reply({ user: { id: 42 } });
    assert.ok(String(url).includes('user_id=42'));
    return reply({
      crates: [
        {
          id: 'tool',
          description: 'A crate',
          max_stable_version: '1.0',
          updated_at: '2026-01-01',
          downloads: 100,
        },
      ],
      meta: { total: 1 },
    });
  });
  assert.equal(rows[0].downloads, 100);
});
test('PyPI uses user_packages ownership discovery and fetches project metadata', async () => {
  const rows = await loadProvider(account('python'), async (url, init) => {
    if (String(url) === 'https://pypi.org/pypi') {
      assert.ok(String(init?.body).includes('user_packages'));
      return new Response(
        '<methodResponse><params><param><value><array><data><value><array><data><value><string>Owner</string></value><value><string>my-tool</string></value></data></array></value></data></array></value></param></params></methodResponse>',
      );
    }
    return reply({
      info: {
        name: 'my-tool',
        summary: 'Useful',
        version: '3',
        project_url: 'https://pypi.org/project/my-tool/',
      },
      urls: [{ upload_time_iso_8601: '2026-01-01' }],
    });
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'my-tool');
});
test('blocked sources fail explicitly rather than presenting an empty list', async () => {
  await assert.rejects(
    loadProvider(account('github'), async () => reply({}, 429)),
    /rate limited/,
  );
  await assert.rejects(
    loadProvider(account('rust'), async () => reply({}, 404)),
    /not found/,
  );
  await assert.rejects(
    loadProvider(account('python'), async () => new Response('<html>challenge</html>')),
    /Unexpected PyPI/,
  );
});
test('transient upstream gateway failure retries once', async () => {
  let calls = 0;
  const rows = await loadProvider(account('github'), async () =>
    ++calls === 1 ? reply({}, 503) : reply([]),
  );
  assert.equal(rows.length, 0);
  assert.equal(calls, 2);
});

test('encoded scoped route parameters decode safely', () => {
  assert.equal(decodeParam('%40scope%2Ftool'), '@scope/tool');
  assert.equal(decodeParam('@scope/tool'), '@scope/tool');
  assert.equal(decodeParam('%E0%A4'), undefined);
});

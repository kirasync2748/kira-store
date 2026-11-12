import { XMLParser } from 'fast-xml-parser';
import { safeUrl, type Account, type Project } from './types.ts';
export type Fetcher = typeof fetch;
const ua = 'KiraStore/1.0 (public project catalog; https://github.com/kirasync2748)';
export class ProviderError extends Error {}
export class PartialProviderError extends ProviderError {
  items: Project[];
  failedPackages: string[];
  constructor(items: Project[], failedPackages: string[]) {
    super('Some package requests failed. This listing may be incomplete.');
    this.items = items;
    this.failedPackages = failedPackages;
  }
}
export const normalizePyPiName = (name: string) => name.toLowerCase().replace(/[-_.]+/g, '-');
async function request(url: string, fetcher: Fetcher, init: RequestInit = {}) {
  const options = {
    ...init,
    headers: { 'User-Agent': ua, ...init.headers },
    signal: AbortSignal.any([
      init.signal || AbortSignal.timeout(25000),
      AbortSignal.timeout(10000),
    ]),
  };
  let response = await fetcher(url, options);
  // A single retry covers transient upstream gateway failures; never retry rate limits.
  if ([502, 503, 504].includes(response.status)) {
    await response.body?.cancel();
    response = await fetcher(url, options);
  }
  if (!response.ok)
    throw new ProviderError(
      response.status === 404
        ? 'Public account or listing not found.'
        : response.status === 429 || response.status === 403
          ? 'Source rate limited or temporarily restricted.'
          : `Source returned HTTP ${response.status}.`,
    );
  return response;
}
const json = async <T>(url: string, f: Fetcher, init?: RequestInit): Promise<T> =>
  (await request(url, f, init)).json() as Promise<T>;
async function mapLimit<T, U>(
  items: T[],
  fn: (x: T) => Promise<U>,
): Promise<PromiseSettledResult<U>[]> {
  const results = new Array<PromiseSettledResult<U>>(items.length);
  let index = 0;
  await Promise.all(
    Array.from({ length: Math.min(5, items.length) }, async () => {
      while (index < items.length) {
        const i = index++;
        try {
          results[i] = { status: 'fulfilled', value: await fn(items[i]) };
        } catch (reason) {
          results[i] = { status: 'rejected', reason };
        }
      }
    }),
  );
  return results;
}
const base = (a: Account, slug: string): Project => ({
  id: `${a.provider}:${a.username.toLowerCase()}:${slug}`,
  source: a.provider,
  owner: a.username,
  slug,
  name: slug,
  description: '',
  url: '',
});
interface Repo {
  name: string;
  owner: { login: string; avatar_url: string };
  description: string | null;
  html_url: string;
  homepage?: string;
  pushed_at: string;
  language?: string;
  stargazers_count: number;
  forks_count: number;
  archived: boolean;
  fork: boolean;
  topics: string[];
  license?: { spdx_id: string };
}
interface Extension {
  publisher: { publisherName: string };
  extensionName: string;
  displayName: string;
  shortDescription: string;
  lastUpdated: string;
  versions: { version: string; files?: { assetType: string; source: string }[] }[];
  statistics?: { statisticName: string; value: number }[];
}
export async function loadProvider(
  a: Account,
  f: Fetcher = fetch,
  token?: string,
): Promise<Project[]> {
  const deadline = AbortSignal.timeout(25000);
  const underlying = f;
  f = (input, init = {}) =>
    underlying(input, {
      ...init,
      signal: AbortSignal.any([deadline, ...(init.signal ? [init.signal] : [])]),
    });
  const user = encodeURIComponent(a.username),
    items: Project[] = [];
  if (a.provider === 'github') {
    for (let page = 1; page <= 100; page++) {
      const rows = await json<Repo[]>(
        `https://api.github.com/users/${user}/repos?per_page=100&page=${page}&sort=pushed&type=owner`,
        f,
        {
          headers: {
            Accept: 'application/vnd.github+json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
        },
      );
      for (const r of rows)
        items.push({
          ...base(a, r.name),
          name: r.name,
          description: r.description || 'No description provided.',
          url: r.html_url,
          icon: safeUrl(r.owner.avatar_url),
          homepage: safeUrl(r.homepage),
          updated: r.pushed_at,
          language: r.language,
          stars: r.stargazers_count,
          forks: r.forks_count,
          archived: r.archived,
          fork: r.fork,
          topics: r.topics,
          license: r.license?.spdx_id,
        });
      if (rows.length < 100) return items;
    }
  } else if (a.provider === 'vscode') {
    for (let page = 1; page <= 100; page++) {
      const r = await json<{
        results: {
          extensions?: Extension[];
          resultMetadata?: {
            metadataType: string;
            metadataItems: { name: string; count: number }[];
          }[];
        }[];
      }>('https://marketplace.visualstudio.com/_apis/public/gallery/extensionquery', f, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json;api-version=7.2-preview.1',
        },
        body: JSON.stringify({
          filters: [
            {
              criteria: [
                { filterType: 8, value: 'Microsoft.VisualStudio.Code' },
                { filterType: 18, value: a.username },
              ],
              pageNumber: page,
              pageSize: 100,
            },
          ],
          flags: 914,
        }),
      });
      const rows = r.results[0]?.extensions;
      if (!rows) throw new ProviderError('Unexpected marketplace response.');
      for (const e of rows.filter(
        (e) => e.publisher.publisherName.toLowerCase() === a.username.toLowerCase(),
      ))
        items.push({
          ...base(a, e.extensionName),
          name: e.displayName,
          description: e.shortDescription,
          url: `https://marketplace.visualstudio.com/items?itemName=${encodeURIComponent(e.publisher.publisherName + '.' + e.extensionName)}`,
          icon: safeUrl(
            e.versions[0]?.files?.find(
              (x) => x.assetType === 'Microsoft.VisualStudio.Services.Icons.Default',
            )?.source,
          ),
          version: e.versions[0]?.version,
          updated: e.lastUpdated,
          downloads: e.statistics?.find((x) => x.statisticName === 'install')?.value,
        });
      if (rows.length < 100) return items;
    }
  } else if (a.provider === 'edge') {
    for (let page = 1; page <= 100; page++) {
      const r = await json<{
        extensionList: {
          name: string;
          crxId: string;
          developerName: string;
          shortDescription: string;
          logoUrl: string;
          activeInstallCount?: number;
        }[];
        hasMorePages: boolean;
      }>(
        `https://microsoftedge.microsoft.com/addons/searchbypublishername?publisherName=${user}&pgNo=${page}&filteredCategories=Edge-Extensions&hl=en-US&gl=US`,
        f,
      );
      if (!Array.isArray(r.extensionList)) throw new ProviderError('Unexpected Edge response.');
      for (const e of r.extensionList.filter(
        (e) => e.developerName.toLowerCase() === a.username.toLowerCase(),
      ))
        items.push({
          ...base(a, e.crxId),
          name: e.name,
          description: e.shortDescription,
          url: `https://microsoftedge.microsoft.com/addons/detail/${encodeURIComponent(e.crxId)}`,
          icon: safeUrl(e.logoUrl),
          downloads: e.activeInstallCount,
        });
      if (!r.hasMorePages) return items;
    }
  } else if (a.provider === 'npm') {
    for (let from = 0; from < 25000; from += 250) {
      const r = await json<{
        total: number;
        objects: {
          package: {
            name: string;
            description?: string;
            version: string;
            date: string;
            maintainers?: { username: string }[];
            links: { npm: string };
          };
        }[];
      }>(`https://registry.npmjs.org/-/v1/search?text=maintainer:${user}&size=250&from=${from}`, f);
      for (const { package: p } of r.objects.filter((x) =>
        x.package.maintainers?.some((m) => m.username.toLowerCase() === a.username.toLowerCase()),
      ))
        items.push({
          ...base(a, p.name),
          description: p.description || 'No description provided.',
          version: p.version,
          updated: p.date,
          url:
            safeUrl(p.links.npm) || `https://www.npmjs.com/package/${encodeURIComponent(p.name)}`,
        });
      if (from + r.objects.length >= r.total || r.objects.length === 0) return items;
    }
  } else if (a.provider === 'rust') {
    const u = await json<{ user: { id: number } }>(`https://crates.io/api/v1/users/${user}`, f);
    for (let page = 1; page <= 100; page++) {
      const r = await json<{
        crates: {
          id: string;
          description: string;
          max_stable_version: string;
          updated_at: string;
          downloads: number;
          repository?: string;
        }[];
        meta: { total: number };
      }>(`https://crates.io/api/v1/crates?user_id=${u.user.id}&page=${page}&per_page=100`, f);
      for (const c of r.crates)
        items.push({
          ...base(a, c.id),
          description: c.description || 'No description provided.',
          version: c.max_stable_version,
          updated: c.updated_at,
          downloads: c.downloads,
          url: `https://crates.io/crates/${encodeURIComponent(c.id)}`,
          homepage: safeUrl(c.repository),
        });
      if (items.length >= r.meta.total || r.crates.length === 0) return items;
    }
  } else {
    // PyPI still supports user_packages even though search/list_packages are retired.
    const response = await request('https://pypi.org/pypi', f, {
      method: 'POST',
      headers: { 'Content-Type': 'text/xml' },
      body: `<methodCall><methodName>user_packages</methodName><params><param><value><string>${a.username}</string></value></param></params></methodCall>`,
    });
    const xml = await response.text();
    const parsed = new XMLParser({ ignoreAttributes: true, processEntities: false }).parse(xml);
    if (parsed.methodResponse?.fault) throw new ProviderError('PyPI could not list this account.');
    // Each row has two strings: role and package name. Names contain no XML entities.
    if (!xml.includes('<methodResponse>') || !parsed.methodResponse?.params)
      throw new ProviderError('Unexpected PyPI response.');
    const names = [...xml.matchAll(/<string>([^<]+)<\/string>/g)]
      .map((m) => m[1])
      .filter((_, i) => i % 2 === 1);
    const packages = [...new Set(names)];
    const outcomes = await mapLimit(packages, async (name) => {
      const p = await json<{
        info: {
          name: string;
          summary: string;
          version: string;
          license: string;
          project_url: string;
        };
        urls: { upload_time_iso_8601: string }[];
      }>(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`, f);
      return {
        ...base(a, p.info.name),
        description: p.info.summary || 'No description provided.',
        version: p.info.version,
        license: p.info.license || undefined,
        url: safeUrl(p.info.project_url) || `https://pypi.org/project/${encodeURIComponent(name)}/`,
        updated: p.urls[0]?.upload_time_iso_8601,
      };
    });
    const successful = outcomes.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const failedPackages = packages.filter((_, i) => outcomes[i].status === 'rejected');
    if (failedPackages.length) throw new PartialProviderError(successful, failedPackages);
    return successful;
  }
  throw new ProviderError('Source pagination limit reached; listing could not be completed.');
}

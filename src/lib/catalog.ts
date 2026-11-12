import { getSecret } from 'astro:env/server';
import text from '../../accounts.txt?raw';
import { parseAccounts } from './accounts.ts';
import { loadProvider } from './providers.ts';
import { createCatalog } from './cache.ts';
export const accounts = parseAccounts(text);
export const catalog = createCatalog(accounts, (a) =>
  loadProvider(a, fetch, getSecret('GITHUB_TOKEN')),
);
export async function allProjects() {
  const sources = await catalog();
  // A package maintained by both accounts is shown once; retain the first configured owner.
  const seen = new Set<string>();
  const items = sources
    .flatMap((r) => r.items)
    .filter((p) => {
      const key = `${p.source}:${p.source === 'github' ? p.owner.toLowerCase() + '/' : ''}${p.slug.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  return {
    sources,
    items: items.sort(
      (a, b) => (b.updated || '').localeCompare(a.updated || '') || a.name.localeCompare(b.name),
    ),
  };
}

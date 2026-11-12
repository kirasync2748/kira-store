import { normalizePyPiName, PartialProviderError, ProviderError } from './providers.ts';
import type { Account, Project, SourceResult } from './types.ts';
export function createCatalog(
  accounts: Account[],
  load: (account: Account) => Promise<Project[]>,
  now = Date.now,
  ttl = 300_000,
) {
  let cached: { results: SourceResult[]; expires: number } | undefined;
  let pending: Promise<SourceResult[]> | undefined;
  return async function catalog(): Promise<SourceResult[]> {
    if (cached && cached.expires > now()) return cached.results;
    if (pending) return pending;
    pending = Promise.all(
      accounts.map(async (a) => {
        const checked = new Date(now()).toISOString();
        try {
          const items = await load(a);
          return { ...a, checked, items, state: items.length ? 'ok' : 'empty' } as SourceResult;
        } catch (error) {
          const old = cached?.results.find(
            (r) => r.provider === a.provider && r.username === a.username,
          );
          if (error instanceof PartialProviderError) {
            const failedPackages = new Set(error.failedPackages.map(normalizePyPiName));
            const freshIds = new Set(error.items.map((p) => p.id));
            return {
              ...a,
              checked,
              items: [
                ...error.items,
                ...(old?.items.filter(
                  (p) => !freshIds.has(p.id) && failedPackages.has(normalizePyPiName(p.slug)),
                ) || []),
              ],
              state: 'degraded',
              message: error.message,
            } as SourceResult;
          }
          return {
            ...a,
            checked: old?.items.length ? old.checked : checked,
            items: old?.items || [],
            state: old?.items.length ? 'stale' : 'error',
            message:
              error instanceof ProviderError
                ? error.message
                : 'Source temporarily unavailable. Please try again later.',
          } as SourceResult;
        }
      }),
    )
      .then((results) => {
        cached = { results, expires: now() + ttl };
        return results;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}

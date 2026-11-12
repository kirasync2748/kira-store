import { labels, type Account, type Provider } from './types.ts';
export function parseAccounts(text: string): Account[] {
  const seen = new Set<string>();
  return text.split(/\r?\n/).flatMap((line, i) => {
    line = line.replace(/#.*/, '').trim();
    if (!line) return [];
    const match = /^([a-z]+)\s*:\s*([a-zA-Z0-9][a-zA-Z0-9_.-]{0,99})$/.exec(line);
    if (!match || !Object.hasOwn(labels, match[1]))
      throw new Error(`Invalid accounts.txt entry at line ${i + 1}`);
    const provider = match[1] as Provider,
      username = match[2];
    const key = `${provider}:${username.toLowerCase()}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ provider, username }];
  });
}

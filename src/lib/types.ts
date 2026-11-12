export const labels = {
  vscode: 'VS Code',
  edge: 'Edge Add-ons',
  npm: 'npm',
  rust: 'Rust crates',
  python: 'PyPI',
  github: 'GitHub',
} as const;
export type Provider = keyof typeof labels;
export type Account = { provider: Provider; username: string };
export interface Project {
  id: string;
  source: Provider;
  owner: string;
  slug: string;
  name: string;
  description: string;
  url: string;
  icon?: string;
  version?: string;
  updated?: string;
  language?: string;
  stars?: number;
  forks?: number;
  downloads?: number;
  license?: string;
  archived?: boolean;
  fork?: boolean;
  topics?: string[];
  homepage?: string;
}
export interface SourceResult extends Account {
  state: 'ok' | 'empty' | 'error' | 'stale' | 'degraded';
  message?: string;
  checked: string;
  items: Project[];
}
export function projectPath(p: Project) {
  return `/${p.source === 'github' ? 'repositories' : 'projects'}/${p.source === 'github' ? '' : p.source + '/'}${encodeURIComponent(p.owner)}/${encodeURIComponent(p.slug)}`;
}
export function safeUrl(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value) return undefined;
  try {
    const u = new URL(value.startsWith('//') ? `https:${value}` : value);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.href : undefined;
  } catch {
    return undefined;
  }
}
export const number = (value?: number) =>
  value == null
    ? '—'
    : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
export const date = (value?: string) =>
  value && Number.isFinite(Date.parse(value))
    ? new Intl.DateTimeFormat('en', { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(value),
      )
    : 'Not provided';

export function decodeParam(value: string | undefined): string | undefined {
  try {
    return value === undefined ? undefined : decodeURIComponent(value);
  } catch {
    return undefined;
  }
}

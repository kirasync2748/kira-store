import type { APIRoute } from 'astro';
import { allProjects } from '../lib/catalog';
import { projectPath } from '../lib/types';
export const GET: APIRoute = async ({ url }) => {
  const { items } = await allProjects();
  const base = import.meta.env.SITE_URL || url.origin;
  const escape = (s: string) =>
    s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
  return new Response(
    `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${['/', '/projects', '/repositories', '/about', '/privacy', ...items.map(projectPath)].map((p) => `<url><loc>${escape(new URL(p, base).href)}</loc></url>`).join('')}</urlset>`,
    { headers: { 'Content-Type': 'application/xml; charset=utf-8' } },
  );
};

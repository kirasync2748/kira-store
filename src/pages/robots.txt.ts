import type { APIRoute } from 'astro';
export const GET: APIRoute = ({ url }) =>
  new Response(
    `User-agent: *\nAllow: /\nDisallow: /500\nDisallow: /status\nSitemap: ${import.meta.env.SITE_URL || url.origin}/sitemap.xml\n`,
    { headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
  );

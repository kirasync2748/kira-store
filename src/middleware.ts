import { defineMiddleware } from 'astro:middleware';
export const onRequest = defineMiddleware(async (context, next) => {
  let response: Response;
  try {
    response = await next();
  } catch (error) {
    console.error('Page rendering failed', error instanceof Error ? error.name : 'UnknownError');
    if (context.url.pathname === '/500')
      return new Response('Service unavailable', { status: 500 });
    response = await context.rewrite('/500');
  }
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  response.headers.set(
    'Cache-Control',
    response.status === 200
      ? 'public, max-age=0, s-maxage=300, stale-while-revalidate=60'
      : 'no-store',
  );
  return response;
});

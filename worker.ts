import handler from 'vinext/server/fetch-handler';
import { canonicalRedirect, newsletterPaths, staticContentType } from './lib/site-routing.mjs';

export default {
  async fetch(request: Request, env: any, context: ExecutionContext) {
    const url = new URL(request.url);
    const canonical = canonicalRedirect(request.url);
    if (canonical) return Response.redirect(canonical, 308);
    // Keep the independently maintained newsletter at its existing paths.
    // Never forward POS cookies, authorization, or request bodies upstream.
    if (['www.philemon.com.tw', 'philemon.com.tw'].includes(url.hostname) &&
        !/^\/pos(?:\/|$)/.test(url.pathname) && !/^\/[a-zA-Z]{2}[0-9]{2}\/?$/.test(url.pathname)) {
      if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
      for (const path of newsletterPaths(url.pathname)) {
        const source = new URL('https://raw.githubusercontent.com/philemon86/philemon202603-news/master' + path);
        const result = await fetch(source, { cf: { cacheTtl: 300, cacheEverything: true } } as any);
        if (result.status === 404) continue;
        if (!result.ok) return new Response('頁面暫時無法載入', { status: 502 });
        return new Response(request.method === 'HEAD' ? null : result.body, {
          headers: { 'Content-Type': staticContentType(path), 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' },
        });
      }
      return new Response('找不到頁面', { status: 404 });
    }
    if (url.pathname === '/pos') {
      url.pathname = '/pos/';
      return Response.redirect(url.toString(), 308);
    }
    const response = await handler.fetch(request, env, context);
    // Revalidate the app entry instead of reusing a document pointing at an old build.
    // Fingerprinted framework assets still use the static asset cache.
    if (response.headers.get('Content-Type')?.includes('text/html')) {
      const fresh = new Response(response.body, response);
      fresh.headers.set('Cache-Control', 'no-store');
      return fresh;
    }
    return response;
  },
};

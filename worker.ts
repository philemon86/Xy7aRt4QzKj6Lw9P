import handler from 'vinext/server/fetch-handler';

export default {
  async fetch(request: Request, env: any, context: ExecutionContext) {
    const url = new URL(request.url);
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

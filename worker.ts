import handler from 'vinext/server/fetch-handler';

export default {
  async fetch(request: Request, env: any, context: ExecutionContext) {
    const url = new URL(request.url);
    if (url.pathname === '/pos') {
      url.pathname = '/pos/';
      return Response.redirect(url.toString(), 308);
    }
    return handler.fetch(request, env, context);
  },
};

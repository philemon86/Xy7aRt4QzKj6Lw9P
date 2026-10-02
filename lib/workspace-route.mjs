const views = new Set(['checkout', 'history', 'stock', 'calculator']);

// The URL remembers the screen, never grants access. Restore only a fair in
// the authenticated bootstrap response, before mounting its register.
export function readWorkspaceRoute(href, events, me) {
  const url = new URL(href);
  const event = events.find((e) => e.id === url.searchParams.get('event'));
  if (!event || (me.role === 'church' && event.tenant !== me.tenant)) return null;
  const requested = url.searchParams.get('view');
  const view = requested && views.has(requested) ? requested : 'checkout';
  return {
    event,
    view: me.role === 'admin' && event.organizer === 'church' && view === 'checkout'
      ? 'history' : view,
  };
}

export function workspaceRouteHref(href, eventId, view = 'checkout') {
  const url = new URL(href);
  if (eventId) {
    url.searchParams.set('event', eventId);
    url.searchParams.set('view', views.has(view) ? view : 'checkout');
  } else {
    url.searchParams.delete('event');
    url.searchParams.delete('view');
  }
  return url.pathname + url.search + url.hash;
}

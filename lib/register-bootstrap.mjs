// Match the preload to its own event, independent of React render timing.
// A missing/stale preload falls back to the authenticated event API.
export async function loadRegisterBootstrap(
  eventId,
  prepared,
  context,
  request,
) {
  if (typeof eventId !== 'string' || !eventId) throw Error('缺少書展場次');
  const [event, catalog, me] = await Promise.all([
    prepared?.id === eventId
      ? prepared.record
      : request('events/' + encodeURIComponent(eventId)),
    context.catalog || request('catalog'),
    context.me || request('me'),
  ]);
  if (event?.id !== eventId || !catalog || !me)
    throw Error('收銀台資料尚未完整，請重試');
  return { event, catalog, me };
}

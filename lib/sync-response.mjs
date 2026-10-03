// A matching revision already has all unchanged data. Stale clients receive
// the full state so another cashier's changes can never disappear locally.
export function syncStateResponse(
  state,
  changes,
  currentRevision,
  knownRevision,
) {
  if (!Number.isSafeInteger(knownRevision) || knownRevision !== currentRevision)
    return { state };
  return {
    patches: changes.map(({ key }) => ({ key, after: state[key] ?? null })),
  };
}

// A default marker holds no credential. The shared initial password stays in
// the hosting secret store; setting an individual password replaces the marker.
export const DEFAULT_CHURCH_PASSWORD = '@default';
export function churchPasswordHash(church, defaultHash) {
  if (!church || church.enabled !== 1) return undefined;
  return church.password === DEFAULT_CHURCH_PASSWORD
    ? defaultHash || undefined
    : church.password;
}

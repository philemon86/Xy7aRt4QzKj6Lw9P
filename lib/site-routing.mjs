export const CANONICAL_HOST = 'www.philemon.com.tw';
export function canonicalRedirect(href) {
  const url = new URL(href);
  if (url.hostname !== 'philemon.com.tw' && url.hostname !== CANONICAL_HOST) return null;
  if (url.hostname === CANONICAL_HOST && url.protocol === 'https:') return null;
  url.hostname = CANONICAL_HOST;
  url.protocol = 'https:';
  url.port = '';
  return url.href;
}
export function newsletterPaths(pathname) {
  const path = decodeURIComponent(pathname);
  if (path.split('/').some(part => part.startsWith('.') || part === '..') || /[\\\x00-\x1f]/.test(path)) return [];
  if (path.endsWith('/')) return [path + 'index.html'];
  if (/\.[a-z0-9]+$/i.test(path)) return [path];
  return [path + '/index.html', path + '.html'];
}
export function staticContentType(path) {
  const extension = path.split('.').pop().toLowerCase();
  return ({ html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8', mjs: 'text/javascript; charset=utf-8', json: 'application/json; charset=utf-8', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', avif: 'image/avif', gif: 'image/gif', ico: 'image/x-icon', pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', xml: 'application/xml', woff: 'font/woff', woff2: 'font/woff2', mp3: 'audio/mpeg', mp4: 'video/mp4' })[extension] || 'application/octet-stream';
}

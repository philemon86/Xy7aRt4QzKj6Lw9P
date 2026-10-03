import type { Metadata } from 'next';
import { POS_BASE } from './paths';

export type POSAudience = 'bookstore' | 'church';

export function portalIcons(audience: POSAudience): Metadata['icons'] {
  const base = `${POS_BASE}/favicon-${audience}`;
  return {
    icon: [
      { url: `${base}-32.png`, type: 'image/png', sizes: '32x32' },
      { url: `${base}-64.png`, type: 'image/png', sizes: '64x64' },
      { url: `${base}.svg`, type: 'image/svg+xml', sizes: 'any' },
    ],
    shortcut: `${base}-32.png`,
  };
}

export function setPOSFavicon(audience: POSAudience) {
  const base = `${POS_BASE}/favicon-${audience}`;
  document.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="shortcut icon"]')
    .forEach((link) => {
      link.href = link.type === 'image/svg+xml'
        ? `${base}.svg`
        : `${base}-${link.sizes.value === '64x64' ? 64 : 32}.png`;
    });
}

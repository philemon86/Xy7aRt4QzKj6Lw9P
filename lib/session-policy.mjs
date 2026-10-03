export const SESSION_TTL = 8 * 3600000;
export function shouldRenewSession(expires, now) {
  return Number(expires) > now && Number(expires) - now < SESSION_TTL - 3600000;
}
export function sessionCookie(portal, token, secure) {
  return `pos_session_${portal || 'admin'}=${token}; Path=/pos; HttpOnly; SameSite=Strict; Max-Age=${SESSION_TTL / 1000}${secure ? '; Secure' : ''}`;
}

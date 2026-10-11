export const isPilotRequest = (path) => /^events\/[^/]+\/pilot-(preview|confirm)$/.test(path);
export function requestTimeout(path, body) {
  if (isPilotRequest(path)) return 60000;
  return body === undefined || path === 'session-renew' ? 2500 : 12000;
}
export function requestFailure(error, path) {
  if (isPilotRequest(path) && error?.name === 'TimeoutError')
    return Object.assign(Error('匯出處理逾時，請重新產生預覽再下載；原始交易仍保留。'), { status: 408, exportTimeout: true });
  return error;
}

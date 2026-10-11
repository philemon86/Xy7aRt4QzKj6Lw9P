export const isPilotRequest = (path) => /^events\/[^/]+\/pilot-(preview|confirm|download)$/.test(path);
export function requestTimeout(path, body) {
  if (isPilotRequest(path)) return 60000;
  return body === undefined || path === 'session-renew' ? 2500 : 12000;
}
export function requestFailure(error, path) {
  if (isPilotRequest(path) && error?.name === 'TimeoutError')
    return Object.assign(Error(path.endsWith('/pilot-download') ? '讀取已保存 CSV 逾時，請再次下載；原檔案仍保存，不需重新匯出。' : '匯出處理逾時，請重新產生預覽再下載；原始交易仍保留。'), { status: 408, exportTimeout: true });
  return error;
}

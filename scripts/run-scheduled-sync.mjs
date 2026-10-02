// Service credentials are supplied through stdin, never files, URLs or shell arguments.
import fs from 'node:fs';
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const endpoint = new URL('/pos/api/scheduled-sync', input.url);
if (
  !endpoint.hostname.endsWith('.chatgpt.site') &&
  endpoint.hostname !== 'www.philemon.com.tw'
)
  throw Error('不支援的同步站點');
const headers = {
  'X-POS-Sync-Key': input.token,
  'OAI-Sites-Authorization': 'Bearer ' + input.token,
};
let status;
for (let i = 0; i < 1500; i++) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers,
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw Error('同步請求失敗 HTTP ' + r.status);
  status = await r.json();
  if (i % 10 === 0 || status.finished) console.log(JSON.stringify(status));
  if (status.finished && !status.busy) break;
  await new Promise((resolve) => setTimeout(resolve, status.busy ? 2000 : 200));
}
const readback = await fetch(endpoint, {
  headers,
  signal: AbortSignal.timeout(15000),
});
if (!readback.ok) throw Error('同步讀回失敗 HTTP ' + readback.status);
const saved = await readback.json();
if (!saved.finished) throw Error('同步尚未完成，下次從游標接續');
console.log(JSON.stringify({ saved: true, ...saved }));

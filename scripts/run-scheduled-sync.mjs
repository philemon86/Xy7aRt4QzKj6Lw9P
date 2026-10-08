// Service credentials are supplied through stdin, never files, URLs or shell arguments.
// Raw input prevents the terminal from echoing the service credential.
if (process.stdin.isTTY) process.stdin.setRawMode(true);
console.log('Ready for sync JSON on stdin (input is hidden).');
const input = JSON.parse(
  await new Promise((resolve, reject) => {
    let buffer = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 30000) reject(Error('同步輸入太長'));
      if (buffer.includes('\n') || buffer.includes('\r')) {
        if (process.stdin.isTTY) process.stdin.setRawMode(false);
        process.stdin.pause();
        resolve(buffer.split(/[\r\n]/)[0]);
      }
    });
    process.stdin.once('end', () => reject(Error('缺少同步輸入')));
    process.stdin.resume();
  }),
);
const endpoint = new URL('/pos/api/scheduled-sync', input.url);
if (
  !endpoint.hostname.endsWith('.chatgpt.site') &&
  endpoint.hostname !== 'www.philemon.com.tw'
)
  throw Error('不支援的同步站點');
const headers = {
  'Content-Type': 'application/json',
  'X-POS-Sync-Key': input.token,
  'OAI-Sites-Authorization': 'Bearer ' + input.token,
};
let status;
let restart = input.restart === true;
for (let i = 0; i < 1500; i++) {
  const r = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify({ restart, repair: input.repair === true }),
    signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw Error('同步請求失敗 HTTP ' + r.status);
  status = await r.json();
  if (input.repair === true) {
    console.log(JSON.stringify({ repair: true, ...status }));
    break;
  }
  if (!status.busy) restart = false;
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

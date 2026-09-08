import { env } from 'cloudflare:workers';
import eriHistory from '../data/pilot-eri-history.json';
import {
  preparePilotSources,
  finalizePilotExport,
  collectEris,
  exportContext,
} from './pilot-finalize.mjs';
const db = () => env.DB;
export const sourceOrders = (state: any) =>
  Object.fromEntries(
    Object.entries(state)
      .filter(([key]) => key.startsWith('order:'))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => [key.slice(6), value]),
  );
const digest = async (value: any) =>
  Array.from(
    new Uint8Array(
      await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(JSON.stringify(value)),
      ),
    ),
    (x) => x.toString(16).padStart(2, '0'),
  ).join('');
const fail = (message: string) =>
  Object.assign(Error(message), { status: 409 });
async function historicalEris() {
  const used = new Set<string>(eriHistory.eris);
  for (const table of ['events', 'audit'])
    for (let offset = 0; ; offset += 8) {
      const rows = await db()
        .prepare(`SELECT state FROM ${table} ORDER BY id LIMIT 8 OFFSET ?`)
        .bind(offset)
        .all<any>();
      for (const row of rows.results)
        for (const eri of collectEris(row.state)) used.add(eri);
      if (rows.results.length < 8) break;
    }
  for (let offset = 0; ; offset += 1000) {
    const allocated = await db()
      .prepare('SELECT eri FROM pilot_eris ORDER BY eri LIMIT 1000 OFFSET ?')
      .bind(offset)
      .all<any>();
    for (const row of allocated.results) used.add(row.eri);
    if (allocated.results.length < 1000) break;
  }
  return used;
}
export async function previewPilot(
  event: any,
  catalog: any,
  input: any,
  numbers: any,
) {
  const context = exportContext(input),
    clients = sourceOrders(JSON.parse(event.state));
  const sourceHash = await digest(clients);
  const prepared = preparePilotSources({
    clients,
    products: Object.fromEntries(catalog.products.map((p: any) => [p.code, p])),
    customerMap: Object.fromEntries(
      catalog.customers.map((c: any) => [c.code, c]),
    ),
    unitMap: catalog.units,
    context,
  });
  const used = await historicalEris();
  const total = prepared.batches.reduce(
    (n: number, b: any) =>
      n +
      Object.values(b.result.rows).reduce(
        (s: number, rows: any) => s + rows.length - 1,
        0,
      ),
    0,
  );
  const count = total + used.size + 1;
  await db()
    .prepare("INSERT OR IGNORE INTO settings(key,value) VALUES('eri','0')")
    .run();
  const range: any = await db()
    .prepare(
      "UPDATE settings SET value=CAST(value AS INTEGER)+? WHERE key='eri' AND CAST(value AS INTEGER)+? < 2176782336 RETURNING value",
    )
    .bind(count, count)
    .first();
  if (!range) throw Error('ERI 序號已用完');
  let sequence = Number(range.value) - count;
  const snapshot = finalizePilotExport(prepared, {
    usedEris: used,
    numbers,
    generateERI: (type: string) =>
      ({ master: '0H5', detail: '0H8', pay: '01E' })[type] +
      '0010LU0' +
      (++sequence).toString(36).toUpperCase().padStart(6, '0'),
  });
  const id = crypto.randomUUID(),
    created = new Date().toISOString();
  const ledger = snapshot.newEris.map((eri: string) =>
    db()
      .prepare('INSERT INTO pilot_eris(eri,export_id) VALUES(?,?)')
      .bind(eri, id),
  );
  for (let n = 0; n < ledger.length; n += 80)
    await db().batch(ledger.slice(n, n + 80));
  const serialized = JSON.stringify(snapshot);
  let part = 0;
  // Bounded rows keep larger CSV snapshots below D1's per-value limit.
  for (let start = 0; start < serialized.length;) {
    let end = Math.min(start + 100000, serialized.length);
    if (end < serialized.length && /[\uD800-\uDBFF]/.test(serialized[end - 1]))
      end--;
    await db()
      .prepare(
        'INSERT INTO pilot_export_parts(export_id,part,data) VALUES(?,?,?)',
      )
      .bind(id, part++, serialized.slice(start, end))
      .run();
    start = end;
  }
  await db()
    .prepare(
      'INSERT INTO pilot_exports(id,event,source_hash,context,snapshot,created) VALUES(?,?,?,?,?,?)',
    )
    .bind(
      id,
      event.id,
      sourceHash,
      JSON.stringify(context),
      JSON.stringify({ parts: part }),
      created,
    )
    .run();
  return {
    id,
    context,
    preview: snapshot.preview,
    counts: {
      masters: snapshot.rows.stkSale1.length - 1,
      details: snapshot.rows.stkSale2.length - 1,
      vouchers: snapshot.rows.vchrplus.length - 1,
    },
  };
}
export async function confirmPilot(event: any, id: string) {
  const record: any = await db()
    .prepare('SELECT * FROM pilot_exports WHERE id=? AND event=?')
    .bind(id, event.id)
    .first();
  if (!record) throw Error('找不到匯出預覽，請重新產生');
  if (
    (await digest(sourceOrders(JSON.parse(event.state)))) !== record.source_hash
  )
    throw fail('預覽後交易內容已變更，請重新預覽再正式匯出');
  const parts = await db()
    .prepare(
      'SELECT data FROM pilot_export_parts WHERE export_id=? ORDER BY part',
    )
    .bind(id)
    .all<any>();
  if (parts.results.length !== JSON.parse(record.snapshot).parts)
    throw Error('匯出快照不完整，請重新預覽');
  const snapshot = JSON.parse(parts.results.map((row) => row.data).join(''));
  await db()
    .prepare(
      'UPDATE pilot_exports SET confirmed=COALESCE(confirmed,?) WHERE id=?',
    )
    .bind(new Date().toISOString(), id)
    .run();
  return {
    id,
    context: snapshot.context,
    rows: snapshot.rows,
    mappings: snapshot.mappings,
  };
}

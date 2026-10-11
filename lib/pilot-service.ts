import { env } from 'cloudflare:workers';
import eriHistory from '../data/pilot-eri-history.json' with { type: 'json' };
import knownImports from '../data/pilot-known-imports.json' with { type: 'json' };
import {
  preparePilotSources,
  finalizePilotExport,
  exportContext,
} from './pilot-finalize.mjs';
import { encodePilotFiles, pilotFilesBase64 } from './pilot-csv.mjs';
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
  const used = new Set<string>([...eriHistory.eris, ...knownImports.eris]);
  // Read unique ERIs only, not every full order/draft snapshot in the audit log.
  // Include object keys as well as values, matching collectEris' collision rules.
  for (const table of ['events', 'audit'])
    for (let after = ''; ;) {
      const rows = await db()
        .prepare(`SELECT DISTINCT candidate.value AS eri
          FROM ${table}, json_tree(${table}.state) AS node,
            json_each(json_array(node.atom,node.key)) AS candidate
          WHERE candidate.type='text' AND length(candidate.value)=16
            AND substr(candidate.value,1,3) IN ('0H5','0H8','01E')
            AND substr(candidate.value,4) NOT GLOB '*[^A-Za-z0-9]*'
            AND candidate.value > ?
          ORDER BY eri LIMIT 1000`)
        .bind(after)
        .all<any>();
      for (const row of rows.results) used.add(row.eri);
      if (rows.results.length < 1000) break;
      after = rows.results[rows.results.length - 1].eri;
    }
  for (let after = ''; ;) {
    const allocated = await db()
      .prepare('SELECT eri FROM pilot_eris WHERE eri > ? ORDER BY eri LIMIT 1000')
      .bind(after)
      .all<any>();
    for (const row of allocated.results) used.add(row.eri);
    if (allocated.results.length < 1000) break;
    after = allocated.results[allocated.results.length - 1].eri;
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
    invoiceNames: input.invoiceNames || {},
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
  encodePilotFiles(snapshot.rows); // Fail before saving a preview with invalid text.
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
    voucherPreview: snapshot.voucherPreview,
    invoiceTitles: snapshot.invoiceTitles,
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
  if (snapshot.formatVersion !== 2)
    throw fail('匯出規則已更新，請重新產生預覽');
  const files = pilotFilesBase64(snapshot.rows);
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
    files,
    encoding: 'CP950',
  };
}

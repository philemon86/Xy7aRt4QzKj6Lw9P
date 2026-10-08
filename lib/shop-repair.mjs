// Repair only unconfirmed zero website cache entries, using freshly checked official prices.
// Exact-row comparison prevents overwriting a simultaneous successful synchronization.
export async function repairZeroShopPrices(db, verifiedPrices) {
  const rows = await db
    .prepare(
      "SELECT code,data FROM shop WHERE json_extract(data,'$.websitePrice')=0",
    )
    .all();
  const writes = [];
  for (const row of rows.results) {
    const current = JSON.parse(row.data),
      verified = verifiedPrices[row.code];
    if (
      current.websiteZeroConfirmed ||
      !verified ||
      !Number.isFinite(verified.websitePrice) ||
      verified.websitePrice <= 0 ||
      !Number.isFinite(Date.parse(verified.syncedAt)) ||
      Date.parse(verified.syncedAt) < (Date.parse(current.syncedAt) || 0)
    )
      continue;
    writes.push(
      db
        .prepare('UPDATE shop SET data=? WHERE code=? AND data=?')
        .bind(JSON.stringify(verified), row.code, row.data),
    );
  }
  let repaired = 0;
  for (let offset = 0; offset < writes.length; offset += 60) {
    for (const result of await db.batch(writes.slice(offset, offset + 60)))
      repaired += result.meta.changes;
  }
  const remaining = await db
    .prepare(
      "SELECT COUNT(*) count FROM shop WHERE json_extract(data,'$.websitePrice')=0 AND COALESCE(json_extract(data,'$.websiteZeroConfirmed'),0)=0",
    )
    .first();
  return { repaired, remainingInvalidZero: remaining?.count || 0 };
}

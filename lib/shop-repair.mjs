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

// Rebuild verified website prices only. Product overrides, orders, and payments
// live in separate tables and are never touched. A newer sync wins over this snapshot.
export async function repairVerifiedShopPrices(db, verifiedPrices) {
  const rows = await db.prepare('SELECT code,data FROM shop').all();
  const writes = [];
  for (const row of rows.results) {
    const current = JSON.parse(row.data), verified = verifiedPrices[row.code];
    if (!verified || verified.priceSchemaVersion !== 2 ||
        (!(verified.websitePrice === null && verified.websitePricingUnavailable) &&
          (!Number.isFinite(verified.websitePrice) || verified.websitePrice < 0)) ||
        (verified.websitePrice === 0 && !verified.websiteZeroConfirmed) ||
        !Number.isFinite(Date.parse(verified.syncedAt)) ||
        Date.parse(verified.syncedAt) < (Date.parse(current.syncedAt) || 0)) continue;
    if (current.priceSchemaVersion === 2 && current.websitePrice === verified.websitePrice &&
        current.listPrice === verified.listPrice) continue;
    writes.push(db.prepare('UPDATE shop SET data=? WHERE code=? AND data=?')
      .bind(JSON.stringify(verified), row.code, row.data));
  }
  let repaired = 0;
  for (let offset = 0; offset < writes.length; offset += 60)
    for (const r of await db.batch(writes.slice(offset, offset + 60))) repaired += r.meta.changes;
  const readback = await db.prepare('SELECT code,data FROM shop').all();
  let remainingPriceMismatch = 0, remainingInvalidZero = 0;
  for (const row of readback.results) {
    const current = JSON.parse(row.data), verified = verifiedPrices[row.code];
    if (current.websitePrice === 0 && !current.websiteZeroConfirmed) remainingInvalidZero++;
    if (verified?.priceSchemaVersion === 2 &&
        (Date.parse(current.syncedAt) || 0) <= Date.parse(verified.syncedAt) &&
        (current.websitePrice !== verified.websitePrice || current.priceSchemaVersion !== 2))
      remainingPriceMismatch++;
  }
  return { repaired, checked: readback.results.length, remainingPriceMismatch, remainingInvalidZero };
}

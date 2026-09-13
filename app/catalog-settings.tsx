'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { parseProductCSV } from '@/lib/catalog.mjs';
import { resolveProductPricing } from '@/lib/pos-core.mjs';

export default function CatalogSettings({ catalog, request, onUpdated }: any) {
  const [open, setOpen] = useState(false),
    [scope, setScope] = useState('products'),
    [code, setCode] = useState(''),
    [mode, setMode] = useState('discount'),
    [value, setValue] = useState('100'),
    [start, setStart] = useState(''),
    [end, setEnd] = useState(''),
    [message, setMessage] = useState(''),
    [busy, setBusy] = useState(false),
    [upload, setUpload] = useState<any>(null),
    [query, setQuery] = useState('');
  const [ruleRevision, setRuleRevision] = useState(catalog.pricingRevision);
  const rules = catalog.pricingRules || { products: {}, classes: {} };
  function selectCode(next: string, nextScope = scope) {
    setRuleRevision(catalog.pricingRevision);
    setCode(next);
    const r = rules[nextScope]?.[next];
    setMode(r?.mode || 'discount');
    setValue(String(r?.value ?? 100));
    setStart(r?.start || '');
    setEnd(r?.end || '');
    setMessage(
      r?.origin === 'legacy'
        ? '此為原雲 POS 單品／類別設定，可直接修改。'
        : r?.disabled
          ? '此設定已停用，採用下一順位價格。'
          : '',
    );
  }
  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMessage('');
    try {
      await fn();
    } catch (e: any) {
      setMessage(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function save(disabled = false) {
    const result = await request('catalog/pricing', {
      scope,
      code,
      revision: ruleRevision,
      rule: disabled ? { disabled: true } : { mode, value, start, end },
    });
    setRuleRevision(result.revision);
    await onUpdated();
    setMessage('已儲存，全教會共用；開啟中的收銀台會在一分鐘內更新。');
  }
  const selected = catalog.products.find((p: any) => p.code === code);
  const price = selected ? resolveProductPricing(selected) : null;
  return (
    <section className="catalog-settings panel">
      <div>
        <h2>商品與共用價格</h2>
        <p className="muted">
          CSV 名稱優先。單品設定 → 官網售價 → 類別設定 → CSV
          原價。已完成的出貨單維持成交資料。
        </p>
      </div>
      <div className="heading-actions">
        <Button
          variant="outline"
          onClick={() => {
            setOpen(true);
            setMessage('');
          }}
        >
          管理全教會折扣
        </Button>
        <label className="csv-upload">
          更新 PRODUCT.csv
          <Input
            type="file"
            accept=".csv"
            disabled={busy}
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              run(async () => {
                if (file.size > 8000000) throw Error('CSV 檔案不可超過 8 MB');
                const bytes = await file.arrayBuffer();
                let text;
                try {
                  text = new TextDecoder('utf-8', { fatal: true }).decode(
                    bytes,
                  );
                } catch {
                  text = new TextDecoder('big5', { fatal: true }).decode(bytes);
                }
                const parsed = parseProductCSV(text);
                setUpload({
                  ...parsed,
                  text,
                  revision: catalog.catalogRevision,
                });
              });
            }}
          />
        </label>
      </div>
      {!open && message && <p role="status">{message}</p>}
      <Dialog open={open} onOpenChange={(v) => !busy && setOpen(v)}>
        <DialogContent className="pricing-dialog">
          <DialogTitle>全教會共用價格</DialogTitle>
          <DialogDescription>
            百分比填 79
            表示七九折；可改用固定單價。日期留白即永久，起訖日均包含當日（臺灣時間）。
          </DialogDescription>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(() => save());
            }}
            className="pricing-form"
          >
            <label>
              設定範圍
              <select
                value={scope}
                onChange={(e) => {
                  setScope(e.target.value);
                  setQuery('');
                  selectCode('', e.target.value);
                }}
              >
                <option value="products">單一商品（含原雲 POS 特價）</option>
                <option value="classes">商品類別</option>
              </select>
            </label>
            {scope === 'products' ? (
              <>
                <label>
                  搜尋商品
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="CSV 名稱、官網名稱或代碼"
                  />
                </label>
                <label>
                  選擇商品
                  <select
                    required
                    value={code}
                    onChange={(e) => selectCode(e.target.value)}
                  >
                    <option value="">請選擇</option>
                    {catalog.products
                      .filter(
                        (p: any) =>
                          p.code === code ||
                          [p.name, p.webName, p.code, p.barcode].some((v) =>
                            String(v || '')
                              .toLowerCase()
                              .includes(query.toLowerCase()),
                          ),
                      )
                      .slice(0, 150)
                      .map((p: any) => (
                        <option key={p.code} value={p.code}>
                          {p.code} · {p.name}
                          {rules.products[p.code] &&
                          !rules.products[p.code].disabled
                            ? ' · 已設定'
                            : ''}
                        </option>
                      ))}
                  </select>
                </label>
                {price && (
                  <p className="muted">
                    目前 $
                    {Math.round((price.price * price.defaultDiscount) / 100)} ·{' '}
                    {price.priceLabel}，CSV 原價 $
                    {selected.legacyPrice ?? selected.price}
                  </p>
                )}
              </>
            ) : (
              <label>
                選擇類別
                <select
                  required
                  value={code}
                  onChange={(e) => selectCode(e.target.value)}
                >
                  <option value="">請選擇</option>
                  {[
                    ...new Set<string>(
                      catalog.products.map((p: any) => p.class),
                    ),
                  ]
                    .filter(Boolean)
                    .sort()
                    .map((c) => (
                      <option key={c} value={c}>
                        {c} · {catalog.classes[c] || c}
                      </option>
                    ))}
                </select>
              </label>
            )}
            <div className="pricing-grid">
              <label>
                設定方式
                <select value={mode} onChange={(e) => setMode(e.target.value)}>
                  <option value="discount">折扣百分比 %</option>
                  <option value="price">固定單價 $</option>
                </select>
              </label>
              <label>
                {mode === 'discount' ? '折扣 %' : '單價'}
                <Input
                  required
                  type="number"
                  step="0.01"
                  min="0"
                  max={mode === 'discount' ? 100 : 9999999}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                />
              </label>
              <label>
                開始日期（可留白）
                <Input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                />
              </label>
              <label>
                結束日期（可留白）
                <Input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                />
              </label>
            </div>
            <p role="status">{message}</p>
            <div className="heading-actions">
              <Button disabled={busy || !code} type="submit">
                儲存並同步
              </Button>
              <Button
                disabled={busy || !code}
                variant="outline"
                type="button"
                onClick={() => run(() => save(true))}
              >
                停用此設定
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!upload}
        onOpenChange={(v) => !busy && !v && setUpload(null)}
      >
        <DialogContent>
          <DialogTitle>確認更新商品 CSV</DialogTitle>
          <DialogDescription>
            更新同代碼商品的名稱、條碼、原價與分類；保留官網快取、共用折扣與歷史成交內容。檔案未列出的商品仍保留。
          </DialogDescription>
          {upload && (
            <>
              <p>
                {upload.products.length} 筆可更新，
                {
                  upload.products.filter(
                    (p: any) =>
                      !catalog.products.some((old: any) => old.code === p.code),
                  ).length
                }{' '}
                筆新商品。
              </p>
              {upload.skipped.length > 0 && (
                <p>
                  略過名稱空白：
                  {upload.skipped.map((p: any) => p.code).join('、')}
                  。既有資料不清空。
                </p>
              )}
              <div className="import-preview">
                {upload.products.slice(0, 8).map((p: any) => (
                  <p key={p.code}>
                    {p.code} · {p.name} · ${p.price}
                  </p>
                ))}
              </div>
              <p role="status">{message}</p>
              <Button
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await request('catalog/import', {
                      text: upload.text,
                      revision: upload.revision,
                    });
                    await onUpdated();
                    setUpload(null);
                    setMessage('商品 CSV 已更新，全教會共用。');
                  })
                }
              >
                {busy ? '儲存中…' : '確認更新商品'}
              </Button>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

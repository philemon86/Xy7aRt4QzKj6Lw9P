'use client';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { parseProductCSV } from '@/lib/catalog.mjs';
export default function CSVImport({ catalog, request, onUpdated }: any) {
  const [preview, setPreview] = useState<any>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  return (
    <div className="csv-import">
      <label>
        更新 PRODUCT.csv
        <Input
          type="file"
          accept=".csv"
          disabled={busy}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            setError('');
            try {
              if (file.size > 8000000) throw Error('CSV 不可超過 8 MB');
              const bytes = await file.arrayBuffer();
              let text;
              try {
                text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
              } catch {
                text = new TextDecoder('big5', { fatal: true }).decode(bytes);
              }
              setPreview({
                ...parseProductCSV(text),
                text,
                revision: catalog.catalogRevision,
              });
            } catch (e: any) {
              setError(e.message);
            }
          }}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      {preview && (
        <div className="inline-price-editor">
          <b>{preview.products.length} 件商品待更新</b>
          <p>更新 CSV 名稱、分類、條碼及原價，保留歷史交易與折扣設定。</p>
          {preview.skipped.length > 0 && (
            <p>
              空白名稱略過：{preview.skipped.map((p: any) => p.code).join('、')}
            </p>
          )}
          <div className="import-preview">
            {preview.products.slice(0, 6).map((p: any) => (
              <p key={p.code}>
                {p.code} · {p.name} · ${p.price}
              </p>
            ))}
          </div>
          <div className="heading-actions">
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                setError('');
                try {
                  await request('catalog/import', {
                    text: preview.text,
                    revision: preview.revision,
                  });
                  await onUpdated();
                  setPreview(null);
                } catch (e: any) {
                  setError(e.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              確認更新 CSV
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => setPreview(null)}
            >
              取消
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

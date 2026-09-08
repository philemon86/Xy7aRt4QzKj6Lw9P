'use client';
import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Table,
  TableHeader,
  TableRow,
  TableHead,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import { taipeiDay } from '@/lib/orders.mjs';
const csv = (rows: any[][]) =>
  '\uFEFF' +
  rows
    .map((row) =>
      row
        .map((cell) => '"' + String(cell ?? '').replaceAll('"', '""') + '"')
        .join(','),
    )
    .join('\r\n');
const filenames = {
  stkSale1: 'STKSALE1.csv',
  stkSale2: 'STKSALE2.csv',
  vchrplus: 'VCHRPLUS_SALE1.csv',
};
function download(key: string, rows: any[][]) {
  const url = URL.createObjectURL(
    new Blob([csv(rows)], { type: 'text/csv;charset=utf-8;' }),
  );
  const a = document.createElement('a');
  a.href = url;
  a.download = filenames[key as keyof typeof filenames];
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export default function PilotExportDialog({
  event,
  request,
  onClose,
}: {
  event: any;
  request: (path: string, body?: any) => Promise<any>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(taipeiDay()),
    [firstCode, setFirstCode] = useState(''),
    [firstInvoice, setFirstInvoice] = useState('');
  const [preview, setPreview] = useState<any>(null),
    [result, setResult] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const invalidate = () => {
    setPreview(null);
    setResult(null);
  };
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="pilot-export-dialog">
        <DialogTitle>PILOT 正式匯出 · {event.name}</DialogTitle>
        <DialogDescription>
          輸入正式資料後先預覽；POS 原始出貨單與交易識別保持不變。
        </DialogDescription>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="pilot-fields">
          <label>
            出貨日期
            <Input
              type="date"
              value={date}
              disabled={busy}
              onChange={(e) => {
                setDate(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            第一筆正式出貨單號
            <Input
              inputMode="numeric"
              placeholder="例如 1152778"
              value={firstCode}
              disabled={busy}
              onChange={(e) => {
                setFirstCode(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label>
            第一張發票號碼
            <Input
              placeholder="例如 FR13223935"
              maxLength={10}
              value={firstInvoice}
              disabled={busy}
              onChange={(e) => {
                setFirstInvoice(e.target.value.toUpperCase());
                invalidate();
              }}
            />
          </label>
        </div>
        <div className="pilot-flags" aria-label="正式匯出設定">
          <label>
            <Checkbox checked disabled /> POS 現銷
          </label>
          <label>
            <Checkbox checked disabled /> 電子發票
          </label>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            setResult(null);
            setPreview(null);
            try {
              setPreview(
                await request('events/' + event.id + '/pilot-preview', {
                  date,
                  firstCode,
                  firstInvoice,
                }),
              );
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? '正在處理…'
            : preview
              ? '重新產生預覽（使用全新 ERI）'
              : '產生匯出預覽'}
        </Button>
        {preview && (
          <>
            <p className="pilot-counts">
              主單 {preview.counts.masters} 張 · 明細 {preview.counts.details}{' '}
              筆 · 付款加減項 {preview.counts.vouchers} 筆
            </p>
            <div className="pilot-preview">
              <Table>
                <TableHeader>
                  <TableRow>
                    {[
                      '原始交易',
                      '客戶／載具',
                      'TAXCATE',
                      '正式 CODE',
                      '正式 INVNO',
                      '出貨日期',
                    ].map((label) => (
                      <TableHead key={label}>{label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.preview.map((row: any) => (
                    <TableRow key={row.code}>
                      <TableCell>{row.sourceNumber}</TableCell>
                      <TableCell>
                        {row.customerCode} · {row.customer}
                        {row.carrier && <small>{row.carrier}</small>}
                      </TableCell>
                      <TableCell>
                        {row.taxCate} ·{' '}
                        {Number(row.taxCate) === 0 ? '應稅' : '免稅'}
                      </TableCell>
                      <TableCell>{row.code}</TableCell>
                      <TableCell>{row.invoice}</TableCell>
                      <TableCell>{row.date}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {!result ? (
              <Button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setError('');
                  try {
                    const saved = await request(
                      'events/' + event.id + '/pilot-confirm',
                      { id: preview.id },
                    );
                    setResult(saved);
                    for (const [key, rows] of Object.entries(saved.rows))
                      download(key, rows as any[][]);
                  } catch (e: any) {
                    setError(e.message);
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                確認正式匯出，下載三個 CSV
              </Button>
            ) : (
              <div className="pilot-downloads">
                <b>正式匯出已完成</b>
                <p>若瀏覽器沒有下載全部檔案，可逐一下載同一份匯出。</p>
                {Object.entries(result.rows).map(([key, rows]) => (
                  <Button
                    key={key}
                    variant="outline"
                    onClick={() => download(key, rows as any[][])}
                  >
                    {filenames[key as keyof typeof filenames]}
                  </Button>
                ))}
              </div>
            )}
            <p className="muted">
              每次重新產生匯出都分配全新 ERI。預覽後若修改交易，須重新預覽。
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

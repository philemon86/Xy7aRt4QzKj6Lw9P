'use client';
import { useEffect, useState } from 'react';
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
const filenames = {
  stkSale1: 'STKSALE1.csv',
  stkSale2: 'STKSALE2.csv',
  vchrplus: 'VCHRPLUS_SALE1.csv',
};
type PreviewRow = {
  sourceNumbers: string[];
  sourceIds: string[];
  sourceNumber: string;
  customerCode: string;
  customer: string;
  carrier: string;
  taxId: string;
  taxCate: number;
  code: string;
  invoice: string;
  date: string;
  amount: number;
  tax: number;
  plusSub: number;
  total: number;
  adjustmentOnly: boolean;
};
type VoucherRow = {
  eri: string;
  method: string;
  createdAt: string | number;
  sourceNumber: string;
  code: string;
  amount: number;
};
type ExportPreview = {
  id: string;
  counts: { masters: number; details: number; vouchers: number };
  preview: PreviewRow[];
  voucherPreview: VoucherRow[];
};
type ExportResult = { id: string; confirmed:string; files: Record<string, string> };
type SavedExport = {id:string;created:string;confirmed:string;context:{date:string;firstCode:string;firstInvoice:string}};
type ExportHistory = {items:SavedExport[];next:{created:string;id:string}|null};
function download(key: string, encoded: string) {
  const bytes = Uint8Array.from(atob(encoded), (char) => char.charCodeAt(0));
  const url = URL.createObjectURL(
    new Blob([bytes], { type: 'text/csv;charset=big5;' }),
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
  event: { id: string; name: string };
  request: (path: string, body?: Record<string, unknown>) => Promise<unknown>;
  onClose: () => void;
}) {
  const [date, setDate] = useState(taipeiDay()),
    [firstCode, setFirstCode] = useState(''),
    [firstInvoice, setFirstInvoice] = useState('');
  const [preview, setPreview] = useState<ExportPreview | null>(null),
    [result, setResult] = useState<ExportResult | null>(null),
    [busy, setBusy] = useState(false),
    [stage, setStage] = useState(''),
    [error, setError] = useState('');
  const [history,setHistory] = useState<SavedExport[]>([]),
    [next,setNext] = useState<ExportHistory['next']>(null),
    [selected,setSelected] = useState(''),
    [loading,setLoading] = useState(true);
  const choose = (saved:SavedExport) => {
    setSelected(saved.id);
    setDate(saved.context.date.replaceAll('/','-'));setFirstCode(saved.context.firstCode);setFirstInvoice(saved.context.firstInvoice);
    setPreview(null);setResult(null);setError('');
  };
  useEffect(()=>{
    let alive=true;
    request('events/'+event.id+'/pilot-exports').then(value=>{
      if(!alive)return;
      const list=value as ExportHistory;setHistory(list.items);setNext(list.next);
      if(list.items.length)choose(list.items[0]);
    }).catch(e=>{if(alive)setError(e.message);}).finally(()=>{if(alive)setLoading(false);});
    return()=>{alive=false;};
  },[event.id]);
  const retrieve = async (file?:string) => {
    setBusy(true);setStage('正在讀取已保存的 CSV…');setError('');
    try {
      const saved=result || (await request('events/'+event.id+'/pilot-download',{id:selected})) as ExportResult;
      setResult(saved);
      for(const [key,encoded] of Object.entries(saved.files)) if(!file||key===file)download(key,encoded);
    }catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
  };
  const invalidate = () => {
    setPreview(null);
    setResult(null);
  };
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="pilot-export-dialog">
        <DialogTitle>匯出pilot · {event.name}</DialogTitle>
        <DialogDescription>
          完成匯出的 CSV 與設定會保存於本場書展，日後可直接下載同一份檔案。
        </DialogDescription>
        <p className="muted">
          未填發票資料與捐贈碼 2995 合併匯出；載具、統編及其他愛心碼各自成單。
          統編只需填號碼，抬頭不必填。 書展付款加減項集中於免稅單，依 LINE
          PAY、文化幣、信用卡分組，各組按交易時間排序。
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {loading && <p role="status">正在讀取已保存匯出…</p>}
        {history.length>0 && <section className="pilot-saved">
          <label htmlFor="pilot-saved">已保存匯出</label>
          <select id="pilot-saved" value={selected} disabled={busy||loading} onChange={e=>{const saved=history.find(row=>row.id===e.target.value);if(saved)choose(saved);}}>
            {!selected && <option value="">正在建立新的匯出</option>}
            {history.map(row=><option key={row.id} value={row.id}>{new Date(row.confirmed).toLocaleString('zh-TW',{timeZone:'Asia/Taipei'})} · {row.context.firstCode} · {row.context.firstInvoice}</option>)}
          </select>
          {next && <Button variant="outline" disabled={busy} onClick={async()=>{
            setBusy(true);setStage('正在讀取較早匯出…');
            try{const list=await request('events/'+event.id+'/pilot-exports?before='+encodeURIComponent(JSON.stringify(next))) as ExportHistory;setHistory(current=>[...current,...list.items]);setNext(list.next);}catch(e){setError(e instanceof Error?e.message:String(e));}finally{setBusy(false);}
          }}>載入較早的匯出</Button>}
          {selected && <>
            {result && <b>正式匯出已完成</b>}
            <p className="muted">下方為這份 CSV 保存的匯出設定。再次下載會使用原檔案。</p>
            <div className="pilot-downloads">
              <Button disabled={busy} onClick={()=>retrieve()}>下載三個已保存 CSV</Button>
              {Object.entries(filenames).map(([key,name])=><Button key={key} variant="outline" disabled={busy} onClick={()=>retrieve(key)}>{name}</Button>)}
            </div>
            <Button variant="outline" disabled={busy} onClick={()=>{setSelected('');setPreview(null);setResult(null);setError('');setDate(taipeiDay());setFirstCode('');setFirstInvoice('');}}>建立新的匯出</Button>
          </>}
        </section>}
        <div className="pilot-fields">
          <label htmlFor="pilot-date">
            出貨日期
            <Input
              id="pilot-date"
              type="date"
              value={date}
              disabled={busy || loading || !!selected}
              onChange={(e) => {
                setDate(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label htmlFor="pilot-code">
            第一筆正式出貨單號
            <Input
              id="pilot-code"
              inputMode="numeric"
              placeholder="例如 1152778"
              value={firstCode}
              disabled={busy || loading || !!selected}
              onChange={(e) => {
                setFirstCode(e.target.value);
                invalidate();
              }}
            />
          </label>
          <label htmlFor="pilot-invoice">
            第一張發票號碼
            <Input
              id="pilot-invoice"
              placeholder="例如 FR13223935"
              maxLength={10}
              value={firstInvoice}
              disabled={busy || loading || !!selected}
              onChange={(e) => {
                setFirstInvoice(e.target.value.toUpperCase());
                invalidate();
              }}
            />
          </label>
        </div>
        <div className="pilot-flags" aria-label="正式匯出設定">
          <label htmlFor="pilot-cash-sale">
            <Checkbox id="pilot-cash-sale" checked disabled /> POS 現銷
          </label>
          <label htmlFor="pilot-einvoice">
            <Checkbox id="pilot-einvoice" checked disabled /> 電子發票
          </label>
        </div>
        {!selected && <Button
          variant="outline"
          disabled={busy || loading}
          onClick={async () => {
            setBusy(true);
            setStage('正在同步交易並產生匯出預覽…');
            setError('');
            setResult(null);
            setPreview(null);
            try {
              const generated = (await request(
                'events/' + event.id + '/pilot-preview',
                {
                  date,
                  firstCode,
                  firstInvoice,
                },
              )) as ExportPreview;
              setPreview(generated);
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy
            ? stage
            : preview
              ? '重新產生預覽（使用全新 ERI）'
              : '產生匯出預覽'}
        </Button>}
        {busy && <p role="status">{stage} 請稍候，完成後會顯示結果。</p>}
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
                      '未稅金額',
                      '稅額',
                      '加減項',
                      '合計',
                    ].map((label) => (
                      <TableHead key={label}>{label}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.preview.map((row) => (
                    <TableRow key={row.code}>
                      <TableCell>
                        {row.sourceNumbers?.length > 1 ? (
                          <details>
                            <summary>{row.sourceNumber}</summary>
                            {row.sourceNumbers.map(
                              (number: string, i: number) => (
                                <small key={row.sourceIds[i]}>{number}</small>
                              ),
                            )}
                          </details>
                        ) : (
                          row.sourceNumber
                        )}
                      </TableCell>
                      <TableCell>
                        {row.customerCode} · {row.customer}
                        {row.carrier && <small>{row.carrier}</small>}
                        {row.taxId && <small>統編：{row.taxId}</small>}
                      </TableCell>
                      <TableCell>
                        {row.taxCate} ·{' '}
                        {Number(row.taxCate) === 0 ? '應稅' : '免稅'}
                      </TableCell>
                      <TableCell>{row.code}</TableCell>
                      <TableCell>{row.invoice}</TableCell>
                      <TableCell>{row.date}</TableCell>
                      {[row.amount, row.tax, row.plusSub, row.total].map(
                        (amount, index) => (
                          <TableCell key={index}>
                            {Number(amount).toLocaleString('zh-TW')}
                          </TableCell>
                        ),
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {preview.preview.some((row) => row.adjustmentOnly) && (
              <p className="muted">
                本批包含免稅加減項專用單：沒有新增商品明細，付款扣抵完整保留，合計可為負值。
              </p>
            )}
            {preview.voucherPreview?.length > 0 && (
              <details className="pilot-preview">
                <summary>查看書展付款加減項（依付款方式、交易時間）</summary>
                <Table>
                  <TableHeader>
                    <TableRow>
                      {[
                        '付款方式',
                        '交易時間',
                        '原始交易',
                        '免稅 CODE',
                        '加減金額',
                      ].map((label) => (
                        <TableHead key={label}>{label}</TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {preview.voucherPreview.map((row) => (
                      <TableRow key={row.eri}>
                        <TableCell>{row.method}</TableCell>
                        <TableCell>
                          {row.createdAt
                            ? new Date(row.createdAt).toLocaleString('zh-TW', {
                                timeZone: 'Asia/Taipei',
                              })
                            : '未記錄時間'}
                        </TableCell>
                        <TableCell>{row.sourceNumber}</TableCell>
                        <TableCell>{row.code}</TableCell>
                        <TableCell>
                          {Number(row.amount).toLocaleString('zh-TW')}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </details>
            )}
            {!result ? (
              <Button
                className="primary"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setStage('正在產生三個 CSV 檔案…');
                  setError('');
                  try {
                    const saved = (await request(
                      'events/' + event.id + '/pilot-confirm',
                      { id: preview.id },
                    )) as ExportResult;
                    setResult(saved);
                    for (const [key, encoded] of Object.entries(saved.files))
                      download(key, encoded as string);
                    const row={id:saved.id,created:saved.confirmed,confirmed:saved.confirmed,context:{date,firstCode,firstInvoice}};
                    setHistory(current=>[row,...current.filter(item=>item.id!==row.id)]);
                    setSelected(saved.id);setPreview(null);
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {busy ? '正在準備下載…' : '確認正式匯出，下載三個 CSV'}
              </Button>
            ) : (
              <div className="pilot-downloads">
                <b>正式匯出已完成</b>
                <p>若瀏覽器沒有下載全部檔案，可逐一下載同一份匯出。</p>
                {Object.entries(result.files).map(([key, encoded]) => (
                  <Button
                    key={key}
                    variant="outline"
                    onClick={() => download(key, encoded as string)}
                  >
                    {filenames[key as keyof typeof filenames]}
                  </Button>
                ))}
              </div>
            )}
            <p className="muted">
              每次重新產生匯出都分配全新 ERI。預覽後若修改交易，須重新預覽。
              三個 CSV 採 Big5 / CP950 編碼、無 BOM。
            </p>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

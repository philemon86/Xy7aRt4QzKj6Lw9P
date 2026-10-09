'use client';
import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { getOfflineRuntime } from '@/lib/offline.mjs';

function describe(value: any) {
  if (value == null) return '已刪除／尚未建立';
  if (Array.isArray(value.items)) return `${value.paymentMethod} · $${value.amount}\n` + value.items.map((i: any) => `${i.code} ${i.name} × ${i.quantity} · $${i.price} · ${i.discount}%`).join('\n');
  return typeof value === 'string' ? value : JSON.stringify(value);
}
export default function OfflineConflicts({ portal, onResolved }: { portal: string; onResolved: () => void }) {
  const [open, setOpen] = useState(false), [review, setReview] = useState<any[]>([]),
    [choices, setChoices] = useState<Record<string, string>>({}), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  return <>
    <button className="offline-download" onClick={async () => {
      setOpen(true); setError(''); setBusy(true); setChoices({});
      try { setReview(await getOfflineRuntime().conflicts(portal)); }
      catch (e: any) { setError(e.message); }
      finally { setBusy(false); }
    }}>檢查同步差異</button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="offline-review">
        <DialogTitle>檢查待同步資料</DialogTitle>
        <DialogDescription>另一台裝置已修改相同資料。請逐項選擇，確認後才會同步；原訂單不會重複建立。</DialogDescription>
        {error && <p role="alert" className="error">{error}</p>}
        {!review.length && !busy && !error && <p>沒有可合併的欄位差異。若書展已封存，請先在連線時重新開啟；其他錯誤可下載待同步備份交由書房處理。</p>}
        {review.map((r) => <section key={r.event + r.key} className="offline-review-item">
          <strong>{r.name} · {r.key.startsWith('order:') ? '交易 ' + r.key.slice(6) : r.key.startsWith('draft:') ? '結帳草稿' : '書展設定'}</strong>
          <div className="offline-review-values"><div><b>雲端資料</b><pre>{describe(r.server)}</pre></div><div><b>此裝置資料</b><pre>{describe(r.device)}</pre></div></div>
          <select aria-label="選擇保留資料" value={choices[r.event + ':' + r.key] || ''} onChange={(e) => setChoices({ ...choices, [r.event + ':' + r.key]: e.target.value })}>
            <option value="">請選擇保留哪一份</option><option value="server">保留雲端資料</option><option value="device">套用此裝置修改</option>
          </select>
        </section>)}
        <Button disabled={busy || !review.length || review.some((r) => !choices[r.event + ':' + r.key])} onClick={async () => {
          setBusy(true); setError('');
          try { await getOfflineRuntime().resolveConflicts(portal, review, choices); setOpen(false); onResolved(); }
          catch (e: any) { setError(e.message); }
          finally { setBusy(false); }
        }}>{busy ? '處理中…' : '確認選擇並同步'}</Button>
      </DialogContent>
    </Dialog>
  </>;
}

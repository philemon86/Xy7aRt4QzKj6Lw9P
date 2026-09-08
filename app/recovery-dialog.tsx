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
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { makePayments } from '@/lib/orders.mjs';
export default function RecoveryDialog({
  cloud,
  onClose,
  onLogout,
}: {
  cloud: any;
  onClose: () => void;
  onLogout: () => void;
}) {
  const [orders] = useState<any[]>(() => cloud.recoveryOrders());
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [parts, setParts] = useState<Record<string, string>>({});
  const [error, setError] = useState(cloud.recoveryError || '');
  const [busy, setBusy] = useState(false);
  const unsupported = orders.filter(
    (o) =>
      (o.paymentRecords || []).some(
        (p: any) => !['文化幣', 'LINE PAY'].includes(p.method),
      ) && cloud.me.role !== 'admin',
  );
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="recovery-dialog">
        <DialogTitle>處理上次待存結帳</DialogTitle>
        <DialogDescription>
          交易資料仍保留在這台裝置。這裡只修正付款紀錄，請勿再次收款。
        </DialogDescription>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {unsupported.map((o) => (
          <section key={o.id} className="recovery-order">
            <b>{o.items.map((i: any) => i.name).join('、')}</b>
            <p>
              NT$ {o.amount} · 原付款：{o.paymentMethod}
            </p>
            <label>確認實際付款方式</label>
            <Select
              value={choices[o.id] || ''}
              onValueChange={(v) =>
                v && setChoices((x) => ({ ...x, [o.id]: v }))
              }
            >
              <SelectTrigger>
                <SelectValue placeholder="依實際收款選擇" />
              </SelectTrigger>
              <SelectContent>
                {['LINE PAY', '文化幣', '文化幣 + LINE PAY'].map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {choices[o.id]?.includes(' + ') && (
              <label>
                文化幣金額
                <Input
                  type="number"
                  min="0"
                  max={Math.abs(o.amount)}
                  step="1"
                  value={parts[o.id] || ''}
                  onChange={(e) =>
                    setParts((x) => ({ ...x, [o.id]: e.target.value }))
                  }
                />
              </label>
            )}
          </section>
        ))}
        {!unsupported.length && (
          <p>
            共有 {orders.length}{' '}
            筆待存交易。重試後仍有衝突時，請保留資料交由書房處理。
          </p>
        )}
        <Button
          disabled={busy}
          className="primary"
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              const payments: Record<string, any> = {};
              for (const o of unsupported) {
                if (!choices[o.id]) throw Error('請確認每筆交易的實際付款方式');
                if (choices[o.id].includes(' + ') && !parts[o.id]?.trim())
                  throw Error('請輸入文化幣金額');
                payments[o.id] = makePayments(
                  o.amount,
                  choices[o.id],
                  Number(parts[o.id] || 0),
                );
              }
              await cloud.resolveRecovery(payments);
              onClose();
            } catch (e: any) {
              setError(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? '保存中…' : '確認並重新保存'}
        </Button>
        <Button variant="outline" disabled={busy} onClick={onLogout}>
          保留待存資料並登出，交由書房處理
        </Button>
      </DialogContent>
    </Dialog>
  );
}

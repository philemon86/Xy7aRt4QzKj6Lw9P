'use client';
import { useEffect, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { ReceiptText, RefreshCw } from 'lucide-react';
export default function Shipments({
  events,
  customers,
  request,
  onEdit,
  onOpen,
  version,
}: {
  events: any[];
  customers: any[];
  request: (path: string) => Promise<any>;
  onEdit: (target: { eventId: string; orderId: string }) => void;
  onOpen: (event: any) => void;
  version: number;
}) {
  const [tenant, setTenant] = useState('all'),
    [orders, setOrders] = useState<any[]>([]),
    [search, setSearch] = useState(''),
    [day, setDay] = useState(''),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let stopped = false;
    setBusy(true);
    setError('');
    request('shipments')
      .then((data) => {
        if (!stopped) setOrders(data);
      })
      .catch((e) => !stopped && setError(e.message))
      .finally(() => !stopped && setBusy(false));
    return () => {
      stopped = true;
    };
  }, [version, refresh]);
  const codes = [
    ...new Set(events.map((e) => e.tenant).filter(Boolean)),
  ].sort();
  const visible = orders.filter(
    (o) =>
      (tenant === 'all' ||
        (tenant === 'mon' ? !o.tenant : o.tenant === tenant)) &&
      (!day || o.day === day) &&
      [o.number, o.summary, o.eventName, o.tenant]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const churchName = (code: string) =>
    customers.find((c) => c.code.toLowerCase() === code)?.name ||
    code.toUpperCase();
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">SHIPMENTS</span>
          <h1>教會出貨單</h1>
          <p>切換教會，查看各場次的結帳明細。</p>
        </div>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setRefresh((v) => v + 1)}
        >
          <RefreshCw /> 更新
        </Button>
      </div>
      <div className="shipment-filters">
        <label>
          教會
          <Select value={tenant} onValueChange={(v) => v && setTenant(v)}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部教會與書房</SelectItem>
              <SelectItem value="mon">腓利門書房</SelectItem>
              {codes.map((code) => (
                <SelectItem key={code} value={code}>
                  {code.toUpperCase()} · {churchName(code)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <label>
          出貨日期
          <Input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
        </label>
        <label>
          搜尋出貨單
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="出貨單號、商品或場次"
          />
        </label>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {busy ? (
        <p className="muted">正在讀取出貨單…</p>
      ) : (
        <div className="shipment-list">
          {visible.map((o) => (
            <article key={o.event + o.id}>
              <ReceiptText />
              <div className="shipment-main">
                <button
                  onClick={() => onEdit({ eventId: o.event, orderId: o.id })}
                >
                  <b>{o.number}</b>
                </button>
                <p>
                  {o.tenant ? churchName(o.tenant) : '腓利門書房'} · {o.day} ·{' '}
                  {o.eventName}
                </p>
                <small>{o.summary}</small>
              </div>
              <div className="shipment-total">
                <strong>NT$ {o.amount.toLocaleString()}</strong>
                <small>{o.isValid ? o.paymentMethod : '原已作廢'}</small>
              </div>
              <div className="shipment-actions">
                <Button
                  variant="outline"
                  onClick={() => onEdit({ eventId: o.event, orderId: o.id })}
                >
                  查看 / 修改
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => onOpen(events.find((e) => e.id === o.event))}
                >
                  開啟場次
                </Button>
              </div>
            </article>
          ))}
          {!visible.length && (
            <div className="empty">
              <ReceiptText />
              <p>此範圍尚無出貨單。</p>
            </div>
          )}
        </div>
      )}
    </>
  );
}

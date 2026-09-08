'use client';
import { useEffect, useMemo, useState } from 'react';
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
import { Plus, Search, Trash2, ArrowLeftRight } from 'lucide-react';
import { resolveProductPricing, editCartItem } from '@/lib/pos-core.mjs';
import { orderTotal, makePayments, paymentLabel } from '@/lib/orders.mjs';
type Target = { eventId: string; orderId: string };
export default function OrderEditor({
  target,
  catalog,
  role,
  request,
  onClose,
  onSaved,
}: {
  target: Target;
  catalog: any;
  role: string;
  request: (path: string, body?: any) => Promise<any>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [original, setOriginal] = useState<any>(null),
    [items, setItems] = useState<any[]>([]),
    [number, setNumber] = useState(''),
    [note, setNote] = useState(''),
    [invoiceText, setInvoiceText] = useState(''),
    [taxId, setTaxId] = useState(''),
    [customerCode, setCustomerCode] = useState(''),
    [choice, setChoice] = useState('LINE PAY'),
    [split, setSplit] = useState('0'),
    [search, setSearch] = useState(''),
    [replacement, setReplacement] = useState<number | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [archived, setArchived] = useState(false);
  useEffect(() => {
    let cancelled = false;
    request('events/' + target.eventId)
      .then((event) => {
        if (cancelled) return;
        const order = event.state['order:' + target.orderId];
        if (!order) throw Error('這筆出貨單已刪除');
        setOriginal(order);
        setItems(structuredClone(order.items));
        setNumber(event.numbers[order.id]);
        setNote(order.note || '');
        setInvoiceText(
          order.invoiceInfo?.carrier || order.invoiceInfo?.donationCode || '',
        );
        setTaxId(order.invoiceInfo?.taxId || '');
        setCustomerCode(order.bookFairCustomerCode || '');
        setArchived(event.status !== 'open');
        const records = order.paymentRecords || [];
        const methods = records.map((p: any) => p.method);
        const allowed =
          role === 'admin'
            ? ['現金', '信用卡', 'LINE PAY', '文化幣']
            : ['LINE PAY', '文化幣'];
        const selected =
          methods.includes('文化幣') && methods.length > 1
            ? '文化幣 + ' + (methods.includes('LINE PAY') ? 'LINE PAY' : '現金')
            : methods[0] || 'LINE PAY';
        setChoice(
          methods.every((m: string) => allowed.includes(m)) ? selected : '',
        );
        setSplit(
          String(
            Math.abs(
              records.find((p: any) => p.method === '文化幣')?.amount || 0,
            ),
          ),
        );
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [target.eventId, target.orderId]);
  const total = useMemo(() => orderTotal(items), [items]);
  const matches = search.trim()
    ? (catalog?.products || [])
        .filter((p: any) =>
          [p.name, p.code, p.barcode, p.webBarcode]
            .join(' ')
            .toLowerCase()
            .includes(search.trim().toLowerCase()),
        )
        .slice(0, 8)
    : [];
  function change(index: number, key: string, value: string) {
    setItems((current) =>
      current.map((item, i) =>
        i === index ? { ...item, [key]: value } : item,
      ),
    );
  }
  function selectProduct(source: any) {
    const p = resolveProductPricing(source);
    const next = {
      ...p,
      quantity: 1,
      discount: p.defaultDiscount,
      isManual: false,
    };
    setItems((list) =>
      replacement == null
        ? [...list, next]
        : list.map((item, i) =>
            i === replacement ? { ...next, quantity: item.quantity } : item,
          ),
    );
    setSearch('');
    setReplacement(null);
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      if (!items.length) throw Error('請至少保留一件商品；整筆移除請使用刪除');
      if (choice.includes(' + ') && !split.trim())
        throw Error('請輸入文化幣金額');
      const edited = items.map((i) => editCartItem(i, i));
      const amount = orderTotal(edited),
        paymentRecords =
          !choice && amount === original.amount
            ? original.paymentRecords
            : makePayments(amount, choice, Number(split));
      const selectedCustomer = catalog.customers.find(
        (c: any) => c.code === customerCode,
      );
      if (
        taxId.trim() &&
        (!selectedCustomer || ['0002', '305'].includes(customerCode))
      )
        throw Error('輸入統編時請選擇發票教會');
      const invoiceInfo = taxId.trim()
        ? { taxId: taxId.trim(), carrier: '', donationCode: '' }
        : {
            taxId: '',
            carrier: /^\d+$/.test(invoiceText.trim()) ? '' : invoiceText.trim(),
            donationCode: /^\d+$/.test(invoiceText.trim())
              ? invoiceText.trim()
              : '',
          };
      const after = {
        ...original,
        items: edited,
        amount,
        paymentRecords,
        paymentMethod: paymentLabel(paymentRecords, amount),
        note,
        invoiceInfo,
        bookFairCustomerCode: invoiceInfo.taxId ? customerCode : '',
        accountingCustomer: invoiceInfo.taxId
          ? selectedCustomer
          : catalog.customers.find(
              (c: any) => c.code === (invoiceInfo.carrier ? '305' : '0002'),
            ),
        modifiedAt: new Date().toISOString(),
      };
      await request('events/' + target.eventId + '/sync', {
        changes: [{ key: 'order:' + original.id, before: original, after }],
      });
      onSaved();
      onClose();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open onOpenChange={(v) => !v && !busy && onClose()}>
      <DialogContent className="order-editor-dialog">
        <DialogTitle>{number || '出貨單'} · 修改內容</DialogTitle>
        <DialogDescription>
          修改商品、單價、數量與付款紀錄，出貨單號保持不變。
        </DialogDescription>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        {!original && !error && <p className="muted">正在讀取出貨單…</p>}
        {original && (
          <>
            <div className="order-editor-meta">
              <span>
                {original.createdAt
                  ? new Date(original.createdAt).toLocaleString('zh-TW')
                  : '歷史出貨單'}
              </span>
              <span>
                {archived
                  ? '此書展已封存'
                  : original.isValid
                    ? '有效出貨單'
                    : '原已作廢紀錄'}
              </span>
            </div>
            <fieldset disabled={busy || archived}>
              <label htmlFor="order-product-search">
                {replacement == null ? '加入商品' : '選擇要替換的商品'}
              </label>
              <div className="order-search-row">
                <Search size={18} />
                <Input
                  id="order-product-search"
                  placeholder="搜尋名稱、商品代碼或條碼"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                {replacement != null && (
                  <Button
                    variant="ghost"
                    onClick={() => {
                      setReplacement(null);
                      setSearch('');
                    }}
                  >
                    取消替換
                  </Button>
                )}
              </div>
              {search.trim() && (
                <div className="order-search-results">
                  {matches.map((p: any) => (
                    <button
                      key={p.code}
                      type="button"
                      onClick={() => selectProduct(p)}
                    >
                      <span>
                        <b>{p.name}</b>
                        <small>{p.code}</small>
                      </span>
                      <Plus size={18} />
                    </button>
                  ))}
                  {!matches.length && <p>找不到商品</p>}
                </div>
              )}
              <div className="order-edit-items">
                {items.map((item, index) => (
                  <div className="order-edit-item" key={index}>
                    <div className="order-item-heading">
                      <span>
                        <b>{item.name}</b>
                        <small>{item.code}</small>
                      </span>
                      <Button
                        variant="ghost"
                        aria-label={'替換 ' + item.name}
                        onClick={() => {
                          setReplacement(index);
                          setSearch('');
                          document
                            .getElementById('order-product-search')
                            ?.focus();
                        }}
                      >
                        <ArrowLeftRight /> 替換
                      </Button>
                      <Button
                        variant="ghost"
                        aria-label={'移除 ' + item.name}
                        onClick={() =>
                          setItems((list) => list.filter((_, i) => i !== index))
                        }
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <div className="order-item-fields">
                      <label>
                        單價
                        <Input
                          type="number"
                          step="any"
                          value={item.price}
                          onChange={(e) =>
                            change(index, 'price', e.target.value)
                          }
                        />
                      </label>
                      <label>
                        數量
                        <Input
                          type="number"
                          step="1"
                          value={item.quantity}
                          onChange={(e) =>
                            change(index, 'quantity', e.target.value)
                          }
                        />
                      </label>
                      <label>
                        折扣 %
                        <Input
                          type="number"
                          step="any"
                          min="0"
                          max="100"
                          value={item.discount}
                          onChange={(e) =>
                            change(index, 'discount', e.target.value)
                          }
                        />
                      </label>
                      <span>
                        小計
                        <strong>
                          $
                          {Number.isFinite(orderTotal([item]))
                            ? orderTotal([item]).toLocaleString()
                            : '—'}
                        </strong>
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              <div className="order-payment-row">
                <div>
                  <label>付款方式</label>
                  <Select
                    value={choice}
                    onValueChange={(v) => v && setChoice(v)}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="請選擇付款方式" />
                    </SelectTrigger>
                    <SelectContent>
                      {[
                        ...(role === 'admin' ? ['現金', '信用卡'] : []),
                        'LINE PAY',
                        '文化幣',
                        '文化幣 + LINE PAY',
                        ...(role === 'admin' ? ['文化幣 + 現金'] : []),
                      ].map((p) => (
                        <SelectItem key={p} value={p}>
                          {p}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {!choice && (
                    <small>
                      原付款為{original.paymentMethod}
                      。總額不變時可保留原紀錄；如有補收或退款，請依實際收款重新選擇。
                    </small>
                  )}
                </div>
                {choice.includes(' + ') && (
                  <label>
                    文化幣金額
                    <Input
                      type="number"
                      min="0"
                      step="1"
                      max={Math.abs(total)}
                      value={split}
                      onChange={(e) => setSplit(e.target.value)}
                    />
                    <small>
                      餘額：{choice.split(' + ')[1]} $
                      {Math.abs(total) - Number(split)}
                    </small>
                  </label>
                )}
              </div>
              <details className="order-invoice-fields">
                <summary>發票與客戶資料</summary>
                <label>
                  載具／捐贈碼
                  <Input
                    value={invoiceText}
                    onChange={(e) => setInvoiceText(e.target.value)}
                  />
                </label>
                <label>
                  統一編號
                  <Input
                    value={taxId}
                    inputMode="numeric"
                    onChange={(e) => setTaxId(e.target.value)}
                  />
                </label>
                {taxId && (
                  <label>
                    發票教會
                    <Select
                      value={customerCode}
                      onValueChange={(v) => v && setCustomerCode(v)}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="請選擇教會" />
                      </SelectTrigger>
                      <SelectContent>
                        {catalog.customers
                          .filter((c: any) => !['0002', '305'].includes(c.code))
                          .map((c: any) => (
                            <SelectItem key={c.code} value={c.code}>
                              {c.code} · {c.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                  </label>
                )}
              </details>
              <label htmlFor="order-note">備註</label>
              <Input
                id="order-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <p className="muted order-change-note">
                修改會更新出貨與收款紀錄；金額變更時，請確認實際補收或退款。
              </p>
            </fieldset>
            <div className="order-editor-footer">
              <span>
                修正後總額
                <strong>
                  NT$ {Number.isFinite(total) ? total.toLocaleString() : '—'}
                </strong>
              </span>
              <Button variant="outline" disabled={busy} onClick={onClose}>
                取消
              </Button>
              <Button
                className="primary"
                disabled={busy || archived}
                onClick={save}
              >
                {busy ? '儲存中…' : '儲存修改'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

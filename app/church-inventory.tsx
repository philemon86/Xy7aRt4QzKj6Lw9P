'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
export default function ChurchInventory({
  tenant,
  catalog,
  request,
  readOnly = false,
}: any) {
  const [data, setData] = useState<any>(null),
    [text, setText] = useState(''),
    [mode, setMode] = useState('add'),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  const path = 'church-stock/' + tenant.toLowerCase();
  useEffect(() => {
    let alive = true;
    const load = () =>
      request(path)
        .then((r: any) => alive && setData(r))
        .catch((e: any) => alive && setMessage(e.message));
    load();
    const timer = setInterval(() => {
      if (!document.hidden) load();
    }, 15000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [path]);
  return (
    <section className="church-stock-panel">
      <h2>{tenant.toUpperCase()} · 教會共用庫存</h2>
      <p className="muted">
        書房可先建立庫存。教會新增書展即共用這份庫存，各場有效銷售（含贈品）合計扣除，退貨補回。
      </p>
      {!readOnly && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            try {
              const r = await request(path, {
                text,
                mode,
                revision: data?.revision || '',
              });
              setData(r);
              setText('');
              setMessage('教會庫存已儲存');
            } catch (e: any) {
              setMessage(e.message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            匯入方式
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="add">加減庫存（進貨／退回書房）</option>
              <option value="set">設定目前剩餘數量</option>
            </select>
          </label>
          <label>
            商品代碼,數量（每行一筆，商品名稱由書房資料帶入）
            <textarea
              rows={5}
              placeholder={'C001,10\nC002,8'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <Button type="submit" disabled={busy || !data || !text.trim()}>
            {busy ? '儲存中…' : '確認儲存庫存'}
          </Button>
        </form>
      )}
      <p role="status">{message}</p>
      <div className="inventory-table">
        <table>
          <thead>
            <tr>
              <th>商品</th>
              <th>書房提供</th>
              <th>各場已售／贈送</th>
              <th>剩餘</th>
            </tr>
          </thead>
          <tbody>
            {data?.rows.map((r: any) => (
              <tr key={r.code}>
                <td>
                  <b>
                    {catalog.products.find((p: any) => p.code === r.code)
                      ?.name || r.code}
                  </b>
                  <small>{r.code}</small>
                </td>
                <td>{r.supplied}</td>
                <td>{r.sold}</td>
                <td>
                  <strong>{r.available}</strong>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {data && !data.rows.length && (
        <p className="muted">尚未匯入庫存，仍可正常結帳。</p>
      )}
    </section>
  );
}

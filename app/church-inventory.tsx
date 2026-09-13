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
    [editing, setEditing] = useState<any>(null),
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
        <p className="muted">
          直接匯入每項商品的目前數量；同代碼再次匯入會更新數量。匯入後雙擊表格的目前庫存即可修改。
        </p>
      )}
      {!readOnly && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setMessage('');
            try {
              const r = await request(path, {
                text,
                mode: 'set',
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
            商品代碼,數量（每行一筆，商品名稱由書房資料帶入）
            <textarea
              rows={5}
              placeholder={'C001,10\nC002,8'}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
          </label>
          <Button
            type="submit"
            disabled={busy || !data || !text.trim() || !!editing}
          >
            {busy ? '儲存中…' : '匯入庫存'}
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
              <th>目前庫存</th>
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
                  {readOnly ? (
                    <strong>{r.available}</strong>
                  ) : editing?.code === r.code ? (
                    <form
                      className="stock-row-editor"
                      onSubmit={async (e) => {
                        e.preventDefault();
                        setBusy(true);
                        setMessage('');
                        try {
                          const updated = await request(path, {
                            mode: 'set',
                            text: r.code + ',' + editing.value,
                            revision: editing.revision,
                          });
                          setData(updated);
                          setEditing(null);
                          setMessage(r.code + ' 庫存已更新');
                        } catch (error: any) {
                          setMessage(error.message);
                        } finally {
                          setBusy(false);
                        }
                      }}
                    >
                      <input
                        aria-label={r.code + ' 庫存數量'}
                        type="number"
                        step="1"
                        min="-10000000"
                        max="10000000"
                        required
                        autoFocus
                        value={editing.value}
                        onChange={(e) =>
                          setEditing({ ...editing, value: e.target.value })
                        }
                      />
                      <Button type="submit" disabled={busy}>
                        儲存
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => setEditing(null)}
                      >
                        取消
                      </Button>
                    </form>
                  ) : (
                    <button
                      type="button"
                      className="stock-quantity-button"
                      disabled={busy}
                      title="雙擊修改庫存；手機可點選，鍵盤可按 Enter"
                      aria-label={'修改 ' + r.code + ' 庫存 ' + r.available}
                      onDoubleClick={() =>
                        setEditing({
                          code: r.code,
                          value: String(r.available),
                          revision: data.revision,
                        })
                      }
                      onClick={(e) => {
                        if (
                          window.matchMedia('(pointer:coarse)').matches ||
                          e.detail === 0
                        )
                          setEditing({
                            code: r.code,
                            value: String(r.available),
                            revision: data.revision,
                          });
                      }}
                    >
                      <strong>{r.available}</strong>
                      <small>修改</small>
                    </button>
                  )}
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

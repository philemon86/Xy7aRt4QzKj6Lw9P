'use client';
import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import CSVImport from './csv-import';
import { resolveProductPricing, formatDiscount } from '@/lib/pos-core.mjs';
import {
  applyPromotions,
  productPromotions,
  ruleActive,
} from '@/lib/promotions.mjs';
const money = (n: number) =>
  Number(n).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
const ruleLabel = (r: any) =>
  !r || r.disabled
    ? '未設定'
    : r.mode === 'price'
      ? '$' + money(r.value)
      : formatDiscount(r.value);
const codes = (s: string) =>
  s
    .split(/[,，\s]+/)
    .map((c) => c.trim())
    .filter(Boolean);
export default function PriceManager({
  catalog,
  request,
  onUpdated,
  readOnly = false,
}: any) {
  const [tab, setTab] = useState('products'),
    [query, setQuery] = useState(''),
    [edit, setEdit] = useState<any>(null),
    [group, setGroup] = useState<any>(null),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState('');
  useEffect(() => {
    if (edit) {
      requestAnimationFrame(() =>
        document
          .getElementById('price-row-' + edit.scope + '-' + edit.code)
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
    }
  }, [edit?.scope, edit?.code, tab]);
  useEffect(() => {
    if (group)
      requestAnimationFrame(() =>
        document
          .getElementById('group-editor')
          ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }),
      );
  }, [group?.id]);
  const rules = catalog.pricingRules,
    groups = rules.groups || [];
  const name = (code: string) =>
    catalog.products.find((p: any) => p.code === code)?.name || code;
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
  function openRule(scope: string, code: string) {
    if (readOnly) return;
    const r = rules[scope]?.[code];
    setEdit({
      scope,
      code,
      mode: r?.mode || 'discount',
      value: r?.value ?? 100,
      start: r?.start || '',
      end: r?.end || '',
      revision: catalog.pricingRevision,
      classRevision: catalog.catalogRevision,
      class: catalog.products.find((p: any) => p.code === code)?.class || '',
    });
  }
  function openGroup(g: any) {
    if (readOnly) return;
    setTab('groups');
    setGroup({
      ...structuredClone(g),
      codesText: g.codes.join(', '),
      giftCodesText: (g.giftCodes || []).join(', '),
      revision: catalog.pricingRevision,
    });
  }
  function newGroup(type: string) {
    openGroup({
      id: '',
      name: '',
      type,
      codes: [],
      giftCode: '',
      giftCodes: [],
      giftMode: 'scanned',
      priority: 0,
      start: '',
      end: '',
      disabled: false,
      tiers: [
        { quantity: 1, mode: 'discount', value: 79 },
        { quantity: 3, mode: 'discount', value: 75 },
        { quantity: 6, mode: 'discount', value: 69 },
      ],
    });
  }
  const pill = (
    text: string,
    kind: string,
    chosen: boolean,
    action?: () => void,
  ) => (
    <button
      type="button"
      className={'price-pill ' + kind + (chosen ? ' chosen' : '')}
      onDoubleClick={action}
      onKeyDown={(e) => {
        if (e.key === 'Enter') action?.();
      }}
      onClick={action}
      title={action ? '雙擊修改；手機可按修改按鈕' : text}
    >
      {text}
      {chosen ? ' · 採用' : ''}
    </button>
  );
  const inline = (scope: string, code: string) =>
    edit?.scope === scope &&
    edit.code === code && (
      <form
        className="inline-price-editor"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await request('catalog/pricing', {
              scope,
              code,
              revision: edit.revision,
              rule: edit,
            });
            await onUpdated();
            setEdit(null);
            setMessage('設定已儲存，全教會同步');
          });
        }}
      >
        <strong>
          {scope === 'products' ? name(code) : catalog.classes[code]} · 修改
        </strong>
        <div className="inline-fields">
          <label>
            方式
            <select
              value={edit.mode}
              onChange={(e) => setEdit({ ...edit, mode: e.target.value })}
            >
              <option value="discount">折數</option>
              <option value="price">固定單價 $</option>
            </select>
          </label>
          <label>
            數值
            <Input
              type="number"
              required
              min="0"
              step="0.1"
              max={edit.mode === 'price' ? 9999999 : 100}
              value={edit.value}
              onChange={(e) => setEdit({ ...edit, value: e.target.value })}
            />
          </label>
        </div>
        <details>
          <summary>有效日期（預設永久）</summary>
          <div className="inline-fields">
            <label>
              開始
              <Input
                type="date"
                value={edit.start}
                onChange={(e) => setEdit({ ...edit, start: e.target.value })}
              />
            </label>
            <label>
              結束
              <Input
                type="date"
                value={edit.end}
                onChange={(e) => setEdit({ ...edit, end: e.target.value })}
              />
            </label>
          </div>
        </details>
        {scope === 'products' && (
          <div className="inline-fields">
            <label>
              商品類別
              <select
                value={edit.class}
                onChange={(e) => setEdit({ ...edit, class: e.target.value })}
              >
                {Object.entries(catalog.classes).map(([c, n]) => (
                  <option key={c} value={c}>
                    {c} · {String(n)}
                  </option>
                ))}
              </select>
            </label>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  await request('catalog/classify', {
                    code,
                    class: edit.class,
                    revision: edit.classRevision,
                  });
                  await onUpdated();
                  setEdit(null);
                  setMessage('類別已更新');
                })
              }
            >
              確認類別
            </Button>
          </div>
        )}
        <div className="heading-actions">
          <Button type="submit" disabled={busy}>
            確認價格
          </Button>
          <Button
            variant="outline"
            type="button"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await request('catalog/pricing', {
                  scope,
                  code,
                  revision: edit.revision,
                  rule: { disabled: true },
                });
                await onUpdated();
                setEdit(null);
              })
            }
          >
            停用此特價
          </Button>
          <Button variant="ghost" type="button" onClick={() => setEdit(null)}>
            取消
          </Button>
        </div>
      </form>
    );
  const products = catalog.products.filter((p: any) =>
    [p.name, p.webName, p.code, p.barcode, p.webBarcode].some((v) =>
      String(v || '')
        .toLowerCase()
        .includes(query.toLowerCase()),
    ),
  );
  return (
    <section className="price-workspace">
      <div className="price-tabs" role="tablist" aria-label="商品與折扣">
        {[
          ['products', '商品列表'],
          ['classes', '類別折扣'],
          ['groups', '折扣群組／買一送一'],
        ].map(([key, title]) => (
          <button
            role="tab"
            aria-selected={tab === key}
            key={key}
            onClick={() => setTab(key)}
          >
            {title}
          </button>
        ))}
      </div>
      <p className="pricing-order">
        群組 → 單品 → 官網 → 類別 → 原價。依順位擇一，不累加。
        {!readOnly && '雙擊膠囊修改，手機可按「修改」。'}
      </p>
      {message && (
        <p className="price-message" role="status">
          {message}
        </p>
      )}
      {tab === 'products' && (
        <>
          {!readOnly && (
            <CSVImport
              catalog={catalog}
              request={request}
              onUpdated={onUpdated}
            />
          )}
          <Input
            aria-label="搜尋商品"
            placeholder="搜尋 CSV 書名、官網名稱、代碼或條碼"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div className="product-price-list">
            {products.slice(0, 100).map((p: any) => {
              const base = resolveProductPricing(p),
                matched = productPromotions(p, groups),
                priced =
                  applyPromotions(
                    [{ ...base, quantity: 1, discount: base.defaultDiscount }],
                    catalog.products,
                    groups,
                  ).find((i: any) => !i.promotionGift) || base;
              return (
                <article
                  key={p.code}
                  id={'price-row-products-' + p.code}
                  className="product-price-row"
                >
                  <div className="product-price-heading">
                    <div>
                      <b>{p.name}</b>
                      <small>
                        {p.code} · {catalog.classes[p.class] || p.class} ·{' '}
                        {p.barcode || p.webBarcode}
                      </small>
                    </div>
                    <div className="price-result">
                      <strong>
                        $
                        {money(
                          (priced.price *
                            (priced.discount ?? base.defaultDiscount)) /
                            100,
                        )}
                      </strong>
                      <small>單件 · {priced.priceLabel}</small>
                    </div>
                  </div>
                  <div className="price-pills">
                    {matched.map((g: any) => (
                      <span key={g.id}>
                        {pill(
                          g.name,
                          'group',
                          priced.promotionId === g.id,
                          () => openGroup(g),
                        )}
                      </span>
                    ))}
                    {pill(
                      '單品 ' + ruleLabel(p.productRule),
                      'single',
                      ['product', 'legacy-special'].includes(
                        priced.priceSource,
                      ),
                      () => openRule('products', p.code),
                    )}
                    {p.websitePrice != null &&
                      pill(
                        '官網 $' + money(p.websitePrice),
                        'web',
                        priced.priceSource === 'website',
                        () => openRule('products', p.code),
                      )}
                    {pill(
                      '類別 ' + ruleLabel(p.categoryRule),
                      'category',
                      priced.priceSource === 'legacy',
                      () => {
                        setTab('classes');
                        openRule('classes', p.class);
                      },
                    )}
                    {pill(
                      '原價 $' + money(p.legacyPrice ?? p.price),
                      'original',
                      priced.priceSource === 'original',
                      () => openRule('products', p.code),
                    )}
                    {!readOnly && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => openRule('products', p.code)}
                      >
                        修改
                      </Button>
                    )}
                  </div>
                  {(matched.length > 1 ||
                    (matched.length > 0 && ruleActive(p.productRule))) && (
                    <p className="price-overlap">
                      重複設定：達門檻時群組優先，不累加折扣。多群組依順位數字由小到大採用。
                    </p>
                  )}
                  {inline('products', p.code)}
                </article>
              );
            })}
          </div>
          <p className="footnote">
            顯示 {Math.min(100, products.length)} / {products.length}{' '}
            件。門檻依購物車合計數量判定。
          </p>
        </>
      )}
      {tab === 'classes' && (
        <div className="category-price-list">
          {Object.entries(catalog.classes).map(([code, title]) => (
            <article
              className="category-price-row"
              id={'price-row-classes-' + code}
              key={code}
            >
              <div className="product-price-heading">
                <div>
                  <b>{String(title)}</b>
                  <small>
                    {code} ·{' '}
                    {
                      catalog.products.filter((p: any) => p.class === code)
                        .length
                    }{' '}
                    件
                  </small>
                </div>
                <div className="price-pills">
                  {pill(
                    ruleLabel(rules.classes[code]),
                    'category',
                    ruleActive(rules.classes[code]),
                    () => openRule('classes', code),
                  )}
                  {!readOnly && (
                    <Button
                      variant="ghost"
                      onClick={() => openRule('classes', code)}
                    >
                      修改
                    </Button>
                  )}
                </div>
              </div>
              {inline('classes', code)}
            </article>
          ))}
        </div>
      )}
      {tab === 'groups' && (
        <>
          <div className="heading-actions">
            {!readOnly && (
              <>
                <Button onClick={() => newGroup('bogo')}>＋ 買一送一</Button>
                <Button variant="outline" onClick={() => newGroup('tiers')}>
                  ＋ 數量折扣
                </Button>
                <Button
                  disabled={busy}
                  variant="outline"
                  onClick={() =>
                    run(async () => {
                      const r = await request('catalog/sync-promotions', {
                        revision: catalog.pricingRevision,
                      });
                      await onUpdated();
                      setMessage('已同步官網 ' + r.count + ' 件買一送一商品');
                    })
                  }
                >
                  同步官網買一送一
                </Button>
              </>
            )}
          </div>
          {group && (
            <form
              id="group-editor"
              className="group-editor inline-price-editor"
              onSubmit={(e) => {
                e.preventDefault();
                run(async () => {
                  await request('catalog/group', {
                    revision: group.revision,
                    group: {
                      ...group,
                      codes: codes(group.codesText),
                      giftCodes: codes(group.giftCodesText),
                    },
                  });
                  await onUpdated();
                  setGroup(null);
                  setMessage('活動已儲存');
                });
              }}
            >
              <h3>{group.type === 'bogo' ? '買一送一' : '數量折扣'}</h3>
              <label>
                活動名稱
                <Input
                  required
                  value={group.name}
                  onChange={(e) => setGroup({ ...group, name: e.target.value })}
                />
              </label>
              <label>
                參加商品代碼（逗號或換行分隔）
                <textarea
                  required
                  rows={2}
                  placeholder="C175, C197"
                  value={group.codesText}
                  onChange={(e) =>
                    setGroup({
                      ...group,
                      codesText: e.target.value.toUpperCase(),
                    })
                  }
                />
              </label>
              <p className="muted">
                {codes(group.codesText).map(name).join('、')}
              </p>
              {group.type === 'bogo' ? (
                <>
                  <label>
                    贈品商品代碼（留白為同商品）
                    <Input
                      list="promotion-products"
                      value={group.giftCode}
                      onChange={(e) =>
                        setGroup({
                          ...group,
                          giftCode: e.target.value.toUpperCase(),
                        })
                      }
                    />
                  </label>
                  <label>
                    其他可搭配的贈品代碼（可留白）
                    <Input
                      value={group.giftCodesText}
                      onChange={(e) =>
                        setGroup({
                          ...group,
                          giftCodesText: e.target.value.toUpperCase(),
                        })
                      }
                    />
                  </label>
                  <p className="muted">
                    掃描購買商品與符合的贈品後，自動套用一件原價、一件免費；未滿兩件不套用。
                  </p>
                </>
              ) : (
                <div>
                  <p>同群組商品合計件數，達門檻後整組適用。</p>
                  {group.tiers.map((t: any, index: number) => (
                    <div className="tier-row" key={index}>
                      <label>
                        滿幾件
                        <Input
                          type="number"
                          min="1"
                          step="1"
                          required
                          value={t.quantity}
                          onChange={(e) =>
                            setGroup({
                              ...group,
                              tiers: group.tiers.map((v: any, i: number) =>
                                i === index
                                  ? { ...v, quantity: Number(e.target.value) }
                                  : v,
                              ),
                            })
                          }
                        />
                      </label>
                      <label>
                        方式
                        <select
                          value={t.mode}
                          onChange={(e) =>
                            setGroup({
                              ...group,
                              tiers: group.tiers.map((v: any, i: number) =>
                                i === index
                                  ? { ...v, mode: e.target.value }
                                  : v,
                              ),
                            })
                          }
                        >
                          <option value="discount">折數</option>
                          <option value="price">每件單價 $</option>
                        </select>
                      </label>
                      <label>
                        數值
                        <Input
                          type="number"
                          min="0"
                          step="0.1"
                          required
                          value={t.value}
                          onChange={(e) =>
                            setGroup({
                              ...group,
                              tiers: group.tiers.map((v: any, i: number) =>
                                i === index
                                  ? { ...v, value: Number(e.target.value) }
                                  : v,
                              ),
                            })
                          }
                        />
                      </label>
                      <Button
                        variant="ghost"
                        type="button"
                        onClick={() =>
                          setGroup({
                            ...group,
                            tiers: group.tiers.filter(
                              (_: any, i: number) => i !== index,
                            ),
                          })
                        }
                      >
                        移除
                      </Button>
                    </div>
                  ))}
                  <Button
                    variant="outline"
                    type="button"
                    onClick={() =>
                      setGroup({
                        ...group,
                        tiers: [
                          ...group.tiers,
                          { quantity: 1, mode: 'discount', value: 100 },
                        ],
                      })
                    }
                  >
                    ＋ 新增門檻
                  </Button>
                </div>
              )}
              <details>
                <summary>有效日期及群組順位</summary>
                <div className="inline-fields">
                  <label>
                    開始
                    <Input
                      type="date"
                      value={group.start}
                      onChange={(e) =>
                        setGroup({ ...group, start: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    結束
                    <Input
                      type="date"
                      value={group.end}
                      onChange={(e) =>
                        setGroup({ ...group, end: e.target.value })
                      }
                    />
                  </label>
                  <label>
                    順位（數字小者優先）
                    <Input
                      type="number"
                      value={group.priority}
                      onChange={(e) =>
                        setGroup({ ...group, priority: Number(e.target.value) })
                      }
                    />
                  </label>
                </div>
              </details>
              <div className="heading-actions">
                <Button type="submit" disabled={busy}>
                  確認儲存
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setGroup(null)}
                >
                  取消
                </Button>
              </div>
            </form>
          )}
          <datalist id="promotion-products">
            {catalog.products.map((p: any) => (
              <option value={p.code} key={p.code}>
                {p.name}
              </option>
            ))}
          </datalist>
          <div className="group-list">
            {groups.map((g: any) => (
              <article className="group-card" key={g.id}>
                <div className="product-price-heading">
                  <div>
                    <b>{g.name}</b>
                    <small>
                      {g.disabled
                        ? '已停用'
                        : ruleActive(g)
                          ? '有效'
                          : '未生效／已到期'}{' '}
                      · 順位 {g.priority} · {g.start || '即日起'}～
                      {g.end || '永久'}
                    </small>
                  </div>
                  {!readOnly && (
                    <div className="heading-actions">
                      <Button variant="outline" onClick={() => openGroup(g)}>
                        修改
                      </Button>
                      <Button
                        variant="ghost"
                        disabled={busy}
                        onClick={() =>
                          run(async () => {
                            await request('catalog/group', {
                              revision: catalog.pricingRevision,
                              group: { ...g, disabled: !g.disabled },
                            });
                            await onUpdated();
                          })
                        }
                      >
                        {g.disabled ? '啟用' : '停用'}
                      </Button>
                    </div>
                  )}
                </div>
                <p>{g.codes.map(name).join('、')}</p>
                <div className="price-pills">
                  {g.type === 'bogo'
                    ? pill(
                        '買一送一 · ' +
                          ((g.giftCodes?.length ? g.giftCodes : [g.giftCode])
                            .filter(Boolean)
                            .map(name)
                            .join('／') || '送同商品'),
                        'group',
                        false,
                      )
                    : g.tiers.map((t: any) => (
                        <span key={t.quantity}>
                          {pill(
                            '滿 ' + t.quantity + ' 件 ' + ruleLabel(t),
                            'group',
                            false,
                          )}
                        </span>
                      ))}
                </div>
                {g.codes.some((c: string) => ruleActive(rules.products[c])) && (
                  <p className="price-overlap">
                    部分商品另有單品設定，達群組門檻時以群組優先。
                  </p>
                )}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

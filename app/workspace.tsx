'use client';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  Table,
  TableHeader,
  TableHead,
  TableRow,
  TableBody,
  TableCell,
} from '@/components/ui/table';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import {
  Sidebar,
  SidebarProvider,
  SidebarContent,
  SidebarHeader,
  SidebarFooter,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import {
  BookOpen,
  CalendarDays,
  Store,
  Users,
  Package,
  ArrowUpRight,
  Plus,
  Search,
  ArrowLeft,
  ScanBarcode,
  ReceiptText,
  CloudCheck,
  LogOut,
  RefreshCw,
  Download,
  Archive,
  Wallet,
  Check,
  ShieldCheck,
} from 'lucide-react';
import Camera from './camera';
const money = (v: number) =>
  new Intl.NumberFormat('zh-TW', { maximumFractionDigits: 0 }).format(v || 0);
const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
async function api(path: string, body?: any): Promise<any> {
  const r = await fetch(
    '/api/' + path,
    body === undefined
      ? {}
      : {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        },
  );
  const j: any = await r.json();
  if (!r.ok) throw new Error(j.error || '連線失敗');
  return j;
}
function download(data: any, name: string) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(
    new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
  );
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
export default function Workspace({ tenant = '' }: { tenant?: string }) {
  const [me, setMe] = useState<any>(null),
    [loaded, setLoaded] = useState(false),
    [password, setPassword] = useState(''),
    [error, setError] = useState(''),
    [notice, setNotice] = useState(''),
    [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<any[]>([]),
    [catalog, setCatalog] = useState<any>(null),
    [section, setSection] = useState('events'),
    [search, setSearch] = useState(''),
    [filter, setFilter] = useState('all'),
    [active, setActive] = useState<any>(null),
    [view, setView] = useState('checkout'),
    [state, setState] = useState<any>({}),
    [closings, setClosings] = useState<any[]>([]);
  const [newEvent, setNewEvent] = useState(false),
    [eventName, setEventName] = useState(''),
    [eventDate, setEventDate] = useState(''),
    [eventTenant, setEventTenant] = useState(''),
    [pricing, setPricing] = useState('website');
  const [churchCode, setChurchCode] = useState(''),
    [churchPassword, setChurchPassword] = useState(''),
    [churches, setChurches] = useState<any[]>([]),
    [stock, setStock] = useState(''),
    [stockMode, setStockMode] = useState('add'),
    [camera, setCamera] = useState(false),
    [cloudStatus, setCloudStatus] = useState('雲端資料'),
    [cloudError, setCloudError] = useState(false),
    [sync, setSync] = useState<any>(null),
    [syncing, setSyncing] = useState(false),
    [day, setDay] = useState(''),
    [closeDialog, setCloseDialog] = useState(false),
    [counted, setCounted] = useState('0'),
    [initial, setInitial] = useState('11000'),
    [expenses, setExpenses] = useState('0'),
    [closeNotes, setCloseNotes] = useState('');
  const frame = useRef<HTMLIFrameElement>(null),
    viewRef = useRef(view),
    activeRef = useRef(active),
    stopSync = useRef(false);
  viewRef.current = view;
  activeRef.current = active;
  async function load() {
    const user = await api('me');
    if (tenant && user.tenant !== tenant) {
      await api('logout', {});
      throw Error('請使用此教會入口密碼登入');
    }
    const [es, cat] = await Promise.all([api('events'), api('catalog')]);
    setEvents(es);
    setCatalog(cat);
    setMe(user);
    if (user.role === 'admin') {
      setChurches(await api('churches'));
      const job = await api('sync-shop');
      setSync(job);
      const last =
        job.finished ||
        cat.products
          .filter((p: any) => p.syncedAt)
          .map((p: any) => p.syncedAt)
          .sort()
          .at(-1);
      if (!last || Date.now() - new Date(last).getTime() > 24 * 3600000)
        setTimeout(() => syncShop(!job.total || job.cursor >= job.total), 1500);
    }
  }
  useEffect(() => {
    setEventDate(today());
    setDay(today());
    load()
      .catch(() => {})
      .finally(() => setLoaded(true));
    return () => {
      stopSync.current = true;
    };
  }, []);
  useEffect(() => {
    const listener = (e: MessageEvent) => {
      if (
        e.origin !== location.origin ||
        e.source !== frame.current?.contentWindow
      )
        return;
      const m = e.data;
      if (m.type === 'height' && frame.current)
        frame.current.style.height =
          Math.max(460, Number(m.height) || 0) + 'px';
      if (m.type === 'cloud-status') {
        setCloudStatus(m.text);
        setCloudError(m.error);
      }
      if (m.type === 'register-ready')
        frame.current?.contentWindow?.postMessage(
          { type: 'view', view: viewRef.current },
          location.origin,
        );
      if (m.type === 'saved') {
        api('events').then(setEvents);
        if (activeRef.current)
          api('events/' + activeRef.current.id).then((r) => setState(r.state));
      }
    };
    window.addEventListener('message', listener);
    return () => window.removeEventListener('message', listener);
  }, []);
  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };
  async function openEvent(e: any) {
    const [record, closing] = await Promise.all([
      api('events/' + e.id),
      api('events/' + e.id + '/close'),
    ]);
    setState(record.state);
    setClosings(closing);
    setActive(e);
    setView('checkout');
  }
  function tab(v: any) {
    setView(v);
    frame.current?.contentWindow?.postMessage(
      { type: 'view', view: v },
      location.origin,
    );
    if (active) api('events/' + active.id).then((r) => setState(r.state));
  }
  async function flushFrame() {
    const cloud = (frame.current?.contentWindow as any)?.POSCloud;
    if (cloud) await cloud.flush();
  }
  async function goHome() {
    await flushFrame();
    setActive(null);
    setEvents(await api('events'));
  }
  async function create() {
    const result = await api('events', {
      name: eventName,
      date: eventDate,
      tenant: eventTenant.split('｜')[0].trim(),
      pricing,
    });
    setNewEvent(false);
    setEventName('');
    const all = await api('events');
    setEvents(all);
    await openEvent(all.find((e: any) => e.id === result.id));
  }
  async function syncShop(restart = false) {
    setSyncing(true);
    stopSync.current = false;
    try {
      let result = await api('sync-shop', { restart });
      setSync(result);
      while (!result.finished && !stopSync.current) {
        result = await api('sync-shop', {});
        setSync(result);
      }
      setCatalog(await api('catalog'));
      setNotice(
        result.finished ? '商品價格同步完成' : '同步已暫停，可隨時繼續',
      );
    } catch (e: any) {
      setError(e.message);
    } finally {
      setSyncing(false);
    }
  }
  async function updateStock() {
    const fresh = await api('events/' + active.id);
    const changes: any[] = [];
    const next = { ...fresh.state };
    for (const line of stock.split(/\r?\n/).filter((x) => x.trim())) {
      const match = line.trim().match(/^(\S+)[,，\s]+(-?\d+)$/);
      if (!match) throw Error('格式請使用「商品代碼,數量」，每行一筆');
      const p = catalog.products.find((p: any) =>
        [p.code, p.barcode, p.webBarcode].includes(match[1].toUpperCase()),
      );
      if (!p) throw Error('找不到商品：' + match[1]);
      const key = 'stock:' + p.code;
      next[key] = (stockMode === 'set' ? 0 : next[key] || 0) + Number(match[2]);
    }
    for (const key of Object.keys(next).filter((k) => k.startsWith('stock:')))
      if (next[key] !== fresh.state[key])
        changes.push({
          key,
          before: fresh.state[key] ?? null,
          after: next[key],
        });
    const r = await api('events/' + active.id + '/sync', { changes });
    setState(r.state);
    setStock('');
    setNotice('商品數量已儲存');
  }
  const products = (catalog?.products || []).filter((p: any) =>
    [p.name, p.code, p.barcode, p.webBarcode]
      .join(' ')
      .toLowerCase()
      .includes(search.toLowerCase()),
  );
  const visibleEvents = events.filter(
    (e) =>
      (filter === 'all' || e.status === filter) &&
      [e.name, e.tenant, e.date]
        .join(' ')
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const scopedTotal = events.reduce((s, e) => s + e.revenue, 0);
  const sales = Object.entries(state)
    .filter(([k]) => k.startsWith('order:'))
    .map(([, v]: any) => v)
    .filter((o) => o.isValid);
  const sold = (code: string) =>
    sales.reduce(
      (s, o) =>
        s +
        o.items
          .filter((i: any) => i.code === code)
          .reduce((s: number, i: any) => s + i.quantity, 0),
      0,
    );
  const daySales = sales.filter(
    (o) =>
      (o.createdAt
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(
            new Date(o.createdAt),
          )
        : String(o.id)
            .slice(0, 8)
            .replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')) === day,
  );
  const dayCash = daySales
    .flatMap((o) => o.paymentRecords || [])
    .filter((p) => p.method === '現金')
    .reduce((s, p) => s + p.amount, 0);
  if (!loaded)
    return (
      <main className="loading">
        <BookOpen />
        <p>正在連接書展工作台…</p>
      </main>
    );
  if (!me)
    return (
      <main className="login">
        <div className="login-brand">
          <BookOpen size={36} />
          <span>
            PHILEMON <b>POS</b>
          </span>
          <span className="stage">V2 測試站</span>
        </div>
        <div className="login-card">
          <span className="eyebrow">
            {tenant ? tenant.toUpperCase() + ' 教會入口' : '腓利門書房'}
          </span>
          <h1>{tenant ? '歡迎回到書報組' : '書展工作台'}</h1>
          <p>
            {tenant
              ? '登入後管理自己教會的書展與交易。'
              : '從一場書展開始，把每次服事好好保存。'}
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(async () => {
                await api('login', { tenant, password });
                setPassword('');
                await load();
              });
            }}
          >
            <label htmlFor="password">
              {tenant ? '教會入口密碼' : '書房管理密碼'}
            </label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <Button type="submit" className="primary wide" disabled={busy}>
              {busy ? '登入中…' : '登入工作台'}
              <ArrowUpRight />
            </Button>
          </form>
          <div className="login-note">
            <ShieldCheck /> 獨立測試環境，所有操作都屬於 V2 測試資料。
          </div>
        </div>
        <small>腓利門書房 · 書展與教會書報組</small>
      </main>
    );
  return (
    <SidebarProvider>
      <Sidebar className="pos-sidebar">
        <SidebarHeader>
          <div className="brand">
            <BookOpen />
            <span>
              PHILEMON<b>雲端 POS</b>
            </span>
          </div>
          <span className="stage">V2 · STAGING</span>
        </SidebarHeader>
        <SidebarContent>
          <div className="side-label">工作空間</div>
          <SidebarMenu>
            {[
              ['events', '書展銷售清單', CalendarDays],
              ['catalog', '商品資料', Package],
              ...(me.role === 'admin' ? [['churches', '教會入口', Users]] : []),
            ].map(([key, label, Icon]: any) => (
              <SidebarMenuItem key={key}>
                <SidebarMenuButton
                  isActive={section === key && !active}
                  onClick={() =>
                    run(async () => {
                      await goHome();
                      setSection(key);
                      setSearch('');
                    })
                  }
                >
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
          <div className="side-note">
            <CloudCheck size={20} />
            <p>
              每場書展，獨立保存。
              <br />
              換一台裝置，繼續工作。
            </p>
          </div>
        </SidebarContent>
        <SidebarFooter>
          <div className="user">
            <span>{me.role === 'admin' ? '腓' : '教'}</span>
            <div>
              <b>{me.name}</b>
              <small>
                {me.role === 'admin' ? '書房管理員' : me.tenant.toUpperCase()}
              </small>
            </div>
          </div>
          <Button
            variant="ghost"
            onClick={() =>
              run(async () => {
                await flushFrame();
                await api('logout', {});
                setMe(null);
                setActive(null);
              })
            }
          >
            <LogOut size={16} /> 登出
          </Button>
        </SidebarFooter>
      </Sidebar>
      <main className="workspace">
        <header className="topbar">
          <div>
            <SidebarTrigger />
            <span>
              {active
                ? '書展 / ' + active.name
                : section === 'events'
                  ? '書展管理'
                  : section === 'catalog'
                    ? '商品資料'
                    : '教會入口'}
            </span>
          </div>
          <span className={cloudError ? 'error connection' : 'connection'}>
            <CloudCheck size={16} />
            {active ? cloudStatus : '已連接雲端'}
          </span>
        </header>
        <div className="page-content">
          {error && (
            <div className="banner error" role="alert">
              {error}
              <button onClick={() => setError('')}>關閉</button>
            </div>
          )}
          {notice && (
            <div className="banner success" role="status">
              <Check size={16} />
              {notice}
              <button onClick={() => setNotice('')}>關閉</button>
            </div>
          )}
          {active ? (
            <>
              <button className="back" onClick={() => run(goHome)}>
                <ArrowLeft size={16} /> 所有書展
              </button>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">
                    {active.tenant
                      ? active.tenant.toUpperCase() + ' · 教會書展'
                      : '腓利門書房 · 外出書展'}
                  </span>
                  <h1>{active.name}</h1>
                  <p>
                    {active.date} <span className="dot">·</span>{' '}
                    {active.pricing === 'website'
                      ? '採用官網售價'
                      : '採用原書展折扣'}{' '}
                    <span className="dot">·</span>{' '}
                    {active.status === 'open' ? '進行中' : '已封存'}
                  </p>
                </div>
                <div className="heading-actions">
                  {me.role === 'admin' && (
                    <Button
                      variant="outline"
                      onClick={() =>
                        run(async () => {
                          await flushFrame();
                          await api('events/' + active.id + '/archive', {
                            open: active.status !== 'open',
                          });
                          const all = await api('events');
                          setEvents(all);
                          setActive(all.find((e: any) => e.id === active.id));
                          if (frame.current)
                            frame.current.src = frame.current.src;
                        })
                      }
                    >
                      <Archive />
                      {active.status === 'open' ? '封存' : '重新開啟'}
                    </Button>
                  )}
                  <Button
                    className="primary"
                    onClick={() => {
                      tab('checkout');
                      setCamera(true);
                    }}
                    disabled={active.status !== 'open'}
                  >
                    <ScanBarcode /> 相機掃描
                  </Button>
                </div>
              </div>
              <Tabs value={view} onValueChange={tab}>
                <TabsList variant="line" className="work-tabs">
                  <TabsTrigger value="checkout">
                    <Store /> 結帳
                  </TabsTrigger>
                  <TabsTrigger value="history">
                    <ReceiptText /> 交易與營收
                  </TabsTrigger>
                  <TabsTrigger value="stock">
                    <Package /> 商品數量
                  </TabsTrigger>
                  <TabsTrigger value="accounting">
                    <Wallet /> 日結
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <iframe
                ref={frame}
                title="書展收銀台"
                src={'/register.html?event=' + active.id}
                allow="camera"
                className="register-frame"
                style={{ display: view === 'stock' ? 'none' : 'block' }}
              />
              {view === 'stock' && (
                <div className="stock-layout">
                  <section className="panel">
                    <h2>批次建立與調整</h2>
                    <p className="muted">
                      數量可以留白。缺貨或負數不會阻擋結帳。
                    </p>
                    <label>調整方式</label>
                    <Select
                      value={stockMode}
                      onValueChange={(v) => setStockMode(v || 'add')}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="add">加減現有數量</SelectItem>
                        <SelectItem value="set">設定為輸入數量</SelectItem>
                      </SelectContent>
                    </Select>
                    <label htmlFor="stock-input">
                      商品代碼,數量 · 每行一筆
                    </label>
                    <textarea
                      id="stock-input"
                      value={stock}
                      onChange={(e) => setStock(e.target.value)}
                      placeholder={'C296,20\nC001,-2'}
                      rows={8}
                    />
                    <Button
                      className="primary"
                      disabled={busy || active.status !== 'open'}
                      onClick={() => run(updateStock)}
                    >
                      儲存數量
                    </Button>
                  </section>
                  <section className="panel">
                    <h2>本場商品數量</h2>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>商品</TableHead>
                          <TableHead>配置</TableHead>
                          <TableHead>售出</TableHead>
                          <TableHead>參考剩餘</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {Object.keys(state)
                          .filter((k) => k.startsWith('stock:'))
                          .map((k) => (
                            <TableRow key={k}>
                              <TableCell>
                                <b>
                                  {
                                    catalog.products.find(
                                      (p: any) => p.code === k.slice(6),
                                    )?.name
                                  }
                                </b>
                                <small>{k.slice(6)}</small>
                              </TableCell>
                              <TableCell>{state[k]}</TableCell>
                              <TableCell>{sold(k.slice(6))}</TableCell>
                              <TableCell>
                                {state[k] - sold(k.slice(6))}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                    {!Object.keys(state).some((k) =>
                      k.startsWith('stock:'),
                    ) && (
                      <div className="empty">
                        <Package />
                        <h3>尚未建立商品數量</h3>
                        <p>可直接開始結帳，之後再補上。</p>
                      </div>
                    )}
                  </section>
                </div>
              )}
              {view === 'accounting' && (
                <section className="panel closing-panel">
                  <div className="panel-heading">
                    <div>
                      <h2>保存日結紀錄</h2>
                      <p className="muted">
                        每次日結保存當下的交易與盤點，歷史紀錄持續保留。
                      </p>
                    </div>
                    <Button
                      className="primary"
                      onClick={() => setCloseDialog(true)}
                      disabled={active.status !== 'open'}
                    >
                      <Plus /> 建立日結
                    </Button>
                  </div>
                  {closings.map((c) => {
                    const snap = JSON.parse(c.snapshot);
                    return (
                      <div className="closing-row" key={c.id}>
                        <div>
                          <b>{c.day}</b>
                          <small>
                            {new Date(c.created).toLocaleString('zh-TW')} 保存
                          </small>
                        </div>
                        <span>{snap.totals.orders} 筆交易</span>
                        <strong>NT$ {money(snap.totals.revenue)}</strong>
                        <Button
                          variant="outline"
                          onClick={() =>
                            download(
                              { ...c, snapshot: snap },
                              '日結-' + c.day + '.json',
                            )
                          }
                        >
                          <Download /> 下載
                        </Button>
                      </div>
                    );
                  })}
                  {!closings.length && (
                    <p className="muted">本場尚無日結紀錄。</p>
                  )}
                  <Button
                    variant="outline"
                    onClick={() =>
                      run(async () =>
                        download(
                          await api('events/' + active.id + '/backup'),
                          '書展完整備份-' + active.date + '.json',
                        ),
                      )
                    }
                  >
                    <Download /> 下載本場完整備份與修訂紀錄
                  </Button>
                </section>
              )}
            </>
          ) : section === 'events' ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">BOOK FAIRS</span>
                  <h1>書展銷售清單</h1>
                  <p>開啟一場書展，開始今天的服事。</p>
                </div>
                <Button className="primary" onClick={() => setNewEvent(true)}>
                  <Plus /> 新增書展
                </Button>
              </div>
              <div className="kpis">
                <div>
                  <span>進行中的書展</span>
                  <strong>
                    {events.filter((e) => e.status === 'open').length}
                    <small>場</small>
                  </strong>
                  <CalendarDays />
                </div>
                <div>
                  <span>累計交易</span>
                  <strong>
                    {money(events.reduce((s, e) => s + e.orders, 0))}
                    <small>筆</small>
                  </strong>
                  <ReceiptText />
                </div>
                <div className="revenue">
                  <span>書展累計營收</span>
                  <strong>
                    <small>NT$</small> {money(scopedTotal)}
                  </strong>
                  <ArrowUpRight />
                </div>
              </div>
              <div className="list-tools">
                <Tabs
                  value={filter}
                  onValueChange={(v) => setFilter(String(v))}
                >
                  <TabsList>
                    <TabsTrigger value="all">全部場次</TabsTrigger>
                    <TabsTrigger value="open">進行中</TabsTrigger>
                    <TabsTrigger value="archived">已封存</TabsTrigger>
                  </TabsList>
                </Tabs>
                <div className="search">
                  <Search />
                  <Input
                    aria-label="搜尋書展"
                    placeholder="搜尋書展、教會或日期"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <section className="event-list">
                {visibleEvents.map((e) => (
                  <button
                    className="event-row"
                    key={e.id}
                    onClick={() => run(() => openEvent(e))}
                  >
                    <div className="event-icon">
                      {e.tenant ? <Users /> : <BookOpen />}
                    </div>
                    <div className="event-name">
                      <h2>{e.name}</h2>
                      <p>
                        {e.date}
                        <span className="dot">·</span>
                        {e.tenant
                          ? catalog.customers.find(
                              (c: any) => c.code.toLowerCase() === e.tenant,
                            )?.name || e.tenant
                          : '腓利門書房'}
                      </p>
                    </div>
                    <span className={'badge ' + e.status}>
                      {e.status === 'open' ? '進行中' : '已封存'}
                    </span>
                    <div className="event-total">
                      <b>NT$ {money(e.revenue)}</b>
                      <small>{e.orders} 筆交易</small>
                    </div>
                    <ArrowUpRight className="event-arrow" />
                  </button>
                ))}
                {!visibleEvents.length && (
                  <div className="empty">
                    <BookOpen />
                    <h2>{search ? '找不到符合的書展' : '準備好下一場書展'}</h2>
                    <p>建立場次後，結帳、交易與日結都會保存在這裡。</p>
                    {!search && (
                      <Button
                        className="primary"
                        onClick={() => setNewEvent(true)}
                      >
                        <Plus /> 新增第一場書展
                      </Button>
                    )}
                  </div>
                )}
              </section>
              <p className="footnote">
                <ShieldCheck size={15} />{' '}
                歷史場次持續保留。封存後可查詢，也可由書房重新開啟。
              </p>
            </>
          ) : section === 'catalog' ? (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">PRODUCT CATALOG</span>
                  <h1>商品資料</h1>
                  <p>
                    {catalog.products.length} 件商品 ·{' '}
                    {catalog.products.filter((p: any) => p.syncedAt).length}{' '}
                    件已比對官網
                  </p>
                </div>
                {me.role === 'admin' && (
                  <Button
                    className="primary"
                    disabled={syncing}
                    onClick={() => syncShop(true)}
                  >
                    <RefreshCw className={syncing ? 'spin' : ''} />{' '}
                    {syncing ? '同步中…' : '同步官網'}
                  </Button>
                )}
              </div>
              {sync && (
                <div className="sync-box">
                  <CloudCheck />
                  <span>
                    同步進度 {sync.cursor || 0} / {sync.total || 0}，成功比對{' '}
                    {sync.matched || 0} 件，失敗 {sync.failed || 0} 頁
                    {sync.finished ? ' · 已完成' : ''}
                  </span>
                  {syncing ? (
                    <Button
                      variant="outline"
                      onClick={() => (stopSync.current = true)}
                    >
                      暫停
                    </Button>
                  ) : (
                    sync.total > sync.cursor && (
                      <Button variant="outline" onClick={() => syncShop()}>
                        繼續同步
                      </Button>
                    )
                  )}
                </div>
              )}
              <div className="search catalog-search">
                <Search />
                <Input
                  aria-label="搜尋商品"
                  placeholder="搜尋名稱、商品代碼、條碼"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <section className="panel">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>商品</TableHead>
                      <TableHead>Barcode</TableHead>
                      <TableHead>官網售價</TableHead>
                      <TableHead>定價</TableHead>
                      <TableHead>同步時間</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {products.slice(0, 100).map((p: any) => (
                      <TableRow key={p.code}>
                        <TableCell>
                          <div className="product-name">
                            {p.image ? (
                              <img src={p.image} alt="" loading="lazy" />
                            ) : (
                              <span className="book-placeholder">
                                <BookOpen />
                              </span>
                            )}
                            <div>
                              <b>{p.name}</b>
                              <small>{p.code}</small>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          {p.barcode || p.webBarcode || '—'}
                        </TableCell>
                        <TableCell>
                          <strong>
                            {p.websitePrice != null
                              ? '$' + money(p.websitePrice)
                              : '尚未比對'}
                          </strong>
                        </TableCell>
                        <TableCell>${money(p.listPrice)}</TableCell>
                        <TableCell>
                          {p.syncedAt ? (
                            <a
                              href={p.sourceUrl}
                              target="_blank"
                              rel="noreferrer"
                            >
                              {new Date(p.syncedAt).toLocaleDateString('zh-TW')}{' '}
                              ↗
                            </a>
                          ) : (
                            'CSV 基礎資料'
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <p className="footnote">
                  顯示 {Math.min(products.length, 100)} / {products.length}{' '}
                  件。尚未比對官網的商品沿用原書展定價與折扣。
                </p>
              </section>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <span className="eyebrow">CHURCH ACCESS</span>
                  <h1>教會入口</h1>
                  <p>以現有客戶代碼建立入口，教會只會看到自己的場次。</p>
                </div>
              </div>
              <div className="stock-layout">
                <section className="panel">
                  <h2>設定教會密碼</h2>
                  <label htmlFor="church-code">教會客戶代碼</label>
                  <Input
                    id="church-code"
                    list="church-options"
                    placeholder="AA01｜臺北教會"
                    value={churchCode}
                    onChange={(e) => setChurchCode(e.target.value)}
                  />
                  <datalist id="church-options">
                    {catalog.customers
                      .filter((c: any) => !['0002', '305'].includes(c.code))
                      .map((c: any) => (
                        <option key={c.code} value={c.code + '｜' + c.name} />
                      ))}
                  </datalist>
                  <label htmlFor="church-password">
                    新密碼（至少 10 字元）
                  </label>
                  <Input
                    id="church-password"
                    type="password"
                    autoComplete="new-password"
                    value={churchPassword}
                    onChange={(e) => setChurchPassword(e.target.value)}
                  />
                  <Button
                    className="primary"
                    disabled={busy}
                    onClick={() =>
                      run(async () => {
                        await api('churches', {
                          code: churchCode.split('｜')[0].trim(),
                          password: churchPassword,
                        });
                        setChurches(await api('churches'));
                        setChurchPassword('');
                        setNotice('教會入口已啟用，原登入已失效');
                      })
                    }
                  >
                    儲存並啟用
                  </Button>
                </section>
                <section className="panel">
                  <h2>已啟用入口</h2>
                  {churches.map((c) => (
                    <div className="church-row" key={c.code}>
                      <Users />
                      <div>
                        <b>
                          {
                            catalog.customers.find(
                              (x: any) => x.code.toLowerCase() === c.code,
                            )?.name
                          }
                        </b>
                        <small>/{c.code}</small>
                      </div>
                      <Button
                        variant="outline"
                        onClick={() =>
                          run(async () => {
                            await navigator.clipboard.writeText(
                              location.origin + '/' + c.code,
                            );
                            setNotice('入口網址已複製');
                          })
                        }
                      >
                        複製網址
                      </Button>
                    </div>
                  ))}
                  {!churches.length && (
                    <div className="empty">
                      <Users />
                      <p>設定密碼後，教會入口就會出現在這裡。</p>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>
      </main>
      <Dialog open={newEvent} onOpenChange={setNewEvent}>
        <DialogContent className="event-dialog">
          <DialogHeader>
            <DialogTitle>新增書展</DialogTitle>
            <DialogDescription>
              每場書展都有獨立的交易、數量與日結紀錄。
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(create);
            }}
          >
            <label htmlFor="event-name">書展名稱</label>
            <Input
              id="event-name"
              placeholder="例如：臺北教會秋季書展"
              required
              value={eventName}
              onChange={(e) => setEventName(e.target.value)}
            />
            <label htmlFor="event-date">開始日期</label>
            <Input
              id="event-date"
              type="date"
              required
              value={eventDate}
              onChange={(e) => setEventDate(e.target.value)}
            />
            {me.role === 'admin' && (
              <>
                <label htmlFor="event-tenant">所屬教會（外出書展可留白）</label>
                <Input
                  id="event-tenant"
                  list="event-churches"
                  value={eventTenant}
                  onChange={(e) => setEventTenant(e.target.value)}
                  placeholder="AA01｜臺北教會"
                />
                <datalist id="event-churches">
                  {catalog?.customers.map((c: any) => (
                    <option key={c.code} value={c.code + '｜' + c.name} />
                  ))}
                </datalist>
              </>
            )}
            <label>預設價格</label>
            <Select
              value={pricing}
              onValueChange={(v) => setPricing(v || 'website')}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="website">
                  官網售價（不再重複折扣）
                </SelectItem>
                <SelectItem value="legacy">原書展定價與折扣</SelectItem>
              </SelectContent>
            </Select>
            <p className="muted">
              可在結帳時調整價格與折扣。商品數量可以稍後建立。
            </p>
            <Button type="submit" className="primary wide" disabled={busy}>
              建立並開啟書展 <ArrowUpRight />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog open={closeDialog} onOpenChange={setCloseDialog}>
        <DialogContent className="event-dialog">
          <DialogTitle>保存日結</DialogTitle>
          <DialogDescription>
            以臺灣時間計算當日交易，保存後仍保留所有訂單。
          </DialogDescription>
          <label>日結日期</label>
          <Input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
          />
          <div className="close-inputs">
            <label>
              盤點現金
              <Input
                type="number"
                min="0"
                value={counted}
                onChange={(e) => setCounted(e.target.value)}
              />
            </label>
            <label>
              初始現金
              <Input
                type="number"
                min="0"
                value={initial}
                onChange={(e) => setInitial(e.target.value)}
              />
            </label>
            <label>
              額外支出
              <Input
                type="number"
                min="0"
                value={expenses}
                onChange={(e) => setExpenses(e.target.value)}
              />
            </label>
          </div>
          <div className="close-total">
            系統現金 NT$ {money(dayCash)}
            <br />
            現金差異 NT${' '}
            {money(+counted - Number(initial) + Number(expenses) - dayCash)}
          </div>
          <label>
            日結備註
            <Input
              value={closeNotes}
              onChange={(e) => setCloseNotes(e.target.value)}
            />
          </label>
          <Button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await flushFrame();
                await api('events/' + active.id + '/close', {
                  day,
                  counts: { drawer: +counted, initial: +initial },
                  expenses: +expenses,
                  notes: closeNotes,
                });
                setClosings(await api('events/' + active.id + '/close'));
                setCloseDialog(false);
                setNotice('日結紀錄已保存');
              })
            }
          >
            確認保存日結
          </Button>
        </DialogContent>
      </Dialog>
      {camera && (
        <Camera
          onClose={() => setCamera(false)}
          onScan={(code) =>
            frame.current?.contentWindow?.postMessage(
              { type: 'scan', code },
              location.origin,
            )
          }
        />
      )}
    </SidebarProvider>
  );
}

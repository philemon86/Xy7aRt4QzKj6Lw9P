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
  Calculator as CalculatorIcon,
  Check,
  ShieldCheck,
} from 'lucide-react';
import Camera from './camera';
import OrderEditor from './order-editor';
import Shipments from './shipments';
import Calculator from './calculator';
import { stats } from '@/lib/state.mjs';
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
    [currentCash, setCurrentCash] = useState(0),
    [scanFeedback, setScanFeedback] = useState<any>(null),
    [editTarget, setEditTarget] = useState<{
      eventId: string;
      orderId: string;
    } | null>(null),
    [orderVersion, setOrderVersion] = useState(0),
    [registerLoading, setRegisterLoading] = useState(false);
  const [newEvent, setNewEvent] = useState(false),
    [eventName, setEventName] = useState(''),
    [eventDate, setEventDate] = useState(''),
    [eventTenant, setEventTenant] = useState('');
  const [churchCode, setChurchCode] = useState(''),
    [churchPassword, setChurchPassword] = useState(''),
    [churches, setChurches] = useState<any[]>([]),
    [stock, setStock] = useState(''),
    [stockMode, setStockMode] = useState('add'),
    [camera, setCamera] = useState(false),
    [cloudStatus, setCloudStatus] = useState('雲端資料'),
    [cloudError, setCloudError] = useState(false),
    [sync, setSync] = useState<any>(null),
    [syncing, setSyncing] = useState(false);
  const audience =
    active?.tenant || me?.role === 'church' || tenant ? 'church' : 'bookstore';
  useEffect(() => {
    document.documentElement.dataset.audience = audience;
  }, [audience]);
  const frame = useRef<HTMLIFrameElement>(null),
    viewRef = useRef(view),
    activeRef = useRef(active),
    stopSync = useRef(false),
    eventRecord = useRef<Promise<any> | null>(null),
    catalogRef = useRef(catalog),
    meRef = useRef(me);
  catalogRef.current = catalog;
  meRef.current = me;
  useEffect(() => {
    (window as any).POSRegisterBootstrap = async (eventId: string) => {
      if (activeRef.current?.id !== eventId || !meRef.current)
        throw Error('請從書展清單開啟收銀台');
      return {
        event: await eventRecord.current,
        catalog: catalogRef.current,
        me: meRef.current,
      };
    };
    return () => {
      delete (window as any).POSRegisterBootstrap;
    };
  }, []);
  viewRef.current = view;
  activeRef.current = active;
  async function load() {
    const boot = await api('bootstrap');
    const user = boot.me,
      es = boot.events,
      cat = boot.catalog;
    if (tenant && user.tenant !== tenant) {
      await api('logout', {});
      throw Error('請使用此教會入口密碼登入');
    }
    setEvents(es);
    setCatalog(cat);
    setMe(user);
    setLoaded(true);
    if (user.role === 'admin') {
      Promise.all([api('churches'), api('sync-shop')])
        .then(([churches, job]) => {
          setChurches(churches);
          setSync(job);
          const last =
            job.finished ||
            cat.products
              .filter((p: any) => p.syncedAt)
              .map((p: any) => p.syncedAt)
              .sort()
              .at(-1);
          if (!last || Date.now() - new Date(last).getTime() > 24 * 3600000)
            setTimeout(
              () => syncShop(!job.total || job.cursor >= job.total),
              1500,
            );
        })
        .catch((e) => setError(e.message));
    }
  }
  useEffect(() => {
    setEventDate(today());
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
      if (m.type === 'scan-result') setScanFeedback(m);
      if (m.type === 'cash-total' && Number.isFinite(m.amount))
        setCurrentCash(m.amount);
      if (m.type === 'open-camera' && activeRef.current?.status === 'open') {
        setScanFeedback(null);
        setCamera(true);
      }
      if (m.type === 'cloud-status') {
        setCloudStatus(m.text);
        setCloudError(m.error);
      }
      if (m.type === 'edit-order' && activeRef.current)
        setEditTarget({ eventId: activeRef.current.id, orderId: m.id });
      if (m.type === 'register-error') setRegisterLoading(false);
      if (m.type === 'register-ready') {
        setRegisterLoading(false);
        frame.current?.contentWindow?.postMessage(
          { type: 'view', view: viewRef.current },
          location.origin,
        );
      }
      if (m.type === 'saved' && m.event === activeRef.current?.id && m.state) {
        setState(m.state);
        setEvents((list) =>
          list.map((event) =>
            event.id === m.event ? { ...event, ...stats(m.state) } : event,
          ),
        );
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
  async function openEvent(e: any, nextView = 'checkout') {
    if (!e) return;
    await flushFrame();
    setRegisterLoading(true);
    setState({});
    setCurrentCash(0);
    eventRecord.current = api('events/' + e.id);
    eventRecord.current
      .then((record) => {
        if (activeRef.current?.id === e.id) {
          setState(record.state);
          setCurrentCash(stats(record.state).payments['現金'] || 0);
        }
      })
      .catch((e) => {
        setError(e.message);
        setRegisterLoading(false);
      });
    setActive(e);
    setView(nextView);
  }
  function tab(v: any) {
    setView(v);
    frame.current?.contentWindow?.postMessage(
      { type: 'view', view: v },
      location.origin,
    );
    if (active) {
      const cloud = (frame.current?.contentWindow as any)?.POSCloud;
      if (cloud) setState(cloud.snapshot());
    }
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
      pricing: 'website',
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
  if (!loaded)
    return (
      <main className="loading">
        <BookOpen />
        <p>正在連接書展工作台…</p>
      </main>
    );
  if (!me)
    return (
      <main className="login" data-audience={audience}>
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
    <SidebarProvider data-audience={audience}>
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
              ...(me.role === 'admin'
                ? [
                    ['shipments', '教會出貨單', ReceiptText],
                    ['churches', '教會入口', Users],
                  ]
                : []),
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
      <main className={active ? 'workspace workspace-active' : 'workspace'}>
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
                    : section === 'shipments'
                      ? '教會出貨單'
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
                    自動套用商品價格 <span className="dot">·</span>{' '}
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
                          eventRecord.current = api('events/' + active.id);
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
                      setScanFeedback(null);
                      (
                        frame.current?.contentWindow as any
                      )?.POSCloud?.unlockAudio?.();
                      setCamera(true);
                    }}
                    disabled={active.status !== 'open'}
                  >
                    <ScanBarcode /> 相機掃描
                  </Button>
                </div>
              </div>
              {me.role === 'admin' && (
                <div className="event-switcher">
                  <label>快速查看場次</label>
                  <Select
                    value={active.id}
                    onValueChange={(id) => {
                      const selected = events.find((e) => e.id === id);
                      if (selected && id !== active.id)
                        run(() => openEvent(selected, 'history'));
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {events.map((e) => (
                        <SelectItem key={e.id} value={e.id}>
                          {e.tenant ? e.tenant.toUpperCase() : '書房'} ·{' '}
                          {e.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
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
                  <TabsTrigger value="calculator">
                    <CalculatorIcon /> 計算機
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              {registerLoading && (
                <p role="status" className="register-loading">
                  正在開啟收銀台…
                </p>
              )}
              <iframe
                ref={frame}
                title="書展收銀台"
                src={'/register.html?event=' + active.id}
                allow="camera"
                className="register-frame"
                style={{
                  display: ['stock', 'calculator'].includes(view)
                    ? 'none'
                    : 'block',
                }}
              />
              {view === 'stock' && (
                <div
                  className={
                    me.role === 'admin' ? 'stock-layout' : 'stock-readonly'
                  }
                >
                  {me.role === 'admin' && (
                    <section className="panel">
                      <h2>書房匯入與調整庫存</h2>
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
                      <label htmlFor="stock-file">匯入數量 CSV</label>
                      <Input
                        id="stock-file"
                        type="file"
                        accept=".csv,.txt"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          try {
                            const text = await file.text();
                            const lines = text
                              .replace(/^\uFEFF/, '')
                              .split(/\r?\n/)
                              .filter(Boolean)
                              .map((line) => line.replaceAll('"', '').trim());
                            if (
                              lines[0] &&
                              /商品|code|qty|quantity/i.test(lines[0]) &&
                              !/^\S+[,，\s]+-?\d+$/.test(lines[0])
                            )
                              lines.shift();
                            setStock(lines.join('\n'));
                            setNotice('數量已讀入，確認後按儲存數量');
                          } catch {
                            setError('檔案無法讀取，請使用商品代碼、數量兩欄');
                          }
                        }}
                      />
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
                  )}
                  <section className="panel">
                    <h2>{me.role === 'admin' ? '本場商品數量' : '目前庫存'}</h2>
                    {me.role !== 'admin' && (
                      <p className="muted">
                        由書房匯入，依有效出貨單即時扣減。
                      </p>
                    )}
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>商品</TableHead>
                          <TableHead>書房匯入</TableHead>
                          <TableHead>售出</TableHead>
                          <TableHead>目前庫存</TableHead>
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
                        <p>
                          {me.role === 'admin'
                            ? '可直接開始結帳，之後再補上。'
                            : '書房尚未匯入庫存；仍可正常結帳。'}
                        </p>
                      </div>
                    )}
                  </section>
                </div>
              )}
              {view === 'calculator' && (
                <Calculator
                  key={active.id}
                  cash={currentCash}
                  refreshCash={async () => {
                    await flushFrame();
                    const fresh = await api('events/' + active.id);
                    setState(fresh.state);
                    const cash = stats(fresh.state).payments['現金'] || 0;
                    setCurrentCash(cash);
                    return cash;
                  }}
                />
              )}
              {view === 'history' && me.role === 'admin' && (
                <Button
                  variant="outline"
                  onClick={() =>
                    run(async () => {
                      await flushFrame();
                      download(
                        await api('events/' + active.id + '/backup'),
                        '書展完整備份-' + active.date + '.json',
                      );
                    })
                  }
                >
                  <Download /> 下載本場完整備份與修訂紀錄
                </Button>
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
          ) : section === 'shipments' && me.role === 'admin' ? (
            <Shipments
              events={events}
              customers={catalog.customers}
              request={api}
              version={orderVersion}
              onEdit={setEditTarget}
              onOpen={(e) => run(() => openEvent(e, 'history'))}
            />
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
              每場書展都有獨立的交易、商品數量與常用商品。
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
            <p className="pricing-policy">
              價格依序採用：官網特價 → 原書展指定特價 →
              官網一般售價。未比對官網時沿用原書展價格。
            </p>
            <p className="muted">
              結帳時仍可修改單價、數量與折扣。商品數量可以稍後建立。
            </p>
            <Button type="submit" className="primary wide" disabled={busy}>
              建立並開啟書展 <ArrowUpRight />
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      {editTarget && (
        <OrderEditor
          target={editTarget}
          catalog={catalog}
          role={me.role}
          request={api}
          onClose={() => setEditTarget(null)}
          onSaved={() => {
            setOrderVersion((v) => v + 1);
            setNotice('出貨單已更新');
            run(async () => {
              const cloud = (frame.current?.contentWindow as any)?.POSCloud;
              if (active?.id === editTarget.eventId && cloud)
                await cloud.refresh();
              setEvents(await api('events'));
            });
          }}
        />
      )}
      {camera && (
        <Camera
          feedback={scanFeedback}
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

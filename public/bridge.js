window.makeCloud = async function () {
  const eid = new URLSearchParams(location.search).get('event');
  let device = window.localStorage.getItem('pos-device');
  if (!device) {
    device = crypto.randomUUID();
    window.localStorage.setItem('pos-device', device);
  }
  const api = async (path, body) => {
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
    const j = await r.json();
    if (!r.ok) throw Error(j.error || '雲端連線失敗');
    return j;
  };
  const initial =
    typeof parent.POSRegisterBootstrap === 'function'
      ? await parent.POSRegisterBootstrap(eid)
      : await (async () => {
          const [event, catalog, me] = await Promise.all([
            api('events/' + eid),
            api('catalog'),
            api('me'),
          ]);
          return { event, catalog, me };
        })();
  const { event, catalog, me } = initial;
  let base = event.state,
    desired = structuredClone(base),
    pending = Promise.resolve(),
    timer,
    busy = false,
    failed = false;
  let clientSnapshot = {},
    cloud;
  const prefix = (k) =>
    ['cart', 'priceOverrides', 'clientCounter', 'printEnabled'].includes(k)
      ? 'draft:' + device + ':' + k
      : 'shared:' + k;
  const readOnly = me.role === 'admin' && event.organizer === 'church';
  const storage = {
    getItem(k) {
      if (k === 'clients') {
        clientSnapshot = structuredClone(
          Object.fromEntries(
            Object.entries(desired)
              .filter(([k]) => k.startsWith('order:'))
              .map(([k, v]) => [k.slice(6), v]),
          ),
        );
        return JSON.stringify(clientSnapshot);
      }
      if (k === 'overallSummary') return '{}';
      return desired[prefix(k)] ?? null;
    },
    setItem(k, v) {
      if (readOnly) return;
      if (k === 'clients') {
        const clients = JSON.parse(v);
        for (const id of new Set([
          ...Object.keys(clientSnapshot),
          ...Object.keys(clients),
        ])) {
          if (
            JSON.stringify(clientSnapshot[id] ?? null) !==
            JSON.stringify(clients[id] ?? null)
          ) {
            if (clients[id]) desired['order:' + id] = clients[id];
            else delete desired['order:' + id];
          }
        }
        clientSnapshot = structuredClone(clients);
      } else if (k !== 'overallSummary') desired[prefix(k)] = String(v);
      schedule();
    },
    removeItem(k) {
      if (readOnly) return;
      delete desired[prefix(k)];
      schedule();
    },
    clear() {
      if (readOnly) return;
      for (const k of Object.keys(desired))
        if (
          k.startsWith('order:') ||
          k.startsWith('shared:') ||
          k.startsWith('draft:' + device + ':')
        )
          delete desired[k];
      clientSnapshot = {};
      schedule();
    },
  };
  function status(text, error = false) {
    const el = document.getElementById('cloud-status');
    if (el) {
      el.textContent = text;
      el.classList.toggle('error', error);
    }
    parent.postMessage({ type: 'cloud-status', text, error }, location.origin);
  }
  function schedule() {
    clearTimeout(timer);
    status('正在儲存…');
    timer = setTimeout(() => flush().catch(() => {}), 350);
  }
  async function save() {
    busy = true;
    const sent = structuredClone(desired);
    const changes = [...new Set([...Object.keys(base), ...Object.keys(sent)])]
      .filter(
        (k) =>
          JSON.stringify(base[k] ?? null) !== JSON.stringify(sent[k] ?? null),
      )
      .map((key) => ({
        key,
        before: base[key] ?? null,
        after: sent[key] ?? null,
      }));
    if (!changes.length) {
      busy = false;
      return;
    }
    try {
      const result = await api('events/' + eid + '/sync', { changes });
      const now = desired;
      desired = { ...result.state };
      for (const k of new Set([...Object.keys(sent), ...Object.keys(now)])) {
        if (
          JSON.stringify(now[k] ?? null) !== JSON.stringify(sent[k] ?? null)
        ) {
          if (now[k] == null) delete desired[k];
          else desired[k] = now[k];
        }
      }
      base = result.state;
      cloud.numbers = { ...cloud.numbers, ...result.numbers };
      cloud.recoveryError = '';
      failed = false;
      cloud?.onUpdate?.();
      status('已儲存至雲端');
      window.localStorage.removeItem('pos-recovery:' + eid + ':' + device);
      parent.postMessage(
        { type: 'saved', event: eid, state: structuredClone(desired) },
        location.origin,
      );
    } catch (e) {
      failed = true;
      cloud.recoveryError = e.message;
      window.localStorage.setItem(
        'pos-recovery:' + eid + ':' + device,
        JSON.stringify({ base, desired, at: new Date().toISOString() }),
      );
      status(e.message + ' · 尚未儲存', true);
      throw e;
    } finally {
      busy = false;
    }
  }
  function flush() {
    clearTimeout(timer);
    pending = pending.catch(() => {}).then(save);
    return pending;
  }
  window.addEventListener('beforeunload', (e) => {
    if (busy || failed || JSON.stringify(desired) !== JSON.stringify(base)) {
      e.preventDefault();
      e.returnValue = '資料尚未儲存';
    }
  });
  window.addEventListener('online', () => flush().catch(() => {}));
  let refreshingCatalog = false,
    catalogVersion = null;
  setInterval(async () => {
    if (refreshingCatalog || document.hidden || !cloud) return;
    refreshingCatalog = true;
    try {
      const { version } = await api('catalog/version');
      const day = new Date().toLocaleDateString('en-CA', {
        timeZone: 'Asia/Taipei',
      });
      const nextVersion = version + day;
      if (nextVersion !== catalogVersion) {
        const next = await api('catalog');
        cloud.catalog = next;
        await cloud.onCatalogUpdate?.();
        catalogVersion = nextVersion;
      }
    } catch {
    } finally {
      refreshingCatalog = false;
    }
  }, 60000);
  cloud = {
    event,
    catalog,
    me,
    numbers: event.numbers || {},
    storage,
    flush,
    api,
    async close(day, counts, expenses, notes) {
      await flush();
      return api('events/' + eid + '/close', { day, counts, expenses, notes });
    },
    setView(view) {
      document.body.dataset.view = view;
    },
    async reserve(count) {
      const r = await api('events/' + eid + '/eri', { count });
      cloud.eri = r.start;
      cloud.eriEnd = r.end;
    },
    nextEri() {
      if (cloud.eri >= cloud.eriEnd) throw Error('ERI 配額不足');
      return (++cloud.eri).toString(36).toUpperCase().padStart(6, '0');
    },
    snapshot() {
      return structuredClone(desired);
    },
    recoveryOrders() {
      return Object.entries(desired)
        .filter(
          ([key, value]) =>
            key.startsWith('order:') &&
            JSON.stringify(value) !== JSON.stringify(base[key]),
        )
        .map(([, value]) => structuredClone(value));
    },
    async resolveRecovery(payments) {
      if (
        !window.localStorage.getItem(
          'pos-recovery-original:' + eid + ':' + device,
        )
      )
        window.localStorage.setItem(
          'pos-recovery-original:' + eid + ':' + device,
          JSON.stringify({ base, desired, at: new Date().toISOString() }),
        );
      for (const [id, records] of Object.entries(payments)) {
        const key = 'order:' + id;
        if (!desired[key]) throw Error('找不到待存交易');
        desired[key] = {
          ...desired[key],
          paymentRecords: records,
          paymentMethod:
            records.length === 1
              ? records[0].method
              : records.map((p) => p.method + '(' + p.amount + ')').join(' + '),
        };
      }
      await flush();
    },
  };
  async function readLatest() {
    busy = true;
    try {
      const latest = await api('events/' + eid);
      const nextBase = structuredClone(latest.state);
      const nextDesired = structuredClone(latest.state);
      for (const key of new Set([
        ...Object.keys(base),
        ...Object.keys(desired),
      ])) {
        if (
          JSON.stringify(base[key] ?? null) ===
          JSON.stringify(desired[key] ?? null)
        )
          continue;
        // Preserve edits made during the read, including their original conflict baseline.
        if (desired[key] == null) delete nextDesired[key];
        else nextDesired[key] = desired[key];
        if (base[key] == null) delete nextBase[key];
        else nextBase[key] = base[key];
      }
      base = nextBase;
      desired = nextDesired;
      cloud.numbers = latest.numbers || cloud.numbers;
      cloud.onUpdate?.();
      parent.postMessage(
        { type: 'saved', event: eid, state: structuredClone(desired) },
        location.origin,
      );
    } finally {
      busy = false;
    }
  }
  cloud.refresh = () => {
    clearTimeout(timer);
    pending = pending
      .catch(() => {})
      .then(save)
      .then(readLatest);
    return pending;
  };
  window.POSCloud = cloud;
  const recover = window.localStorage.getItem(
    'pos-recovery:' + eid + ':' + device,
  );
  if (recover && !readOnly) {
    const r = JSON.parse(recover);
    status('正在復原上次未完成的儲存…');
    base = r.base;
    desired = r.desired;
    try {
      await flush();
    } catch {
      /* Keep the register available so the saved recovery can be reviewed. */
    }
  }
  setInterval(() => {
    if (busy || failed || JSON.stringify(desired) !== JSON.stringify(base))
      return;
    pending = pending
      .catch(() => {})
      .then(async () => {
        if (failed || JSON.stringify(desired) !== JSON.stringify(base)) return;
        await readLatest();
      });
    pending.catch(() => {});
  }, 15000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush().catch(() => {});
  });
  window.addEventListener('message', async (e) => {
    if (e.origin !== location.origin || e.source !== parent) return;
    if (e.data.type === 'view') cloud.setView(e.data.view);
    if (e.data.type === 'flush')
      try {
        await flush();
        parent.postMessage(
          { type: 'flushed', request: e.data.request },
          location.origin,
        );
      } catch (error) {
        parent.postMessage(
          { type: 'flushed', request: e.data.request, error: error.message },
          location.origin,
        );
      }
  });
  status(
    cloud.recoveryError
      ? '上次結帳待處理 · ' + cloud.recoveryError
      : '已連接雲端',
    !!cloud.recoveryError,
  );
  return cloud;
};

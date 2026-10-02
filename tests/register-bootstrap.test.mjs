import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadRegisterBootstrap } from '../lib/register-bootstrap.mjs';

const catalog = { products: [{ code: 'A', price: 100 }] };
const me = { role: 'church', tenant: 'aa01' };
const record = (id) => ({ id, state: {}, numbers: {}, organizer: 'church' });

test('A newly created fair opens from its saved response without any additional API reads', async () => {
  const created = record('new');
  const boot = await loadRegisterBootstrap(
    'new',
    { id: 'new', record: Promise.resolve(created) },
    { catalog, me },
    () => {
      throw Error('Unnecessary API read');
    },
  );
  assert.equal(boot.event, created);
  assert.equal(boot.catalog, catalog);
  assert.equal(boot.me, me);
});

test('Missing or stale parent preload requests the correct authenticated fair and reuses catalog and identity', async () => {
  for (const prepared of [
    null,
    { id: 'old', record: Promise.resolve(record('old')) },
  ]) {
    const calls = [];
    const boot = await loadRegisterBootstrap(
      'new',
      prepared,
      { catalog, me },
      async (path) => {
        calls.push(path);
        return record('new');
      },
    );
    assert.equal(boot.event.id, 'new');
    assert.deepEqual(calls, ['events/new']);
  }
});

test('Rapid fair switches preserve the event associated with each in-flight preload', async () => {
  let release;
  const prepared = {
    id: 'first',
    record: new Promise((resolve) => {
      release = resolve;
    }),
  };
  const first = loadRegisterBootstrap(
    'first',
    prepared,
    { catalog, me },
    () => {
      throw Error('Wrong request');
    },
  );
  const second = await loadRegisterBootstrap(
    'second',
    { id: 'second', record: Promise.resolve(record('second')) },
    { catalog, me },
    () => {
      throw Error('Wrong request');
    },
  );
  release(record('first'));
  assert.equal((await first).event.id, 'first');
  assert.equal(second.event.id, 'second');
});

test('Fallback does not bypass authentication or tenant boundaries and rejects mismatched event data', async () => {
  await assert.rejects(
    loadRegisterBootstrap('other-church', null, { catalog, me }, async () => {
      throw Error('找不到書展');
    }),
    /找不到書展/,
  );
  await assert.rejects(
    loadRegisterBootstrap(
      'new',
      { id: 'new', record: Promise.resolve(record('old')) },
      { catalog, me },
      () => {},
    ),
    /資料尚未完整/,
  );
  await assert.rejects(
    loadRegisterBootstrap('', null, { catalog, me }, () => {}),
    /缺少/,
  );
});

test('Without parent data, independent authenticated reads start concurrently', async () => {
  const releases = new Map();
  const boot = loadRegisterBootstrap(
    'new',
    null,
    {},
    (path) => new Promise((resolve) => releases.set(path, resolve)),
  );
  assert.deepEqual([...releases.keys()], ['events/new', 'catalog', 'me']);
  releases.get('events/new')(record('new'));
  releases.get('catalog')(catalog);
  releases.get('me')(me);
  assert.equal((await boot).event.id, 'new');
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readWorkspaceRoute, workspaceRouteHref } from '../lib/workspace-route.mjs';

const events = [
  { id: 'bookroom', organizer: 'bookstore', tenant: '' },
  { id: 'church-a', organizer: 'church', tenant: 'aa01' },
  { id: 'church-b', organizer: 'church', tenant: 'aa02' },
];
const admin = { role: 'admin' };
const church = { role: 'church', tenant: 'aa01' };
const origin = 'https://www.philemon.com.tw';

test('Reload restores the same fair and checkout, including a newly created fair', () => {
  const href = workspaceRouteHref(origin + '/pos/?v=22', 'bookroom');
  assert.deepEqual(readWorkspaceRoute(origin + href, events, admin), {
    event: events[0], view: 'checkout',
  });
  const created = { id: 'new', organizer: 'church', tenant: 'aa01' };
  assert.equal(readWorkspaceRoute(origin + workspaceRouteHref(origin + '/pos/aa01', 'new'), [created], church).event, created);
});

test('Reload restores each working tab and normalizes invalid tab names', () => {
  for (const view of ['checkout', 'history', 'stock', 'calculator']) {
    const href = workspaceRouteHref(origin + '/pos/aa01', 'church-a', view);
    assert.equal(readWorkspaceRoute(origin + href, events, church).view, view);
  }
  assert.equal(readWorkspaceRoute(origin + '/pos/?event=bookroom&view=invalid', events, admin).view, 'checkout');
});

test('URLs cannot restore an inaccessible, deleted, or another church fair', () => {
  assert.equal(readWorkspaceRoute(origin + '/pos/aa01?event=church-b', events, church), null);
  assert.equal(readWorkspaceRoute(origin + '/pos/aa01?event=bookroom', events, church), null);
  assert.equal(readWorkspaceRoute(origin + '/pos/?event=missing', events, admin), null);
  assert.equal(readWorkspaceRoute(origin + '/pos/aa01?event=church-a', [], church), null);
});

test('Bookroom viewing a church fair retains its existing read-only history entry', () => {
  assert.equal(readWorkspaceRoute(origin + '/pos/?event=church-a&view=checkout', events, admin).view, 'history');
});

test('Returning to the list or signing out removes the fair without changing portal or other URL parameters', () => {
  const href = origin + '/pos/aa01?v=22&event=church-a&view=stock#top';
  assert.equal(workspaceRouteHref(href), '/pos/aa01?v=22#top');
  assert.equal(readWorkspaceRoute(origin + workspaceRouteHref(href), events, church), null);
  assert.equal(workspaceRouteHref(href, 'church-b', 'calculator'), '/pos/aa01?v=22&event=church-b&view=calculator#top');
});

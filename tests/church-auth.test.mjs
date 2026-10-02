import test from 'node:test';
import assert from 'node:assert/strict';
import { churchPasswordHash } from '../lib/church-auth.mjs';

test('default password applies only to enabled, explicitly registered churches', () => {
  assert.equal(churchPasswordHash(undefined, 'default:hash'), undefined);
  assert.equal(churchPasswordHash({ enabled: 0, password: '@default' }, 'default:hash'), undefined);
  assert.equal(churchPasswordHash({ enabled: 1, password: '@default' }, undefined), undefined);
  assert.equal(churchPasswordHash({ enabled: 1, password: '@default' }, 'default:hash'), 'default:hash');
});

test('individual church password replaces the shared default', () => {
  assert.equal(churchPasswordHash({ enabled: 1, password: 'individual:hash' }, 'default:hash'), 'individual:hash');
});

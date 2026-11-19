'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const make = require('../desktop/app/module-state-client');
const A = { scope: 'module', module: 'query' };
test('explicit reread discards stale pending UI settings and restores the latest revision', async () => {
  let latest = { revision: 0, data: { pageSize: 50 }, corrupt: false };
  const client = make({
    delay: 10000,
    api: async (name) => {
      if (name === 'readModuleState') return structuredClone(latest);
      throw Object.assign(Error('conflict'), { code: 'STATE_CONFLICT' });
    },
  });
  await client.open(A);
  client.change(A, { pageSize: 25 });
  await assert.rejects(client.flush());
  latest = { revision: 2, data: { pageSize: 100 }, corrupt: false };
  await client.rereadAll();
  assert.equal(client.current(A).revision, 2);
  assert.equal(client.current(A).data.pageSize, 100);
  await client.flush();
});
function setup() {
  let saved = { revision: 0, data: { pageSize: 50 }, corrupt: false };
  const writes = [],
    statuses = [];
  const api = async (name, input) => {
    if (name === 'readModuleState') return structuredClone(saved);
    writes.push(input);
    saved = { revision: saved.revision + 1, data: input.data, corrupt: false };
    return structuredClone(saved);
  };
  const client = make({ api, onStatus: (s) => statuses.push(s), delay: 10000 });
  return { client, api, writes, statuses };
}
test('UI state coalesces repeated changes into one durable revision', async () => {
  const h = setup();
  await h.client.open(A);
  h.client.change(A, { pageSize: 25 });
  h.client.change(A, { pageSize: 100 });
  await h.client.flush();
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].data.pageSize, 100);
  assert.equal(h.client.current(A).revision, 1);
});
test('UI state retains the newest edit arriving during an asynchronous save', async () => {
  let release, entered;
  const enteredPromise = new Promise((r) => (entered = r));
  const gate = new Promise((r) => (release = r));
  let n = 0;
  const h = setup();
  const api = async (name, input) => {
    if (name === 'saveModuleState' && n++ === 0) {
      entered();
      await gate;
    }
    return h.api(name, input);
  };
  const c = make({ api, delay: 10000 });
  await c.open(A);
  c.change(A, { pageSize: 25 });
  const flushed = c.flush();
  await enteredPromise;
  c.change(A, { pageSize: 100 });
  release();
  await flushed;
  assert.equal(h.writes.length, 2);
  assert.equal(h.writes[1].expectedRevision, 1);
  assert.equal(c.current(A).data.pageSize, 100);
});
test('UI save failures keep the pending data and block close until explicit retry succeeds', async () => {
  let fail = true;
  const errors = [];
  const h = setup();
  const c = make({
    api: async (name, input) => {
      if (name === 'saveModuleState' && fail) throw Error('synthetic write denied');
      return h.api(name, input);
    },
    onError: (e) => errors.push(e.message),
    delay: 10000,
  });
  await c.open(A);
  c.change(A, { pageSize: 100 });
  await assert.rejects(c.flush());
  assert.equal(c.current(A).revision, 0);
  assert.equal(errors.length, 1);
  fail = false;
  await c.flush();
  assert.equal(c.current(A).data.pageSize, 100);
});
test('corrupt state is visibly failed and cannot be silently overwritten', async () => {
  const states = [];
  let writes = 0;
  const c = make({
    api: async (name) => {
      if (name === 'saveModuleState') writes++;
      return { data: { pageSize: 50 }, revision: 2, corrupt: true, warning: 'broken' };
    },
    onStatus: (s) => states.push(s),
    delay: 10000,
  });
  await c.open(A);
  assert.equal(states.at(-1), 'failed');
  c.change(A, { pageSize: 100 });
  await assert.rejects(c.flush());
  assert.equal(writes, 0);
});
test('detaching a workspace retains global settings and removes only workspace cache', async () => {
  const h = setup(),
    g = { scope: 'global', module: 'shell' };
  await h.client.open(A);
  await h.client.open(g);
  h.client.detach();
  assert.equal(h.client.current(A), undefined);
  assert.ok(h.client.current(g));
});

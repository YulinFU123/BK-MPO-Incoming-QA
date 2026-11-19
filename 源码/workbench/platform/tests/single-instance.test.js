'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { ownDesktopInstance } = require('../desktop/single-instance');

test('repeated launch focuses/restores existing work without creating another writer', () => {
  const app = new EventEmitter(),
    calls = [];
  app.requestSingleInstanceLock = () => true;
  const window = {
    isDestroyed: () => false,
    isMinimized: () => true,
    restore: () => calls.push('restore'),
    show: () => calls.push('show'),
    focus: () => calls.push('focus'),
  };
  assert.equal(
    ownDesktopInstance(app, () => window),
    true,
  );
  app.emit('second-instance');
  assert.deepEqual(calls, ['restore', 'show', 'focus']);
});

test('a second process exits before initialization while absent/destroyed first windows are safe', () => {
  const app = new EventEmitter();
  let quit = 0;
  app.requestSingleInstanceLock = () => false;
  app.quit = () => quit++;
  assert.equal(
    ownDesktopInstance(app, () => null),
    false,
  );
  assert.equal(quit, 1);
  assert.equal(app.listenerCount('second-instance'), 0);
  app.requestSingleInstanceLock = () => true;
  let window = null;
  ownDesktopInstance(app, () => window);
  app.emit('second-instance');
  window = { isDestroyed: () => true };
  app.emit('second-instance');
});

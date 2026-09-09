import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readTabIdentity } from '../src/tab';

function get(values: Record<string, unknown>): (key: string) => unknown {
  return (key) => values[key];
}

test('a valid @N tab and server name are accepted', () => {
  assert.deepEqual(readTabIdentity(get({ 'rk.tab': '@7', 'rk.server': 'default' })), {
    tab: '@7',
    server: 'default',
  });
});

test('a tab without the @ prefix is rejected', () => {
  assert.equal(readTabIdentity(get({ 'rk.tab': '7', 'rk.server': 'default' })), null);
});

test('an empty tab is rejected', () => {
  assert.equal(readTabIdentity(get({ 'rk.tab': '', 'rk.server': 'default' })), null);
});

test('an empty server is rejected', () => {
  assert.equal(readTabIdentity(get({ 'rk.tab': '@7', 'rk.server': '' })), null);
});

test('a server with characters outside the tmux server-name charset is rejected', () => {
  assert.equal(readTabIdentity(get({ 'rk.tab': '@7', 'rk.server': 'a b' })), null);
  assert.equal(readTabIdentity(get({ 'rk.tab': '@7', 'rk.server': '../etc' })), null);
});

test('non-string values are rejected', () => {
  assert.equal(readTabIdentity(get({ 'rk.tab': 7, 'rk.server': 'default' })), null);
  assert.equal(readTabIdentity(get({})), null);
});

test('server names with dots, underscores and dashes are accepted', () => {
  assert.deepEqual(readTabIdentity(get({ 'rk.tab': '@12', 'rk.server': 'my-server_1.2' })), {
    tab: '@12',
    server: 'my-server_1.2',
  });
});

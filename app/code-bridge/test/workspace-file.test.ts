import { test } from 'node:test';
import assert from 'node:assert/strict';
import { identityFromWorkspaceFile } from '../src/workspace-file';

test('a workspace file whose settings carry a valid identity resolves it', () => {
  const contents = JSON.stringify({
    folders: [{ path: '/repo' }],
    settings: { 'rk.tab': '@7', 'rk.server': 'default' },
  });
  assert.deepEqual(identityFromWorkspaceFile(contents), { tab: '@7', server: 'default' });
});

test('a workspace file without a settings key yields null', () => {
  assert.equal(identityFromWorkspaceFile('{"folders":[{"path":"/repo"}]}'), null);
});

test('a non-object settings block yields null', () => {
  assert.equal(identityFromWorkspaceFile('{"settings":5}'), null);
  assert.equal(identityFromWorkspaceFile('{"settings":null}'), null);
  assert.equal(identityFromWorkspaceFile('{"settings":"x"}'), null);
});

test('invalid rk.tab / rk.server values yield null', () => {
  assert.equal(
    identityFromWorkspaceFile('{"settings":{"rk.tab":"7","rk.server":"default"}}'),
    null,
  );
  assert.equal(
    identityFromWorkspaceFile('{"settings":{"rk.tab":"@7","rk.server":"a b"}}'),
    null,
  );
});

test('non-JSON contents yield null', () => {
  assert.equal(identityFromWorkspaceFile('nope'), null);
  assert.equal(identityFromWorkspaceFile(''), null);
});

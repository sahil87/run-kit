import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { resolveRkPath, runRk } from '../src/rk';

test('resolveRkPath: a non-empty absolute setting wins over RK_BIN', () => {
  assert.equal(resolveRkPath('/opt/rk', { RK_BIN: '/x/rk' }), '/opt/rk');
});

test('resolveRkPath: RK_BIN wins when the setting is empty', () => {
  assert.equal(resolveRkPath('', { RK_BIN: '/x/rk' }), '/x/rk');
});

test('resolveRkPath: a non-absolute setting falls through to RK_BIN', () => {
  assert.equal(resolveRkPath('rel/rk', { RK_BIN: '/x/rk' }), '/x/rk');
});

test('resolveRkPath: the bare name is the last resort', () => {
  assert.equal(resolveRkPath('', {}), 'rk');
  assert.equal(resolveRkPath(undefined, {}), 'rk');
});

let tmpDir: string;
let stub: string;
let failingStub: string;

before(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-run-test-'));
  stub = path.join(tmpDir, 'rk-stub');
  fs.writeFileSync(
    stub,
    [
      '#!/bin/sh',
      'echo "argc=$#"',
      'for a in "$@"; do echo "arg=$a"; done',
      'echo "stdin=$(cat)"',
      '',
    ].join('\n'),
  );
  failingStub = path.join(tmpDir, 'rk-stub-fail');
  fs.writeFileSync(failingStub, '#!/bin/sh\necho "refused: agent active" >&2\nexit 3\n');
  fs.chmodSync(stub, 0o755);
  fs.chmodSync(failingStub, 0o755);
});

after(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('runRk passes each argv element unsplit and pipes stdin', async () => {
  const result = await runRk(stub, ['a', 'b c'], { timeoutMs: 5000, stdin: 'hi' });
  assert.equal(result.code, 0);
  assert.equal(result.stdout, 'argc=2\narg=a\narg=b c\nstdin=hi\n');
  assert.equal(result.error, undefined);
});

test('runRk resolves a non-zero exit as a result carrying stderr, not a throw', async () => {
  const result = await runRk(failingStub, [], { timeoutMs: 5000 });
  assert.equal(result.code, 3);
  assert.equal(result.stderr, 'refused: agent active\n');
  assert.equal(result.error, undefined);
});

test('runRk surfaces a spawn ENOENT as a distinguishable result', async () => {
  const result = await runRk(path.join(tmpDir, 'no-such-rk'), ['tab'], { timeoutMs: 5000 });
  assert.equal(result.error, 'enoent');
  assert.notEqual(result.code, 0);
});

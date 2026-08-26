import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { once } from 'node:events';
import { startBridge, BridgeDeps } from '../src/bridge';
import { BridgeResponse } from '../src/protocol';

const info = { folder: '/tmp/fake-folder', pid: 4242, version: '0.0.0-dev' };

const deps: BridgeDeps = {
  executeCommand: (command, ...args) => {
    if (command === 'explode') return Promise.reject(new Error('boom'));
    if (command === 'slow') return new Promise<unknown>(() => {});
    if (command === 'cycle') {
      const obj: Record<string, unknown> = {};
      obj.self = obj;
      return Promise.resolve(obj);
    }
    return Promise.resolve({ command, args });
  },
  getCommands: () => Promise.resolve(['echo', 'explode', 'slow', 'cycle']),
  parseUri: (value) => ({ parsed: value }),
  info,
};

let tmpDir: string;
let sockPath: string;
let server: net.Server;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rk-cb-test-'));
  sockPath = path.join(tmpDir, 'bridge.sock');
  server = startBridge({ socketPath: sockPath, deps });
  if (!server.listening) await once(server, 'listening');
});

after(() => {
  server.close();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function call(payload: string): Promise<{ lines: string[]; response: BridgeResponse }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sockPath);
    let buffer = '';
    socket.on('connect', () => socket.write(payload));
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
    });
    socket.on('end', () => {
      const lines = buffer.split('\n').filter((l) => l.length > 0);
      const raw: unknown = JSON.parse(lines[0]);
      resolve({ lines, response: raw as BridgeResponse });
    });
    socket.on('error', reject);
  });
}

test('__ping returns folder, pid, and version', async () => {
  const { response } = await call('{"id":"a","command":"__ping"}\n');
  assert.equal(response.id, 'a');
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.deepEqual(response.result, info);
    assert.equal(typeof response.ms, 'number');
  }
});

test('unknown command reports unknown-command', async () => {
  const { response } = await call('{"id":"b","command":"nope.x"}\n');
  assert.deepEqual(response, {
    id: 'b',
    ok: false,
    error: { kind: 'unknown-command', message: "command 'nope.x' not found" },
  });
});

test('executor rejection reports threw with the error message', async () => {
  const { response } = await call('{"id":"c","command":"explode"}\n');
  assert.deepEqual(response, {
    id: 'c',
    ok: false,
    error: { kind: 'threw', message: 'boom' },
  });
});

test('executor exceeding timeoutMs reports timeout', async () => {
  const { response } = await call('{"id":"d","command":"slow","timeoutMs":50}\n');
  assert.equal(response.ok, false);
  if (!response.ok) assert.equal(response.error.kind, 'timeout');
});

test('non-JSON line reports bad-request with null id', async () => {
  const { response } = await call('not json\n');
  assert.equal(response.id, null);
  assert.equal(response.ok, false);
  if (!response.ok) assert.equal(response.error.kind, 'bad-request');
});

test('shape-invalid request reports bad-request and echoes the id', async () => {
  const { response } = await call('{"id":"m","args":[]}\n');
  assert.equal(response.id, 'm');
  assert.equal(response.ok, false);
  if (!response.ok) assert.equal(response.error.kind, 'bad-request');
});

test('{"$uri": "..."} markers are rewritten at any nesting depth', async () => {
  const payload = JSON.stringify({
    id: 'e',
    command: 'echo',
    args: [{ outer: [{ $uri: 'file:///tmp/a.ts' }] }, { $uri: 'file:///tmp/b.ts', extra: 1 }],
  });
  const { response } = await call(payload + '\n');
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.deepEqual(response.result, {
      command: 'echo',
      args: [
        { outer: [{ parsed: 'file:///tmp/a.ts' }] },
        // An object with keys beyond $uri is not a marker and passes through untouched.
        { $uri: 'file:///tmp/b.ts', extra: 1 },
      ],
    });
  }
});

test('non-serialisable result degrades to the marker object', async () => {
  const { response } = await call('{"id":"f","command":"cycle"}\n');
  assert.equal(response.ok, true);
  if (response.ok) {
    assert.deepEqual(response.result, { $nonSerializable: true, type: 'Object' });
  }
});

test('server answers exactly one response then closes the connection', async () => {
  const { lines, response } = await call(
    '{"id":"g1","command":"__ping"}\n{"id":"g2","command":"__ping"}\n',
  );
  assert.equal(lines.length, 1);
  assert.equal(response.id, 'g1');
});

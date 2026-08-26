import * as net from 'node:net';
import {
  BridgeResponse,
  ErrorKind,
  parseRequest,
  rewriteUriMarkers,
  safeSerialize,
} from './protocol';

export interface BridgeInfo {
  folder: string;
  pid: number;
  version: string;
}

export interface BridgeDeps {
  executeCommand(command: string, ...args: unknown[]): Promise<unknown>;
  getCommands(includeInternal: boolean): Promise<string[]>;
  parseUri(value: string): unknown;
  info: BridgeInfo;
}

export interface BridgeOptions {
  socketPath: string;
  deps: BridgeDeps;
  defaultTimeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

export function startBridge(options: BridgeOptions): net.Server {
  const { socketPath, deps } = options;
  const defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  // One request per connection keeps the bridge stateless; the socket ends after one response.
  const server = net.createServer((socket) => {
    let buffer = '';
    let handled = false;
    const handle = (line: string): void => {
      if (handled) return;
      handled = true;
      void respond(socket, line, deps, defaultTimeoutMs);
    };
    socket.on('data', (chunk: Buffer) => {
      buffer += chunk.toString('utf8');
      const newline = buffer.indexOf('\n');
      if (newline !== -1) handle(buffer.slice(0, newline));
    });
    socket.on('end', () => {
      if (buffer.trim().length > 0) handle(buffer);
    });
    socket.on('error', () => {
      // A client that vanishes mid-request needs no response.
    });
  });
  server.listen(socketPath);
  return server;
}

class TimeoutError extends Error {}

async function respond(
  socket: net.Socket,
  line: string,
  deps: BridgeDeps,
  defaultTimeoutMs: number,
): Promise<void> {
  const started = Date.now();
  const finish = (response: BridgeResponse): void => {
    socket.end(JSON.stringify(response) + '\n');
  };
  const fail = (id: string | null, kind: ErrorKind, message: string): void => {
    finish({ id, ok: false, error: { kind, message } });
  };

  const parsed = parseRequest(line);
  if (!parsed.ok) {
    fail(parsed.id, 'bad-request', parsed.message);
    return;
  }
  const request = parsed.request;
  const timeoutMs = request.timeoutMs ?? defaultTimeoutMs;

  try {
    if (request.command === '__ping') {
      finish({ id: request.id, ok: true, result: deps.info, ms: Date.now() - started });
      return;
    }
    if (request.command === '__commands') {
      const commands = await deps.getCommands(true);
      finish({ id: request.id, ok: true, result: commands, ms: Date.now() - started });
      return;
    }
    const commands = await deps.getCommands(true);
    if (!commands.includes(request.command)) {
      fail(request.id, 'unknown-command', `command '${request.command}' not found`);
      return;
    }
    const rewritten: unknown = rewriteUriMarkers(request.args, deps.parseUri);
    const args = Array.isArray(rewritten) ? rewritten : [];
    const result = await raceTimeout(
      deps.executeCommand(request.command, ...args),
      timeoutMs,
    );
    finish({ id: request.id, ok: true, result: safeSerialize(result), ms: Date.now() - started });
  } catch (err) {
    if (err instanceof TimeoutError) {
      fail(request.id, 'timeout', `command '${request.command}' timed out after ${timeoutMs}ms`);
    } else {
      fail(request.id, 'threw', errorMessage(err));
    }
  }
}

// Both settle handlers stay attached, so a late executor rejection after a timeout is consumed.
function raceTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new TimeoutError()), timeoutMs);
    if (typeof timer.unref === 'function') timer.unref();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(errorMessage(err)));
      },
    );
  });
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

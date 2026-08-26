import * as vscode from 'vscode';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { startBridge, BridgeDeps } from './bridge';

let server: net.Server | undefined;
let socketPath: string | undefined;
let recordPath: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const enabled = vscode.workspace.getConfiguration('rk.bridge').get<boolean>('enabled', true);
  if (!enabled) return;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const output = vscode.window.createOutputChannel('run-kit Code Bridge');
  context.subscriptions.push(output);

  const cbDir = stateDir();
  if (!ensurePrivateDir(cbDir, output)) return;
  const hostsDir = path.join(cbDir, 'hosts');
  fs.mkdirSync(hostsDir, { recursive: true, mode: 0o700 });

  const hostId = computeHostId(folder.uri.fsPath);
  const sock = path.join(cbDir, `${hostId}.sock`);
  // A leftover socket from a dead host is stale; liveness is re-derived by the client per call.
  try {
    fs.unlinkSync(sock);
  } catch (err) {
    if (!isNotFound(err)) throw err;
  }

  const extVersion = extensionVersion(context);
  const deps: BridgeDeps = {
    executeCommand: (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
    getCommands: (includeInternal) => Promise.resolve(vscode.commands.getCommands(includeInternal)),
    parseUri: (value) => vscode.Uri.parse(value),
    info: { folder: folder.uri.fsPath, pid: process.pid, version: extVersion },
  };
  server = startBridge({ socketPath: sock, deps });
  socketPath = sock;
  server.on('error', (err) => {
    output.appendLine(`code bridge server error: ${err.message}`);
  });
  server.once('listening', () => {
    fs.chmodSync(sock, 0o600);
    const record = {
      hostId,
      folder: folder.uri.fsPath,
      pid: process.pid,
      sock,
      extVersion,
      startedAt: new Date().toISOString(),
    };
    const recordFile = path.join(hostsDir, `${hostId}.json`);
    writeAtomic(recordFile, JSON.stringify(record) + '\n');
    recordPath = recordFile;
    output.appendLine(`code bridge listening on ${sock} (host ${hostId})`);
  });
}

export function deactivate(): void {
  if (server) {
    server.close();
    server = undefined;
  }
  for (const file of [socketPath, recordPath]) {
    if (file !== undefined) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Socket or record may already be gone.
      }
    }
  }
  socketPath = undefined;
  recordPath = undefined;
}

function stateDir(): string {
  const xdg = process.env.XDG_STATE_HOME;
  const base = typeof xdg === 'string' && xdg.length > 0 ? xdg : path.join(os.homedir(), '.local', 'state');
  return path.join(base, 'run-kit', 'cb');
}

// The socket dir gates who can reach the bridge; group/other access means refusing to start.
function ensurePrivateDir(dir: string, output: vscode.OutputChannel): boolean {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dir);
  } catch (err) {
    if (isNotFound(err)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      return true;
    }
    throw err;
  }
  if (!stat.isDirectory()) {
    output.appendLine(`code bridge not started: ${dir} exists and is not a directory`);
    return false;
  }
  if ((stat.mode & 0o077) !== 0) {
    output.appendLine(
      `code bridge not started: ${dir} has mode ${(stat.mode & 0o777).toString(8)}, expected 700`,
    );
    return false;
  }
  return true;
}

function computeHostId(folderPath: string): string {
  return crypto
    .createHash('sha1')
    .update(`${folderPath}\n${vscode.env.machineId}`)
    .digest('hex')
    .slice(0, 12);
}

function extensionVersion(context: vscode.ExtensionContext): string {
  const pkg: unknown = context.extension.packageJSON;
  if (typeof pkg === 'object' && pkg !== null && 'version' in pkg && typeof pkg.version === 'string') {
    return pkg.version;
  }
  return '0.0.0-dev';
}

// Temp + rename so a concurrent reader never sees a partial record.
function writeAtomic(file: string, contents: string): void {
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, contents, { mode: 0o600 });
  fs.renameSync(tmp, file);
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

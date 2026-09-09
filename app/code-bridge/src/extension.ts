import * as vscode from 'vscode';
import * as net from 'node:net';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import * as crypto from 'node:crypto';
import { startBridge, BridgeDeps } from './bridge';
import { readTabIdentity, TabIdentity } from './tab';
import { resolveRkPath, runRk, RunRkResult } from './rk';
import {
  WEB_ADD_TIMEOUT_MS,
  NOTIFY_TIMEOUT_MS,
  SEND_TIMEOUT_MS,
  buildWebAddArgv,
  buildNotifyArgv,
  buildSendArgv,
  buildSendPayload,
  formatReference,
  parsePort,
  selectionLines,
} from './actions';

let server: net.Server | undefined;
let socketPath: string | undefined;
let recordPath: string | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const enabled = vscode.workspace.getConfiguration('rk.bridge').get<boolean>('enabled', true);
  if (!enabled) return;
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const readConfig = (key: string): unknown => vscode.workspace.getConfiguration().get(key);
  let identity = readTabIdentity(readConfig);
  const setHasTab = (): void => {
    void vscode.commands.executeCommand('setContext', 'rk.hasTab', identity !== null);
  };
  setHasTab();
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('rk')) {
        identity = readTabIdentity(readConfig);
        setHasTab();
      }
    }),
  );
  registerActions(context, () => identity);

  const output = vscode.window.createOutputChannel('run-kit Code Bridge');
  context.subscriptions.push(output);

  const cbDir = stateDir();
  if (!ensurePrivateDir(cbDir, output)) return;
  const hostsDir = path.join(cbDir, 'hosts');
  fs.mkdirSync(hostsDir, { recursive: true, mode: 0o700 });

  // A tab-keyed window hashes its workspace file so two tabs on one folder get distinct hosts;
  // a tab-less window hashes the first folder exactly as before.
  const workspaceFile = vscode.workspace.workspaceFile;
  const identityPath =
    identity !== null && workspaceFile !== undefined ? workspaceFile.fsPath : folder.uri.fsPath;
  const hostId = computeHostId(identityPath);
  const sock = path.join(cbDir, `${hostId}.sock`);
  // A leftover socket from a dead host is stale; liveness is re-derived by the client per call.
  try {
    fs.unlinkSync(sock);
  } catch (err) {
    if (!isNotFound(err)) {
      output.appendLine(`code bridge not started: cannot remove stale socket ${sock}: ${errorMessage(err)}`);
      return;
    }
  }

  const extVersion = extensionVersion(context);
  const deps: BridgeDeps = {
    executeCommand: (command, ...args) => Promise.resolve(vscode.commands.executeCommand(command, ...args)),
    getCommands: (includeInternal) => Promise.resolve(vscode.commands.getCommands(includeInternal)),
    parseUri: (value) => vscode.Uri.parse(value),
    info: {
      folder: folder.uri.fsPath,
      pid: process.pid,
      version: extVersion,
      ...(identity !== null ? { tab: identity.tab, server: identity.server } : {}),
    },
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
      ...(identity !== null ? { tab: identity.tab, server: identity.server } : {}),
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

// Every action no-ops without an identity; the rk.hasTab when-clauses already hide the entries.
function registerActions(
  context: vscode.ExtensionContext,
  getIdentity: () => TabIdentity | null,
): void {
  const rkPath = (): string =>
    resolveRkPath(vscode.workspace.getConfiguration('rk.bridge').get<string>('rkPath', ''), process.env);

  // Context-menu invocations pass the clicked resource (a multi-select passes it first);
  // palette invocations pass nothing and fall back to the active editor.
  const resolveResourceUri = (uri: vscode.Uri | undefined): vscode.Uri | null => {
    const target = uri ?? vscode.window.activeTextEditor?.document.uri;
    if (target === undefined) return null;
    if (target.scheme !== 'file') {
      void vscode.window.showWarningMessage('Only local files and folders can be shown in the Web Tile');
      return null;
    }
    return target;
  };

  const showRunError = (result: RunRkResult): void => {
    if (result.error === 'enoent') {
      void vscode.window.showErrorMessage('run-kit: rk not found — set rk.bridge.rkPath');
      return;
    }
    const detail = firstLine(result.stderr);
    void vscode.window.showErrorMessage(`run-kit: ${detail.length > 0 ? detail : `exit ${result.code}`}`);
  };

  const openInWebTile = async (uri?: vscode.Uri): Promise<void> => {
    const identity = getIdentity();
    if (identity === null) return;
    const target = resolveResourceUri(uri);
    if (target === null) return;
    const result = await runRk(rkPath(), buildWebAddArgv(identity, target.fsPath), {
      timeoutMs: WEB_ADD_TIMEOUT_MS,
    });
    if (result.error !== undefined || result.code !== 0) showRunError(result);
  };

  const openInWebTileAndNotify = async (uri?: vscode.Uri): Promise<void> => {
    const identity = getIdentity();
    if (identity === null) return;
    const target = resolveResourceUri(uri);
    if (target === null) return;
    const add = await runRk(rkPath(), buildWebAddArgv(identity, target.fsPath), {
      timeoutMs: WEB_ADD_TIMEOUT_MS,
    });
    if (add.error !== undefined || add.code !== 0) {
      showRunError(add);
      return;
    }
    // rk notify is fail-silent by contract; its result is not surfaced.
    await runRk(rkPath(), buildNotifyArgv(path.basename(target.fsPath)), {
      timeoutMs: NOTIFY_TIMEOUT_MS,
    });
  };

  const sendToAgent = async (uri?: vscode.Uri): Promise<void> => {
    const identity = getIdentity();
    if (identity === null) return;
    const target = resolveResourceUri(uri);
    if (target === null) return;
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) return;
    const selection = editor.selection;
    const { startLine, endLine } = selectionLines(selection.start, selection.end);
    const ref = formatReference(vscode.workspace.asRelativePath(target, false), startLine, endLine);
    const text = selection.isEmpty ? '' : editor.document.getText(selection);
    const stdin = buildSendPayload(ref, text);
    const runSend = (force: boolean): Promise<RunRkResult> =>
      runRk(rkPath(), buildSendArgv(identity, { force }), { timeoutMs: SEND_TIMEOUT_MS, stdin });
    const result = await runSend(false);
    if (result.error !== undefined) {
      showRunError(result);
      return;
    }
    if (result.code === 0) {
      vscode.window.setStatusBarMessage(`Staged in tab ${identity.tab}`, 3000);
      return;
    }
    const refusal = firstLine(result.stderr);
    // Exit 1 with stderr is the agent-activity gate refusing; only that case offers Force.
    if (result.code === 1 && refusal.length > 0) {
      const choice = await vscode.window.showWarningMessage(refusal, 'Force');
      if (choice !== 'Force') return;
      const retried = await runSend(true);
      if (retried.error === undefined && retried.code === 0) {
        vscode.window.setStatusBarMessage(`Staged in tab ${identity.tab}`, 3000);
        return;
      }
      showRunError(retried);
      return;
    }
    showRunError(result);
  };

  const copyReferenceForAgent = async (uri?: vscode.Uri): Promise<void> => {
    const identity = getIdentity();
    if (identity === null) return;
    const target = resolveResourceUri(uri);
    if (target === null) return;
    const editor = vscode.window.activeTextEditor;
    if (editor === undefined) return;
    const { startLine, endLine } = selectionLines(editor.selection.start, editor.selection.end);
    const ref = formatReference(vscode.workspace.asRelativePath(target, false), startLine, endLine);
    await vscode.env.clipboard.writeText(ref);
    vscode.window.setStatusBarMessage(`Copied ${ref}`, 3000);
  };

  const openPortInWebTile = async (): Promise<void> => {
    const identity = getIdentity();
    if (identity === null) return;
    const input = await vscode.window.showInputBox({
      prompt: 'Local port',
      validateInput: (value) => (parsePort(value) === null ? '1–65535' : undefined),
    });
    if (input === undefined) return;
    const port = parsePort(input);
    if (port === null) return;
    const result = await runRk(rkPath(), buildWebAddArgv(identity, `:${port}`), {
      timeoutMs: WEB_ADD_TIMEOUT_MS,
    });
    if (result.error !== undefined || result.code !== 0) showRunError(result);
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('rk.openInWebTile', (uri?: vscode.Uri) => openInWebTile(uri)),
    vscode.commands.registerCommand('rk.openFolderInWebTile', (uri?: vscode.Uri) =>
      openInWebTile(uri),
    ),
    vscode.commands.registerCommand('rk.openInWebTileAndNotify', (uri?: vscode.Uri) =>
      openInWebTileAndNotify(uri),
    ),
    vscode.commands.registerCommand('rk.sendToAgent', (uri?: vscode.Uri) => sendToAgent(uri)),
    vscode.commands.registerCommand('rk.copyReferenceForAgent', (uri?: vscode.Uri) =>
      copyReferenceForAgent(uri),
    ),
    vscode.commands.registerCommand('rk.openPortInWebTile', () => openPortInWebTile()),
  );
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

function computeHostId(identityPath: string): string {
  return crypto
    .createHash('sha1')
    .update(`${identityPath}\n${vscode.env.machineId}`)
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

function firstLine(text: string): string {
  return text.split('\n', 1)[0].trim();
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && err.code === 'ENOENT';
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

import { execFile } from 'node:child_process';
import * as path from 'node:path';

// Ladder: a non-empty absolute rk.bridge.rkPath setting, then $RK_BIN, then rk on PATH.
export function resolveRkPath(settingValue: unknown, env: NodeJS.ProcessEnv): string {
  if (typeof settingValue === 'string' && settingValue.length > 0 && path.isAbsolute(settingValue)) {
    return settingValue;
  }
  const envPath = env.RK_BIN;
  if (typeof envPath === 'string' && envPath.length > 0) return envPath;
  return 'rk';
}

export interface RunRkResult {
  code: number;
  stdout: string;
  stderr: string;
  error?: 'enoent';
}

// argv arrays only — never a shell string. A non-zero exit is a result, not a throw;
// a spawn ENOENT resolves as a distinguishable result so callers can point at rk.bridge.rkPath.
export function runRk(
  rkPath: string,
  argv: string[],
  opts: { timeoutMs: number; stdin?: string },
): Promise<RunRkResult> {
  return new Promise((resolve) => {
    const child = execFile(
      rkPath,
      argv,
      { timeout: opts.timeoutMs, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        if (error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          resolve({ code: -1, stdout, stderr, error: 'enoent' });
          return;
        }
        // A timeout kill carries a null code and a signal; it surfaces as a generic non-zero.
        const code = error === null ? 0 : typeof error.code === 'number' ? error.code : 1;
        resolve({ code, stdout, stderr });
      },
    );
    if (opts.stdin !== undefined && child.stdin !== null) {
      child.stdin.on('error', () => {
        // A failed spawn can EPIPE the stdin write; the spawn result already carries the error.
      });
      child.stdin.end(opts.stdin);
    }
  });
}

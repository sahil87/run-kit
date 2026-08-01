/**
 * SSH-remote-host pure logic — parsing of the `rk remote` CLI's stable
 * stdout contracts and the streamed-progress line handling used by the
 * welcome page's "or over SSH" rung.
 *
 * Deliberately electron-free (the `local-daemon.ts` precedent): everything
 * here is a pure function over strings, fully covered by the sibling
 * `remote-host.test.ts` under plain `node --test`. The impure glue —
 * execFile invocations, IPC, progress relay — lives in `main.ts`.
 *
 * CLI contracts consumed (labeled data lines, the `rk desktop status` →
 * update-check.ts precedent):
 *   - `rk remote add <target>` stdout:
 *       Name:   buildbox
 *       Target: sahil@buildbox
 *       Local:  http://127.0.0.1:3100
 *   - `rk remote connect <name>`: progress lines on stderr (streamed to the
 *     renderer), the local origin as the final stdout line.
 */

/** Parsed registration from `rk remote add` stdout. */
export interface RemoteAddInfo {
  /** The rk remote name — the hosts.json `remote` field + connect argument. */
  name: string;
  /** The stable local origin, e.g. `http://127.0.0.1:3100`. */
  origin: string;
}

/**
 * Parse `rk remote add` stdout to the remote name + local origin. Returns
 * null when either labeled line is missing or empty — callers surface a
 * generic failure rather than persisting a half-parsed host.
 */
export function parseRemoteAddOutput(stdout: string): RemoteAddInfo | null {
  const name = labeledValue(stdout, "Name");
  const origin = labeledValue(stdout, "Local");
  if (name === null || origin === null) return null;
  return { name, origin };
}

/** Extract the value of a `Label:  value` line, null when absent/empty. */
function labeledValue(text: string, label: string): string | null {
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(`${label}:`)) continue;
    const value = line.slice(label.length + 1).trim();
    return value === "" ? null : value;
  }
  return null;
}

/**
 * Parse `rk remote connect` stdout to the tunnel's local origin — the final
 * non-empty line, which must look like an http(s) origin. Null on anything
 * else (the add-derived origin is the fallback identity, so a parse miss is
 * survivable but never guessed at).
 */
export function parseConnectOrigin(stdout: string): string | null {
  const lines = stdout
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  if (lines.length === 0) return null;
  const last = lines[lines.length - 1];
  return /^https?:\/\/\S+$/.test(last) ? last : null;
}

/**
 * Incremental line splitter for a streamed chatter feed (`rk remote
 * connect`'s stderr arrives in arbitrary chunks). push() returns the
 * complete, trimmed, non-empty lines the chunk finished; flush() drains a
 * trailing unterminated line at stream end.
 */
export function createLineSplitter(): {
  push: (chunk: string) => string[];
  flush: () => string[];
} {
  let buffer = "";
  const emit = (raw: string[]): string[] =>
    raw.map((l) => l.trim()).filter((l) => l !== "");
  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      return emit(parts);
    },
    flush(): string[] {
      const rest = buffer;
      buffer = "";
      return emit([rest]);
    },
  };
}

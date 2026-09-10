import { TabIdentity } from './tab';

/**
 * Ownership test for the registry files deactivate() may unlink: true iff the
 * contents parse to an object whose numeric pid equals the given pid. The
 * hostId is stable per tab+browser (machineId is persistent), so successive
 * boots of one tab share one record/socket/marker path and VS Code keeps a
 * disconnected extension host alive for minutes — a file a NEWER host rewrote
 * carries its pid and must survive this host's exit. A missing pid or
 * unparseable contents are never owned: never guess ownership.
 */
export function ownsFile(contents: string, pid: number): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    return false;
  }
  if (typeof parsed !== 'object' || parsed === null || !('pid' in parsed)) return false;
  return (parsed as { pid: unknown }).pid === pid;
}

/** One cb/boots/<hostId>.json — the positive empty-boot signal the daemon's
 *  code-bridge status route reports as `emptyBootAt`. Field names are the JSON
 *  contract with the Go side and must not change. */
export interface BootMarker {
  hostId: string;
  workspaceFile: string;
  tab: string;
  server: string;
  pid: number;
  extVersion: string;
  startedAt: string;
}

/** Build the marker for a zero-folder tab-keyed activation. `hostId` is the
 *  SAME hash the good-boot host record uses (both key on the workspace file),
 *  so marker and record for one tab share a key. */
export function buildBootMarker(args: {
  hostId: string;
  workspaceFile: string;
  identity: TabIdentity;
  pid: number;
  extVersion: string;
  now: Date;
}): BootMarker {
  return {
    hostId: args.hostId,
    workspaceFile: args.workspaceFile,
    tab: args.identity.tab,
    server: args.identity.server,
    pid: args.pid,
    extVersion: args.extVersion,
    startedAt: args.now.toISOString(),
  };
}

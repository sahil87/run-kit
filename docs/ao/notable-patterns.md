# Notable Patterns

## Atomic Session ID Reservation

When spawning a session, the ID (`int-1`, `ao-3`) must be unique. Instead of check-then-create (TOCTOU race), the code uses `openSync` with `O_EXCL` flag:

```typescript
function reserveSessionId(dataDir: string, sessionId: SessionId): boolean {
  const path = metadataPath(dataDir, sessionId);
  mkdirSync(dirname(path), { recursive: true });
  try {
    const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL);
    closeSync(fd);
    return true;
  } catch {
    return false;
  }
}
```

If the file already exists, `O_EXCL` makes `openSync` fail atomically. The spawn loop retries up to 10 times with incrementing numbers.

## Cleanup-on-Failure Cascade

The spawn flow creates resources in order: workspace -> runtime -> metadata -> hooks. If any step fails, all previously created resources are cleaned up in reverse order:

```
workspace fails? → delete reserved session ID
runtime fails?   → destroy workspace, delete session ID
metadata fails?  → destroy runtime, destroy workspace, delete session ID
```

This is implemented with nested try/catch blocks, each with `/* best effort */` cleanup that swallows errors (since the original error is what matters).

## Read-Last-Line from End of File

For activity detection, only the last line of a potentially 100MB+ JSONL file matters. Instead of reading the whole file, the code reads backwards in 4KB chunks from the end:

```typescript
async function readLastLine(filePath: string): Promise<string | null> {
  const CHUNK = 4096;
  const fh = await open(filePath, "r");
  const { size } = await fh.stat();
  // Read backwards in chunks, accumulating raw buffers
  // to avoid corrupting multi-byte UTF-8 at chunk boundaries
  const chunks: Buffer[] = [];
  let pos = size;
  while (pos > 0) {
    const readSize = Math.min(CHUNK, pos);
    pos -= readSize;
    const chunk = Buffer.alloc(readSize);
    await fh.read(chunk, 0, readSize, pos);
    chunks.unshift(chunk);
    // Convert all accumulated bytes to string (safe for multi-byte)
    const tail = Buffer.concat(chunks).toString("utf-8");
    // Find the last non-empty line
    // ...
  }
}
```

This is used by both `readLastJsonlEntry()` (shared utility) and `parseJsonlFileTail()` (agent plugin, reads ~128KB for cost/summary data).

## PS Cache with TTL

Checking if an agent process is running requires `ps -eo pid,tty,args`. When listing 20 sessions, that would spawn 20 concurrent `ps` processes, each slow on machines with many processes. The cache ensures only one `ps` call per 5-second window:

```typescript
let psCache: { output: string; timestamp: number; promise?: Promise<string> } | null = null;

async function getCachedProcessList(): Promise<string> {
  if (psCache && Date.now() - psCache.timestamp < 5000) {
    if (psCache.promise) return psCache.promise;  // wait for in-flight request
    return psCache.output;
  }
  const promise = execFileAsync("ps", [...]).then(({ stdout }) => {
    if (psCache?.promise === promise) {
      psCache = { output: stdout, timestamp: Date.now() };
    }
    return stdout;
  });
  psCache = { output: "", timestamp: Date.now(), promise };
  return promise;
}
```

The `promise` field in the cache allows concurrent callers to share a single in-flight request rather than each starting their own.

## Claude Code Workspace Hooks

The claude-code agent plugin installs a PostToolUse hook (bash script) into each workspace's `.claude/settings.json`. This hook runs after every Bash tool call and:

1. Detects `gh pr create` commands → extracts PR URL → writes `pr=<url>` to metadata
2. Detects `git checkout -b` / `git switch -c` → extracts branch → writes `branch=<name>`
3. Detects `gh pr merge` → writes `status=merged`

This is how the dashboard knows about PRs without polling GitHub — the agent's own tool calls trigger metadata updates in real time.

## Enrichment Timeout

When listing sessions, each session is "enriched" with live runtime state and activity detection. This involves subprocess calls (tmux, ps) that can be slow. To prevent one stuck session from blocking the entire list:

```typescript
const enrichTimeout = new Promise<void>((resolve) => setTimeout(resolve, 2_000));
await Promise.race([
  ensureHandleAndEnrich(session, sessionName, project, plugins),
  enrichTimeout,
]);
```

If enrichment takes longer than 2 seconds, the session keeps its metadata-only values and the list continues.

## Lifecycle Polling Re-entrancy Guard

The lifecycle manager polls all sessions every 30 seconds. If a poll cycle takes longer than 30 seconds (slow GitHub API, many sessions), the next tick would start a second concurrent poll. A boolean guard prevents this:

```typescript
let polling = false;

async function pollAll(): Promise<void> {
  if (polling) return;
  polling = true;
  try {
    // ... poll all sessions
  } finally {
    polling = false;
  }
}
```

## Ad-Hoc Issue Handling

When `ao spawn my-app "fix login bug"` is called with a free-text string instead of an issue ID, the tracker lookup fails with "issue not found." The code distinguishes this from auth/network errors:

```typescript
function isIssueNotFoundError(err: unknown): boolean {
  const message = (err as Error).message?.toLowerCase() || "";
  return (
    (message.includes("issue") && message.includes("not found")) ||
    message.includes("no issue found") ||
    // ... other patterns
  );
}
```

If it's a "not found" error, the spawn proceeds without tracker context, generating a branch name from the free-text: `"fix login bug"` -> `feat/fix-login-bug`. If it's an auth error, the spawn fails fast.

## Terminal-Aware Status Skipping

Sessions in terminal states (`killed`, `done`, `merged`, `terminated`, `cleanup`) skip all subprocess/IO enrichment:

```typescript
const TERMINAL_SESSION_STATUSES = new Set(["killed", "done", "merged", "terminated", "cleanup"]);

async function enrichSessionWithRuntimeState(session, plugins, handleFromMetadata) {
  if (TERMINAL_SESSION_STATUSES.has(session.status)) {
    session.activity = "exited";
    return;  // No tmux/ps/JSONL checks needed
  }
  // ... expensive enrichment for active sessions
}
```

This optimization prevents wasting subprocess calls on sessions that are already known to be dead.

## State Transition Detection Across Restarts

When the lifecycle manager restarts, it needs to know what each session's status was before the restart. Rather than using the in-memory tracked state (which is empty), it falls back to the persisted metadata status:

```typescript
const tracked = states.get(session.id);
const oldStatus = tracked ?? (session.metadata?.["status"] || session.status);
```

This ensures transitions are detected even after a lifecycle manager restart.

## Fabricated vs Stored Handles

Sessions created by external scripts (bash, CI) may not have a `runtimeHandle` in their metadata. The session manager fabricates one as a fallback, but marks it differently. Fabricated handles do NOT trigger "killed" status when the tmux session isn't found — because the session may never have had a tmux session:

```typescript
if (handleFromMetadata && session.runtimeHandle && plugins.runtime) {
  const alive = await plugins.runtime.isAlive(session.runtimeHandle);
  if (!alive) {
    session.status = "killed";
    return;
  }
}
// Fabricated handles skip this check — we don't know if tmux ever existed
```

## All-Complete Guard

The "all sessions complete" notification fires once when every session reaches a terminal state. A boolean guard prevents it from firing repeatedly on every subsequent poll:

```typescript
let allCompleteEmitted = false;

// In pollAll():
if (sessions.length > 0 && activeSessions.length === 0 && !allCompleteEmitted) {
  allCompleteEmitted = true;
  // trigger all-complete reaction
}

// Reset when any session becomes active again:
if (newStatus !== "merged" && newStatus !== "killed") {
  allCompleteEmitted = false;
}
```

## PR Auto-Detection for Non-Claude Agents

Claude Code has PostToolUse hooks that write PR URLs to metadata. Other agents (Codex, Aider, OpenCode) don't. The lifecycle manager compensates by auto-detecting PRs by branch name:

```typescript
if (!session.pr && scm && session.branch) {
  const detectedPR = await scm.detectPR(session, project);
  if (detectedPR) {
    session.pr = detectedPR;
    updateMetadata(sessionsDir, session.id, { pr: detectedPR.url });
  }
}
```

This runs on every poll cycle until a PR is found. Once detected, the PR URL is persisted so subsequent polls skip the SCM query.

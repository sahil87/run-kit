# Plugin System

## Design

Every plugin is an implementation of a TypeScript interface. There are 7 pluggable slots (Runtime, Agent, Workspace, Tracker, SCM, Notifier, Terminal) plus the non-pluggable Lifecycle core.

A plugin exports a `PluginModule` with two things:
1. A `manifest` describing the plugin (name, slot, description, version)
2. A `create()` factory function that returns the interface implementation

```typescript
import type { PluginModule, Runtime } from "@composio/ao-core";

export const manifest = {
  name: "tmux",
  slot: "runtime" as const,
  description: "Runtime plugin: tmux sessions",
  version: "0.1.0",
};

export function create(): Runtime {
  return {
    name: "tmux",
    async create(config) { /* ... */ },
    async destroy(handle) { /* ... */ },
    async sendMessage(handle, message) { /* ... */ },
    async getOutput(handle, lines) { /* ... */ },
    async isAlive(handle) { /* ... */ },
    // Optional methods:
    async getMetrics(handle) { /* ... */ },
    async getAttachInfo(handle) { /* ... */ },
  };
}

export default { manifest, create } satisfies PluginModule<Runtime>;
```

The `satisfies PluginModule<T>` pattern gives compile-time type checking without losing the specific types of `manifest` and `create`. This is enforced in CLAUDE.md — the alternative (`const plugin = { ... }; export default plugin`) loses type checking.

## Plugin Registry

The registry is a simple `Map<"slot:name", instance>` created by `createPluginRegistry()`. It supports:

- **`register(plugin, config?)`** — instantiate and register a plugin
- **`get<T>(slot, name)`** — get a plugin instance by slot and name
- **`list(slot)`** — list all registered plugins for a slot
- **`loadBuiltins(config?, importFn?)`** — load all built-in plugins
- **`loadFromConfig(config, importFn?)`** — load built-ins plus config-specified plugins

Built-in plugins are listed in a constant array mapping slot+name to npm package:

```typescript
const BUILTIN_PLUGINS = [
  { slot: "runtime",   name: "tmux",         pkg: "@composio/ao-plugin-runtime-tmux" },
  { slot: "agent",     name: "claude-code",  pkg: "@composio/ao-plugin-agent-claude-code" },
  { slot: "workspace", name: "worktree",     pkg: "@composio/ao-plugin-workspace-worktree" },
  { slot: "tracker",   name: "github",       pkg: "@composio/ao-plugin-tracker-github" },
  { slot: "scm",       name: "github",       pkg: "@composio/ao-plugin-scm-github" },
  { slot: "notifier",  name: "desktop",      pkg: "@composio/ao-plugin-notifier-desktop" },
  // ... etc
];
```

Missing plugins are silently skipped (not installed = not available). This allows partial installations.

## Interface Deep Dive

### Runtime

The Runtime interface manages where agent sessions execute. It's the lowest-level abstraction.

```typescript
interface Runtime {
  name: string;
  create(config: RuntimeCreateConfig): Promise<RuntimeHandle>;
  destroy(handle: RuntimeHandle): Promise<void>;
  sendMessage(handle: RuntimeHandle, message: string): Promise<void>;
  getOutput(handle: RuntimeHandle, lines?: number): Promise<string>;
  isAlive(handle: RuntimeHandle): Promise<boolean>;
  getMetrics?(handle: RuntimeHandle): Promise<RuntimeMetrics>;          // optional
  getAttachInfo?(handle: RuntimeHandle): Promise<AttachInfo>;           // optional
}
```

The `RuntimeHandle` is an opaque object carrying a runtime-specific ID (tmux session name, container ID, pod name), the runtime name, and arbitrary data. This handle is serialized to JSON and stored in session metadata for later retrieval.

Implementations: `tmux` (creates detached tmux sessions), `process` (spawns child processes).

### Agent

The Agent interface adapts a specific AI coding tool. It's the most complex interface because different agents have very different APIs.

```typescript
interface Agent {
  name: string;
  processName: string;                    // e.g., "claude", "codex"
  promptDelivery?: "inline" | "post-launch";  // how initial prompt is delivered
  getLaunchCommand(config: AgentLaunchConfig): string;
  getEnvironment(config: AgentLaunchConfig): Record<string, string>;
  detectActivity(terminalOutput: string): ActivityState;                // legacy
  getActivityState(session: Session, thresholdMs?): Promise<ActivityDetection | null>;  // preferred
  isProcessRunning(handle: RuntimeHandle): Promise<boolean>;
  getSessionInfo(session: Session): Promise<AgentSessionInfo | null>;
  getRestoreCommand?(session: Session, project: ProjectConfig): Promise<string | null>;  // optional
  postLaunchSetup?(session: Session): Promise<void>;                                     // optional
  setupWorkspaceHooks?(path: string, config: WorkspaceHooksConfig): Promise<void>;       // optional
}
```

Key design decisions:

- **`promptDelivery`**: Claude Code exits after `-p` flag (one-shot mode), so the prompt is delivered post-launch via `runtime.sendMessage()`. Other agents may accept inline prompts.
- **`detectActivity` vs `getActivityState`**: The old terminal-parsing approach (`detectActivity`) is deprecated in favor of JSONL-based detection (`getActivityState`). Both are kept for backward compatibility.
- **`setupWorkspaceHooks`**: Claude Code writes a PostToolUse hook that auto-updates metadata when the agent runs `gh pr create` or `git checkout -b`. This is critical for the dashboard — without it, PRs created by agents never show up.

Implementations: `claude-code`, `codex`, `aider`, `opencode`.

### Workspace

```typescript
interface Workspace {
  name: string;
  create(config: WorkspaceCreateConfig): Promise<WorkspaceInfo>;
  destroy(workspacePath: string): Promise<void>;
  list(projectId: string): Promise<WorkspaceInfo[]>;
  postCreate?(info: WorkspaceInfo, project: ProjectConfig): Promise<void>;  // optional
  exists?(workspacePath: string): Promise<boolean>;                         // optional
  restore?(config: WorkspaceCreateConfig, path: string): Promise<WorkspaceInfo>;  // optional
}
```

The worktree plugin creates git worktrees, handles symlinks for shared resources (`.env`, `.claude`), and runs postCreate commands (`pnpm install`, etc.). The `restore` method recreates a worktree for an existing branch after it was killed.

### Tracker

```typescript
interface Tracker {
  name: string;
  getIssue(id: string, project: ProjectConfig): Promise<Issue>;
  isCompleted(id: string, project: ProjectConfig): Promise<boolean>;
  issueUrl(id: string, project: ProjectConfig): string;
  branchName(id: string, project: ProjectConfig): string;
  generatePrompt(id: string, project: ProjectConfig): Promise<string>;
  listIssues?(filters: IssueFilters, project: ProjectConfig): Promise<Issue[]>;  // optional
  updateIssue?(id: string, update: IssueUpdate, project: ProjectConfig): Promise<void>;  // optional
  createIssue?(input: CreateIssueInput, project: ProjectConfig): Promise<Issue>;  // optional
}
```

The tracker is responsible for issue-to-branch-name mapping and generating the issue context prompt that gets sent to the agent.

### SCM

The richest interface. Covers the full PR pipeline: detection, state, CI checks, reviews, merge readiness, and merge execution.

```typescript
interface SCM {
  name: string;
  detectPR(session: Session, project: ProjectConfig): Promise<PRInfo | null>;
  getPRState(pr: PRInfo): Promise<PRState>;
  mergePR(pr: PRInfo, method?: MergeMethod): Promise<void>;
  closePR(pr: PRInfo): Promise<void>;
  getCIChecks(pr: PRInfo): Promise<CICheck[]>;
  getCISummary(pr: PRInfo): Promise<CIStatus>;
  getReviews(pr: PRInfo): Promise<Review[]>;
  getReviewDecision(pr: PRInfo): Promise<ReviewDecision>;
  getPendingComments(pr: PRInfo): Promise<ReviewComment[]>;
  getAutomatedComments(pr: PRInfo): Promise<AutomatedComment[]>;
  getMergeability(pr: PRInfo): Promise<MergeReadiness>;
}
```

### Notifier

The primary human interface. The notifier pushes information to the human rather than making them pull.

```typescript
interface Notifier {
  name: string;
  notify(event: OrchestratorEvent): Promise<void>;
  notifyWithActions?(event: OrchestratorEvent, actions: NotifyAction[]): Promise<void>;  // optional
  post?(message: string, context?: NotifyContext): Promise<string | null>;               // optional
}
```

Multiple notifiers can be active simultaneously, with routing by priority level:

```yaml
notificationRouting:
  urgent: [desktop, slack]   # agent stuck, needs input
  action: [desktop, slack]   # PR ready to merge
  warning: [slack]           # auto-fix failed
  info: [slack]              # summary, all done
```

## Reaction System

Reactions are the auto-handling mechanism. Each reaction maps an event type to an action:

| Reaction Key | Trigger | Default Action |
|-------------|---------|---------------|
| `ci-failed` | CI checks fail on PR | Send fix instructions to agent (2 retries) |
| `changes-requested` | Reviewer requests changes | Send review comments to agent |
| `bugbot-comments` | Automated review comments found | Send bot comments to agent |
| `merge-conflicts` | Branch has merge conflicts | Send rebase instructions to agent |
| `approved-and-green` | PR approved + CI green | Notify human (auto: false by default) |
| `agent-stuck` | Agent inactive for >10m | Notify human (urgent) |
| `agent-needs-input` | Agent asking a question | Notify human (urgent) |
| `agent-exited` | Agent process exited | Notify human (urgent) |
| `all-complete` | All sessions merged/killed | Notify human (info) |

Each reaction supports:
- `auto: true/false` — whether to trigger automatically
- `action: "send-to-agent" | "notify" | "auto-merge"` — what to do
- `retries: N` — how many times to retry before escalating
- `escalateAfter: "30m"` or `escalateAfter: 2` — when to escalate to human
- `message: "..."` — the message to send to the agent
- `priority: "urgent" | "action" | "warning" | "info"` — notification priority

Reactions track attempt counts per session. After exceeding retries or time limits, they escalate to human notification automatically.

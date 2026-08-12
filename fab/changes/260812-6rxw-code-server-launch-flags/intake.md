# Intake: Curated Launch Flags for the Daemon-Managed code-server Spawn

**Change**: 260812-6rxw-code-server-launch-flags
**Created**: 2026-08-12

## Origin

Promptless dispatch (`/fab-proceed` create-new path) from a fully specified change description. The description arrived pre-deliberated: flag set verified against the installed binary, alternatives explicitly rejected with rationale, constraints and test expectations named. No questions were asked (promptless-defer contract); no decisions required deferral — the input left no genuine unknowns.

> **Title direction**: curated launch flags for the daemon-managed code-server spawn.
>
> **What**: Add flags to the code-server argv built in `ensureCodeServer` (app/backend/internal/daemon/codeserver.go:84-90). Current argv ends with `code-server --bind-addr 127.0.0.1:{port} --auth none`. Append: `--disable-telemetry`, `--disable-update-check`, `--disable-workspace-trust`, `--disable-getting-started-override`, `--app-name run-kit`.
>
> **Verified facts** (checked on this box, 2026-08-12): installed code-server is 4.112.0 with Code 1.112.0; all five flags exist in its `--help` output verbatim as spelled above.
>
> **Explicitly rejected**: `--idle-timeout-seconds` (must NOT be added), `-e/--ignore-last-opened` (unnecessary), chat-panel suppression (no CLI flag in this build — out of scope, backlog 71bv). Argv-only change; test updated via the `codeServerSpawn` seam. Change type: small, well-understood enhancement to an existing feature.

## Why

The daemon-managed code-server (PR #563: sibling `rk-code-server` tmux session on the rk-daemon socket, consumed through the stable `/code` route as an embedded lens) currently launches with only `--bind-addr 127.0.0.1:{port} --auth none`. Everything else is code-server's stock defaults, which are tuned for a standalone, self-updating, multi-tenant-wary editor — not for an rk-owned embedded lens. Four kinds of noise result:

1. **Telemetry** — code-server phones home by default. An rk-spawned local editor has no reason to report usage.
2. **Update nagging** — the built-in notifier checks GitHub every 6 hours and nags weekly. On this box code-server updates arrive via Homebrew, so the notifier can only ever produce false actionable-looking noise inside the lens.
3. **Workspace-trust prompts** — every worktree opened through `/code` triggers a "Do you trust the authors?" dialog inside the embedded iframe. The `/code` lens only opens rk-managed worktrees; the prompt is pure friction with no security value in this context. code-server has no "auto-accept trust" flag — `--disable-workspace-trust` (which disables the feature entirely, so every workspace runs implicitly trusted with no prompt) is the only mechanism.
4. **Coder branding** — the Welcome tab is occupied by a Coder-branded "Deploy code-server for your team" promo (`--disable-getting-started-override` removes it), and the title bar / welcome strings say "code-server" (`--app-name run-kit` makes the lens read as part of run-kit).

If we don't make this change, every fresh spawn of the managed editor ships telemetry, a permanently-wrong update nag, a trust dialog per worktree, and third-party branding inside rk's own UI. The alternative mechanisms were considered and rejected (see What Changes → Non-Goals): flags are the smallest, most legible lever — an argv-only change at the single spawn site rk already owns, with an existing test seam that captures the exact argv.

## What Changes

### `ensureCodeServer` argv (app/backend/internal/daemon/codeserver.go)

The args slice at codeserver.go:84-90 currently builds:

```go
args := []string{
    "new-session", "-d",
    "-s", CodeServerSessionName,
    "-n", CodeServerWindowName,
    "env", "-u", "VSCODE_IPC_HOOK_CLI",
    "code-server", "--bind-addr", fmt.Sprintf("%s:%d", localhostAddr, port), "--auth", "none",
}
```

Append five flags after `--auth none`, in this order:

1. `--disable-telemetry`
2. `--disable-update-check` — code-server updates arrive via Homebrew; the built-in notifier (checks GitHub every 6h, nags weekly) is noise.
3. `--disable-workspace-trust` — disables the workspace-trust feature entirely, so every workspace runs implicitly trusted with no prompt. Intended: the `/code` lens only opens rk-managed worktrees, and trust dialogs inside the embedded iframe are pure noise. There is no separate "auto-accept" flag; killing the feature is the mechanism.
4. `--disable-getting-started-override` — removes the Coder-branded "Deploy code-server for your team" promo occupying the Welcome tab in the embedded lens.
5. `--app-name run-kit` — title bar / welcome strings say run-kit instead of code-server (cosmetic curation of the `/code` lens). Passed as two argv elements: `"--app-name", "run-kit"`.

Resulting spawn tail:

```go
"code-server", "--bind-addr", fmt.Sprintf("%s:%d", localhostAddr, port), "--auth", "none",
"--disable-telemetry", "--disable-update-check", "--disable-workspace-trust",
"--disable-getting-started-override", "--app-name", "run-kit",
```

All five flags verified present verbatim in the installed code-server 4.112.0 (`Code 1.112.0`) `--help` output on this box, 2026-08-12.

The argv stays an explicit argument slice through `runTmux` / `exec.CommandContext` (Constitution I posture unchanged — no shell strings). Everything upstream of the slice — the session-exists silent skip, the port resolution, the `portInUse` externally-managed skip, the missing-binary warn-and-continue, the `env -u VSCODE_IPC_HOOK_CLI` strip — is untouched.

### Test update (app/backend/internal/daemon/codeserver_test.go)

`TestEnsureCodeServerSpawnsSiblingSession` captures the spawn argv via the `codeServerSpawn` seam and asserts the exact joined string (codeserver_test.go:48). Update its `want` to the full new argv ending in the five flags — an exact-argv assertion of the new flag set is the coverage requirement (code-quality.md: changed behavior MUST be tested). `TestEnsureCodeServerConventionPort` uses a `strings.Contains` check on `--bind-addr` only and needs no change; the skip-branch tests assert zero spawns and are unaffected.

### Non-Goals (explicitly rejected)

- **`--idle-timeout-seconds` — must NOT be added.** Server-side terminals and hot-exit state live in the code-server process; that persistence is why it runs as a sibling tmux session surviving daemon stops (see the comment block at codeserver.go:12-23, 260811-a2bo). An idle timeout would kill exactly what the sibling-session design protects.
- **`-e`/`--ignore-last-opened` — unnecessary.** The `/code` route drives the folder via URL.
- **Suppressing the "Build with Agent" chat panel — OUT OF SCOPE.** It has no CLI flag in this build (settings-only via `chat.disableAIFeatures`); the user will set it manually in the default profile, and an rk-owned `--user-data-dir` seeded settings.json is already captured as backlog idea 71bv on the main worktree. This change is argv-only.
- **No behavior change for externally managed instances.** The `portInUse` skip at codeserver.go:75 is unchanged — rk controls flags only for instances it spawns.
- **No restart/re-flag mechanism for an already-running session.** The session-exists skip (codeserver.go:66) means an existing `rk-code-server` session keeps its old argv; the new flags take effect on the next fresh spawn (e.g., after the session is gone and the daemon starts). That rollout behavior is inherent to the existing idempotent design and is not extended here.

## Affected Memory

- `run-kit/architecture`: (modify) the managed code-server sibling-session coverage gains the curated launch-flag set (telemetry/update-check/workspace-trust/getting-started disabled, `--app-name run-kit`) and the flags-only-for-rk-spawned-instances boundary.

## Impact

- **Code**: `app/backend/internal/daemon/codeserver.go` — the args slice in `ensureCodeServer` only (5 flag additions, ~2 lines).
- **Tests**: `app/backend/internal/daemon/codeserver_test.go` — the `want` argv string in `TestEnsureCodeServerSpawnsSiblingSession`.
- **Runtime**: next fresh spawn of `rk-code-server` launches with the curated flags; existing sessions and externally managed instances unaffected. No API, frontend, config, or route changes. No new dependencies.
- **Scale**: 2 files, small diff; light-lane candidate.

## Open Questions

None — the description pre-resolved flag spellings (verified against the installed binary), ordering intent, rejected alternatives, and test expectations.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Append exactly the five flags `--disable-telemetry`, `--disable-update-check`, `--disable-workspace-trust`, `--disable-getting-started-override`, `--app-name run-kit` to the `ensureCodeServer` argv | Given verbatim in the description; all five verified present in installed code-server 4.112.0 `--help` on this box (2026-08-12) | S:95 R:90 A:95 D:95 |
| 2 | Certain | Flags are appended after `--auth none`, in the description's listed order | Description says "append"; ordering among boolean CLI flags is behavior-neutral for code-server, one obvious default (as listed), trivially reversible | S:75 R:95 A:85 D:85 |
| 3 | Certain | `--app-name run-kit` rides the explicit argument slice as two elements (`"--app-name", "run-kit"`); no shell strings anywhere | Constitution I mandates explicit argv through `exec.CommandContext`; the existing slice already models value-taking flags this way (`--bind-addr`, `--auth`) | S:90 R:90 A:95 D:95 |
| 4 | Certain | `--idle-timeout-seconds` is NOT added | Explicit must-not in the description: server-side terminals + hot-exit state live in the process; persistence is the point of the sibling-session design (codeserver.go:12-23) | S:95 R:80 A:90 D:90 |
| 5 | Certain | Chat-panel ("Build with Agent") suppression is out of scope | Explicit in the description: no CLI flag in this build (settings-only `chat.disableAIFeatures`); seeded settings.json is backlog 71bv; this change is argv-only | S:95 R:85 A:90 D:95 |
| 6 | Certain | Coverage = exact-argv assertion of the new flag set in `TestEnsureCodeServerSpawnsSiblingSession` via the existing `codeServerSpawn` seam | Named in the description's constraints; matches code-quality.md (changed behavior MUST be tested) and the test file's existing exact-string pattern (codeserver_test.go:48) | S:90 R:90 A:90 D:90 |
| 7 | Certain | The `portInUse` externally-managed skip and the session-exists skip are untouched — rk curates flags only for instances it spawns | Explicit constraint in the description; the change is confined to the args slice | S:95 R:85 A:90 D:95 |
| 8 | Confident | New flags take effect only on future spawns; an already-running `rk-code-server` session keeps its old argv until it next goes away — no restart/re-flag mechanism is added | Not stated explicitly, but forced by the argv-only constraint plus the existing idempotent session-exists skip; adding a restart path would exceed the stated scope | S:60 R:85 A:80 D:75 |
| 9 | Confident | Affected memory is `run-kit/architecture` (modify) only — the domain file already covering the managed code-server sibling session | Memory index maps the daemon/code-server spawn to architecture.md; the change is backend spawn contract, not a UI-pattern or route change | S:55 R:90 A:75 D:70 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).

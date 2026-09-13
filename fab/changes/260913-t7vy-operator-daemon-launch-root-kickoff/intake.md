# Intake: rk operator -L — Project-Root Launch Dir and Kickoff Visibility

**Change**: 260913-t7vy-operator-daemon-launch-root-kickoff
**Created**: 2026-09-13

## Origin

Conversational, from a `/fab-discuss` session on 2026-09-13 diagnosing a live incident on the `runKit` and `fabKit` servers. The user's raw reports, in order:

> Starting the operator using the "start operator" button led to a trust wall that I accepted — which then led to a claude session starting but no "/fab-operator". So I exited that claude session and terminal. But the operator tab doesn't detect it. Its stuck at this state. So — multiple issues

> This is because also — the home folder doesn't have an operator skill.

Three screenshots accompanied the reports: (1) the quake terminal showing the new operator pane in `_rk-operator` sitting on Claude Code's "Quick safety check: Is this a project you created or one you trust?" dialog with cwd `/home/sahil`; (2) Claude Code booted in `/home/sahil` answering the typed kickoff with `Unknown command: /fab-operator`; (3) the drawer's operator-less body stuck on a disabled `starting…` button (that third symptom is the sibling change `260913-e20j-quake-start-operator-pending-reset`, not this one).

**Diagnosis established in the discussion** (all verified against code, the daemon log, and live tmux state):

- `rk operator -L <server>` — the daemon-invocable form both the Start operator button (`POST /api/operator/start`) and the cron entry's `if_absent: respawn` argv use — opens the operator window in `os.UserHomeDir()` (`app/backend/cmd/rk/operator.go`, the `serverMode` branch of `runOperator`). The interactive `rk operator` uses the git root of the caller's cwd instead. The home-dir rule was a recorded decision ("the daemon has no project cwd", `docs/memory/run-kit/cron.md` § Caller-Supplied Respawn, upt2).
- `$HOME` fails on two independent counts. (a) Claude has never trusted `/home/sahil` (`~/.claude.json` shows `hasTrustDialogAccepted: false` for it), so every daemon-started operator parks on the trust dialog. (b) `/fab-operator` is a **project-scoped** skill: `fab sync` deploys it into each project's `.agents/skills/` and `.claude/skills/`; nothing is installed at user level (`~/.claude/skills` holds only `shll-toolkit`). A Claude started in `$HOME` cannot see the skill even after the wall is cleared.
- Agent resolution also runs project-less in server mode: `operatorResolveAgentFn(ctx, root, operatorTier)` is called with `root == ""`, so `fab agent operator -o yaml` runs in the daemon's cwd and resolves fab-kit's built-in operator profile (the boot banner read "Sonnet 5 with medium effort", `--permission-mode bypassPermissions`) instead of the project's `providers:` table (which renders `--dangerously-skip-permissions`).
- The kickoff miss is **silent**. `inject.DeliverWhenReady` correctly fails closed on the parked classification (`inject.ErrParked`); `runOperator` prints its degrade note ("could not deliver the kickoff prompt (…) — paste this into the operator agent yourself: /fab-operator") to stderr and exits 0. `runOperatorStartExec` (`app/backend/api/operator_start.go`) reads stderr only on a non-zero exit or a missing receipt; after the receipt the post-receipt `cmd.Wait()` goroutine logs only a non-zero exit, so the note is discarded. The daemon log for the incident (13:03:59 and 17:39:41, `POST /api/operator/start?server=runKit` → 202) carries no delivery line at all. No signal reached the UI.
- Once the user cleared the wall by hand, nobody re-delivered: `AwaitReady` returns `ParkedError` the first time a settled screen fails the sentinel echo probe, so the 25 s `operatorDeliverDeadline` was never even consumed.
- fab-kit's own reference (`_cli-fab-operator.md` § fab operator, "Launch cwd") says the operator's "natural launch point is a neutral dir with no `fab/` project". That claim is unrealized: the skill the operator needs is never installed anywhere a neutral dir can see. The interactive path has masked this because a project git root carries the skill and is already trusted.

**Decisions made in the discussion**:

- Fix it in `rk operator -L` (the launcher), not in the HTTP handler or the cron tick, so the Start button and the cron respawn are fixed by one change and stay byte-identical launches.
- Derive the launch directory from the server's live sessions (rk owns those facts; Constitution II and VII), reusing the user-role session facts and the main-worktree-root resolver that `rk tab new`'s role-aware landing rule (`260913-xga4`, PR #966) just introduced — no new state, no new setting.
- `$HOME` stays only as the last-resort fallback when no session qualifies, and the miss is then **visible** instead of silent.
- Keep the wall wait bounded so the cron tick's synchronous 90 s respawn bound and the daemon's 90 s detached process bound both still hold.
- A fab-kit follow-up (install the operator skill bundle at user level so a neutral dir works) is noted for fab-kit, not done here. Rejected as the fix for this repo: it does not help today, still leaves the first-visit trust wall, and is another repo's change.

## Why

**The pain.** The two ways an operator gets started without a human typing `rk operator` inside a project window — the quake terminal's Start operator button and the operator-tick cron entry's `if_absent: respawn` — both produce a Claude session that cannot do the operator's job: it boots in `/home/sahil`, stops on a trust dialog nobody sees unless the drawer happens to be open, and even once the dialog is cleared it has no `/fab-operator` skill to run. The kickoff is typed into a wall, the launcher shrugs ("paste it yourself") into a stderr buffer that nothing reads, and the daemon returns 202 as if everything worked. The user sees a live operator terminal doing nothing, or an `Unknown command` line, and has no idea the kickoff was dropped.

**The consequence of not fixing it.** The Start operator button (shipped in `260912-7usy`) and the cron respawn (the whole point of `if_absent: respawn`, `260906-kbbh` / `260912-pfo3`) are both non-functional on every server: an operator that boots without its skill never runs a tick, so the watched-row overlay, the operator-tick heartbeat, and every `rk operator request` lane go dark, while the cron log keeps recording `respawned` as a success. Each failed attempt also leaves a dead `_rk-operator` session behind that the SSE reaper has to notice ("real session disappeared between SSE polls" — five such lines in today's log).

**Why this approach.** The daemon does have a project cwd — several, in fact: every user-role session on the server was started in a project checkout (`runKit` → `/home/sahil/code/sahil87/run-kit`, `completed` → a run-kit worktree, `fab_kit` → `/home/sahil/code/sahil87/fab-kit`). Those directories are exactly the ones the user has already opened Claude in (so they are trusted) and that `fab sync` has deployed the skill into. `tmux.ListSessionFacts` already enumerates them with role, attached count, window count, and start path, and `gitinfo.MainWorktreeRoot` already collapses a linked worktree in the sibling `<repo>.worktrees/<name>` directory to its main checkout — both introduced for `rk tab new`'s landing rule and reusable in-process. Picking the operator's home from that set is the same convention-over-configuration move `rk tab new` made, and it produces a launch identical to what the interactive path has done all along. Making the kickoff miss visible and letting the readiness wait ride out a wall that the user is clearing are cheap defense in depth for the residual cases (a brand-new checkout, a provider that walls on every boot).

## What Changes

### 1. Server-mode launch directory: derive a fab project root from the server's user sessions (`app/backend/cmd/rk/operator.go`)

Replace the `serverMode` branch's `windowDir = home` with a derivation over the target server's sessions. Extract it as a pure picker plus a thin resolver, the `pickLandingSession` shape:

```go
// operatorLaunchRoot picks the operator window's working directory for the
// -L/--server path: the main-worktree root of a user-role session on the
// server that carries the fab-operator skill. Candidates are the server's
// user-role sessions in enumeration order (the `rk mux sessions` row order);
// each session's start path is collapsed to its main checkout by rootOf
// (gitinfo.MainWorktreeRoot — linked worktrees live in the sibling
// <repo>.worktrees/<name> directory, so only the common-dir resolution ties
// them to the checkout); a root qualifies when hasOperatorSkill(root) is true.
// Among qualifying roots: the sole one wins; else the most attached session's
// root; ties → the session with the most windows; ties → the earliest row.
// Returns ("", rungNone) when nothing qualifies — the caller falls back to
// the home directory.
func operatorLaunchRoot(candidates []tmux.SessionFacts, rootOf func(path string) string, hasOperatorSkill func(root string) bool) (root, rung string)
```

- **Candidates**: `tmux.ListSessionFacts(ctx, server)` filtered to `Role == tmux.SessionRoleUser` (the `_rk-ctl`, `_rk-operator`, `_rk-pin-*` and reserved sessions are never candidates — their paths are `$HOME` by construction).
- **Root of a candidate**: `gitinfo.MainWorktreeRoot(ctx, facts.Path)` through the existing `tabNewMainRootFn`-style seam (name it `operatorMainRootFn`; tests stub it). A session whose path is not inside a git repository yields `""` and is dropped.
- **Qualifies**: the root contains the deployed operator skill — `.agents/skills/fab-operator/SKILL.md` **or** `.claude/skills/fab-operator/SKILL.md` exists (`fab sync` writes both; either is sufficient because different providers read different trees). Checked with `os.Stat` on the two paths, no subprocess. <!-- assumed: skill-file presence is the qualification test rather than fab/project/config.yaml — the skill is what the booted agent needs; a fab project without a synced skill tree would fail the same way $HOME does -->
- **Ranking**, in order: exactly one qualifying root → it (rung `sole`); else the root of the qualifying session with the highest `Attached` (rung `most-attached`); ties → highest `Windows` (rung `most-windows`); ties → earliest enumeration row (rung `first`). Two sessions collapsing to the same root are one root — count is per distinct root, using the max `Attached`/`Windows` across its sessions.
- **Fallback**: no candidate qualifies → `os.UserHomeDir()` exactly as today (rung `home`), so an operator window still appears for the user to act on, and the kickoff miss that follows is now surfaced (§3).
- **Agent resolution follows the root**: call `operatorResolveAgentFn(ctx, root, operatorTier)` with the derived root (today's `root` variable, which is `""` in server mode) so `fab agent operator -o yaml` resolves the project's `providers:` table and role profile — the same command the interactive path produces from the same checkout. On the `home` fallback the root stays `""` (today's behavior).
- **Explicit override**: add `--dir <path>` to `rk operator` (server mode and interactive mode alike). When given, it is validated (absolute path, exists, is a directory — a usage error otherwise, exit 2, before any subprocess), used verbatim as the window directory, and its git root (via `config.FindGitRoot`, falling back to the path itself) becomes the agent-resolution root. This is the escape hatch for a server whose sessions do not identify the right project, and it lets fab's operator-tick seed carry a pinned directory later if it ever wants to (`--respawn --dir --respawn <path>`). <!-- assumed: the flag is named --dir, not --cwd — rk tab new uses --cwd for "the new window's start directory", but here the value also drives agent resolution and is the operator's project home; if the plan prefers symmetry with tab new, --cwd is acceptable -->
- The derivation runs **only** in server mode. The interactive path keeps its git-root-of-cwd rule unchanged.

The `--json` receipt gains two fields so the daemon and the cron log can see what was chosen (additive; existing readers ignore unknown keys):

```json
{ "window": "@68", "server": "runKit", "created": true, "dir": "/home/sahil/code/sahil87/run-kit", "dir_rung": "most-attached" }
```

`dir_rung` is one of `sole | most-attached | most-windows | first | home | explicit` (a closed token set, the `session_rung` precedent). On a singleton hit (`created: false`) both fields are omitted — no directory was chosen.

`rk operator --help` documents the rule in one paragraph under the existing `-L/--server` text (replacing "the window opens in your home directory") and lists `--dir`. The toolkit help-dump standard applies (`shll standards help-dump`): re-run the help-dump check for the `operator` surface.

### 2. Readiness wait rides out a wall in server mode (`app/backend/internal/inject/ready.go`, `app/backend/cmd/rk/operator.go`)

Today `AwaitReady` returns `ParkedError` the first time a settled screen fails the sentinel echo probe. That is right for `rk mux await --ready` (a classifier) and for the cron session respawn (fail-silent, escalate). It is wrong for the operator launch when nobody is watching: the pane is parked on a dialog the user will clear in a moment, and the deadline has barely started.

Add one opt-in to `inject.ReadyOpts`:

```go
// WaitThroughWalls keeps polling after a parked classification instead of
// returning ParkedError: the settle → probe cycle repeats until the pane
// echoes (ready), goes away (ErrGone), or the Deadline expires. At expiry
// the error is the LAST classification — ParkedError (with the final
// screen's snippet) when the pane is still walled, ErrNotReady otherwise —
// so a caller still learns why delivery never happened. Default false:
// every existing consumer keeps the fail-fast classification.
WaitThroughWalls bool
```

- Each repeated probe still cleans up after itself (the C-u clear and the polluted-composer fail-closed rule are unchanged); a wall that eats the paste sees nothing.
- `rk operator` sets `WaitThroughWalls: true` **only in server mode**, with a server-mode delivery deadline `operatorServerDeliverDeadline = 60 * time.Second` (a var, the `operatorDeliverDeadline` precedent). 60 s + `operatorCmdTimeout` 10 s stays under both callers' bounds: `operatorStartProcessTimeout` (90 s, detached from the HTTP response) and cron's `DefaultRespawnTimeout` (90 s, synchronous inside the tick). The interactive path keeps 25 s and fail-fast: the human is looking at the pane.
- `NarrowError` is unaffected (a too-small pane is not a wall the user clears from the dialog).

### 3. The kickoff miss is visible (`app/backend/cmd/rk/operator.go`, `app/backend/api/operator_start.go`)

Three sinks, all additive:

1. **Structured note on stderr**: the existing degrade line stays (it is the interactive user's instruction), and in `--json` mode the same information is ALSO emitted as one stderr line prefixed `kickoff:` so a machine reader does not have to parse prose: `kickoff: undelivered reason=parked prompt=/fab-operator dir=/home/sahil` (reason ∈ `parked | narrow | gone | timeout | send-error`). stdout keeps its exactly-one-JSON-document contract — the receipt precedes delivery and must not be followed by a second document.
2. **Daemon log**: `runOperatorStartExec`'s post-receipt `cmd.Wait()` goroutine reads the captured stderr after exit and logs `slog.Warn("operator kickoff undelivered", "server", …, "window", …, "reason", …, "dir", …)` when a `kickoff:` line is present (today it logs only a non-zero exit). Exit 0 with no `kickoff:` line logs nothing (delivered).
3. **User-facing toast**: on an undelivered kickoff the same goroutine broadcasts a shell notification on the state socket (the broadcast-only shell-notification event the `/ws/state` hub already carries, `docs/memory/run-kit/api-and-sockets.md` § state socket) with the message `Operator started in <dir> but /fab-operator was not delivered (<reason>) — paste it into the operator terminal` targeted at the server; the quake terminal surfaces it through its existing toast seam (`useOptionalToast`). No new socket event kind: reuse the shell-notification shape. <!-- assumed: the state-socket broadcast notification is the right channel over push.Notify (OS push) — the user who clicked Start is looking at the drawer; if the hub's notification shape turns out to be host-global rather than server-addressable, fall back to logging + the stderr line and record it as a limitation -->

The cron tick's respawn path (`internal/cron` `RunRespawn`, which captures combined output) gets the `kickoff:` line for free in its `≤200-byte output tail`; no cron code changes. Its log line for a respawn whose kickoff was undelivered should read `respawned (kickoff undelivered: parked)` rather than bare `respawned` — a small string tweak in `respawnDetail`'s success branch when the tail contains a `kickoff:` line. <!-- assumed: the cron log-line tweak is in scope because the same `rk operator -L` launch is the respawn — drop it if the plan judges the cron package untouchable for this change -->

### 4. Tests

- `app/backend/cmd/rk/operator_test.go`: `TestOperatorServerFlagCreatesWithoutTMUX` today pins `-c <home>` in the `new-window` argv — it becomes the **fallback** case (no qualifying session). New cases: sole qualifying session → its main root and `dir_rung: sole`; two qualifying roots ranked by attached, then windows, then row order; a worktree session collapsing to the main checkout (stubbed `operatorMainRootFn`); a non-repo session dropped; `--dir` explicit (valid, and the three usage-error shapes); agent resolution receives the derived root; the JSON receipt carries `dir`/`dir_rung` on create and omits them on a singleton hit; the `kickoff:` stderr line for each reason; server mode passes `WaitThroughWalls: true` and the 60 s deadline while interactive mode passes false and 25 s (assert through the `operatorDeliverFn` seam's opts).
- `app/backend/internal/inject/ready_test.go`: `WaitThroughWalls` — parked once then echo → `ReadyByEcho`; parked through the deadline → `ParkedError` at expiry with the last snippet; default false keeps today's first-parked return; `IsGone` still ends the wait promptly mid-wall.
- `app/backend/api/operator_start_test.go`: post-receipt stderr with a `kickoff:` line → one WARN log entry and one shell-notification broadcast; without it → neither; the receipt parse tolerates the two new fields.
- Help-dump: `rk operator --help` snapshot/golden updated for `--dir` and the new cwd paragraph (whatever the toolkit-standards check in `scripts/` asserts today).

### Non-goals

- No change to the interactive `rk operator` cwd rule, singleton probe, role stamp, or promote flow.
- No new setting in the `internal/settings` registry (the 16-key inventory is unchanged); `--dir` is the only override.
- No auto-answering of the trust dialog or any other wall — walls are never answered (the cron memory's standing rule).
- No change to the operator-tick entry, its respawn argv, or fab-kit's seed. `rk operator -L {server}` stays the seed value; `--dir` is available to it but not adopted here.
- No user-level skill install — a fab-kit follow-up, noted in the archive note.
- The drawer's stuck `starting…` state is `260913-e20j`, not this change.

## Affected Memory

- `run-kit/cron`: (modify) § Caller-Supplied Respawn and § Tick Orchestration's role/session row — replace "the window opened in the home directory" / "`os.UserHomeDir()` as cwd (the daemon has no project cwd)" with the derived-root rule and its `home` fallback; the respawn log-line tweak; the `kickoff:` tail line. § Requirement: Caller-supplied respawn argv — the cwd clause.
- `run-kit/rk-riff`: (modify) the `operator.go` consumer row — server mode's derived launch root, `--dir`, `WaitThroughWalls`, the `dir`/`dir_rung` receipt fields.
- `run-kit/architecture/cli`: (modify) the `operator` subcommand row — `--dir` flag, server-mode cwd rule.
- `run-kit/api-and-sockets`: (modify) the `/api/operator/start` row — post-receipt kickoff WARN + shell notification; the receipt's new fields.
- `run-kit/agent-send`: (modify) the injection-engine/readiness section — the `WaitThroughWalls` opt and which consumer sets it.
- `run-kit/ui/quake-terminal`: (modify) § Start operator design decision — the launch now lands in a project root; the kickoff-undelivered toast.
- `run-kit/tmux-sessions`: (modify) § Operator Session — the operator window's cwd is a project main root in both launch modes (the `_rk-operator` session path itself stays `ServerBirthDir()`).

Spec touch (human-curated, small): `docs/specs/cron.md` § Targets & Fire-Time Resolution, the two sentences describing `rk operator -L {server}` opening the window in the home directory.

## Impact

- **Backend CLI**: `app/backend/cmd/rk/operator.go` (server-mode branch, new picker + resolver + `--dir` flag + receipt fields + `kickoff:` stderr line), `operator_test.go`.
- **Inject engine**: `app/backend/internal/inject/ready.go` (`ReadyOpts.WaitThroughWalls`), `ready_test.go`.
- **API**: `app/backend/api/operator_start.go` (post-receipt stderr read → WARN + broadcast), `operator_start_test.go`; the state-socket broadcast helper it calls (existing).
- **Cron**: `app/backend/internal/cron` — one string tweak in the respawn success detail (optional per Assumptions).
- **Reused, unchanged**: `tmux.ListSessionFacts`, `tmux.SessionRole`, `gitinfo.MainWorktreeRoot`, `config.FindGitRoot`, `inject.DeliverWhenReady`.
- **Frontend**: none required — the toast rides the existing shell-notification path. If the quake terminal needs a one-line handler to render a server-scoped notification, it is a handful of lines in `quake-terminal.tsx`.
- **Docs**: the seven memory files above, `docs/specs/cron.md`, `rk operator --help` text, the rk skill's operator section if it quotes the cwd rule (`docs/site/skill/`).
- **Live verification**: after merge and `rk update`, click Start operator on `runKit` → the window opens in `/home/sahil/code/sahil87/run-kit`, no trust dialog, `/fab-operator` runs; `fabKit` → `/home/sahil/code/sahil87/fab-kit`.

## Open Questions

- Should the `home` fallback instead refuse to create the window (exit 3 with a clear message) now that we know a `$HOME` operator can never work? Creating it keeps today's contract and gives the user something to act on; refusing avoids a dead `_rk-operator` session. Intake keeps "create + surface" (Assumptions row 7); `/fab-clarify` if you prefer refusal.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix lives in `rk operator -L` (the launcher), not the HTTP handler or the cron tick | Discussed — user chose it; both callers share the argv, one fix covers both | S:90 R:85 A:95 D:95 |
| 2 | Certain | Launch root derives from the server's user-role sessions via `tmux.ListSessionFacts` + `gitinfo.MainWorktreeRoot`, no new setting | Discussed — Constitution II/VII; reuses the `rk tab new` (#966) helpers verbatim | S:85 R:80 A:90 D:85 |
| 3 | Confident | Ranking: sole → most attached → most windows → earliest row, per distinct root | `pickLandingSession` precedent; deterministic; any order is easily changed later | S:70 R:90 A:80 D:65 |
| 4 | Confident | Qualification test is presence of `.agents/skills/fab-operator/SKILL.md` or `.claude/skills/fab-operator/SKILL.md` | The skill is what the agent needs; `fab/project/config.yaml` alone does not guarantee a synced skill tree; provider trees differ | S:60 R:90 A:60 D:55 |
| 5 | Confident | Override flag named `--dir` (validated absolute existing directory), also driving agent-resolution root | `rk tab new` uses `--cwd`; here the value is the operator's project home, so `--dir` reads better; trivially renamed | S:55 R:95 A:65 D:50 |
| 6 | Certain | `ReadyOpts.WaitThroughWalls` opt-in; server mode only; 60 s server-mode deadline under the 90 s bounds | Both caller bounds verified in code; fail-fast stays default for every existing consumer | S:75 R:85 A:85 D:75 |
| 7 | Confident | `home` fallback still creates the window; the miss is surfaced rather than refused | Keeps today's contract and the singleton/receipt shape; refusal is a one-line change if chosen (Open Question) | S:65 R:90 A:75 D:60 |
| 8 | Confident | Undelivered-kickoff toast rides the state socket's broadcast shell notification; fall back to log + stderr if the shape is host-global only | Channel exists per api-and-sockets memory; its addressability per server not verified at intake | S:55 R:85 A:50 D:55 |
| 9 | Confident | Cron respawn success detail reads `respawned (kickoff undelivered: <reason>)` when the tail carries a `kickoff:` line | Same launch, same miss; a string tweak — drop if cron is judged out of scope | S:50 R:95 A:70 D:60 |
| 10 | Certain | Walls are never auto-answered; the interactive cwd rule, singleton, stamp, promote are untouched; fab-kit user-level install is a follow-up | Discussed — standing cron rule; user rejected the fab-kit path as this repo's fix | S:90 R:90 A:95 D:95 |

10 assumptions (4 certain, 6 confident, 0 tentative, 0 unresolved).

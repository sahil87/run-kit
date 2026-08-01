# Plan: SSH-Only Remote Hosts — `rk remote`

**Change**: 260801-35gv-ssh-remote-hosts
**Intake**: `intake.md`

## Requirements

### CLI: `rk remote` command family

#### R1: Six-verb command family owned by the Go CLI
`rk remote` MUST be a new top-level cobra command group in `app/backend/cmd/rk/remote.go` with exactly six subcommands — `add <target>` (flags `--name`, `--local-port`), `connect <name|target>`, `list`, `status <name>`, `disconnect <name>`, `remove <name>` — and NO `update` verb (update is folded into `connect`). The group MUST be registered on `rootCmd`, wrap nested arg validators with `usageArgs` (the `desktop.go` idiom), and route output through the `outputSink` (stdout = data, stderr = chatter, `--quiet` drops chatter — Toolkit Principle 9). No new HTTP endpoints.

- **GIVEN** a built `rk` binary
- **WHEN** `rk remote --help` runs
- **THEN** the six subcommands are listed and `rk remote update` is an unknown command
- **AND** `rk help-dump` includes the `remote` subtree (non-hidden commands are captured automatically)

#### R2: `add` registers a remote with a stable port, no ssh roundtrip
`rk remote add <target>` SHALL store the target **verbatim** (ssh alias or `user@host`, never parsed for connection purposes), derive the default name from the target's host token (text after the last `@`, dots mapped to hyphens), assign a local port (R4), persist to `remotes.yaml` (R3), and print stable labeled data lines on stdout:

```
Name:   buildbox
Target: sahil@buildbox
Local:  http://127.0.0.1:3100
```

Re-adding an already-registered target SHALL be idempotent — print the existing entry's lines and exit 0 — unless `--name`/`--local-port` conflict with the stored entry (error). A name collision with a different target SHALL error.

- **GIVEN** an empty `remotes.yaml`
- **WHEN** `rk remote add sahil@buildbox` runs
- **THEN** the entry `{name: buildbox, target: sahil@buildbox, local_port: 3100}` is persisted and the three labeled lines print to stdout
- **GIVEN** the same registered target
- **WHEN** `rk remote add sahil@buildbox` runs again
- **THEN** exit 0 with the same lines, and the file is unchanged

### State: `~/.config/rk/remotes.yaml`

#### R3: Version-1 state file with only underivable state
The state file MUST live at `~/.config/rk/remotes.yaml`, schema `version: 1`, entries carrying exactly `{name, target, local_port}`. Load MUST treat a missing file as an empty v1 list; a wrong version or malformed YAML is an error (never silently rewritten). Save MUST be atomic (tmp-file-then-rename) with `0o755` dir / `0o644` file modes. Everything else (tunnel up/down, remote daemon state, remote port, version skew) is derived at request time — no pid files, no supervisor (Constitution II).

- **GIVEN** no `~/.config/rk/` directory
- **WHEN** `rk remote add` persists the first entry
- **THEN** the directory and file are created and a round-trip load returns the entry

#### R4: Port assignment — 3100–3199, collision-checked, immutable
Local ports MUST be assigned at add-time from the reserved range **3100–3199**: the lowest port not taken by another `remotes.yaml` entry and not currently listening on the host (live listeners via the `internal/ports` platform enumeration). An explicit `--local-port` MUST fall inside the range and pass the same collision checks. Once assigned the port is immutable — no code path reassigns it.

- **GIVEN** entries on 3100 and 3101 and a live listener on 3102
- **WHEN** a new remote is added
- **THEN** it is assigned 3103
- **GIVEN** `--local-port 3050`
- **WHEN** add runs
- **THEN** it errors naming the valid range

### Tunnels: tmux windows on the `rk-daemon` socket

#### R5: Tunnel lifecycle in a sibling `rk-remotes` session
Tunnel processes MUST live in tmux on socket `rk-daemon` (`daemon.ServerSocket`), session `rk-remotes`, one window per remote (window name = remote name), running exactly:

```
ssh -N -o BatchMode=yes -o ServerAliveInterval=15 -L 127.0.0.1:<lp>:127.0.0.1:<rp> <target>
```

The command MUST be passed as argv elements (tmux ≥3.4 direct exec — no shell string). Session creation MUST use exact-match targets (`=rk-remotes`) and, when it births the tmux server, pin the CWD via `tmux.ServerBirthDir()` (the server-birth seam rule). Tunnel state MUST be derived at request time from `list-windows` + pane command; no supervisor, no auto-reconnect. `disconnect` kills only that remote's window; `rk daemon stop` (which kills only `=rk-daemon`) never touches tunnels.

- **GIVEN** a connected remote `buildbox`
- **WHEN** `tmux -L rk-daemon list-windows -t =rk-remotes` is inspected
- **THEN** a window named `buildbox` runs the ssh tunnel command
- **GIVEN** that window is killed externally
- **WHEN** `rk remote list` runs
- **THEN** the tunnel column reads down (state derived, nothing stored)

### Connect: idempotent bootstrap + tunnel

#### R6: `connect` is the one idempotent get-in flow
`rk remote connect <name|target>` MUST: (1) ssh-probe `rk --version` on the remote; (2) if rk is missing, bootstrap via the standard public installer over ssh exec — `curl -fsSL https://shll.ai/install | sh -s -- run-kit` (a fixed literal command, verified against `docs/site/install.md`); (3) if the remote rk is **older** than the local rk, re-run the same installer (never downgrade — a newer remote is left untouched and noted); (4) run `rk daemon start` on the remote ("daemon already running" and "already serving on" both count as success); (5) derive the remote origin via `ssh <target> rk url` — **never stored** — and use its port in the `-L` forward spec; (6) ensure the tunnel window is up; (7) wait for the local port to accept TCP; (8) print the local origin `http://127.0.0.1:<lp>` as the final stdout data line. Progress lines go to the chatter channel. All remote exec commands are fixed literals prefixed with a PATH augmentation (`PATH="$PATH:/opt/homebrew/bin:/usr/local/bin:/home/linuxbrew/.linuxbrew/bin"`) so non-login ssh shells find `rk`/`tmux`.

- **GIVEN** a registered remote with rk absent on the box
- **WHEN** `connect` runs
- **THEN** the installer runs over ssh, the daemon starts, the tunnel opens, and stdout ends with the local origin
- **GIVEN** the same remote already connected
- **WHEN** `connect` runs again
- **THEN** it verifies and reprints the origin without side effects (idempotent)

#### R7: BatchMode-only auth with actionable failure
Every ssh invocation (probes, bootstrap, tunnel) MUST carry `-o BatchMode=yes`; probes additionally carry `-o ConnectTimeout=5` (the tunnel command stays exactly as R5 specifies). On an ssh-level failure (exit 255) connect MUST surface the stderr tail plus the hint to run `ssh <target>` once from a terminal. `StrictHostKeyChecking` is untouched — no `accept-new`, no weakening.

- **GIVEN** a target with no non-interactive auth set up
- **WHEN** `connect` runs
- **THEN** it fails with ssh's stderr tail and the `ssh <target>` hint, and never prompts

#### R8: Foreign port squatter → error, never reassign
At connect time, if the assigned local port is accepting connections but the remote's tunnel window is NOT up, connect MUST fail with an actionable error naming the port — it never reassigns the port (immutability, stable-origin rationale).

- **GIVEN** an unrelated process listening on the remote's assigned port
- **WHEN** `connect` runs
- **THEN** it errors naming the port and the squatter situation; `remotes.yaml` is unchanged

### Read verbs

#### R9: `list`, `status`, `disconnect`, `remove`
`rk remote list` MUST print columns NAME / TARGET / LOCAL / TUNNEL / REMOTE DAEMON — tunnel state from tmux at request time, remote daemon state via ssh probe (`rk daemon status --json`, classified running / stopped / no rk / unreachable). `rk remote status <name>` MUST print single-remote detail including remote version and version skew (a newer remote is noted, never downgraded). `disconnect <name>` MUST kill only the tunnel window (absent window = success). `remove <name>` MUST disconnect and drop the entry; the remote installation is untouched.

- **GIVEN** two remotes, one connected
- **WHEN** `rk remote list` runs
- **THEN** each row shows derived tunnel + daemon state
- **GIVEN** a connected remote
- **WHEN** `disconnect` then `remove` run
- **THEN** the window is gone, the entry is gone, and nothing ran on the remote

### Security & validation

#### R10: Validation before subprocess use
Remote names MUST be validated via `internal/validate` before use as tmux window names / config keys (tmux-safe charset, no spaces, no leading `-`, no slash). Targets MUST be validated before use as ssh argv (non-empty, no whitespace/control characters, no double quotes, no leading `-` — flag-injection defense). All Go subprocess calls MUST use `exec.CommandContext` with argument slices and timeouts; remote command strings are fixed literals (no interpolation). Electron-side rk invocations MUST use `execFile` with argument slices and timeouts.

- **GIVEN** `rk remote add -- "-oProxyCommand=evil"`
- **WHEN** validation runs
- **THEN** the target is rejected before any subprocess sees it

### Desktop shell

#### R11: `hosts.json` stays schema v1 with an additive `remote` field
`app/desktop/src/hosts.ts` MUST gain an optional `remote?: string` field on `HostEntry` — parsed tolerantly like `lastPath` (absent → fine, string → kept, other type → dropped, entry still loads) — with NO version bump. `addHost` MUST accept an optional remote name and persist it when non-empty. `url` stays required and real (the stable local origin).

- **GIVEN** a hosts.json entry carrying `"remote": "buildbox"`
- **WHEN** an older shell loads it
- **THEN** the entry loads as a plain URL host (dead-host degradation, never an emptied list)
- **AND** the new shell round-trips the field

#### R12: Activation of a remote-carrying host re-runs connect
When the shell activates a host carrying `remote`, it MUST run `rk remote connect <name>` via `execFile` (the `runRk` wrapper with `augmentPath`, argument slices + timeout) — non-blocking: the view attaches immediately, the connect heals the tunnel in the background, and the view is reloaded only when its last main-frame load failed. A background connect failure surfaces via the native error dialog. Duplicate connects are guarded (in-flight + recent-success suppression).

- **GIVEN** a remote host whose tunnel is down
- **WHEN** the user switches to it
- **THEN** the shell kicks off `rk remote connect buildbox`, and once it succeeds the failed view reloads to the live origin

#### R13: Welcome page gains the "or over SSH" middle rung
`app/desktop/src/welcome/` MUST become three rungs: **This Mac** (unchanged), divider **"or over SSH"** with one input (`user@host` or ssh alias) + one **Connect via SSH** button + a live amber progress line, then divider **"or a URL"** with the existing remote-URL form unchanged. The renderer only renders; **main** runs `rk remote add` then `rk remote connect` via execFile, streams connect's chatter lines to the renderer over a `remote:progress` channel, pings the resulting origin, persists the host (with `remote`), and ends at the existing `switchToHost` seam. The SSH rung shares the darwin/linux platform gate with This Mac (suppressed on win32). The `remote:*` IPC handlers are welcome-sender-gated like `welcome:*`/`daemon:*`. No ssh-config datalist in v1.

- **GIVEN** the welcome page on macOS
- **WHEN** the user enters `sahil@buildbox` and clicks Connect via SSH
- **THEN** the amber line streams `connecting… → installing… → starting daemon… → opening tunnel…` style progress and success lands in the host view via `switchToHost`
- **GIVEN** a connect failure
- **WHEN** the flow errors
- **THEN** the error renders inline and the form re-enables

### Non-Goals

- No Tailscale replacement / mobile access — the tunnel exists only where the ssh client runs.
- No interactive SSH auth (BatchMode only), no bundled SSH library, no scp/bespoke installer.
- No `rk remote update` verb; no tunnel supervisor or auto-reconnect loop.
- No new HTTP endpoints; no SPA (`app/frontend`) changes.
- No ssh-config Host-alias datalist (nice-to-have follow-up).
- No docs/site command docs in apply (ship/hydrate-time work per intake).

### Design Decisions

#### Pure-core / impure-shell split in `internal/remote`
**Decision**: `internal/remote` keeps decision logic pure (port assignment, name derivation, output parsing, skew decision take explicit inputs) and isolates subprocess work behind package-level seam vars (`runCmdFn` for ssh, `tmuxRunFn`/`tmuxOutputFn` for tmux); live-listener enumeration is a small exported one-shot in `internal/ports` wired at the cmd boundary through a seam var.
**Why**: matches the repo's established test idiom (`findPortOwner`/`innerServePIDFn`, `readListeningPortsFn`) and makes the orchestration testable without ssh or tmux.
**Rejected**: spinning up the `ports.Collector` (goroutine + poll machinery for a one-shot read) and interface-based injection (heavier than the codebase's seam-var convention).
*Introduced by*: 260801-35gv-ssh-remote-hosts

#### Labeled data lines as the shell↔CLI contract
**Decision**: `rk remote add` emits `Name:`/`Target:`/`Local:` labeled stdout lines; `connect` emits the origin as its final stdout line; the shell parses these in an electron-free pure module.
**Why**: the `rk desktop status` → `update-check.ts` precedent — stable labeled data lines, Principle 9 stdout discipline, no JSON flag surface added for one consumer.
**Rejected**: `--json` flags (new surface, help-dump churn for a single internal consumer) and name re-derivation in TypeScript (duplicated logic across languages).
*Introduced by*: 260801-35gv-ssh-remote-hosts

## Tasks

### Phase 1: Setup

- [x] T001 Add `ValidateRemoteName` (tmux-safe + no leading `-`/slash/space) and `ValidateRemoteTarget` (ValidateSSHHost rules + no leading `-`) to `app/backend/internal/validate/validate.go` with cases in `validate_test.go` <!-- R10 -->
- [x] T002 [P] Export one-shot `ports.ListeningNow(ctx)` in `app/backend/internal/ports/collector.go` (delegates to `readListeningPortsFn`) with a stubbed-seam test in `collector_test.go` <!-- R4 -->

### Phase 2: Core Implementation (`app/backend/internal/remote/`)

- [x] T003 <!-- rework: must-fix: re-validate Name/Target on the read path (Load or Connect/Inspect/Disconnect/Remove entry) via validate.ValidateRemoteName/ValidateRemoteTarget — remotes.yaml is an input boundary, hostile target reaches ssh argv (Constitution I, A-016) — FIXED: Load re-validates every entry (validateEntries), the one seam all verbs read through --> Create `store.go` — `Remote`/`File` types (yaml.v3 tags), `DefaultPath()` (`~/.config/rk/remotes.yaml`), tolerant `Load` (missing → empty v1), atomic `Save`, name/target lookup helpers — plus `store_test.go` round-trip/missing/bad-version cases <!-- R3 -->
- [x] T004 Create `name.go` (`DefaultName(target)` host-token derivation, dots→hyphens, validate) and `ports.go` (`AssignPort(file, taken, explicit)` — range 3100–3199, store + live collision, explicit in-range rule) with `name_test.go`/`ports_test.go` <!-- R2, R4 -->
- [x] T005 <!-- rework: nice-to-have folded in: drop VersionOlder/VersionNewer pass-through wrappers (export originals); tighten rkMissing — remove bare "not found" substring fallback, keep exit-127 + "command not found" — FIXED: originals exported directly, wrappers gone; rkMissing matches only exit-127 or "command not found" --> Create `ssh.go` — `runCmdFn` seam, BatchMode+ConnectTimeout probe args, fixed-literal remote commands with the PATH prefix, exit-255/`command not found` classification, `parseRemoteVersion`, skew decision via `updatecheck.AnyIncrease` (local "dev" skips), remote `rk url` port parse — plus `ssh_test.go` <!-- R6, R7 -->
- [x] T006 Create `tunnel.go` — exact tunnel argv builder, `tmuxRunFn`/`tmuxOutputFn` seams over `tmux.Run`/`RunOutput` with `-L rk-daemon`, session-birth via `tmux.ServerBirthDir()`, window up/list/open/close on `=rk-remotes` — plus `tunnel_test.go` (argv shape, state parse, open/close command sequences) <!-- R5 -->
- [x] T007 <!-- rework: must-fix companion: ensure Connect/Inspect/Disconnect paths reject invalid stored entries before any subprocess use; add regression test for hostile stored target (-oProxyCommand) rejected — FIXED: all verbs reject via Load; TestHostileStoredTargetRejectedBeforeAnySubprocess proves zero ssh/tmux seam calls on a -oProxyCommand target --> Create `connect.go` + `status.go` — `Connect(ctx, ...)` orchestration (probe → bootstrap → update-if-older → remote daemon start → derive origin → squatter check → tunnel up → local-port readiness wait → origin result, progress callback) and `Inspect` (tunnel + remote daemon classification for list/status) — plus `connect_test.go` driving the seams through bootstrap/update/squatter/auth-failure/idempotent paths <!-- R6, R7, R8, R9 -->

### Phase 3: CLI surface

- [x] T008 Create `app/backend/cmd/rk/remote.go` — `remoteCmd` group + six subcommands wired to `internal/remote` (sink output, labeled add lines, tabwriter list, usageArgs wrap, seam vars for store path + live listeners), register in `root.go` — plus `remote_test.go` (add flow shapes/idempotency/collisions/range errors, unknown-remote errors, no `update` verb) <!-- R1, R2, R9 -->

### Phase 4: Desktop shell

- [x] T009 Extend `app/desktop/src/hosts.ts` — optional `remote` on `HostEntry`, tolerant parse, `addHost` optional remote param — and cover in `hosts.test.ts` (round-trip, tolerance, old-shape files load) <!-- R11 -->
- [x] T010 <!-- rework: should-fix: connectProgressText has zero production call sites — either call it from welcome.ts or drop the export and its test — FIXED: export + test deleted (the smaller diff; welcome.ts is a separately-bundled renderer script that keeps its inline join) --> [P] Create `app/desktop/src/remote-host.ts` (electron-free) — `parseRemoteAddOutput` (Name:/Local: lines), `createLineSplitter` for streamed chatter, `connectProgressText` accumulator — plus `remote-host.test.ts` under node:test <!-- R12, R13 -->
- [x] T011 <!-- rework: should-fix cycle2: runRkStreaming uses raw-callback execFile so err.stderr is unset — a timeout leaks "Command failed: /abs/path/rk remote connect <name>" to the welcome page and error dialog; add an explicit SIGTERM+code===null timeout branch — FIXED: isExecTimeout (signal==="SIGTERM" && code===null) + rkTimeoutMessage in local-daemon.ts (pure, node:test covered incl. the verified timeout error shape), branched in runRkStreaming's callback before execErrorMessage; message names `rk <args>` + the timeout seconds, never the binary path --> Wire main-process SSH flow — `preload.ts` `__remote` bridge (connect + onProgress), `main.ts` welcome-gated `remote:connect` handler (validate → `rk remote add` → parse → streaming `rk remote connect` via execFile with stderr line relay → health ping → `addHost` with remote → `switchToHost`), streaming `runRk` variant with timeout <!-- R13 -->
- [x] T012 <!-- rework: must-fix cycle2: did-finish-load clobbers the failure flag (Chromium fires it for its own error page right after did-fail-load), so reload-on-heal never fires and a dead-tunnel view stays stuck on ERR_CONNECTION_REFUSED — ignore did-finish-load on a failed navigation (or key the flag off the navigation URL/did-navigate); do NOT remove the reload gate. Breaks R12/A-009 — FIXED: flag transitions extracted to pure `nextLoadFailed` in views.ts (did-fail-load sets, ONLY did-navigate clears, did-finish-load is a deliberate no-op); event order re-verified against a real WebContentsView (error page fires finish but NEVER did-navigate; a 200 commit fires did-navigate) and the full fail→finish→heal-reload→commit cycle re-run empirically: flag survives the error-page finish, gate fires, clears only on the live commit. Reload gate untouched. Regression tests in views.test.ts --> Activation heal in `main.ts` — per-view main-frame load-failure tracking, `ensureRemoteConnected` on the attach seam (in-flight + recent-success guards, background `rk remote connect`, reload-on-heal, error dialog) <!-- R12 -->
- [x] T013 Welcome third rung — `welcome/welcome.html` SSH section (divider "or over SSH", input, Connect via SSH button, amber progress line, inline error, divider "or a URL"; local section's old divider removed) + `welcome/welcome.ts` structural `__remote` narrowing and section wiring under the darwin/linux gate <!-- R13 -->

### Phase 5: Verification

- [x] T014 <!-- rework: rework cycle2: re-run scoped suites after fixes — DONE: `just test-backend` all packages ok; desktop `pnpm run compile && pnpm test` 125/125 pass (incl. 4 new nextLoadFailed + 3 new timeout-classification tests) --> Run the scoped suites — `just test-backend`, desktop `pnpm run compile && pnpm test` — and fix fallout until green <!-- R1–R13 -->

## Execution Order

- T001–T002 before Phase 2 (validation + listener seam are inputs).
- T003 blocks T004; T003–T006 block T007; T007 blocks T008.
- T009 and T010 are independent; both block T011; T011 blocks T012–T013 only at the main.ts merge level (small sequential edits).

## Acceptance

### Functional Completeness

- [x] A-001 R1: `rk remote` exposes exactly add/connect/list/status/disconnect/remove, registered on root, no `update` verb, present in `rk help-dump` — verified against a built binary (`help-dump` emits all six `run-kit remote <verb>` rows); `remote.go:163-168`, `root.go:65`, `remote_test.go:60`
- [x] A-002 R2: `add` persists `{name, target verbatim, local_port}`, derives the default name from the host token, and prints the `Name:`/`Target:`/`Local:` data lines; re-add of the same target is idempotent — `remote.go:188-247`, `name.go:20`, `remote_test.go:93-171`
- [x] A-003 R3: `remotes.yaml` is v1 at `~/.config/rk/remotes.yaml`, atomic save, missing-file → empty list, wrong version → error — `store.go:68-118`, `store_test.go`
- [x] A-004 R4: ports assigned lowest-free in 3100–3199 against store + live listeners; explicit `--local-port` range- and collision-checked; no reassignment path exists — `ports.go:23-52`; grepped: `LocalPort` is written only at `remote.go:239`
- [x] A-005 R5: tunnels run in tmux socket `rk-daemon` session `rk-remotes`, one window per remote, exact ssh argv, state derived from list-windows at request time — `tunnel.go:52-146`, byte-exact argv asserted in `tunnel_test.go:52`
- [x] A-006 R6: connect probes, bootstraps via the standard curl installer, updates only when the remote is older, starts the remote daemon, derives the origin via remote `rk url` (never stored), and prints the local origin — `connect.go:36-139`; installer string matches `docs/site/install.md:10` verbatim
- [x] A-007 R9: list shows NAME/TARGET/LOCAL/TUNNEL/REMOTE DAEMON with derived states; status shows skew; disconnect kills only the window; remove drops the entry and leaves the remote untouched — `remote.go:272-365`, `status.go:39`, `connect.go:155-190`
- [x] A-008 R11: hosts.json stays schema v1 with tolerant additive `remote`; old-shape files still load — `hosts.ts:22-31,92-94,144-158`, `hosts.test.ts:301-363`
- [x] A-009 R12: activating a remote-carrying host runs `rk remote connect <name>` via execFile with augmentPath + timeout, non-blocking with reload-on-heal — `main.ts:930-969` (`ensureRemoteConnected`), called from `attachHostView`. Re-verified in rework cycle 2: the reload gate now actually fires for a dead-tunnel view — flag transitions are the pure `nextLoadFailed` (`views.ts:174`; did-fail-load sets, ONLY did-navigate clears, did-finish-load never clears since Chromium fires it for its own error page), regression-covered in `views.test.ts` and re-proven empirically against a real WebContentsView on a dead port (fail→finish keeps flag=true → heal reloads → live commit clears)
- [x] A-010 R13: welcome renders three rungs; main streams add+connect progress to the renderer; success ends at `switchToHost`; the rung is welcome-sender-gated and suppressed on win32 — `welcome.html:221-240`, `welcome.ts:426-489,566-572`, `main.ts:1114-1125` (`isWelcomeSender` gate)

### Behavioral Correctness

- [x] A-011 R6: version skew never downgrades — a newer remote is left untouched and noted in status; local "dev" builds skip the auto-update — `ssh.go:155-189`, `connect.go:80`, `remote.go:330-335`; all three directions asserted in `connect_test.go:137-183`
- [x] A-012 R7: every ssh exec carries BatchMode=yes; auth failure surfaces the stderr tail + the `ssh <target>` hint; StrictHostKeyChecking untouched — `ssh.go:86-121` (probes), `tunnel.go:68-77` (tunnel); `connect_test.go:185-200`
- [x] A-013 R6: idempotent re-connect (all healthy) verifies and reprints the origin without re-installing or re-opening the tunnel — `connect_test.go` (`TestConnect_HappyPathIdempotent`) proves no installer and no new tunnel window. The remaining `rk daemon start` + `rk url` probes on a healthy re-connect ARE the verification R6 specifies: R6 steps 4–5 run on every connect ("daemon already running" = success is a classified no-op, `rk url` is a pure read), and Constitution II forbids storing the remote origin, so deriving it per-connect via the probe is mandatory — no state mutates, satisfying "without side effects"
- [x] A-014 R8: a foreign squatter on the assigned port at connect time yields an actionable error, never a port reassignment — `connect.go:119-127`, `connect_test.go:202-229` (asserts the store still holds 3100)
- [x] A-015 R9: a dead tunnel (window killed externally) shows as down in list and heals via connect; disconnect of a not-connected remote succeeds — `tunnel.go:96-166`, `tunnel_test.go:66-90,136-167`
- [x] A-016 R10: hostile names/targets (leading `-`, whitespace, quotes, metacharacter-bearing names) are rejected by internal/validate before any subprocess use — validated on the `add` WRITE path (`remote.go:191,227`) AND on the READ path: `Load` re-validates every stored entry (`store.go` `validateEntries`), so `connect`/`disconnect`/`remove`/`list`/`status` reject a hand-edited hostile entry before any ssh/tmux argv exists; regression-proven by `store_test.go` `TestLoad_RejectsHostileStoredEntries` and `connect_test.go` `TestHostileStoredTargetRejectedBeforeAnySubprocess` (a stored `-oProxyCommand=touch /tmp/pwned` target triggers zero subprocess/tmux seam calls)
- [x] A-017 Pattern consistency: seam-var test idiom, outputSink discipline, electron-free pure modules with node:test follow the surrounding code — matches `findPortOwner`/`innerServePIDFn`, `daemon.runTmuxInDir`, `local-daemon.ts`; `go vet` + `gofmt` clean
- [x] A-018 No unnecessary duplication: reuses `internal/tmux` runner core, `internal/ports` enumeration, `internal/validate`, `internal/updatecheck.AnyIncrease`, `daemon.ServerSocket`, and the shell's `runRk`/`augmentPath`/`pingServer` seams — all confirmed; `connectRemoteHost` now health-gates through the same `pingServer` the URL rung uses (rework cycle 1)
- [x] A-019 R10: all Go subprocess calls are `exec.CommandContext` with argument slices + timeouts; remote command strings are fixed literals; Electron calls are `execFile` with timeout; no shell strings anywhere — `ssh.go:65-93`, `tunnel.go:52-60`, `main.ts:803-830`; no `exec()`/`execSync`/template-string shell command in the diff

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- ~~`app/desktop/src/remote-host.ts:99` `connectProgressText`~~ — resolved in rework cycle 1: export and test deleted (welcome.ts keeps its inline join).
- ~~`app/backend/internal/remote/ssh.go:181-189` `VersionOlder` / `VersionNewer` pass-through wrappers~~ — resolved in rework cycle 1: the originals are exported directly; the wrapper pair is gone.
- None outstanding (review cycle 3) — every exported symbol in `internal/remote` and `remote-host.ts` has a live non-test call site (verified by grep); the change adds new functionality without making existing code redundant.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | `rk remote add` does no ssh roundtrip; the default name derives from the target's host token (after `@`, dots→hyphens), validated via internal/validate | No health ping can exist before a tunnel; intake's "health ping hostname" parenthetical points at the auto-derive convention, and offline add keeps registration instant | S:55 R:80 A:75 D:70 |
| 2 | Confident | Remote exec commands carry a fixed literal PATH prefix (`$PATH` + brew/linuxbrew bins) so non-login ssh shells find rk/tmux | Mirrors the shell's `augmentPath` GUI-PATH fix for the identical trap; fixed literal keeps Constitution I intact | S:60 R:85 A:85 D:80 |
| 3 | Confident | Explicit `--local-port` must fall inside 3100–3199 and pass the same collision checks | The reserved-range decision loses meaning if explicit picks escape it; reversible flag semantics | S:55 R:85 A:80 D:75 |
| 4 | Confident | Shell↔CLI contract = labeled stdout lines (`Name:`/`Target:`/`Local:`; connect's final origin line) parsed by an electron-free module | `rk desktop status` → update-check.ts is the established precedent; avoids new `--json` surface | S:60 R:80 A:85 D:75 |
| 5 | Confident | Activation connect is non-blocking: attach immediately, heal in background, reload only a failed view; failures surface via native dialog | Blocking every switch on multi-roundtrip ssh would break the instant warm-flip model the shell is built on | S:50 R:75 A:75 D:65 |
| 6 | Confident | Probes add `-o ConnectTimeout=5`; the tunnel command stays byte-exact as specified | The exactness constraint names the tunnel command; unbounded probe hangs would violate the timeout discipline | S:55 R:85 A:85 D:80 |
| 7 | Tentative | Tunnel readiness = TCP accept on 127.0.0.1:<lp> within 15s; window-gone during the wait → auth-hint error | Several valid checks (dial, HTTP health, pane scrape); dial is the most conservative and never consumes an HTTP request | S:40 R:80 A:70 D:50 |
| 8 | Confident | Remote `rk daemon start` failures matching "daemon already running" OR "already serving on" count as daemon-up success | Both mean something serves the configured port; the shell's isDaemonAlreadyRunning precedent, extended to the foreground-serve refusal | S:50 R:80 A:75 D:70 |
| 9 | Confident | A local `dev` (non-ldflags) rk skips the skew auto-update | "dev" is incomparable; never-downgrade posture makes skipping the only safe default | S:45 R:85 A:80 D:80 |
| 10 | Confident | The SSH rung shares the darwin/linux gate with "This Mac" (suppressed on win32) | Tunnels require local rk + tmux, which the codebase declares a non-Windows concept | S:55 R:85 A:85 D:80 |
| 11 | Confident | Desktop dedupe for SSH hosts keys on the stored `remote` name — reconnecting an already-registered remote activates the existing entry | Mirrors the local-connect origin dedupe; the remote name is the stable identity across launches | S:50 R:80 A:80 D:75 |

11 assumptions (0 certain, 10 confident, 1 tentative).

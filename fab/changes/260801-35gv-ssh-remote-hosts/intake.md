# Intake: SSH-Only Remote Hosts — `rk remote`

**Change**: 260801-35gv-ssh-remote-hosts
**Created**: 2026-08-01

## Origin

Promptless dispatch (`/fab-proceed` → `_intake` with `{questioning-mode} = promptless-defer`) from a synthesized design discussion. The full feature design was agreed in conversation before dispatch; this intake captures those decisions verbatim.

> Feature: SSH-only remote hosts — `rk remote`. Given only SSH access to a machine, make it usable as a full rk host that the desktop Electron shell (and a browser) can connect to — the VS Code Remote-SSH model (it bootstraps its own server on the host), removing the need for Tailscale for the desktop use case. Explicitly a complement to Tailscale, not a replacement (the tunnel exists only where the ssh client runs; no mobile access).

Interaction mode: one-shot dispatch of a fully-discussed design. Nine concrete decisions were made in the originating conversation (tunnel mechanism, bootstrap mechanism, update folding, loopback binding, CLI ownership + command family, tmux tunnel lifecycle, state file, hosts.json compatibility, welcome-page UX) — all captured under What Changes and graded in Assumptions.

## Why

1. **The pain point**: today a remote machine becomes an rk host only if it is network-reachable from the viewer — in practice that means Tailscale (or equivalent VPN/port exposure). Plenty of real machines are reachable *only* over SSH: cloud VMs, work servers behind bastions, machines where installing a mesh VPN is not allowed. For those, the desktop shell has no path to a working host today.

2. **The consequence of not fixing it**: the desktop shell's multi-host story stays gated on Tailscale adoption. Every SSH-only box stays a second-class citizen — users must hand-roll `ssh -L` tunnels, hand-start the daemon, and paste ephemeral URLs into the shell, none of which survives reconnects or restarts.

3. **Why this approach**: the VS Code Remote-SSH model is proven — bootstrap your own server over the existing SSH channel, tunnel to it, treat the tunnel origin as a local URL. It reuses the user's entire existing SSH trust setup (~/.ssh/config, agent auth, ProxyJump, ControlMaster) instead of inventing an rk auth story. It is explicitly a **complement to Tailscale, not a replacement**: the tunnel exists only where the ssh client runs, so there is no mobile access — Tailscale remains the answer for that.

## What Changes

### 1. CLI command family: `rk remote` (Go backend owns bootstrap + tunnel)

The CLI — not the Electron shell — owns bootstrap and tunnel lifecycle. This preserves the shell's viewer discipline (the shell only runs user-initiated `rk` commands via execFile, per the existing `app/desktop/src/local-daemon.ts` pattern) and makes the feature usable from a plain terminal + browser with no shell at all. New command family in `app/backend/cmd/rk/`:

| Command | Behavior |
|---------|----------|
| `rk remote add <target> [--name <n>] [--local-port <p>]` | Register a remote + assign a stable local port. `<target>` is stored verbatim (ssh alias or `user@host`). Name defaults from the health ping's hostname (the `addHost` convention in `app/desktop/src/hosts.ts`). |
| `rk remote connect <name\|target>` | Idempotent get-in: ssh probe → install rk if missing (standard curl install) → auto-update on version skew → `rk daemon start` on the remote → tunnel window up → prints the local origin (`http://127.0.0.1:<local_port>`). |
| `rk remote list` | Columns: NAME / TARGET / LOCAL / TUNNEL / REMOTE DAEMON. Tunnel state derived from tmux at request time; remote daemon state via ssh probe. |
| `rk remote status <name>` | Single-remote detail, including version skew. |
| `rk remote disconnect <name>` | Kill the tunnel window only; the remote daemon keeps running. |
| `rk remote remove <name>` | Disconnect + drop the entry from `remotes.yaml`; the remote installation is untouched. |

There is **no `rk remote update`** — update is folded into `connect` (explicit decision): connect detects version skew on the remote and auto-updates as part of its idempotent flow.

No new HTTP endpoints are intended — the shell reaches this via execFile, so Constitution IX is not triggered.

### 2. Tunnel mechanism: the system `ssh` binary, never a bundled SSH library

The tunnel process is exactly:

```
ssh -N -o BatchMode=yes -o ServerAliveInterval=15 -L 127.0.0.1:<localPort>:127.0.0.1:<remotePort> <target>
```

- Inherits everything from the user's SSH setup: `~/.ssh/config`, agent auth, ProxyJump, ControlMaster.
- v1 requires **non-interactive auth** (`BatchMode=yes`). On auth failure, surface the stderr tail with a hint to run `ssh <target>` once from a terminal (key setup / host-key trust).
- `StrictHostKeyChecking` stays on — no `accept-new`, no weakening of host-key verification.
- Launched via `exec.CommandContext` with argument slices + timeout (Constitution I) for the setup steps; the long-lived `-N` tunnel itself lives in tmux (below), not as a child of the CLI process.

### 3. Tunnel lifecycle: tmux windows on the `rk-daemon` socket, session `rk-remotes`

Tunnel processes live in tmux: socket `rk-daemon` (the existing daemon socket — `ServerSocket` in `app/backend/internal/daemon/daemon.go`), **sibling session `rk-remotes`**, one window per remote (window name = remote name) running the ssh command above. Rationale:

- **Invisible to the dashboard** — `rk-daemon` is the infrastructure socket, never enumerated as user sessions.
- **Independent of `kill-session =rk-daemon`** — daemon stop never kills tunnels, and tunnels do not need the local daemon at all (a browser user with no local daemon can still tunnel).
- **Derivable state** (Constitution II): tunnel state is computed at request time from `tmux -L rk-daemon list-windows` + pane command. No pid files, no supervisor.

`disconnect` kills only the remote's tunnel window. Remote work is never touched (Constitution VI).

### 4. Bootstrap + auto-update over ssh exec

`rk remote connect` bootstraps the remote over ssh exec:

1. Probe: `ssh <target> rk --version`.
2. If rk is missing: run the project's **standard curl-based installation step** on the remote — the same public install command (explicit decision; not scp, not a bespoke installer):

   ```
   curl -fsSL https://shll.ai/install | sh -s -- run-kit
   ```

3. If rk is present but version-skewed: re-run the same installer (the auto-update fold — see the graded assumption on skew semantics below).
4. `rk daemon start` on the remote — the remote daemon already runs inside tmux, so SSH drops / laptop sleep lose nothing (Constitution VI).

Version-skew handling: connect compares the remote `rk --version` against the local rk version; a remote **older** than local triggers the installer re-run (which installs the latest published build); a remote **newer** than local is left untouched and noted in `status` output — connect never downgrades.
<!-- assumed: skew baseline = local version, update only when remote is older, never downgrade — the discussion decided "auto-update on version skew" without fixing the baseline or direction; installer semantics (installs latest) make older-than-local the only actionable direction -->

### 5. Remote daemon: loopback-only, origin derived, never stored

The remote daemon binds `127.0.0.1` for these hosts — SSH is the sole auth layer; no exposed port, no rk auth story. The remote origin/port is derived at connect time via `ssh <target> rk url` (the same probe local-daemon control uses), **never stored**. The derived remote port feeds the `-L` forward spec.

### 6. CLI-owned state file: `~/.config/rk/remotes.yaml`

Version-1 schema — entries carry only the genuinely underivable-when-disconnected state:

```yaml
version: 1
remotes:
  - name: buildbox            # display + tmux window name + lookup key
    target: sahil@buildbox    # verbatim ssh arg — alias or user@host, never parsed
    local_port: 3100          # assigned once at add-time, then immutable
```

- `local_port` is assigned at add-time from a reserved range (**3100–3199**) with collision checks against both `remotes.yaml` and live listeners (the `app/backend/internal/ports` collector), then **immutable**. A stable port is what keeps per-origin browser state (localStorage theme accent, terminal font) and the shell's persistent WebContentsView identity across launches.
- Everything else (tunnel up/down, remote daemon state, remote port, version skew) is derived at request time (Constitution II).
- Remote names are validated before use as tmux window names / config keys (Constitution I — reuse the existing validation seam, `internal/validate`).

### 7. Desktop shell: `hosts.json` stays schema version 1 + one additive field

`app/desktop/src/hosts.ts` (`<userData>/hosts.json`) stays **schema version 1** with one additive optional field:

```jsonc
{ "id": "…", "name": "buildbox", "url": "http://127.0.0.1:3100", "remote": "buildbox" }
```

- `url` remains **required and real** — the stable local origin `http://127.0.0.1:<local_port>`.
- On activating a host that carries `remote`, the shell runs `rk remote connect <name>` via execFile (user-initiated, same pattern as local-daemon control in `app/desktop/src/local-daemon.ts` — argument slices + timeout, Constitution I).
- **Older shells** see a plain URL host and show the normal dead-host state — acceptable degradation. Deliberately **no version bump**: a v2 bump would empty the host list into welcome on old shells.

### 8. Welcome/Connect page: three rungs

`app/desktop/src/welcome/` becomes three rungs:

1. **"This Mac"** — unchanged.
2. Divider **"or over SSH"** — one input (`user@host` or a `~/.ssh/config` alias) + one **"Connect via SSH"** button + a live progress line in the amber "starting…" style the This-Mac card already uses:

   ```
   connecting to buildbox… → installing rk v0.x (linux/arm64)… → starting daemon… → opening tunnel on :3100…
   ```

3. Divider **"or a URL"** — the existing remote-URL form, unchanged.

The renderer only renders; **main** runs `rk remote add` + `rk remote connect` via execFile and streams progress to the renderer. Success ends at the existing `switchToHost` seam. A datalist of Host aliases parsed from `~/.ssh/config` is a nice-to-have, **not v1-required**.

### Non-Goals

- **Not a Tailscale replacement** — no mobile access; the tunnel exists only where the ssh client runs.
- **No interactive SSH auth in v1** — `BatchMode=yes`; password/2FA prompts are out, with an actionable error instead.
- **No bundled SSH library**, no scp-based deploy, no bespoke remote installer.
- **No `rk remote update` verb** — folded into connect.
- **No new HTTP API** — CLI-only surface; the shell uses execFile.
- **No ssh-config datalist in v1** (nice-to-have follow-up).
- **No supervisor / auto-reconnect loop for tunnels** — a dead tunnel is visible in `rk remote list` and heals via the idempotent `connect` (which the shell re-runs on host activation).

## Affected Memory

- `run-kit/remote-hosts`: (new) The SSH-only remote host subsystem — `rk remote` command family, remotes.yaml schema, tunnel-in-tmux lifecycle, bootstrap/auto-update flow, loopback + derived-origin model.
- `run-kit/architecture`: (modify) New CLI command group + internal remote package; the `rk-remotes` sibling session on the `rk-daemon` socket; ports-collector reuse.
- `run-kit/desktop-shell`: (modify) hosts.json additive `remote` field (schema stays v1), activation-time `rk remote connect` via execFile, welcome page's third rung + progress streaming.
- `run-kit/toolkit-standards`: (modify) New command surface (`rk remote`) gets the standard help-dump-stability + Principle 9 conformance check.

## Impact

- **Go backend** (`app/backend/`):
  - `cmd/rk/` — new `remote.go` command family (add/connect/list/status/disconnect/remove) + tests.
  - New internal package (e.g. `internal/remote/`) — remotes.yaml load/save, port assignment, ssh probe/bootstrap/tunnel orchestration.
  - Reuse seams: `internal/daemon` (socket/session constants, tmux runner), `internal/ports` (listener enumeration for port-collision checks), `internal/tmux`, `internal/validate`, the `rk url` / `/api/health` probes.
- **Desktop shell** (`app/desktop/src/`):
  - `hosts.ts` — additive optional `remote` field (schema v1 preserved) + tests.
  - Main-process wiring — activation-time `rk remote connect` runner following `local-daemon.ts` patterns (runRk wrapper, augmentPath, probe chains); progress streaming to the welcome renderer.
  - `welcome/welcome.html` + `welcome/welcome.ts` — the SSH rung UI + progress line; ends at the existing `switchToHost` seam.
- **Tests**: Go unit tests alongside new code (`*_test.go`); Vitest for desktop `src/*.ts` changes (hosts, welcome wiring). New command surface passes the help-dump stability check.
- **No new HTTP endpoints**; no frontend SPA (`app/frontend/`) changes anticipated.
- **Docs**: docs/site command docs at ship/hydrate time per toolkit standards.

## Open Questions

None — every decision point was either resolved in the originating discussion or recorded as a graded assumption below (no decision scored Unresolved; promptless dispatch deferred nothing).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Tunnel via the system `ssh` binary with exactly `-N -o BatchMode=yes -o ServerAliveInterval=15 -L 127.0.0.1:<lp>:127.0.0.1:<rp> <target>`; never a bundled SSH library | Discussed — explicit decision; inherits ~/.ssh/config, agent auth, ProxyJump, ControlMaster | S:95 R:70 A:90 D:95 |
| 2 | Certain | Bootstrap via the standard public curl install (`curl -fsSL https://shll.ai/install` piped to `sh -s -- run-kit`, exactly as in What Changes § 4) over ssh exec — not scp, not a bespoke installer | Discussed — user's explicit decision; command verified in docs/site/install.md | S:95 R:75 A:85 D:95 |
| 3 | Certain | No `rk remote update` verb — connect detects version skew and auto-updates as part of its idempotent flow | Discussed — user's explicit decision | S:90 R:80 A:85 D:90 |
| 4 | Confident | Remote daemon binds 127.0.0.1; SSH is the sole auth layer; remote origin/port derived via `ssh <target> rk url`, never stored | Discussed — explicit; graded Confident only because binding policy cascades into the security story if ever revisited | S:90 R:60 A:85 D:90 |
| 5 | Certain | CLI (Go) owns bootstrap + tunnel with the six-command `rk remote` family as specified — not the Electron shell | Discussed — explicit; preserves shell viewer discipline, usable from plain terminal/browser | S:95 R:60 A:90 D:95 |
| 6 | Certain | Tunnels live in tmux: socket `rk-daemon`, sibling session `rk-remotes`, one window per remote (window name = remote name); state derived from `list-windows` + pane command | Discussed — explicit; Constitution II (derivable state) + VI (independence); constants verified in internal/daemon/daemon.go | S:90 R:70 A:90 D:90 |
| 7 | Certain | State file `~/.config/rk/remotes.yaml` v1 with entries `{name, target verbatim, local_port}`; local_port is the only persisted underivable state | Discussed — explicit; Constitution II-compliant | S:90 R:65 A:85 D:90 |
| 8 | Certain | `hosts.json` stays schema version 1 + additive optional `remote` field; `url` stays required and real (stable local origin); no v2 bump | Discussed — explicit, with degradation rationale (old shells show dead-host, never an emptied list) | S:95 R:60 A:85 D:90 |
| 9 | Certain | Welcome page = three rungs (This Mac / "or over SSH" / "or a URL"); renderer renders, main runs add+connect via execFile and streams progress; success ends at `switchToHost` | Discussed — explicit, including the amber progress-line style | S:90 R:75 A:85 D:85 |
| 10 | Certain | BatchMode auth failure surfaces the stderr tail + hint to run `ssh <target>` once from a terminal; StrictHostKeyChecking stays on (no accept-new) | Discussed — explicit v1 posture | S:90 R:80 A:85 D:90 |
| 11 | Certain | Remote names validated before use as tmux window names / config keys, via the existing validation seam | Constitution I mandates input validation; internal/validate exists | S:60 R:80 A:90 D:85 |
| 12 | Certain | ssh-config Host-alias datalist excluded from v1 | Discussed — explicitly "nice-to-have, not v1-required" | S:85 R:90 A:90 D:90 |
| 13 | Confident | Local tunnel ports assigned from reserved range **3100–3199**, collision-checked against remotes.yaml + live listeners (internal/ports), then immutable | Range was proposed (not contested) in discussion; clears dev ports 3000/3020/3333; reversible for future adds | S:70 R:50 A:75 D:70 |
| 14 | Tentative | Version-skew semantics: baseline = local rk version; installer re-run only when remote is **older**; a newer remote is left untouched (never downgrade), noted in `status` | "Auto-update on skew" was decided but baseline/direction were not; installer installs latest, making older-than-local the only actionable direction | S:40 R:55 A:50 D:40 |
| 15 | Confident | No tunnel auto-reconnect supervisor: bare ssh in the tmux window; a dead tunnel shows in `rk remote list` and heals via idempotent `connect` (shell re-runs it on activation) | Undiscussed directly, but Constitution II ("no supervisor") + the idempotent-connect design point one way | S:30 R:70 A:75 D:65 |
| 16 | Confident | If a foreign process squats the assigned local port at connect time, `connect` fails with an actionable error — no silent port reassignment (port immutability was decided) | Undiscussed edge; immutability decision + stable-origin rationale exclude reassignment; error-and-tell is the conservative default | S:40 R:70 A:70 D:60 |

16 assumptions (11 certain, 4 confident, 1 tentative, 0 unresolved).

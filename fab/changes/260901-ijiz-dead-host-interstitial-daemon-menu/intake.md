# Intake: Dead-Host Interstitial & Daemon Menu Rework

**Change**: 260901-ijiz-dead-host-interstitial-daemon-menu
**Created**: 2026-09-01

## Origin

Conversational (`/fab-discuss` session, 2026-09-01). The user reported the post-reboot desktop-shell experience: a blank black screen (Chromium's error page over the `#0f1117` view background), a `Hosts → Local Daemon → Connect` item that appears to do nothing, and recovery possible only via `rk daemon restart --full` in a terminal. A follow-up message critiqued the Local Daemon submenu directly:

> These menu options aren't really cohesive. Connect, restart, and stop don't really make sense. You need a start, restart, and stop separately. Moreover when there's no runKit running, what really happens is that you see only a connect option, not even a start option, which causes a lot of dissonance.

> Ideally there should have been a "Start local run-kit server" or a "Restart local run-kit server" option on the UI itself. Think deeply about what a good UX would be.

Key decisions from the discussion:
- The primary recovery surface belongs **in the black window itself** (a shell-owned interstitial), not in a menubar submenu.
- The menu becomes lifecycle verbs: **Start / Restart / Stop** with state-dependent enablement; "Connect" is dropped from the submenu.
- User override on restart semantics: **"restart should mimic `run-kit daemon restart --full` instead of the non full variant"** — every shell-invoked restart runs `--full`, not as an escalation rung.
- A "wedged" daemon state (tmux session alive, HTTP dead — the user's exact incident) must be detected and named, with Restart as its offered action.
- Every daemon action gets in-flight feedback; failures surface immediately with the next action in the dialog.

The sibling bug fix `260901-ggjb-reload-failed-local-view` (local connect never reloads a failed view) lands **first**; this change builds on its reload gate. Execute in series, A then B.

## Why

**Problem.** The desktop shell is a viewer that never auto-starts the daemon (Constitution VI discipline, by design). But when the daemon is down, the shell's failure surfaces are all dead ends:

1. A failed host view shows Chromium's error page — no run-kit affordance at all, read as "blank black screen".
2. The Local Daemon submenu mixes vocabularies: "Connect" (host-hub language) beside Restart/Stop (process language). When stopped, the only enabled item is Connect — dissonant ("connect to *what*?") — and there is no Start.
3. Restart is disabled when the ping-based probe says "stopped", but the probe cannot distinguish *stopped* from *wedged* (rk-daemon tmux session alive, HTTP dead). In the wedged state, `rk daemon start` returns "daemon already running" (classified as success by `isDaemonAlreadyRunning`), `waitForHealth` burns 30 silent seconds, and the one verb that fixes stale server-scoped state — restart — is grayed out. The user had to leave the app for a terminal.
4. Menu Connect gives zero in-flight feedback: probe (5s) + start (30s cap) + health wait (30s cap) with no relabel and no progress; an error box appears up to a minute later, which reads as "nothing happened."

**Consequence.** Every reboot turns into a terminal round-trip, and the shell's own status line can contradict the window (menu `● running · v3.18.17`, window black).

**Approach.** Put the recovery affordance where the user is looking (an interstitial in the failed view) with a read-only health poll that auto-heals the window however the daemon comes back; make the menu's verbs honest lifecycle verbs; detect and name the wedged state; make restart the `--full` variant per user direction. The viewer constitution holds throughout: polling is read-only detection (the same `net.fetch` health ping and read-only `rk daemon status --json`), and the daemon still starts/restarts/stops only on an explicit click.

## What Changes

### 1. Shell-owned dead-host interstitial (new `src/interstitial/` page)

When an attached view's main-frame load fails (the existing `viewLoadFailed` mechanics — `nextLoadFailed` in `src/views.ts`), main loads a shell-owned page into the failed view's webContents in place of Chromium's error page (a main-initiated `loadURL` bypasses `will-navigate`, the welcome-page precedent). Static HTML + compiled no-import/export TS, mirroring `src/welcome/` exactly: same CSP (`default-src 'none'; script-src 'self'; style-src 'unsafe-inline'`), same copied design tokens with `prefers-color-scheme` support, same structural bridge narrowing (`Reflect.get(window, "runkitShell")`), same `[hidden] { display: none !important; }` rule.

The page receives `?host={id}&kind={local|remote|url}` (main decides `kind`: the host's origin equals the probed local origin → `local`; the entry carries `remote` → `remote`; else `url`). Content by kind:

- **`local`** — the welcome This-Mac card's states, transplanted:
  - *stopped*: "run-kit isn't running on this Mac" + accent **Start run-kit** button (invokes the existing `daemon:start` flow; success ends with the view reloading via the sibling change's gate).
  - *starting…*: amber progress line `starting… waiting for {host}:{port} to answer` (buttons disabled).
  - *not responding* (wedged, § 3): "run-kit is running but not answering on {origin}" + accent **Restart run-kit** button (runs `rk daemon restart --full`, § 4).
  - *not installed*: the brew install line, as on the welcome card.
- **`remote`** — "reconnecting to {name}…" while the existing `ensureRemoteConnected` heal is in flight; on heal failure, a **Retry** button re-invoking the heal. (The heal's existing reload-on-success gate already repaints the view.)
- **`url`** — "can't reach {origin}" + **Retry** button (reload the view to `url + lastPath`) + one line pointing at the titlebar host-switcher's Edit Host for a wrong address.

**Health poll + auto-heal**: while an interstitial is visible for a `local` or `url` host, main polls the host origin's `/api/health` at 3s (the welcome card's `LOCAL_STATUS_POLL_MS` precedent; `inFlight` guard, poll dies when the interstitial navigates away). On a healthy answer, main reloads the view to `url + (lastPath ?? "")` — so a daemon started from a terminal heals the window with no click. This is read-only detection; no start path is automatic.

**`viewLoadFailed` contract constraint**: navigating the view to the interstitial (`file://`) commits a `did-navigate`, which clears the flag under today's pure transition. The interstitial's presence must remain equivalent to "failed" for every consumer (the remote heal's reload gate, the sibling change's local-connect gate, the fallback-strip injection predicate which already excludes non-registered origins). Whether that is a `nextLoadFailed` event-union extension, a main-side re-set after the interstitial commits, or an "interstitial shown" companion map is an apply-time decision — but the invariant is normative: **a view showing the interstitial reloads to the host on the next successful connect/heal exactly as an error-page view does today**, and lastPath capture must never persist the interstitial URL (the existing origin-equality guard already covers this).

### 2. Local Daemon submenu → Start / Restart / Stop (`src/menu.ts`, `src/main.ts`)

The submenu keeps its disabled status line and replaces Connect/Restart/Stop with:

| State | Status line | Start | Restart | Stop |
|-------|-------------|-------|---------|------|
| stopped | `○ stopped · v{X}` | **enabled** | enabled | disabled |
| running | `● running · v{X}` | disabled | enabled | enabled |
| not responding (wedged) | `◐ not responding · v{X}` | disabled | **enabled** | enabled |

- **Start** keeps the connect tail (`startAndConnectLocal`) — starting a daemon and not getting in is never the intent (the welcome card's one-intent rule survives; only the label carries the true verb now). The version fragment stays omitted when unparseable.
- **Restart is enabled in every state** (when installed) — `rk daemon restart` is idempotent and starts fresh when nothing runs, and an always-enabled Restart is the guard against any residual stopped/wedged misclassification.
- **Connect is dropped.** When running, getting in is the host's own row in the Hosts menu (⌥⌘n / Alt+n) or the interstitial's auto-heal; the daemon-running-but-unregistered case keeps its existing path (the welcome card's Connect button and `Hosts → Add Host…`).
- `DaemonMenuInfo` grows the third state (e.g. `{ state: "running" | "stopped" | "wedged", version }`); the menu-rebuild-only-on-change comparison updates accordingly.

### 3. Wedged-state detection (`src/local-daemon.ts` + `src/main.ts`)

Two detection seams, both feeding one classification:

- **Probe-time**: `probeDaemonStatus()` extends its chain — when the health ping fails but `rk daemon status --json` (read-only by contract; `app/backend/cmd/rk/daemon_status.go`) reports `daemon.running: true`, the state is **wedged**, not stopped. The JSON parse lives in `src/local-daemon.ts` as electron-free pure logic with `node --test` coverage (parse `{daemon:{running}}`, tolerate malformed output by degrading to the ping-derived state).
- **Action-time**: in `startAndConnectLocal`, the `isDaemonAlreadyRunning`-classified start followed by a `waitForHealth` timeout is reclassified from a generic timeout error to the wedged state, and the surfaced dialog offers the fix directly: message "run-kit reports running but isn't answering on {origin}", buttons **Restart Daemon** / **Cancel** (Cancel default, the Stop-confirm precedent) — Restart Daemon invokes § 4's restart.

The welcome This-Mac card and the interstitial both gain the wedged row (status dot amber-or-distinct, single **Restart run-kit** action); the menu shows `◐ not responding` per § 2.

### 4. Shell restarts run `rk daemon restart --full` (`src/main.ts`)

Every shell-invoked restart — the menu's Restart item, the wedged-state dialogs, the interstitial's Restart button — runs `["daemon", "restart", "--full"]` (user direction: the non-full variant cannot clear stale server-scoped state, which is the recovery this button exists for). Notes binding the plan:

- `--full` kills the entire rk-daemon tmux server including the `rk-remotes` tunnel session, and the CLI itself captures the up-tunnel set first and reconnects it after the fresh start (per `docs/memory/run-kit/daemon-lifecycle.md` § `--full` semantics) — so no shell-side tunnel handling is needed, but the Restart confirm/tooltip copy must be honest that tunnels blip.
- The `--full` inside-daemon-server guard is irrelevant here (the Electron main process is not a pane on the rk-daemon server).
- Timeout: `RK_DAEMON_TIMEOUT_MS` (30s) may be tight for stop-grace (12s) + kill-server + port-free waits (up to 5s) + fresh start + tunnel reconnect; give restart its own generous constant (e.g. 60s) rather than reusing the start timeout.
- User-facing labels say "Restart", not "--full" — the flag is an implementation detail; the honest copy is about tunnels/sessions, not flags.

### 5. In-flight feedback on every daemon action (`src/menu.ts`, `src/main.ts`, welcome + interstitial pages)

- Menu items relabel and disable while their action runs — `Starting…` / `Restarting…` / `Stopping…` — the Restart-to-Update item's exact pattern (synchronous state set, rebuild, restore on completion/error).
- The interstitial and welcome card render the amber progress state during start/restart (the card already does for start; restart joins it).
- Failures surface immediately (`dialog.showErrorBox` at minimum), never after silent waits without state change; the wedged dialog carries its action button per § 3.

### Behavior contracts (key scenarios)

- GIVEN a cold start with the daemon down, WHEN the restored window's view fails its load, THEN the window shows the local interstitial in the *stopped* state (not a Chromium error page), and clicking **Start run-kit** starts the daemon, shows *starting…*, and lands the SPA in that window.
- GIVEN the interstitial is showing and the user runs `rk daemon start` in a terminal, THEN within ~3s the window auto-heals to the SPA with no click.
- GIVEN the rk-daemon tmux session exists but health does not answer, THEN the menu status reads `◐ not responding`, Start is disabled, and Restart (enabled) runs `rk daemon restart --full` and recovers.
- GIVEN the daemon is stopped, THEN the submenu shows Start enabled / Stop disabled / Restart enabled — never a lone "Connect".
- GIVEN any daemon action in flight, THEN its menu item reads `…ing` and is disabled, and the acting surface shows progress.

### Tests

Electron-free pure logic gets `node --test` coverage per package convention: the `rk daemon status --json` parse + wedged classification (`local-daemon.test.ts`), the three-state menu enablement matrix (extracted decision, `menu` is buildable data), interstitial state derivation if extracted. Page scripts and main-side glue follow the welcome page's precedent (no jsdom/e2e harness exists in `app/desktop`; the compile + node:test gate is the bar).

## Affected Memory

- `run-kit/desktop-shell`: (modify) § Local Daemon Control (three-state model, wedged detection, `--full` restarts, feedback pattern), § Welcome "This Mac" Local Section (fifth state row), a new § Dead-Host Interstitial, § Keyboard-Tier Menu Seam / Local Daemon Submenu (verb change), and the Design Decisions this supersedes (the one-button "Start & connect" rationale gains the menu-verb split; "restart maps to `rk daemon restart` directly" becomes `--full`).

## Impact

- `app/desktop/src/main.ts` — interstitial routing on load-fail, health poll lifecycle, wedged classification wiring, `--full` restart, action in-flight state.
- `app/desktop/src/menu.ts` — submenu items, three-state enablement, in-flight relabels; `DaemonMenuInfo` shape.
- `app/desktop/src/local-daemon.ts` (+ test) — `rk daemon status --json` probe leg, wedged classification, restart timeout constant.
- `app/desktop/src/interstitial/` (new) — page + script, compile-script copy step (the `welcome.html` copy precedent in `package.json`).
- `app/desktop/src/welcome/welcome.{html,ts}` — wedged state row on the This-Mac card.
- `app/desktop/src/preload.ts` — the interstitial joins the privileged sender set for the existing `daemon:*` bridge group (and a narrow retry/reload channel if needed); no SPA/backend changes.
- Depends on `260901-ggjb-reload-failed-local-view` (the local reload gate is the connect flow's landing half). Execute in series after it.

## Open Questions

- None — the discussion resolved surface placement, menu verbs, wedged handling, and restart semantics; remaining choices are graded below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Every shell-invoked restart runs `rk daemon restart --full` | Explicit user direction this session, overriding the discussed escalation-ladder alternative | S:95 R:85 A:95 D:95 |
| 2 | Certain | Menu verbs become Start/Restart/Stop; Connect is dropped from the submenu | Explicit user critique and request ("You need a start, restart, and stop separately") | S:95 R:90 A:90 D:90 |
| 3 | Certain | The primary recovery surface is an interstitial in the failed view, not the menu | Discussed and agreed — "the affordance should be in it"; menu remains secondary | S:90 R:75 A:85 D:85 |
| 4 | Confident | Interstitial is a static shell page loaded into the failed view's webContents (welcome-page architecture: CSP, tokens, no-import script, privileged sender gating) | Keeps welcome semantics untouched, inherits per-(window,host) isolation, and the main-initiated `loadURL` precedent exists; alternative (detach view + window-webContents page) would lose per-host scoping | S:70 R:70 A:85 D:75 |
| 5 | Confident | Wedged detection = health ping fails ∧ `rk daemon status --json` reports `daemon.running: true`; plus the action-time reclassification of already-running + health-timeout | The CLI probe exists, is read-only by contract, and distinguishes exactly the two states the ping conflates | S:75 R:85 A:85 D:80 |
| 6 | Confident | Start keeps the connect tail (one-intent rule); the daemon-running-but-unregistered case stays on the welcome card / Add Host | Recorded design decision for the card; dropping the tail would reintroduce two-clicks-for-one-intention | S:65 R:85 A:80 D:70 |
| 7 | Confident | Health poll at 3s, main-side, interstitial-scoped, auto-reload on healthy answer; read-only so the viewer constitution holds | Mirrors the welcome card's documented cadence and the constitution's read-only-detection carve-out | S:75 R:90 A:85 D:85 |
| 8 | Confident | Restart gets its own longer timeout constant (~60s) instead of `RK_DAEMON_TIMEOUT_MS` | `--full`'s documented sequence (12s stop grace + port-free waits + start + tunnel reconnect) can exceed 30s; a killed restart mid-sequence is the worst outcome | S:60 R:90 A:80 D:80 |
| 9 | Tentative | Wedged status glyph/copy: `◐ not responding · v{X}` in the menu; "running but not answering" prose on cards <!-- assumed: exact glyph and copy wording — pattern follows the existing ●/○ status-line convention; easily changed --> | Copy is easily revised; the three-state model, not the glyph, is the contract | S:50 R:95 A:70 D:45 |
| 10 | Tentative | Remote-kind interstitial adds only a Retry button over the existing heal (no tunnel progress streaming into the interstitial this change) <!-- assumed: remote interstitial scope kept minimal — the heal + error dialog already exist; streaming progress is welcome-page-only today --> | Keeps scope on the local-daemon incident; remote streaming can follow later | S:45 R:80 A:65 D:55 |

10 assumptions (3 certain, 5 confident, 2 tentative, 0 unresolved).

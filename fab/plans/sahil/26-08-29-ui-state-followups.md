# UI State Follow-ups — `rk tab` Polish, Legacy Cleanup, Boards as Tab Addresses

**Drafted**: 2026-08-29 · against `a802493b` (v3.18.10) · parent plan: [`26-08-28-ui-state-tmux-options.md`](26-08-28-ui-state-tmux-options.md) (Changes 1–4 shipped as #759/#760/#761/#763) · spec: [`docs/specs/ui-state.md`](../../../docs/specs/ui-state.md)
**Shape**: 3 changes, run-kit only. A is independent and can ship now; B waits until v3.18.10 has soaked (it is the parent plan's Change 5); C is spec-first.

## What this plan closes

| Pending item (from the 2026-08-29 audit) | Change |
|---|---|
| `rk tab` rough edges + `%N` targeting | **A** |
| Parent-plan Change 5 cleanup (translation shims, n-less present route, payload compat) | **B** |
| `@rk_win_url` dual-read → one-shot convergence | **B** |
| Detected-port `+ :3000` web-tab chip (spec § Web Tabs promise, unbuilt) | **B** |
| Spec OQs — boards (decide), ratios + companions (park explicitly) | **C** |

Not in this plan: fab-kit's `@rk_agent_state` legacy-read removal (cross-repo; tracked in fab-kit's backlog).

### Facts that shape the plan (verified at `a802493b`)

- `cmd/rk/tab_code.go` has one subverb (`set`); no read/clear. `cmd/rk/tab_layout.go` exposes `--add/--rm/--promote/--cycle`; `internal/layoutspec.SwapWithNext` exists but has no CLI arm.
- `--notify` lives only on `rk present` (`present.go:42-57`); `webAddShow` (`tab_web.go`) is the single code path behind `present` and `tab web add`. `--show` on a full 3-tile layout without web **silently replaces the last slot** (`tab_web.go` webAddShow comment).
- `internal/tabaddr.Parse` accepts `@N`, `=session:window` (via `resolveTabAddr`), bare `<n>`, `web/<n>`; **no `%N`**. `cmd/rk/mux_send.go:152 resolvePaneTarget` already resolves `%N` → pane; `owntab.go:108 resolveTabWindow` resolves `$TMUX_PANE` → `@N` — the pane→window step exists, just not for an explicit `%N`.
- Legacy shims still live: `lib/surface-layout.ts:268 translateLegacyParams` + `:289 legacyTranslationDecision`; `app.tsx:754-801` (one-shot `?view/?panel/?layout` write + `rk-layout:`/`runkit-code-folder:` key migration + delete); `api/router.go:836-837` n-less `/present/{windowId}[/*]`; `api/windows.go:424-436 translateLegacyOptionKeys` (`@rk_win_url`/`@rk_win_lens` on `/options`); derived `rkUrl`/`rkType` on the Window JSON (`internal/sessions/sessions.go:~582`).
- `@rk_win_url` has **no sweep row** (`legacy_options.go:65-72`): the family dual-reads it as the slot-1 fallback and never unsets it — a sweep row could not both satisfy the legacy-scope rule and converge to `_web_1`.
- Ports are host-level (`internal/ports` `Service{Port, Process, PID}`), served to the host overview; the Window JSON carries no ports. A per-tab chip needs a pane→port join (pane pid descendant match) — new derivation.
- Boards today: link-based pin-sessions `_rk-pin-*` carrying `@rk_ses_pin_board/_home/_order` (`tmux.go:418,967`); board tiles are whole windows (tty relay), not surfaces.

---

## Change A — `rk tab` polish + `%N` targeting (SMALL, `feature`, ships now)

### `internal/tabaddr`
- Accept a leading `%N` segment: `%7`, `%7/web/2`. `Addr` gains `PaneID`; `resolveTabWindow` resolves it via `display-message -p -t %N '#{window_id}'` (the `$TMUX_PANE` arm generalized — one helper, two callers). `-L` + `%N` allowed (same rule as `@N`). Grammar doc in `ui-state.md` § Addressing Grammar gains the row.

### `cmd/rk/tab_code.go`
- `rk tab code [@N]` (no subverb) prints `@rk_win_code_root` (empty line + exit 0 when unset; `--json`).
- `rk tab code clear [@N]` unsets it (forces re-seed on next code-surface render — today only raw tmux can).

### `cmd/rk/tab_layout.go`
- `--swap S` → `layoutspec.SwapWithNext`. Mutual-exclusion set grows by one.

### `cmd/rk/tab_web.go` + `present.go`
- `--notify[=msg]` moves onto `rk tab web add` (same `rk notify` machinery, fail-silent); `rk present` forwards it. After this `present` has zero unique capability; its help gains "alias — prefer `rk tab web add --show`". Demotion to a hidden alias is **not** this change (skill bundle + memory still teach it; one release of overlap).
- `--show` eviction: when the growth table has to replace a slot, print `evicted <surface> from <old layout>` on stderr. No behaviour change.

### Tests / standards
- `tabaddr_test.go`: `%N` forms, `%N/tty/2` rejected, `%N` + `@N` in one address rejected.
- `tab_test.go`: code read/clear, `--swap`, `--notify` forwarding (mock `notifyFn`), eviction message.
- `help-dump` + toolkit Principle 9; `rk skill run-kit` bundle: `%N` addressing, `code`/`code clear`, `--swap`, `--notify` on `tab web add`.
- Hydrate: `architecture.md` `tab` row, `tmux-sessions.md` grammar note, `ui-state.md` § Addressing Grammar + § `rk tab`.

---

## Change B — Legacy cleanup + `@rk_win_url` convergence + port chip (MEDIUM, `chore`, after v3.18.10 soaks)

Gate: `rk doctor` "legacy tmux options" row reports 0 on the operator's fleet and v3.18.10 has been the installed release for ≥ a few days.

### B1 — Delete the shims (parent-plan Change 5)
- Frontend: `translateLegacyParams`, `legacyTranslationDecision`, the `app.tsx:754-801` translation effect and `rk-layout:`/`runkit-code-folder:` key handling; `router-url.ts` loses `view`/`panel`/`layout` search params entirely (unknown params ignored, not translated). Focus-memory comment referencing the dead keys updated.
- Backend: n-less `/present/{windowId}[/*]` routes; `translateLegacyOptionKeys` + the `/options` acceptance of `@rk_win_url`/`@rk_win_lens` (400 like any unknown key); derived `rkUrl`/`rkType` dropped from the Window JSON (`sessions.go`) and from `api/client.ts` types; `createWindow`'s `rkType` arm already gone in #760 — verify no caller remains.
- Migration table: `@rk_win_lens→_layout` and `_present_root→_web_1_root` rows become **unset-only** (nothing to carry forward after one release).

### B2 — `@rk_win_url` convergence
- New one-shot step beside `MigrateLegacyOptionsOnce` (same per-server-per-daemon-lifetime gate): for every window with `@rk_win_url` set — if `_web_1` empty → copy URL to `_web_1` (+ `_active=1` when unset); then unset `@rk_win_url`. If `_web_1` is already set, just unset (the family already won). Idempotent, logged, non-fatal.
- Then delete the slot-1 dual-read (`parseWindows` / `ReadWebTabFamily` fallback) and the `legacyWinURLOption` constant. `rk present`'s stdout contract (resolved URL) unchanged.
- `rk doctor`: the legacy row's tally includes `@rk_win_url`.
- Spec: § Option Inventory `@rk_win_url` row becomes plainly "retired (converged by one-shot step, v3.18.x)".

### B3 — Detected-port web-tab chip
- Backend derivation: per tab, the ports whose owning PID is a descendant of one of the tab's pane pids → `Window.Ports []int` on the JSON (reuse `internal/ports` collector + a pid-tree walk; Linux `/proc` + darwin `ps` arms already exist in the collector). Cadence: piggyback the existing ports collector tick, not per SSE tick.
- Frontend `iframe-window.tsx`: ports not already in `webTabs` (compare against `/proxy/<port>/` prefix) → muted `+ :3000` chip at the strip's end; click = `POST …/web {target: ":3000"}` (declared write; spec § Web Tabs "declared only"). Chip visible also at `webTabs.length === 0` inside the onboarding state ("serving :3000 — add as web tab").
- Tests: derivation unit (pid tree, dead pid, port already attached); strip unit (chip set = ports − attached); e2e: spawn `python3 -m http.server` in the tab's pane, assert chip, click, assert `@rk_win_web_1=/proxy/<port>/`.

### Hydrate
- `tmux-sessions.md` registry (rows removed / converged), `ui/lenses-and-layout.md` (ladder residue gone, chip), `api-and-sockets.md` (routes removed, `ports` field), `architecture.md`. `ui-state.md` § Migration marked complete; § What Dies table pruned.

---

## Change C — Boards as layouts of tab addresses (spec-first; `feature` after the spec lands)

Resolve `ui-state.md` OQ3 before the next boards change lands on the old model; park OQ1/OQ2 explicitly.

### C0 — Spec (`docs/specs/ui-state.md` + `boards` section, PR on its own)
- **Decision to make**: a board = an ordered set of `@N[/<surface>]` addresses + a shape, stored as session options on the pin-session (`@rk_ses_pin_order` already holds window order; add `@rk_ses_pin_layout` for shape and let each entry carry an optional `/surface`, default `tty`). Boards become addressable (`rk board add <board> @12/web/2`) and agent-writable through the same `set-option` seam — the parent spec's Goal extended one level up.
- **Consequences to write down**: pin-sessions stay link-based (a board tile of `@12/web/2` renders that tab's web surface, so the relay/iframe work is reused); settings.yaml boards (surface-layout phase 4 note) are **not** built; board mobile carousel = degradation rule over the same order.
- **Park explicitly**: OQ1 ratios (per-viewer stays; revisit on demand), OQ2 `@rk_owner` companions (dormant; delete the right-panel.md section or mark `[parked]`).
- Constitution check: II (derived, restore-safe — `@rk_ses_pin_*` already round-trips), IV (no new routes; `rk board` is CLI).

### C1 — Implementation (sized after C0; expected MEDIUM)
- `internal/tmux` board option read/write + snapshot round-trip; `rk board` verb family (`ls/add/rm/layout`) mirroring `rk tab`; board page renders `(tab, surface)` tiles via the existing surface renderers; sidebar boards section unchanged in shape.

---

## Sequencing

```
A  ── now (independent; small)
B  ── after v3.18.10 soaks + doctor 0; B1 → B2 → B3 inside one PR (or B3 split out if review load is high)
C0 ── any time (docs PR); C1 after C0 merges and before the next boards feature
```

- Each: `/fab-new` → confidence gate → `/fab-fff`. Types: A `feature`, B `chore` (B3 is a feature inside a chore — acceptable, or split), C0 `docs`, C1 `feature`.
- B touches `web-view-lens.spec.ts` territory: baseline on clean `origin/main` first (pre-existing :138/:295/:335 failures).
- After B ships, `rk present` may be demoted to a hidden alias in the following release (skill bundle re-pointed at `rk tab web add --show` in A).

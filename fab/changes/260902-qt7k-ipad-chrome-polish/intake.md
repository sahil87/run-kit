# Intake: iPad Chrome Polish — pane-ID leak, coarse-pointer sizing, name redundancy

**Change**: 260902-qt7k-ipad-chrome-polish
**Created**: 2026-09-03

## Origin

> iPad polish bundle: humanize the raw tmux pane-ID status segment (display `pane N`, keep `%id` as copy payload), audit top-bar touch-target tokens under coarse/any-pointer on iPad, and trim window-name redundancy (compose placeholder, pane-border title, tmux status-left clipping)

Conversational mode. The user shared an iPad screenshot of the dashboard (terminal route, keyboard up) in a `/fab-discuss` session; six issues were identified and this change bundles the three polish items (an annotated before/after HTML mock was reviewed and approved by the user). Investigation during intake **relocated two of the three items**:

- The `(1/%161)` leak is NOT the web status bar (which already renders `pane 1/2 %5` with a raw-id copy affordance — `status-bar.tsx:235`). It is the **tmux `pane-border-format`** in the managed config: `configs/tmux/default.conf:75` renders `(#P/#D): <path>` where `#D` expands to the raw pane id.
- The coarse compose placeholder `→ {name}…` is a **deliberate design** (260814-ke2s/260814-ink6): on touch, the header row folds away and the placeholder is the *sole* surfacing of the compose target. Removing the name there would remove the target indicator — it is now a non-goal (see What Changes § C).

## Why

1. **Pain point**: On iPad the dashboard chrome leaks internals and under-sizes touch targets. The pane border shows `(1/%161)` — a raw tmux pane id that means nothing to a user; the top-bar buttons render at the 28px fine-pointer size even though iPad is a touch device; and the same window name repeats across several chrome sites while the tmux status line clips its window list.
2. **Consequence if unfixed**: The dashboard reads as a debugging tool rather than a product on tablets — cryptic identifiers in primary chrome, and touch targets below Apple's 44pt guidance make routine taps (refresh, overflow menu, lens switch) error-prone.
3. **Why this approach**: All three fixes are display-layer polish with no behavior contracts: two are format-string edits in the managed tmux config (already hash-stamped with reload paths — see `docs/memory/run-kit/configuration.md`), one is a media-query audit of existing tokens that already carry `coarse:` variants. No new state, no API changes.

## What Changes

### A. Pane-border format — drop the raw pane id (`configs/tmux/default.conf:75`)

Current format (both the active and inactive arms):

```
(#P/#D): #(echo #{pane_current_path} | rev | cut -d/ -f1-2 | rev)
```

renders `(1/%161): run-kit.worktrees/quick-ravine`.

Change both arms to drop `#D` (the raw `%N` pane id) entirely and show the pane index only when the window actually has multiple panes:

```
#{?#{e|>:#{window_panes},1},#P · ,}#(echo #{pane_current_path} | rev | cut -d/ -f1-2 | rev)
```

- Single-pane window (the common case): `run-kit.worktrees/quick-ravine` — no pane prefix at all.
- Multi-pane window: `2 · run-kit.worktrees/quick-ravine`.
- The rest of the format (worktree glyph, git branch segment, `pane_current_command` segment, active/inactive color arms) is unchanged.
- The raw pane id stays available where it belongs: the web status bar's Pane panel already copies it (`Copy tmux pane id`, `status-bar.tsx`), and `tmux display-message -p '#{pane_id}'` for CLI users.
- The managed conf is hash-stamped; the existing `@rk_srv_managed`-gated reload paths pick the edit up (verify per `docs/memory/run-kit/configuration.md` — no new reload mechanism).
- `just setup` stages this config for the Go embed (`build.TmuxConfig` via `app/backend/internal/tmux/embed.go`) — confirm the staged copy and any golden tests over the embedded bytes are updated together.

### B. Coarse-pointer sizing — make iPad resolve the existing `coarse:` tokens

The tokens are already correct (`TOP_BAR_BUTTON_BASE` in `top-bar-overflow-menu.tsx:103` carries `w-[28px] h-[28px] coarse:w-[30px] coarse:h-[30px]`), but iPad rendered 28px in the screenshot. Root cause hypothesis: both gates use the **primary**-pointer query —

- `app/frontend/src/globals.css:27` — `@custom-variant coarse (@media (pointer: coarse));`
- `app/frontend/src/hooks/use-is-mobile.ts:7` — `COARSE_QUERY = "(pointer: coarse)"`
- plus the raw `@media (pointer: coarse)` block at `globals.css:1637`

and iPadOS Safari reports the primary pointer as `fine` when a trackpad/mouse is paired (and in some hardware-keyboard configurations), dropping every coarse treatment even though touch remains available.

Change: switch the three sites above from `(pointer: coarse)` to `(any-pointer: coarse)` so touch-capable devices keep touch sizing regardless of paired peripherals. Accepted tradeoff: touchscreen laptops also match `any-pointer: coarse` and will get the upsized targets (+2px buttons, 36px compose rows) — acceptable because the coarse deltas are small by design and those users do tap. Keep the Tailwind variant, `COARSE_QUERY`, and the raw media block **in lockstep** — `evaluateIsMobile()` (`narrow OR coarse`) and the CSS must not disagree about what "coarse" means.

Verification: this is exactly the audit the user asked for — before changing anything, confirm the hypothesis (e.g. Playwright with `hasTouch` + fine primary pointer, or manual iPad check) rather than assuming; if iPadOS already resolves `pointer: coarse` in the default configuration, the fix narrows to documenting the trackpad case and the change may shrink.

### C. Window-name redundancy — the surviving trim

Of the five sites the window name appeared in on one screen, only the tmux-owned chrome changes:

- **Pane-border path segment** — already handled by § A (dropping `(#P/#D)` removes the noisiest duplicate-adjacent content).
- **tmux status line clipping** — the screenshot showed `<vements` (tmux's `<` truncation marker) left of the window list. Investigate whether the clip is `status-left-length 30` (`configs/tmux/default.conf:58-59`) or the window-list scroll indicator with many windows; widen `status-left-length` to 40 if it's the former, and leave the window-list scroll alone if it's the latter (that is tmux working as designed).
- **Non-goals (explicitly kept)**: the top-bar heading `Tab: <name>` (canonical site), the branch segment `⎇ quick-ravine` (a different fact — the git branch — that happens to match), and the coarse compose placeholder `→ {name}…` (the deliberate sole target indicator on touch, per `compose-strip.tsx:333-350` and 260814-ink6 — do NOT genericize it).

## Affected Memory

- `run-kit/configuration`: (modify) managed tmux.conf pane-border-format and status-left changes ride the hash-stamped conf + reload-path contract documented there
- `run-kit/ui/visual-design`: (modify) the `coarse:` custom variant's media query changes from `pointer: coarse` to `any-pointer: coarse` — the variant's meaning is a cross-surface convention
- `run-kit/ui/top-bar`: (modify) only if the token audit changes more than the variant definition (token values are expected to stay untouched)

## Impact

- `configs/tmux/default.conf` (pane-border-format line 75, status-left lines 58-59) + wherever `just setup` stages it for the Go embed; any backend test asserting the embedded conf bytes
- `app/frontend/src/globals.css` (lines 27, 1637) — coarse variant definition
- `app/frontend/src/hooks/use-is-mobile.ts` (line 7) — `COARSE_QUERY`
- No Go code changes expected; no API/SSE/WS surface changes; no new settings keys (per Constitution IV the conf edit lives in the managed file, not a new preference)
- Tests: unit coverage for `evaluateIsMobile` under `any-pointer`; e2e specs that emulate coarse pointers may need their emulation flags checked (`hasTouch` vs primary-pointer emulation)

## Open Questions

- Does iPadOS Safari in the user's configuration (external keyboard visible in screenshot) actually report `pointer: fine`? The § B fix is gated on confirming this — if primary pointer is already coarse, the sizing bug has a different cause (e.g. the cluster not consuming the token) and the audit should find it.
- Is the `<vements` clip status-left or window-list scrolling? (§ C investigation decides which knob, if any, to turn.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The `(1/%161)` leak is the tmux pane-border-format, not the web status bar | Verified in intake: `configs/tmux/default.conf:75` renders `(#P/#D)`; `status-bar.tsx:235` already renders `pane 1/2 %5` with raw-id copy | S:90 R:85 A:95 D:90 |
| 2 | Confident | Drop `#D` from the border and show `#P · ` only when `window_panes > 1` | Discussed — user approved "display pane N, keep %id as copy payload"; the copy affordance already exists in the web status bar, so the border can drop the id outright | S:80 R:85 A:80 D:75 |
| 3 | Tentative | Switch `coarse:` variant + `COARSE_QUERY` + globals.css:1637 to `any-pointer: coarse`, accepting touchscreen-laptop upsizing | Discussed as the front-runner with the tradeoff named; user did not pick between `any-pointer` and a combined `coarse OR (any-coarse AND narrow)` rule — apply verifies the iPad hypothesis first and records the final rule <!-- assumed: any-pointer: coarse as the new coarse gate — smallest consistent change; combined-rule fallback if laptop upsizing proves objectionable --> | S:60 R:70 A:45 D:40 |
| 4 | Confident | Compose placeholder and heading/branch segments are non-goals; redundancy trim is border-format + status-left only | Verified in intake: coarse placeholder is the sole target indicator on touch (260814-ink6, compose-strip.tsx:333-350) | S:75 R:90 A:85 D:80 |
| 5 | Tentative | `status-left-length` 30 → 40 if the clip is status-left; no change if it's window-list scroll | Screenshot alone can't distinguish the truncation source; investigation task decides <!-- assumed: widen status-left-length only after confirming it is the clipping knob --> | S:45 R:90 A:55 D:50 |

5 assumptions (1 certain, 2 confident, 2 tentative, 0 unresolved).

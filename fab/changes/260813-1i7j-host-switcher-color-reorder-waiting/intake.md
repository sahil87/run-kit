# Intake: Desktop-Shell Host-Switcher Menu — Per-Host Accent Color, Manual Reorder, Per-Host Waiting Counts

**Change**: 260813-1i7j-host-switcher-color-reorder-waiting
**Created**: 2026-08-13

## Origin

Promptless dispatch (`/fab-proceed` create-new, `{questioning-mode} = promptless-defer`) from a synthesized design-discussion capture. A visual mock was reviewed in that discussion and specific options were chosen; this intake records those decisions verbatim — no questions were asked at intake time, and every would-be question is a deferred Unresolved row in `## Assumptions`.

> **Feature: Desktop-shell host-switcher menu — per-host accent color, manual reorder, and per-host waiting counts.** The Electron desktop shell's titlebar-strip host-switcher dropdown (`app/frontend/src/components/shell-titlebar-strip.tsx`, rows built by `shellHostMenuRows` in `app/frontend/src/lib/shell-strip.ts`, data via the `servers:list` bridge projection `hostInfos` in `app/desktop/src/hosts.ts` — currently `{id, name, url, active}`) gets three enhancements: (1) a ~3px left-edge bar per row in that host's instance accent color (mock option B); (2) manual reordering via a hover drag grip (option E) plus ⌥↑/⌥↓ keyboard move while the menu is open (option F), because host list order IS the ⌥⌘1–9 / ⇧Ctrl+1–9 accelerator map; (3) each background host's row shows its cached waiting-agent count as an amber `● N`.

## Why

1. **Pain point — rows are indistinguishable and order is arbitrary.** The dropdown today renders name + dimmed origin + accelerator hint. Hosts have per-instance accent identity everywhere else (each host's SPA tints its own titlebar strip via the `theme-color` meta), but the menu that switches between them carries none of it. And the list order is insertion order with no way to change it — yet **order IS the accelerator map**: ⌥⌘1–9 (mac) / ⇧Ctrl+1–9 (win/linux) bind by index over the hosts array, in both the native Hosts menu and the dropdown's trailing hints (`hostAcceleratorHint` in `shell-strip.ts`). A user cannot put their most-used host at ⌥⌘1.

2. **Consequence of not fixing.** Multi-host users scan text to find the right row, the muscle-memory value of the digit accelerators stays locked to registration order, and "an agent is waiting on a background host" is invisible until the user switches there — the dock badge is deliberately active-host-only, so background hosts have no attention surface at all.

3. **Why this approach.** All three legs ride existing machinery: the accent color is already observed per view (`did-change-theme-color` → `themeColor` cache in `app/desktop/src/views.ts`), the waiting count is already reported continuously per view (`badge:set` → `badgeCount` cache), and hosts.json already has the additive-optional-field pattern (`lastPath`) and the id-keyed mutator shape. Manual ordering (not auto-sort) is chosen precisely because order carries accelerator semantics — **alphabetical auto-sort was explicitly REJECTED** (it silently remaps accelerators when a host is added/renamed). Rejected color treatments: dot (A — implied by mock set), tinted name (C — collides with the "active row = accent-green text" convention), row wash (D — too loud, ambiguous hover). Option B rhymes with the strip itself, costs zero width, and doesn't conflict with the ✓ active-marker column.

## What Changes

### 1. Host color — left-edge bar (option B)

- Each host row in the dropdown shows a **~3px left-edge bar** in that host's instance accent color — the same value that tints its titlebar strip (the SPA's `theme-color` meta, accent-blended).
- **Persistence**: a new `accentColor` field in `hosts.json`, as an **additive optional field** exactly like `lastPath` — per-field tolerance: absent → entry loads unchanged; string → kept; wrong type → field dropped, entry still loads. **NO schema version bump** (`version` stays `1`; absence is a valid state).
- **Capture**: shell-side, from each view's `did-change-theme-color` reports. The view registry (`app/desktop/src/views.ts`) already caches per-view `themeColor` via `setViewThemeColor` (wired at `main.ts` `contents.on("did-change-theme-color", …)`); persistence makes colors survive cold start and cover hosts not yet visited *in this run* but visited in a previous one. A host never visited at all has no color → no bar.
- **Projection**: extend `hostInfos` / the `servers:list` payload to carry `accentColor` (optional string alongside `{id, name, url, active}`).
- **Rendering**: `shellHostMenuRows` adds the color to `ShellHostMenuRow`; the strip component renders the bar. Hex-validate before style interpolation (the `fallbackStripCss` precedent in `app/desktop/src/strip.ts`); an invalid value renders no bar.
- **Older-shell degradation**: the SPA renders no bar when the field is absent from the projection — mirrors the existing `canAddShellHost` optional-capability pattern in `app/frontend/src/lib/shell.ts`.

### 2. Sorting — drag grip + keyboard move (options E and F together)

Governing constraint (design-critical): **host list order IS the accelerator map**. Manual ordering is therefore a feature — the user puts their most-used host at ⌥⌘1. Alphabetical auto-sort explicitly REJECTED (silently remaps accelerators).

- **E (mouse)**: a drag handle (grip) appears on row hover in the dropdown; drag to reorder — the sidebar session-reorder precedent in the SPA.
- **F (keyboard)**: ⌥↑/⌥↓ (Alt+ArrowUp/ArrowDown) while the menu is open moves the focused row up/down; the ⌥⌘N hints re-number live as the row moves so the user sees the accelerator being assigned. The strip already has a capture-phase ArrowUp/ArrowDown roving-focus handler to extend. Alt-modified arrows don't hit the macOS Option-composes-characters issue since arrows compose nothing.
- **Plumbing**:
  - One new IPC channel — `servers:reorder` with a move-by-id shape <!-- assumed at Confident: name/payload left open in discussion; move-by-id `{id, toIndex}` follows the id-keyed mutator convention --> — exposed through the preload bridge (`app/desktop/src/preload.ts`, `window.runkitShell.servers`), sender-gated like every existing `servers:*` handler.
  - An id-keyed array-move mutator in `app/desktop/src/hosts.ts` following the existing mutator shape: load → membership guard (unknown id is a no-op that writes nothing) → patch → atomic tmp-then-rename save.
  - After a reorder the shell **must rebuild the native application menu** (accelerators derive from order); the rebuild-on-host-list-change seam already exists (`rebuildMenu()` in `main.ts`).
- **Older-shell degradation**: no reorder invoker on the bridge → no grips, no ⌥↑/⌥↓ handling (same optional-invoker pattern as `canAddShellHost`).
- **Optional/deferred supplement**: command-palette reorder commands were suggested as a discoverable supplement, but the user named only E and F — treat palette commands as optional/deferred (see Open Questions / Assumptions #16).

### 3. Per-host waiting count

Chosen from an "extras" set; the ssh tag and an unreachable ⚠ row state were mocked but **NOT selected**.

- Each **background** host's row shows its cached waiting-agent count as an amber `● N` before the accelerator hint. **Waiting only** — matching the dock badge's "non-zero means act now" semantics (busy/idle never show).
- Data already exists shell-side: every visited host's view continuously reports its waiting count via `badge:set`, cached per view in the view registry (`badgeCount`); today only the active view's count paints the dock. Extend the `servers:list` projection to include the cached count.
- A never-visited host has no view → no count → the row shows nothing.
- **The dock badge itself stays active-host-only** — cross-host aggregation there remains a deliberate non-goal.
- **Projection join**: the projection currently reads only the hosts.json store; waiting counts live in the view registry in `main.ts` — the `servers:list` IPC handler joins the two (store list + registry `badgeCount` caches). Freshness: the menu refetches on every open (existing behavior), so an open-time snapshot of cached counts suffices.

### Explicitly rejected / out of scope

- Rename-host affordance (recorded design decision in desktop-shell memory: names auto-derive at add-time; remove+re-add is the path)
- Alphabetical auto-sort
- Color treatments A (dot) / C (tinted name) / D (row wash)
- ssh tag on rows; unreachable ⚠ row state
- Cross-host dock-badge aggregation
- Command-palette reorder commands (deferred, not selected — see Assumptions)

## Affected Memory

- `run-kit/desktop-shell`: (modify) hosts.json gains the additive `accentColor` field (lastPath-style tolerance); new id-keyed reorder mutator; `hostInfos`/`servers:list` projection extended (accentColor + waiting count via registry join); new `servers:reorder` IPC channel + preload bridge entry; theme-color persistence seam; menu rebuild after reorder
- `run-kit/ui-patterns`: (modify) titlebar-strip host-switcher dropdown — accent edge bar, amber waiting count, drag-grip + Alt-arrow reorder with live hint re-numbering, capability-gated degradation

## Impact

- `app/desktop/src/hosts.ts` (+ `hosts.test.ts`): `accentColor` field tolerance, reorder/move mutator, `hostInfos` projection changes
- `app/desktop/src/main.ts`: accentColor capture/persist on `did-change-theme-color`, `servers:reorder` IPC handler + sender gating, `servers:list` projection join with view-registry badge counts, native-menu rebuild after reorder
- `app/desktop/src/preload.ts`: bridge addition (reorder invoker; new projection fields ride the existing `servers:list`)
- `app/frontend/src/lib/shell.ts` / `shell-strip.ts` (+ tests): `ShellServer` type extension, row model (color, waitingCount), capability detection for reorder
- `app/frontend/src/components/shell-titlebar-strip.tsx` (+ `.test.tsx`): edge bar, waiting count, drag-grip reorder, ⌥↑/⌥↓ handling with live hint re-numbering
- **Tests**: desktop modules run via `node --test` over compiled electron-free modules; frontend via Vitest (`just test-frontend`). The strip renders only inside the Electron shell, so Playwright e2e is not applicable (existing precedent: `shell-titlebar-strip.test.tsx` unit coverage).
- No backend (Go) changes; no new routes; no database (Constitution II untouched — hosts.json is the desktop shell's own store, an established exception outside the rk server).

## Open Questions

- Should the command-palette reorder commands (the discoverable supplement to E/F) ship in this change, or be dropped/deferred to a follow-up? The user named only E and F; the palette supplement was left "optional/deferred". (Deferred — promptless dispatch; see Assumptions #16.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Host color renders as a ~3px left-edge bar (mock option B), colored by the host's instance accent — the same `theme-color`-meta value that tints its titlebar strip | Discussed — user chose B over dot/tinted-name/row-wash with explicit rationale (rhymes with strip, zero width cost, no ✓-column conflict) | S:95 R:85 A:90 D:95 |
| 2 | Certain | `accentColor` persists in hosts.json as an additive optional field with lastPath-style per-field tolerance (absent → unchanged, string → kept, wrong type → dropped, entry still loads); NO schema version bump | Discussed — plumbing decided verbatim; matches the established `lastPath`/`remote` additive-field pattern | S:95 R:80 A:95 D:95 |
| 3 | Certain | Capture is shell-side from `did-change-theme-color` (view registry already caches per-view `themeColor`); persistence exists to survive cold start and cover previously-visited hosts; a never-visited host shows no bar | Discussed — capture seam named in the design; registry cache verified in views.ts/main.ts | S:90 R:80 A:90 D:90 |
| 4 | Certain | The `hostInfos` / `servers:list` projection is extended to carry `accentColor` and the cached waiting count (no new list channel) | Discussed — "extend the hostInfos projection / servers:list payload"; projection verified at hosts.ts:237 | S:90 R:80 A:90 D:90 |
| 5 | Certain | Reorder ships as drag grip on row hover (E) + Alt-arrow keyboard move while menu open (F); alphabetical auto-sort REJECTED because host list order IS the ⌥⌘1–9/⇧Ctrl+1–9 accelerator map | Discussed — user named E and F; governing constraint stated as design-critical | S:95 R:75 A:90 D:95 |
| 6 | Certain | After a reorder the shell rebuilds the native application menu (accelerators derive from order) via the existing rebuild-on-host-list-change seam | Discussed — named explicitly; `rebuildMenu()` seam verified in main.ts | S:90 R:80 A:95 D:90 |
| 7 | Certain | Waiting count shows on background host rows as amber `● N` before the accelerator hint, waiting-only semantics; dock badge stays active-host-only; never-visited host (no view) shows nothing | Discussed — chosen from the extras set with mock; aggregation non-goal restated | S:95 R:85 A:90 D:90 |
| 8 | Certain | Older-shell degradation follows the optional-capability pattern: absent `accentColor` field → no bar; absent reorder invoker on the bridge → no grips, no Alt-arrow handling | Discussed — mirrors `canAddShellHost` precedent (shell.ts:149) | S:90 R:85 A:95 D:90 |
| 9 | Certain | Out of scope: rename-host affordance, alphabetical auto-sort, color options A/C/D, ssh tag, unreachable ⚠ row state | Discussed — explicitly rejected list; rename rejection is already a recorded desktop-shell design decision | S:95 R:90 A:90 D:95 |
| 10 | Confident | New IPC channel is `servers:reorder` with a move-by-id payload (`{id, toIndex}`), exposed under the preload `servers` group and sender-gated like existing `servers:*` handlers | Discussion left "`servers:reorder` or a move-by-id shape" open; move-by-id keys on the immutable id per the store's id-keyed-mutator rule; easily renamed pre-merge | S:60 R:85 A:85 D:70 |
| 11 | Confident | The hosts.ts mutator follows the existing id-keyed shape (load → membership guard, unknown id no-op → array move → atomic tmp-then-rename save) with out-of-range target index clamped | Shape dictated by discussion + existing `setActiveHost`/`setHostLastPath` mutators; clamp behavior is my fill | S:60 R:85 A:90 D:70 |
| 12 | Confident | Alt+ArrowUp/ArrowDown is the move chord on ALL platforms (not per-platform); each keypress commits one move (reorder invoke + live hint re-number); no wrap at list edges | Discussion gave mac notation only; Alt+arrows are safe cross-platform (no AltGr digit issue — arrows, not characters), and per-keypress commit is what makes hints re-number live | S:60 R:85 A:80 D:70 |
| 13 | Confident | Drag reorder commits on drop — one reorder invocation per drag, local row order updated optimistically during the drag | Sidebar session-reorder precedent (derive-over-store, commit at drag end); reversible UI detail | S:55 R:85 A:75 D:65 |
| 14 | Certain | `accentColor` persists only when the value actually changed (short-circuit identical writes), and the SPA hex-validates before style interpolation (no bar on invalid value) | Codebase precedent determines both: `setHostLastPath`'s unchanged-value short-circuit, `strip.ts` hex-validation before CSS interpolation | S:55 R:90 A:90 D:85 |
| 15 | Certain | Test strategy: `node --test` over compiled electron-free desktop modules (hosts, views), Vitest for shell-strip/shell/component; NO Playwright e2e (strip renders only in-shell) | Config/context determine this — established split, `shell-titlebar-strip.test.tsx` precedent | S:70 R:90 A:95 D:90 |
| 16 | Unresolved | Command-palette reorder commands (discoverable supplement to E/F): excluded from this change's required scope; ship-or-drop decision left to the user | Deferred — promptless dispatch (user named only E and F; the palette supplement was suggested but not selected) | S:45 R:90 A:60 D:50 |

16 assumptions (11 certain, 4 confident, 0 tentative, 1 unresolved).

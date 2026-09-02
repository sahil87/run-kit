# Intake: Web-Tab Strip Rework — Draft Tabs, Reorder, Richer Chrome

**Change**: 260901-s36e-web-tab-strip-drafts-reorder
**Created**: 2026-09-01

## Origin

Promptless dispatch (`/fab-proceed` create-new path) from a discussion session. The description below was synthesized in that session and is the sole source; an interactive HTML mock of the full design was built and approved by the user ("all good") — copied into this change folder as `web-tab-strip-design-study.html` (the 260819-v6y4 `web-tile-chrome-design-study.html` precedent). This is a NEW increment on top of the completed change 260828-9kip-web-tab-strip, not a resume.

> Feature: web-tab strip rework — Chrome-style draft tabs, tab reordering, richer tab chrome. Client-side draft tabs for the empty-tab flow (NOT a stored sentinel URL); a new reorder verb (backend move + CLI mv + pointer drag / keyboard / palette); always-visible strip at ≥1 tab; page titles, favicons, and per-tab load spinners on the tabs; Chrome muscle-memory gestures (middle-click close, double-click-empty-space new draft).

## Why

Three user-stated problems with the shipped web-tab strip (260828-9kip):

1. **Cannot open multiple empty tabs Chrome-style.** `web add` requires a resolvable target, so from a 0–1-tab window the only path to a second tab is the palette's `Web: New tab from address` or the address bar's one-shot "arm" mode — an invisible mode switch, nothing like the browser gesture users reach for. Without a fix, the multi-tab feature stays undiscoverable and awkward for its primary interactive audience.
2. **No way to reorder tabs.** Slot index IS position; no move verb exists anywhere (backend, CLI, or UI). Tabs land in add order forever; the only "reorder" is remove + re-add, which loses the `?v=` cache-buster state and renumbers everything.
3. **The strip is spartan.** URL-derived labels only (`webTabTitle(url)`), no page titles, no favicons, and the strip hides at n=1 — so the `+` affordance is unreachable until you already have two tabs, a chicken-and-egg discoverability hole.

**Why drafts over a stored sentinel** (decided in discussion): a stored blank tab (`about:blank` / `/newtab` sentinel) fights three spec decisions at once — identity-is-the-URL (two blanks collide with idempotent add), "absent and empty read alike as unset" (an empty option value cannot exist), and "declared only". A draft is viewer-local UI state — the One Rule (`docs/specs/ui-state.md` § The One Rule) classes drafts as viewer preferences, exactly like compose drafts. The sentinel alternative was rejected: it would need an idempotence exemption and makes blanks shared state with no shared content.

## What Changes

### 1. Client-side draft tabs (the empty-tab flow)

Viewer-local "new tab" entries in the strip — never POSTed, never in tmux options:

- **Entry points**: the strip's `+`, double-click on empty strip space (§5), and the palette entry (§6). Opening a draft appends a dashed "new tab" tab to the strip and focuses/arms the address bar for it.
- **Materialize**: Enter in the address bar (while a draft is selected) calls the existing add verb (`onAddTab` → `POST /api/windows/{windowId}/web`, server-assigned slot) then selects the resolved index (the existing client-selects-after-add rule). The draft is removed once the add resolves.
- **Discard**: Esc, or the draft's own ×. Multiple concurrent drafts are allowed.
- **Render order**: drafts render after all real tabs.
- **Retirement**: the existing one-shot NEW-TAB arm mode on the address bar — and its `web-address:focus` `detail.newTab` plumbing (`WEB_ADDRESS_FOCUS_EVENT` in `lib/web-url.ts`, the arm/disarm logic in `iframe-window.tsx`, the `+`-with-empty-draft arm branch) — is replaced by the draft mechanism and removed.
- Drafts live per window (keyed like the store's `webOverride` entries) and are dropped on window switch/unmount — they are ephemeral viewer posture, not durable state.
- At 0 tabs the onboarding state remains as shipped; the `+`-equivalent entry there is the onboarding address bar itself (unchanged — typing an address boots the tile via the slot-1 write).

### 2. Always-visible strip

Retire the hidden-at-n=1 rule (`tabs.length >= 2` in `iframe-window.tsx` § Web tab strip): the strip renders whenever `tabs.length >= 1` **or any draft exists**. Onboarding (empty family, no drafts) keeps today's stripless chrome. This makes `+` always reachable from any window with at least one tab. The spec's "hidden at n = 1, today's chrome unchanged" line (`docs/specs/ui-state.md` § Web Tabs, Rendering) updates to match.

### 3. Reorder verb — backend, CLI, frontend

**Backend** — new verb alongside add/rm/select in `app/backend/api/windows_web.go` + `app/backend/internal/tmux/webtabs.go`:

```
POST /api/windows/{windowId}/web/{n}/move    body: {"to": m}
```

- POST-only per Constitution IX; route registered beside the existing three in `api/router.go` (currently lines 763–766).
- Permutes the `@rk_win_web_<n>` URL values AND their `_<n>_root` companions (the same paired handling `shiftWebTabs` does for remove); repoints `@rk_win_web_active` to follow the moved/affected slots (active follows the tab's identity, not its old index — the `repointActive` companion logic).
- Slots stay dense and 1-based; out-of-range `n` or `to` → the existing `ErrWebTabRange` 400 shape. `n == to` is a no-op success.
- The POST handler wakes the SSE hub like the sibling verbs (user-option mutations emit no control-mode event).

**CLI** — twin verb in `app/backend/cmd/rk/tab_web.go`:

```
rk tab web mv <n> <m>            # bare index on the caller's tab
rk tab web mv @N/web/<n> <m>     # full address grammar, same as rm/select
rk tab web mv web/<n> <m>
```

Thin like its siblings: resolve address → tmux writes → print resulting address on stdout. Works with `rk serve` down. New CLI surface — check against `shll standards` (help-dump, Principle 9) per Constitution Toolkit Standards before ship.

**Frontend** — three reorder surfaces (Constitution V parity):

- (a) **Pointer drag-to-reorder** on the strip with a drop-side indicator (drop-target edge highlight per the approved mock).
- (b) **Keyboard move-tab-left/right on the focused tablist**: ⌥⇧←/⌥⇧→ as component-local keys in the strip's existing roving-tablist keydown handler (beside ←/→/Home/End/Enter/Delete). Verified against the keybinding registry: no existing claim conflicts, and the registry **cannot** host Alt chords at all — `matchesCombo` rejects `e.altKey` and `lib/keybindings.ts`'s header declares Alt "no tier" (macOS character composition); component-local is the same tier-exempt territory the Alt+1–9 shell switcher uses, and arrows compose no characters.
- (c) **Palette entries** `Web: Move tab left` / `Web: Move tab right` in `lib/palette/web-tabs.ts` (`buildWebTabActions`), present at ≥2 tabs like the next/prev/close entries.
- **Optimistic move** rides the existing `webOverride` machinery in `surface-layout.tsx` exactly like select/remove: a pure `webFamilyAfterMove(tabs, active, n, to)` display mirror, compounding on in-flight overrides, SSE reconcile clears, rejection reverts + toasts.

### 4. Richer tab chrome

- **Page titles**: extend the existing active-frame-only `onPageMeta` seam so ALL same-origin frames report their document title per-frame (the per-tab `WebFrame` already owns frame-scoped state; titles land in the URL-keyed chrome-state map). Tab labels show the tracked document title, falling back to today's `webTabTitle(url)`. Titles stay display-only — never written to tmux (spec § Addressing Grammar: "Titles are derived from the page and are display-only").
- **Favicons**: same-origin frames read the document's icon `<link>`; external tabs try `https://{host}/favicon.ico`; the `classifyAddress` kind-dot (green present / amber proxy / blue external) remains the fallback for missing/failed icons and for kinds without one.
- **Per-tab load spinner**: while a frame loads, its tab shows a spinner in the icon slot (per-frame load state already exists in `WebFrame` for the progress line); reduced-motion gets a static treatment per the project's motion rules.

### 5. Chrome muscle-memory gestures

- **Middle-click** (`auxclick`, button 1) on a tab closes it (same path as the × — `onCloseTab`).
- **Double-click on empty strip space** opens a draft (§1).

### 6. Palette + retirement wiring

`Web: New tab from address` is replaced by a draft-opening entry (label `Web: New tab`), offered whenever the web tile is open and the family is non-empty (the draft path needs the strip; at 0 tabs onboarding's address bar is the entry). The `detail.newTab` arm plumbing dies with the arm mode (§1). Existing entries (`Web: Next/Previous tab`, `Web: Close tab`) unchanged.

### Held invariants (explicitly NOT changed)

- Identity stays the URL; add stays idempotent (re-add returns the existing index, bumps `?v=` for file/dir kinds).
- Slots dense, 1-based, cap 8 — a cap raise was discussed and deliberately left OUT of scope.
- One iframe per tab, hidden never unmounted, keyed by URL; a move permutes strip order only — no frame remounts (keys are URLs, not indices).
- `rk tab web add` and agent flows unchanged; no new tmux options (drafts are client-side; move permutes existing values).
- POST-only verbs (Constitution IX), tmux-derived state (II), keyboard-first with palette parity (V), Playwright intent comments on new e2e tests.

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Iframe Window — strip visibility rule (≥1 or draft), draft-tab mechanism + arm-mode retirement, reorder surfaces (drag/keys/palette + optimistic move), title/favicon/spinner tab chrome, middle-click + double-click gestures
- `run-kit/ui/keyboard-and-palette`: (modify) § Command Palette Actions — `Web: New tab` replaces `Web: New tab from address`, new `Web: Move tab left/right`; note the component-local ⌥⇧←/→ tablist keys (Alt is registry-exempt territory)
- `run-kit/api-and-sockets`: (modify) web-tab verb routes gain `/web/{n}/move`
- `run-kit/tmux-sessions`: (modify) only if the `@rk_win_web_<n>` family section enumerates verbs — the option registry itself is unchanged (no new options)
- `run-kit/toolkit-standards`: (modify) `rk tab web mv` joins the CLI-surface conformance posture (help-dump / Principle 9 sweep over `tab`)

## Impact

- **Backend**: `app/backend/api/windows_web.go` (move handler), `app/backend/api/router.go` (route), `app/backend/internal/tmux/webtabs.go` (`WebMove` + permute/repoint helpers beside `WebAdd`/`WebRemove`/`WebSelect`/`shiftWebTabs`/`repointActive`), Go tests alongside.
- **CLI**: `app/backend/cmd/rk/tab_web.go` (mv subcommand), `tab_test.go`.
- **Frontend**: `components/iframe-window.tsx` (strip visibility, drafts, drag, gestures, chrome), `components/surface-layout.tsx` (move wiring + `webOverride` optimistic move), `lib/web-url.ts` (arm-event plumbing removal), `lib/palette/web-tabs.ts` (+ tests), window store `webOverride` shape if move needs it, `app.tsx` palette registration.
- **e2e**: extend `app/frontend/tests/e2e/web-tabs.spec.ts` (drafts, reorder via drag + keys + palette, middle-click, always-visible strip, title/favicon fallback) with Constitution Test Intent comments.
- **Specs** (human-curated; update as part of this change): `docs/specs/ui-state.md` § Web Tabs (strip-visibility rule, move semantics, a draft-tab note distinguishing viewer-local drafts from declared tabs) and § `rk tab` (the `mv` row).
- **Design artifact**: `web-tab-strip-design-study.html` in this change folder is the approved reference for all UI states.

## Open Questions

None — every decision point was either resolved in the discussion session (mock approved) or carries a stated default recorded in Assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Draft tabs are client-side viewer-local UI state, not a stored sentinel URL | Discussed and decided — sentinel fights identity-is-URL, empty-reads-unset, and declared-only at once; One Rule classes drafts as viewer preferences; mock approved | S:95 R:65 A:95 D:90 |
| 2 | Certain | Reorder verb is `POST /api/windows/{windowId}/web/{n}/move` body `{to: m}`, permuting URL + `_root` pairs and repointing `_active`; slots stay dense/1-based | Discussed and decided; Constitution IX fixes POST; sibling verbs fix the route/error shape | S:95 R:60 A:95 D:90 |
| 3 | Certain | CLI twin is `rk tab web mv <n> <m>` with the rm/select address grammar | Discussed and decided; grammar mirrors existing siblings verbatim | S:95 R:80 A:95 D:95 |
| 4 | Confident | Strip renders whenever `tabs.length >= 1` or a draft exists; onboarding (0 tabs, no drafts) keeps stripless chrome | Bracketed default supplied in the discussion summary for the strip-at-1 subtlety | S:75 R:80 A:80 D:70 |
| 5 | Confident | ⌥⇧←/⌥⇧→ move-tab keys are component-local on the focused tablist, not registry entries | Registry check done: no claim conflicts, but `keybindings.ts` rejects all Alt chords by design ("Alt is no tier"); the strip's roving keys are already component-local, arrows compose no characters | S:60 R:85 A:80 D:70 |
| 6 | Certain | Held invariants: URL identity, idempotent add, dense 1-based slots, cap 8 (raise out of scope), hidden-never-unmounted URL-keyed frames, agent flows unchanged | Explicitly enumerated as not-changed in the discussion | S:95 R:70 A:95 D:95 |
| 7 | Confident | NEW-TAB arm mode + `detail.newTab` plumbing retired; palette entry becomes draft-opening `Web: New tab` offered at ≥1 tab | Retirement decided; the replacement label/gating is the obvious mapping of the old entry onto the draft path | S:80 R:70 A:80 D:75 |
| 8 | Confident | Favicons: same-origin doc icon link; external `https://{host}/favicon.ico`; kind-dot is the fallback (incl. load failure) | Decided in discussion; failure fallback is the only added inference; no new external exposure — external frames already mount eagerly | S:80 R:80 A:70 D:70 |
| 9 | Certain | Titles: `onPageMeta` seam extended per-frame to all same-origin frames; label falls back to `webTabTitle(url)`; display-only, never POSTed | Decided in discussion; spec fixes titles as display-only | S:90 R:75 A:90 D:85 |
| 10 | Certain | Middle-click (auxclick button 1) closes a tab; double-click on empty strip space opens a draft | Decided in discussion, in the approved mock | S:95 R:85 A:90 D:95 |
| 11 | Certain | Optimistic move rides the existing `webOverride` machinery like select/remove (pure display mirror, compound on in-flight, SSE reconcile) | Decided in discussion; the machinery and its rules already exist | S:90 R:75 A:90 D:85 |
| 12 | Confident | Draft lifetime: per-window viewer state, dropped on window switch/unmount; Enter materializes the currently selected draft; each draft's × discards only itself | Mock shows the behavior; the `webOverride` window-switch drop is the store precedent for the lifetime rule | S:55 R:80 A:70 D:60 |
| 13 | Confident | At 0 tabs no draft entry point exists — onboarding's address bar is the sole entry (palette `Web: New tab` gates on ≥1 tab) | Discussion states the 0-tab entry is the address bar, unchanged; keeps onboarding stripless per row 4 | S:60 R:80 A:70 D:60 |
| 14 | Confident | Drag-to-reorder is pointer-event-based with a drop-side indicator | Mock approved shows the indicator; boards pane-reorder is the in-repo precedent; exact DnD mechanics are apply's call | S:70 R:80 A:75 D:70 |
| 15 | Certain | Per-tab load spinner derives from `WebFrame`'s existing per-frame load state; static under reduced motion | Decided in discussion; the state already exists per-frame; project motion rules fix the reduced-motion form | S:85 R:85 A:85 D:80 |

15 assumptions (8 certain, 7 confident, 0 tentative, 0 unresolved).

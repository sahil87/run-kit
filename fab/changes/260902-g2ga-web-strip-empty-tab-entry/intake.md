# Intake: Web Tile Empty-Tab Entry Points

**Change**: 260902-g2ga-web-strip-empty-tab-entry
**Created**: 2026-09-02

## Origin

Synthesized from a live conversation (promptless dispatch via /fab-proceed; no questions asked). User report, with screenshot, against the just-merged 260901-s36e-web-tab-strip-drafts-reorder (PR #783):

> "0 tabs looks like this with no plus icon? So I can't open, say, 3 empty tabs?"

The conversation reached three explicit decisions (recorded verbatim under What Changes): (1) always render the tab strip when the web tile renders, retiring the "onboarding keeps stripless chrome" rule; (2) ungate the palette `Web: New tab` from the ≥1-tab condition; (3) leave draft mechanics untouched. This is a UX gap-fix in a shipped feature — s36e's intake explicitly assumed "at 0 tabs onboarding's address bar is the sole entry", a decision now regretted. Chrome parity requires opening multiple empty tabs from an empty state.

## Why

1. **The pain point**: the web tile's 0-tab (onboarding) state offers no way to open a draft tab. s36e shipped three draft entry points — the strip's trailing `+` (`aria-label="Add web tab from address"`), double-click on empty strip space, and palette `Web: New tab` — but all three are dead at 0 tabs: the strip only renders at `tabs.length >= 1 || drafts.length > 0` (`app/frontend/src/components/iframe-window.tsx:1197`), so the `+` and the double-click surface don't exist, and the palette entry is suppressed twice — `buildWebTabActions` returns `[]` for an empty family (`app/frontend/src/lib/palette/web-tabs.ts:30`) AND its app.tsx call-site sits inside the `hasWebUrl(effectiveWindow)` content gate (false at 0 tabs). Today's sole entry at 0 tabs is the onboarding reduced URL bar: type an address + Enter boots slot 1 directly. You cannot open one empty tab, let alone three.

2. **If we don't fix it**: the draft-tab feature is unreachable exactly where a browser user most expects it — the empty state. Users coming from Chrome expect `+` → empty tab → type address, repeated N times; the current state reads as a missing plus icon (the user's literal report).

3. **Why this approach**: rendering the strip unconditionally is the smallest change that revives all three shipped entry points at once — the `+` and double-click surface come back for free, and the palette needs only its gate dropped. The onboarding panel stays as the CONTENT below the strip (it describes how to fill the tile, which remains true); nothing about draft mechanics, the add verb, or the backend changes. The alternative — a special onboarding-only "open a tab" affordance — would add a fourth entry point instead of unifying on the shipped three.

## What Changes

Frontend gating + tests + docs only. Backend, API, tmux options, and `rk tab web` CLI are untouched.

### 1. Strip always renders with the web tile (`app/frontend/src/components/iframe-window.tsx`)

- Drop the render gate at line ~1197: `{(tabs.length >= 1 || drafts.length > 0) && (` — the `role="tablist"` strip renders unconditionally inside the tile. At 0 tabs and 0 drafts it shows only the trailing `+`; drafts render in it as they already do. Update the s36e comment block at ~1019 ("tab strip: renders at ≥1 tab OR any draft (onboarding keeps the …)") — the old rule is retired.
- Double-click on empty strip space (`iframe-window.tsx:1205`, `e.target === e.currentTarget → openDraftRef.current()`) works at 0 tabs for free once the strip mounts. No new code.
- The `WEB_TAB_DRAFT_EVENT` document listener is already unconditional on the mounted tile (`iframe-window.tsx:791-793`) — no change needed for the event path.
- **Onboarding panel remains the content state, not chrome**: `onboarding = tabs.length === 0` (line 521) and the content ternary at ~1614 are unchanged. While the family is empty the content area shows the onboarding panel — including with drafts OPEN (selected or not); verified in shipped s36e code: the content ternary keys on `tabs.length` only, and draft selection changes the URL-bar binding (input bound to the draft, Enter materializes it via `handleSubmit`'s `selectedDraft !== null` arm at ~951), never the content area. Keep exactly that.
- **Reduced URL bar unchanged**: the `!onboarding` chrome gates (back/forward nav ~1411, ~1478, find bar ~1543, load-progress line ~1562) all stay keyed on the empty family. Typing an address + Enter with no draft selected still calls `onWriteUrl` and boots slot 1 (~951-964) — both entries coexist.
- Cap behavior unchanged: `+` disables at `tabs.length >= 8` with the `web tabs full (8)` Tip.
- Onboarding panel copy ("three ways to fill it", ~1614-1670) stays as-is — it describes content-filling paths, which remain accurate (Assumptions #8).

### 2. Ungate the palette `Web: New tab` (two seams)

The ≥1 condition lives in BOTH places (verified at c38dc5d4):

- **Builder** (`app/frontend/src/lib/palette/web-tabs.ts:30`): `if (count === 0) return [];` suppresses everything. New shape: emit the `web-tab-new` / `Web: New tab` entry unconditionally; keep every other entry count-gated exactly as today (Next/Previous/Close/Move require ≥2; move directions omitted at boundaries). Guard the `current`/`next`/`prev` wrap math so it only runs at count ≥ 1 (it currently sits above the early return). Update the builder's doc comment ("An empty family yields no entries.").
- **Call-site** (`app/frontend/src/app.tsx:3356`): the `...buildWebTabActions(...)` spread sits inside the `hasWebUrl(effectiveWindow)` content-gate ternary (~3329), which is false at 0 tabs. Move the spread out to the enclosing `windowParam && layout.order.includes("web")` level (beside `web-address` / `Web: Focus address bar`) — the builder self-gates the tab-verb entries, and `hasWebUrl` ≈ tabs ≥ 1 was redundant for them. `Web: Find in page` and the `Web: Zoom *` group stay content-gated on `hasWebUrl` as before. Update the adjacent gating comments.

Result: `Web: New tab` is offered whenever the web tile is open, including an empty family; it dispatches `WEB_TAB_DRAFT_EVENT` as today and the mounted (onboarding) tile appends + focuses a draft.

### 3. Draft mechanics unchanged (held from s36e)

Multiple drafts may be opened from 0; Enter materializes one at a time — the first landing slot 1 via the ordinary add verb (`onAddTab` → `POST …/web`) followed by the select POST; add idempotence may return an existing slot; Esc/× discards a draft without a POST; drafts stay viewer-local and never touch tmux. No code change to any of this.

### 4. Tests

- **e2e `app/frontend/tests/e2e/web-tabs.spec.ts`**: the test at :109 ("always-visible strip at ≥1 tab; onboarding stays stripless") — its second scenario (0-tab window → `web-tab-strip` count 0, onboarding visible) flips to assert the strip AND `web-tab-add` (`+`) render at 0 tabs with the onboarding panel still visible below. Add a new case proving 2–3 drafts opened from a 0-tab window (via `+` and/or palette) and sequential materialization landing dense slots 1..n in the real tmux family. Both carry the mandatory Test Intent JSDoc (Proves/Steps, constitution § Test Intent Comments); update the pre-existing file-header prose where it states the old rule.
- **Unit `app/frontend/src/components/iframe-window.test.tsx`**: :765 ("no strip at onboarding (0 tabs, no drafts); the URL-bar row DOM stays as-is") flips to strip-present at 0 tabs; the onboarding-branch describe (~670) gains/updates coverage that the onboarding panel still renders WITH the strip mounted; the strip-order assertions (strip is the wrapper's first child) hold at 0 tabs.
- **Unit `app/frontend/src/lib/palette/web-tabs.test.ts`**: :33 ("offers nothing for an empty family (the onboarding tile)") flips to "offers only `Web: New tab` for an empty family"; the file-header comment (:9, "`Web: New tab` is offered at ≥1") updates.

### 5. Spec (in-change) + memory (hydrate)

- **`docs/specs/ui-state.md` § Web Tabs**, Rendering paragraph (:276-278): "the web tile shows its tab strip whenever at least one declared tab or viewer-local draft exists. Only onboarding (no declared tabs and no drafts) is stripless." → the strip always renders with the web tile; onboarding is the empty-family CONTENT state below the strip, not stripless chrome. The following "Draft tabs are viewer-local" paragraph does not repeat the 0-tab entry rule (verified) — touch only if wording reads stale after the Rendering edit.
- Memory updates are hydrate-stage work — see Affected Memory.

### Change type

`fix` — a UX gap in a shipped feature. If `fab status refresh` inference lands elsewhere, pin with `fab status set-change-type g2ga fix` (s36e precedent for pinning; pin to `fix` this time).

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § Iframe Window — the intro (line ~9 "an empty family with no draft selects the tile's ONBOARDING content state"), Layout (line ~11 "In the ONBOARDING state … the strip, frames, find bar … do not mount"), and § Web tab strip (line ~13 "at `tabs.length >= 1 || drafts.length > 0` … only onboarding is stripless") all state the retired rule; rewrite to strip-always + onboarding-as-content, and note the empty-family draft entry points.
- `run-kit/ui/keyboard-and-palette`: (modify) the web-tab palette paragraph (line ~283) states "an empty family yields no entries; … `Web: New tab` is offered at ≥1 declared tab" — update to New-tab-always-offered-with-open-web-tile, other entries' count gates unchanged.
- `run-kit/tmux-sessions`: (modify) verify only — the § entry-point prose (line ~354, "Its `+`, an empty-space double-click, and palette `Web: New tab` open viewer-local drafts") does not state the 0-tab restriction (verified); expected minor or no edit.

## Impact

- **Code**: `app/frontend/src/components/iframe-window.tsx` (drop one render gate + comment), `app/frontend/src/lib/palette/web-tabs.ts` (builder ungate + comment), `app/frontend/src/app.tsx` (call-site moves one gate level out + comments). No new files, no new state, no new events.
- **Tests**: `app/frontend/tests/e2e/web-tabs.spec.ts`, `app/frontend/src/components/iframe-window.test.tsx`, `app/frontend/src/lib/palette/web-tabs.test.ts`.
- **Docs**: `docs/specs/ui-state.md` (in-change); three memory files (hydrate).
- **Untouched**: backend (all gates are frontend — verified), URL identity, idempotent add, dense 1-based slots, cap 8, hidden-never-unmounted URL-keyed frames, no new tmux options, `rk tab web` CLI, POST-only verbs, optimistic select/remove/move machinery.
- **Risk**: low. The one behavior seam to watch is the strip as a `role="tablist"` containing zero `role="tab"` entries at 0 tabs/0 drafts (only the `+` button) — roving-focus code must not assume a selected tab exists (drafts already render alongside as non-declared entries, so the code paths largely exist; Assumptions #9).

## Open Questions

- None — all decision points were resolved in the originating conversation (promptless dispatch; nothing scored low enough to defer).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Strip renders unconditionally whenever the web tile renders; at 0 tabs it shows only the `+` (plus any drafts). The "onboarding keeps stripless chrome" rule is retired everywhere it is documented. | Explicit user decision in the originating conversation | S:95 R:85 A:95 D:95 |
| 2 | Certain | Palette `Web: New tab` is offered whenever the web tile is open, including an empty family; other web-tab entries keep their count gates. | Explicit user decision; availability-idiom precedent unchanged for the rest | S:95 R:90 A:95 D:95 |
| 3 | Certain | Draft mechanics unchanged: multiple drafts from 0, Enter materializes one at a time via the ordinary add verb + select (first lands slot 1), Esc/× discards, drafts viewer-local. | Explicit user decision; verified shipped s36e code paths need no change | S:90 R:85 A:95 D:95 |
| 4 | Certain | Backend untouched — this is frontend gating + tests + docs. | Verified at c38dc5d4: every suppressing gate is frontend (iframe-window.tsx:1197, web-tabs.ts:30, app.tsx hasWebUrl block) | S:90 R:90 A:95 D:90 |
| 5 | Certain | Onboarding reduced-URL-bar entry coexists unchanged: typing an address + Enter with no draft selected still boots slot 1. | Explicit user decision ("both entries coexist"); code path verified (handleSubmit ~951-964) | S:90 R:85 A:95 D:90 |
| 6 | Certain | The palette ungate touches TWO seams: the builder's `count === 0` early return AND moving the app.tsx call-site out of the `hasWebUrl` content gate to the layout-includes-web level. | Repo-verified — the description said "verify where the ≥1 condition actually lives"; it lives in both. Exact restructuring is apply's call | S:80 R:80 A:85 D:75 |
| 7 | Certain | Content area at 0 tabs shows the onboarding panel regardless of draft presence or selection; draft selection changes only the URL-bar binding. | Verified s36e behavior (content ternary keys on `tabs.length === 0` alone); description says keep whatever s36e shipped | S:80 R:80 A:85 D:80 |
| 8 | Confident | Onboarding panel copy stays unchanged (no fourth "click +" row). | Panel describes content-filling paths, which stay accurate; copy edits are out of the agreed scope | S:70 R:90 A:75 D:70 |
| 9 | Confident | The empty strip's a11y shape (a `role="tablist"` with zero `role="tab"` children, only the `+` button) is acceptable as-is; apply adjusts aria only if the roving-focus/axe surface complains. | Drafts already render as non-declared strip entries so precedent exists, but an always-empty tablist is a new resting state nobody has audited | S:55 R:75 A:60 D:50 |

9 assumptions (7 certain, 2 confident, 0 tentative, 0 unresolved).

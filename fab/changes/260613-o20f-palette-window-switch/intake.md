# Intake: Palette Window Switch

**Change**: 260613-o20f-palette-window-switch
**Created**: 2026-06-13

## Origin

Sidebar improvements WAVE 1, change C (`palette-window-switch`), from backlog `[o20f]` (2026-06-13). One of three orthogonal Wave 1 changes; B and C are fully independent (only A and Wave 2 contend over `window-row.tsx`).

> Add "Window: Switch to <session › name>" command-palette entries calling `selectWindow(server,windowId)` — the palette today only mutates the current window; combined with no tree arrow-nav (Wave 3) there is no keyboard way to switch windows. Lives in `app.tsx` windowActions useMemo. Context: `docs/memory/run-kit/ui-patterns.md` "## Sidebar".

**Interaction mode**: conversational (one gap-analysis question asked and answered).

**Key decision from this session — the backlog premise was wrong, scope was corrected:**
A gap analysis before folder creation found the stated gap does **not** exist. The command palette **already** contains per-window switch entries. The `terminalActions` useMemo block (`app.tsx:1063-1070`, present since PR #34) maps every window across **every** session — not just the current one — to a `Terminal: <session>/<window.name>` palette entry whose `onSelect` calls `navigateToWindow(fw.window.windowId)`. `navigateToWindow` (`app.tsx:479-491`) already does the optimistic URL navigation **and** fires `selectWindow(server, windowId)` (plus mobile-sidebar-close). So there is already a keyboard path to switch to any window via `Cmd+K`.

The user was presented with this finding and chose **"Relabel/dedupe existing"**: drop the net-new-capability framing and the backlog's claim that this "lives in `windowActions`" (the real entries live in `terminalActions`). Scope the change to **improving the existing entries**, not duplicating them. No new `selectWindow` plumbing is added — it already exists.

## Why

1. **Problem (real, narrowed)**: the existing per-window palette entries are mislabeled and mis-grouped for discoverability. They read `Terminal: <session>/<window.name>` — the `Terminal:` prefix sorts/groups them away from the other `Window:` actions (Create, Rename, Move, Kill, Split), and a user looking to *switch windows* will not intuit that "Terminal:" is the switch verb. There is also no `(current)` affordance telling the user which window they are already on, unlike `Server: Switch to <name> (current)` (`app.tsx:1056`).
2. **Consequence if not fixed**: the keyboard-first switch path (Constitution V) is functionally present but poorly surfaced. Wave 3 (`wt1v`, arrow-key tree nav) will add the *other* keyboard path; until then the palette is the only one, so its label/grouping is the whole discoverability story. The backlog's framing ("no keyboard way to switch windows") would have led to building a **duplicate** block — two palette rows per window — which is strictly worse.
3. **Why this approach over alternatives**: relabel-in-place reuses the already-correct `navigateToWindow` plumbing (one source of truth for "switch to a window": navigate + `selectWindow` + mobile-close, and the `pendingClickRef` writeback-suppression that prevents SSE bounce-back). Building a second block calling `selectWindow` directly would (a) duplicate rows, (b) bypass `pendingClickRef` and the mobile-close, reintroducing the bounce-back the existing path already solves. Relabel is smaller, honest, and avoids regressions.

## What Changes

### Relabel the existing per-window palette entries (`app.tsx`)

The single touched block is the `terminalActions` useMemo at `app.tsx:1063-1070`. **No new block is added** (correcting the backlog, which said `windowActions` — the entries do not live there; `windowActions` at `:758-921` holds only *current-window* mutations like Create/Rename/Move/Kill/Split).

Current code:

```tsx
const terminalActions: PaletteAction[] = useMemo(
  () => flatWindows.map((fw) => ({
    id: `terminal-${fw.session}-${fw.window.windowId}`,
    label: `Terminal: ${fw.session}/${fw.window.name}`,
    onSelect: () => navigateToWindow(fw.window.windowId),
  })),
  [flatWindows, navigateToWindow],
);
```

Target behavior:

```tsx
// Per-window switch entries — one per window across every session. Reuses
// navigateToWindow (URL nav + selectWindow + mobile-close + writeback
// suppression). Renamed from the "Terminal:" prefix to group with the other
// Window: actions and surface the keyboard switch path (constitution V).
const windowSwitchActions: PaletteAction[] = useMemo(
  () => flatWindows.map((fw) => ({
    id: `window-switch-${fw.session}-${fw.window.windowId}`,
    label: `Window: Switch to ${fw.session} › ${fw.window.name}${
      fw.window.windowId === windowParam ? " (current)" : ""
    }`,
    onSelect: () => navigateToWindow(fw.window.windowId),
  })),
  [flatWindows, navigateToWindow, windowParam],
);
```

Concrete deltas:

1. **Label**: `Terminal: <session>/<window.name>` → `Window: Switch to <session> › <window.name>`. The separator is the single-character right-pointing angle `›` (U+203A) with a space on each side (`<session> › <name>`), per the backlog. This is the first use of `›` in the frontend — no existing precedent to match, so it is introduced here exactly as specified.
2. **`(current)` suffix**: append `" (current)"` when `fw.window.windowId === windowParam` (the URL's active window id). This mirrors `Server: Switch to <name> (current)` (`app.tsx:1056`, which compares `name === server`). Adds `windowParam` to the useMemo dep array. (Comparing against `windowParam` — the URL window id — is the consistent "what am I viewing" identity used throughout `app.tsx`; `currentWindow?.windowId` would be equivalent but `windowParam` needs no extra derivation and matches the alignment-key convention documented in ui-patterns § "Mount-time alignment".)
3. **`id` prefix**: `terminal-…` → `window-switch-…`. Stable, unique per (session, windowId). Keeps ids descriptive of the new grouping; no external consumer keys off the old id (grep confirms no test or other reference to `terminal-${...}` ids).
4. **Const + composition rename**: rename the binding `terminalActions` → `windowSwitchActions` and update both references in the `paletteActions` composition useMemo (`app.tsx:1072-1075`: the spread `...terminalActions` and the dep array). The block keeps its existing position in the composition order (last); ordering is not part of this change.

### Out of scope (explicit)

- **No new `selectWindow` call site** — `navigateToWindow` already wraps it.
- **No `windowActions` edits** — that block is current-window-only and untouched.
- **No arrow-key tree navigation** — that is Wave 3 (`wt1v`), explicitly deferred.
- **No change to `navigateToWindow`, `flatWindows`, or `selectWindow`** themselves.
- **No cross-server switch entries** — `flatWindows` is built from `sessions` (the current server's merged sessions, `app.tsx:514-518`); switching across servers stays a `Server:`-prefixed concern.

## Affected Memory

- `run-kit/ui-patterns.md`: (modify) the `## Sidebar` section documents `navigateToWindow` / `selectWindow` behavior (lines 41–61) but does not yet enumerate the command-palette switch entries. Add a short note that the per-window switch path is surfaced as `Window: Switch to <session> › <name> (current)` palette entries built from `flatWindows`, reusing `navigateToWindow`. Low-priority doc touch; spec-level behavior (the switch mechanism) is unchanged — only its palette surface label changes.

## Impact

- **Code**: single file — `app/frontend/src/app.tsx` (the `terminalActions` → `windowSwitchActions` block ~`:1063-1070` plus its two references in `paletteActions` ~`:1072-1075`).
- **Tests**: no existing unit/e2e coverage references these palette entries (grep of `app.test.tsx` for `Terminal:` / `terminalActions` / `Switch to` returns nothing). A focused unit test SHOULD be added asserting the relabeled entries: presence of one `Window: Switch to …` entry per window, the `›` separator, and the `(current)` suffix on the active window. (`app.test.tsx` is a unit test — exempt from the `.spec.md` companion rule; that rule covers Playwright `*.spec.ts` only.)
- **APIs / backend**: none. `selectWindow` (`client.ts:281`, `POST /api/windows/{windowId}/select`) is unchanged.
- **Constitution**: advances V (Keyboard-First) — improves palette discoverability of the switch action. Minimal Surface Area (IV) preserved: no new routes/pages; relabel only.
- **Coordination**: orthogonal to Wave 1 A and B. Touches only `app.tsx`; A/B touch `window-row.tsx`/`shell.tsx`/`sidebar/index.tsx`. No rebase contention.

## Open Questions

- None blocking. (The label format, separator, `(current)` rule, and dedupe-vs-duplicate scope were all resolved in this session's gap analysis.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Scope is relabel/dedupe the existing `terminalActions` entries, NOT a net-new block — the palette already switches windows via `navigateToWindow`→`selectWindow`. | User was shown the gap-analysis finding (existing `terminalActions` since PR #34) and explicitly chose "Relabel/dedupe existing" this session. | S:98 R:80 A:95 D:95 |
| 2 | Certain | Reuse `navigateToWindow` rather than calling `selectWindow` directly — it already wraps selectWindow + URL nav + mobile-close + pendingClickRef writeback-suppression. | Code-verified (`app.tsx:479-491`); duplicating the call would bypass bounce-back suppression and mobile-close. | S:95 R:85 A:95 D:90 |
| 3 | Confident | Label = `Window: Switch to <session> › <name>`, `›` = U+203A with surrounding spaces, `(current)` suffix on the URL-active window. | Backlog specifies the label + separator verbatim; `(current)` mirrors `Server: Switch …(current)` (`app.tsx:1056`). `›` is new to the frontend but explicitly requested — no precedent to reconcile. | S:80 R:90 A:75 D:85 |
| 4 | Confident | The block lives in `terminalActions` (`:1063-1070`), not `windowActions` as the backlog stated — relabel/rename in place to `windowSwitchActions`. | Code-verified: `windowActions` (`:758-921`) is current-window-only; the per-window entries are `terminalActions`. Backlog's "lives in windowActions useMemo" is inaccurate. | S:75 R:85 A:90 D:85 |
| 5 | Confident | Add a focused unit test in `app.test.tsx` for the relabeled entries (one per window, `›` separator, `(current)` on active). | No existing coverage; code-quality + project test conventions favor asserting user-visible label behavior. Reversible/cheap; one obvious shape. | S:60 R:90 A:80 D:80 |
| 6 | Confident | `(current)` compares `fw.window.windowId === windowParam` (URL window id), not `currentWindow?.windowId`. | `windowParam` is the canonical "what am I viewing" id used for alignment keys (ui-patterns § Mount-time alignment); equivalent to `currentWindow?.windowId` but needs no extra derivation. | S:70 R:90 A:80 D:75 |

6 assumptions (2 certain, 4 confident, 0 tentative, 0 unresolved).

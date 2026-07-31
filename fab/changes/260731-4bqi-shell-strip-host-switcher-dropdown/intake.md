# Intake: Host-Switcher Dropdown in the Desktop Shell Titlebar Strip

**Change**: 260731-4bqi-shell-strip-host-switcher-dropdown
**Created**: 2026-08-01

## Origin

Promptless dispatch (`/fab-proceed`-style create-intake subagent, `{questioning-mode} = promptless-defer`) from a synthesized design-conversation description. No questions were asked; every decision the conversation did not settle is recorded as a deferred Unresolved row in `## Assumptions`.

> Host-switcher dropdown in the desktop shell's titlebar strip — make the SPA-drawn 28px titlebar strip's centered host-name label a clickable dropdown for quick mouse-driven switching between registered hosts in the Electron viewer shell (`app/desktop`).

Key facts from the design conversation (verified against `docs/memory/run-kit/desktop-shell.md`, `docs/memory/run-kit/ui-patterns.md` § Desktop-Shell Titlebar Strip, and the source):

- The strip is rendered by the SPA (`app/frontend/src/components/shell-titlebar-strip.tsx` + `app/frontend/src/lib/shell-strip.ts`), mounted in `AppLayout` gated on `isShell()`. It already fetches the host list once on mount via `listShellServers()` (bridge `servers.list()`) to render the centered active-host display name, and the bridge already exposes `switchShellServer(id)` (`servers.switch`), which routes through the shell's single `switchToHost` seam in `app/desktop/src/main.ts` (lastPath capture → set active → loadURL → menu rebuild). **The core feature needs zero new IPC channels and zero main-process changes — it is SPA-side UI.**
- The strip band is a drag surface: the whole band carries `.rk-shell-drag` (`-webkit-app-region: drag` via a CSS utility class in `globals.css`) and today deliberately holds **no interactive elements** (a documented design decision in both memory files). This change deliberately reverses that decision in a scoped way — the reversal is recorded in memory at hydrate time.

## Why

1. **The pain point**: switching hosts in the Electron viewer shell is keyboard/menu-only today — the ⌥⌘1–9 accelerators (⇧Ctrl+1–9 on win/linux), the native `Hosts` menu radios, and the command palette's `Server: Switch to "<name>"` block. There is no in-page mouse affordance where the user's eye already rests: the titlebar strip's centered host-name label, which names the window's host but does nothing when clicked.
2. **The consequence of not doing it**: mouse-driven users must detour to the native menu bar or open the palette for a two-step flow; the strip label reads as clickable chrome (it names the switchable identity) but is inert — a discoverability dead end for the shell's most identity-defining action.
3. **Why this approach**: the label is already the host's name and already fetched via the bridge; making it the dropdown trigger reuses the SPA top bar's existing `▾` switcher vocabulary (`Terminal: <window> ▾` / `Board: <board> ▾`), needs **zero new IPC** for the core feature, and keeps keyboard paths primary (Constitution V — keyboard-first, mouse secondary). The alternative of merging the whole top bar into the titlebar was previously rejected (desktop-shell memory § Design Decisions); a single scoped no-drag island on the existing strip is the minimal-surface move.

## What Changes

### 1. Trigger — the existing centered label becomes the dropdown trigger

- The centered label renders as `<active-host-name> ▾` with a subtle hover pill, reusing the SPA top bar's existing `▾` switcher vocabulary (the `Terminal: <window> ▾` / `Board: <board> ▾` pattern in `top-bar.tsx`).
- The trigger is the **only** no-drag island in the band: add a sibling CSS utility class `rk-shell-no-drag` (`-webkit-app-region: no-drag`) next to `.rk-shell-drag` in `app/frontend/src/globals.css`. It must be a class, not an inline style, because `WebkitAppRegion` is absent from React's `CSSProperties` and an inline style would need an `as` cast the code-quality rules forbid (type narrowing over `as` casts).
- The rest of the band stays a drag surface (`.rk-shell-drag` on the band is unchanged); **no broader no-drag bookkeeping** — exactly one carve-out.

### 2. Degradation gate — dropdown affordance only when the bridge can actually switch

- The dropdown affordance (chevron + click behavior + hover pill) is gated on `listShellServers()` resolving a **non-empty** list — the command palette's shell-switch block precedent (it gates on the `servers` group answering, not on `isShell()`).
- An older shell without the `servers` bridge group (exposes `version`/`platform` only) keeps today's static, non-interactive label with the `location.hostname` fallback. All bridge wrappers already never-throw (`listShellServers()` resolves `null`, `switchShellServer()` resolves `false`), so no new error handling is required.
- The strip itself stays mounted on `isShell()` in `AppLayout` — the mount gate is untouched; only the affordance inside it is bridge-gated.

### 3. Refetch on open

- The host list is **refetched every time the dropdown opens** (a fresh `listShellServers()` call), not reused from the mount-time fetch. Rationale: removing a non-active host via the native `Hosts → Remove "<name>"…` menu mutates the list without a page reload, so a mount-time-only list can go stale. The mount-time fetch stays as-is for the label + gate.

### 4. Menu row anatomy (per the approved mock)

Each row in the open menu shows:

- **Active marker**: the active host marked with ✓ and accent color.
- **Display name + dimmed origin**: the host display name plus the dimmed origin (from the entry's `url`). Host names are not unique in the store — `addHost` never dedupes — so the origin disambiguates. The bridge's `servers:list` projection already returns `{ id, name, url, active }` (`ShellServer` in `app/frontend/src/lib/shell.ts`), so hints and origins need **no bridge change**.
- **Trailing accelerator hints** mirroring the native Hosts menu bindings: ⌥⌘1–9 on mac, ⇧Ctrl+1–9 on win/linux, capped at 9 (the native menu's `MAX_SWITCHER_ACCELERATORS` cap — hosts beyond the ninth get no hint). Platform is read from the bridge's `platform` field (`shellInfo()`).

### 5. Selection behavior

- Selecting a host calls `switchShellServer(id)`; the page swaps via the shell's `switchToHost` seam (lastPath capture/restore comes for free — no SPA-side path handling).
- **No optimistic UI** — the whole page navigates, so there is nothing to optimistically update.

### 6. Keyboard posture

- Keyboard paths (⌥⌘1–9 / ⇧Ctrl+1–9, palette `Server: Switch to`) remain primary; this adds the missing mouse-secondary affordance (Constitution V).
- The dropdown itself is keyboard-operable once open: arrow keys to move, Enter to select, Escape to close — standard menu semantics, following the existing top-bar switcher menu implementation patterns in the SPA.

### 7. Pure logic lands in `lib/shell-strip.ts`

- Menu-row derivation (rows from `ShellServer[]`: name, origin, active, hint), the gate predicate (non-empty list ⇒ interactive), and the accelerator-hint mapping (platform → per-index hint string, 9-cap) are pure functions in `app/frontend/src/lib/shell-strip.ts` beside `activeShellHostName`/`stripInsets`/`stripLabelColor`, covered by the colocated vitest suite.

### Constraints (unchanged invariants)

- Strip stays 28px (`SHELL_STRIP_HEIGHT_PX`); keeps the `rk-shell-strip` marker class on `<html>` (version-skew fallback CSS keys off it); keeps the darwin symmetric 80px insets / `titlebar-area-*` env insets so the label and trigger stay clear of OS window controls.
- The frozen bridge contract (`servers` group naming, `servers:list`/`servers:switch` channel names, envelope shape) is untouched.
- Frontend code-quality: type narrowing over `as` casts; follow existing popover/menu patterns in the SPA (top-bar switcher menus).
- `isShell()` is false in Playwright, so **no e2e can cover the strip** — verification is vitest for the pure logic in `lib/shell-strip.ts` plus manual verification in the actual shell. (The Test Companion Docs constitution rule is moot — no new `.spec.ts`.)

### Out of scope unless the deferred decision below resolves to include it

- `+ Add Host…` footer item (shown in the mock). Add Host is main-process-owned (the native menu's `onAddHost` navigates to the welcome page `?mode=add`) and the `servers` bridge group has no add channel — including the footer requires ONE new sender-gated IPC channel routed to the same main-side `onAddHost` path; excluding it keeps the change strictly SPA-side. See Assumptions row 12.

## Affected Memory

- `run-kit/ui-patterns`: (modify) § Desktop-Shell Titlebar Strip — label becomes the dropdown trigger, dropdown anatomy (✓+accent active row, dimmed origin, accelerator hints, refetch-on-open, non-empty-list gate), and the scoped `rk-shell-no-drag` carve-out replacing "no interactive elements / no no-drag bookkeeping"; the related § Design Decisions entry is updated to record the scoped reversal.
- `run-kit/desktop-shell`: (modify) the "the whole band is a drag surface with no interactive elements" design decision is reversed in scoped form (one no-drag island: the switcher trigger); cross-reference from § Hidden Titlebar & Accent Strip.

## Impact

- `app/frontend/src/components/shell-titlebar-strip.tsx` — label → trigger + dropdown menu (the bulk of the change).
- `app/frontend/src/lib/shell-strip.ts` (+ colocated `.test.ts`) — new pure helpers: menu-row derivation, gate predicate, accelerator-hint mapping.
- `app/frontend/src/globals.css` — new `.rk-shell-no-drag` utility class beside `.rk-shell-drag`.
- No backend changes; no `app/desktop` changes for the core feature (zero new IPC). If the deferred `+ Add Host…` footer is later included, `app/desktop/src/preload.ts` + `src/main.ts` gain one sender-gated channel — that is explicitly NOT part of this intake's committed scope.
- Tests: vitest only (unit tests exempt from `.spec.md` companion rule); no Playwright coverage possible (`isShell()` false there); manual verification in the real shell is part of acceptance.

## Open Questions

- Should the dropdown include the mock's `+ Add Host…` footer item (requires one new sender-gated IPC channel to the main-side `onAddHost` path), or ship strictly SPA-side without it? (Deferred — see Assumptions row 12.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Trigger is the existing centered label rendered as `<name> ▾` with a subtle hover pill, reusing the top bar's `▾` switcher vocabulary | Discussed — decided in the design conversation; matches existing SPA pattern | S:90 R:85 A:90 D:90 |
| 2 | Certain | The trigger is the only no-drag island, via a new `rk-shell-no-drag` CSS utility class in `globals.css` (never an inline style) | Discussed — decided; inline `WebkitAppRegion` would need an `as` cast the code-quality rules forbid | S:90 R:90 A:95 D:90 |
| 3 | Certain | Host list is refetched on every dropdown open (mount-time fetch kept for label + gate) | Discussed — decided; native Hosts-menu removals mutate the list without a page reload | S:90 R:90 A:90 D:85 |
| 4 | Certain | Dropdown affordance gated on `listShellServers()` resolving non-empty; older shells keep the static label | Discussed — decided; command-palette shell-switch block precedent, wrappers never throw | S:90 R:85 A:90 D:85 |
| 5 | Certain | Menu rows: active host ✓ + accent; display name + dimmed origin (names not unique — origin disambiguates); trailing accelerator hints ⌥⌘1–9 mac / ⇧Ctrl+1–9 win-linux, capped at 9; platform from bridge `platform` | Discussed — approved mock; `servers:list` already returns `{id, name, url, active}` so no bridge change | S:85 R:80 A:85 D:85 |
| 6 | Certain | Selecting a host calls `switchShellServer(id)`; no optimistic UI (whole page navigates via `switchToHost`, lastPath free) | Discussed — decided; the single switch seam already exists | S:90 R:85 A:90 D:90 |
| 7 | Certain | Verification is vitest for pure logic in `lib/shell-strip.ts` + manual shell verification; no e2e | Discussed — `isShell()` is false in Playwright, documented constraint | S:90 R:85 A:90 D:90 |
| 8 | Certain | The scoped reversal of the "no interactive elements in the strip" design decision is recorded in both affected memory files at hydrate | Discussed — explicitly called out as part of the change | S:90 R:90 A:90 D:90 |
| 9 | Confident | Open menu is keyboard-operable (ArrowUp/ArrowDown, Enter, Escape) per standard menu semantics, following the existing top-bar switcher menu implementation | Constitution V keyboard-first; conversation named it; exact focus/roving-tabindex details follow the existing SPA menu pattern | S:70 R:80 A:75 D:70 |
| 10 | Confident | Pure logic (row derivation, gate predicate, hint mapping) lands in `lib/shell-strip.ts` beside the existing strip helpers | Existing extraction pattern for this exact component; testable without mounting | S:75 R:85 A:85 D:80 |
| 11 | Confident | Hover-pill styling and menu popover visuals follow the existing top-bar switcher menu treatment (subtle pill on hover, existing popover vocabulary); accessible naming/roles per existing menu components | "Subtle hover pill" agreed; exact classes are implementation detail resolved by following existing patterns (code-quality: follow project patterns) | S:60 R:85 A:75 D:70 |
| 12 | Unresolved | Whether the dropdown includes the mock's `+ Add Host…` footer (requires ONE new sender-gated IPC channel routed to main-side `onAddHost`) or ships strictly SPA-side without it | Deferred — promptless dispatch | S:30 R:65 A:40 D:40 |

12 assumptions (8 certain, 3 confident, 0 tentative, 1 unresolved).

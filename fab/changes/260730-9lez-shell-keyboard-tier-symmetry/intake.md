# Intake: Shell Keyboard-Tier Symmetry

**Change**: 260730-9lez-shell-keyboard-tier-symmetry
**Created**: 2026-07-30

## Origin

Conversational — emerged from a `/fab-discuss` session about porting the desktop shell (`app/desktop`, shipped in 260728-04pg) to Windows/Linux. The user set the governing principle and picked the switcher direction:

> The best case is to have symmetry between Windows - MacOS. Whatever is Cmd+\<ANY\> for Mac can be Ctrl+\<ANY\> for Windows. So keeping this in mind, Ctrl+1 / 2 aren't available to switch between servers. The switch can be done directly by the menu entry "Servers" - OR - can be Cmd/Ctrl + SHIFT + \<NUM\>. Thoughts?

The agent recommended `Shift+CmdOrCtrl+1–9` (keeping the menu radios as the mouse path) and proposed a two-tier accelerator rule; it also suggested exposing server switching through the SPA command palette via the existing `runkitShell` bridge. The user confirmed:

> yes, it can be exposed via the command palette, we should definitely do that.

Scope note: this change covers **everything except cross-platform packaging** — the accelerator migration, the tier rule, and the palette integration, all landing on the current (macOS-only) shell. The actual Windows/Linux build targets and CI are a separate change: `260730-ler1-desktop-windows-linux-packaging`, which depends on this one.

## Why

1. **The current switcher binding blocks the cross-platform premise.** The Servers switcher binds literal `Ctrl+1–9` — deliberately chosen on macOS *because* it leaves ⌘1–9 free for the page. On Windows/Linux the browser-reserved tier the shell exists to liberate is the **Ctrl** tier, so `Ctrl+1–9` would steal exactly the keys the shell's premise promises to the SPA. The binding must move before (or together with) any Windows/Linux build.
2. **The ⌘-tier seam is stated in macOS-specific terms.** The shell's key contract ("do not bind accelerators on keys the page should own"; guaranteed fall-through set includes "all unlisted ⇧⌘ combos") is written against macOS keys. Restating it platform-neutrally — as a two-tier rule expressed with `CmdOrCtrl` — makes the same accelerator table and the same documented contract valid on every platform, instead of per-platform hand-tuning.
3. **Keyboard-first demands a keyboard path everywhere (Constitution V).** Server switching should be reachable from the SPA's primary discovery mechanism, the command palette (`Cmd+K`), not only via a shell accelerator chord and a native menu. The `window.runkitShell` bridge already exists as the SPA↔shell seam; extending it is the designed-for path.

If we don't do this: the cross-platform change either ships a shell that undermines its own keyboard-first premise on Windows/Linux, or blocks on this design work anyway — and macOS users keep a switcher chord that has no discoverable palette equivalent.

## What Changes

### 1. Two-tier accelerator rule (the contract)

Replace the macOS-specific fall-through contract with a platform-neutral two-tier rule, documented in the `menu.ts` header comment (the existing home of the seam rationale):

- **Page tier — unshifted `CmdOrCtrl+<any>`**: the shell NEVER binds it, on any platform. This is the shell's premise, stated platform-neutrally. (macOS: ⌘-tier; Windows/Linux: Ctrl-tier.)
- **Shell tier — `Shift+CmdOrCtrl+<any>`**: shell chrome MAY claim keys here, sparingly. Today the only claim is the Servers switcher (1–9).

The guaranteed fall-through promise narrows accordingly: from "all unlisted ⇧⌘ combos" to "the unshifted Cmd/Ctrl tier is inviolable; the shifted tier is shell-claimable". The existing rule that a menu-bound key the SPA later needs is fixed by *un-binding the accelerator, never by intercepting input events* is unchanged.

Platform carve-outs the rule tolerates (documented alongside it, not silently violated):

- macOS Edit roles (⌘Z/⇧⌘Z/⌘X/⌘C/⌘V/⌘A) stay — clipboard in web content is dead on macOS without them. This is a macOS quirk, not part of the cross-platform rule; on Windows/Linux Chromium handles these natively and the equivalent accelerators are NOT bound (that application lands in the cross-platform change).
- View/App-menu accelerators (⌘R, ⌥⌘I, zoom roles, etc.) keep their current bindings; they are conventional shell chrome and predate the rule.

### 2. Servers switcher migration: `Ctrl+1–9` → `Shift+CmdOrCtrl+1–9` (`src/menu.ts`)

- The Servers radio items move from literal `Ctrl+1…Ctrl+9` to `Shift+CmdOrCtrl+1…9` (⇧⌘1–9 on macOS today).
- The old `Ctrl+1–9` bindings are **dropped entirely** — one accelerator table, one documented rule, no legacy alias. The feature shipped 2026-07-28; there is no meaningful muscle-memory install base to migrate.
- Menu radios remain as the mouse path — the accelerator and the menu entry are the same item, not alternatives.
- Accelerators throughout `menu.ts` are expressed with `CmdOrCtrl` (except the deliberate macOS-only carve-outs above), so the identical table is correct when the Windows/Linux build lands. Zero behavior change on macOS from this re-expression alone.

### 3. Command-palette server switching via the bridge (`src/preload.ts`, `src/main.ts`, `app/frontend/src/lib/shell.ts`, palette registration)

Extend the `window.runkitShell` bridge so the SPA palette can list and switch servers:

- **Preload**: expose a `servers` group — `list()` returning `{ id, name, url, active }[]` and `switch(id)` — as thin `ipcRenderer.invoke` wrappers (new `servers:*` channels), following the existing `__welcome` wrapper pattern.
- **Main**: `servers:list` / `servers:switch` handlers. Sender-frame gating follows the established trust-boundary pattern, with a different allowlist than `welcome:*`: these channels are privileged for **registered server origins** (the pages that host the palette) and the welcome page — any other sender gets `{ ok: false, error: "Not allowed" }`. `switch` resolves via the existing store functions (set active, rebuild menu, `loadURL`), reusing the same code path as the menu radio callback. IPC payloads structurally validated in main before use, per the existing pattern.
- **SPA** (`app/frontend/src/lib/shell.ts`): extend the structural narrowing to the new bridge surface (typed as `unknown`, narrowed by guards — no `as` casts, per the existing pattern), still never leaking `__welcome`. Update `shell.test.ts` for present/absent/malformed shapes of the new surface.
- **Palette**: register `Server: Switch to "<name>"` commands (one per registered server, active one indicated), gated on `isShell()` — outside the shell the commands are absent. This is the first real consumer of `isShell()`. Per the project review rules, the new commands are documented in the palette registration.
- Palette scope v1 is **switch only** — Add/Remove Server stay in the native menu + welcome flow.

### 4. Verify-on-hardware additions

Shifted-digit accelerators are the flakiest accelerator class (AZERTY digits already require Shift; Electron resolves accelerators by character, not scancode). Add ⇧⌘1–9 switching on a non-US layout to the existing manual verification list (alongside xterm ⌘C/⌘V interplay and ⌘-fall-through feel). No scancode workaround is attempted in v1.

## Affected Memory

- `run-kit/desktop-shell`: (modify) ⌘-tier seam section becomes the two-tier `CmdOrCtrl` rule; switcher accelerator ⌃1–9 → ⇧⌘1–9; bridge section gains the `servers` group + its origin-gating; fall-through contract narrowed; verify-on-hardware list extended
- `run-kit/ui-patterns`: (modify) command palette gains the shell-gated `Server: Switch` commands — the first `isShell()` consumer (§ Keyboard Shortcuts cross-reference)

## Impact

- `app/desktop/src/menu.ts` — accelerator table, header-comment contract
- `app/desktop/src/preload.ts` — `servers` bridge group
- `app/desktop/src/main.ts` — `servers:*` IPC handlers, sender-frame gating, switch path reuse
- `app/desktop/src/servers.ts` — possibly a small read helper; store logic otherwise unchanged
- `app/frontend/src/lib/shell.ts` + `shell.test.ts` — bridge narrowing + tests
- Frontend command-palette registration — new shell-gated commands
- Tests: node:test for any store-level additions; vitest for `shell.ts`; palette unit test if the registration file has one. Accelerator behavior and non-US layouts are hardware-verify items, not CI-testable.
- Sequencing: `260730-ler1-desktop-windows-linux-packaging` depends on this change landing first (or in the same release) — without it, Ctrl+1–9 collides with the page tier on Windows/Linux.

## Open Questions

- None blocking. (Palette Add/Remove Server, and whether the switcher should also get palette-visible ⇧⌘N hint text, are deferred as v1 scope decisions recorded in Assumptions.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Two-tier rule: page tier = unshifted `CmdOrCtrl` (never bound), shell tier = `Shift+CmdOrCtrl` (claimable sparingly) | Discussed — user set the Cmd↔Ctrl symmetry principle; the tier rule is its direct restatement | S:90 R:70 A:90 D:90 |
| 2 | Certain | Switcher chord is `Shift+CmdOrCtrl+1–9`; menu radios stay as the mouse path | Discussed — user proposed this exact option ("Cmd/Ctrl + SHIFT + \<NUM\>"); agent recommended it over menu-only (Constitution V) | S:90 R:85 A:85 D:85 |
| 3 | Confident | Old ⌃1–9 bindings dropped entirely — no legacy alias on macOS | Recommended in discussion, unchallenged; feature is days old, trivially reversible, one accelerator table is the cleaner contract | S:60 R:90 A:75 D:70 |
| 4 | Certain | Server switching exposed via the SPA command palette through the `runkitShell` bridge | Discussed — user: "we should definitely do that" | S:95 R:80 A:85 D:90 |
| 5 | Confident | Bridge shape: `servers.list()`/`servers.switch(id)` invokers, main-side sender-frame gating allowlisting registered server origins + welcome | Not discussed in detail; follows the established `__welcome` pattern and the one-authoritative-check-in-main decision | S:55 R:75 A:85 D:75 |
| 6 | Confident | Palette scope v1 is switch-only; Add/Remove Server remain menu + welcome flow | Not discussed; minimal-surface default (Constitution IV), easily extended later | S:50 R:85 A:70 D:65 |
| 7 | Confident | Non-US-layout risk handled by hardware-verify listing, no scancode workaround in v1 | Raised in discussion as a caveat to carry, not a blocker; workaround complexity unjustified before a repro | S:70 R:80 A:70 D:70 |
| 8 | Confident | All portable accelerators re-expressed as `CmdOrCtrl` now (macOS-only carve-outs stay explicit), zero mac behavior change | Direct prep for the dependent cross-platform change; inert on today's mac-only build | S:75 R:90 A:85 D:80 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).

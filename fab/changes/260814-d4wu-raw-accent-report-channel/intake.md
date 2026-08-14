# Intake: Raw Accent Report Channel

**Change**: 260814-d4wu-raw-accent-report-channel
**Created**: 2026-08-14

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a synthesized design-discussion description. The user observed the shipped host-switcher accent bars (PR #588 / change `260813-1i7j-host-switcher-color-reorder-waiting`) rendering visibly muted versus the design mock (screenshot comparison), and explicitly chose **option 1 of 2**: report the raw accent over a dedicated `accent:set` channel, keeping theme-color capture only as the older-SPA fallback. Option 2 — a render-time OKLCH chroma/lightness punch-up — was explicitly REJECTED as a symptom patch that guesses at information the blend destroyed.

> Fix: host-switcher accent bars render muted — report the raw accent over a dedicated `accent:set` channel; keep theme-color capture as the older-SPA fallback. Builds on the seams added by change 260813-1i7j (PR #588, open draft on branch `260813-1i7j-host-switcher-color-reorder-waiting`); the new branch stacks on that branch's HEAD.

## Why

1. **The pain point**: the desktop shell persists each host's `accentColor` (hosts.json) from its `did-change-theme-color` capture (`app/desktop/src/main.ts:397-403`). But the SPA's theme-color meta content is deliberately `titlebarHex` = `blendHex(accent, background, INSTANCE_TITLEBAR_RATIO)` with the ratio at **0.35** (`app/frontend/src/instance-accent.ts` — `INSTANCE_TITLEBAR_RATIO = 0.35`, applied in `deriveAccentHexes`) — a subtle window-chrome tint that is 65% background. The host-switcher menu's left-edge accent bars therefore render visibly muted compared to the design mock, which used full-strength accents. Confirmed by user screenshot comparison.
2. **If not fixed**: every host's persisted accent stays a 35% blend forever — the edge bars (the per-host identity cue in the switcher) read nearly-uniform dark instead of the distinct full-strength accents the design intends, and the gap widens on dark themes where the blend collapses toward background.
3. **Why this approach**: the blend destroys information (the raw hue/chroma cannot be recovered from a 35% mix), so the only correct fix is to report the raw value from the one place that has it — the SPA, which already derives the full-strength, contrast-guarded `stripeHex`. A dedicated report channel mirrors the proven `badge:set` shape exactly, keeps the window-overlay tint (which MUST stay the titlebar blend) untouched, and degrades cleanly: an older SPA has no reporter, so the theme-color capture remains as its fallback — a blend is still better than nothing.

## What Changes

### 1. New `accent:set` IPC channel (preload)

`app/desktop/src/preload.ts`: add an `accent` group with a `set(hex)` invoker, exactly like the existing `badge` group (`preload.ts:54-56`):

```ts
accent: {
  set: (hex: string): Promise<unknown> => ipcRenderer.invoke("accent:set", hex),
},
```

### 2. Main-side `accent:set` handler (`app/desktop/src/main.ts`)

Mirrors the `badge:set` handler (`main.ts:1249-1267`) structurally:

- **Gate**: `isHostsSender(event)` first — non-allowed senders get `{ ok: false, error: "Not allowed" }`.
- **Payload validation**: the payload MUST be a plausible hex color string — validate against the strict `#RGB`/`#RRGGBB`/`#RRGGBBAA` pattern (the same pattern `shellHostMenuRows`' SPA-side consumer validates against, and the shell-side `fallbackStripCss` hex-validation precedent in `app/desktop/src/strip.ts`). Reject anything else with `{ ok: false, error: "Invalid request" }` — the value feeds style interpolation on the SPA side.
- **Sender resolution**: `findViewByWebContentsId(views, event.sender.id)` — webContents id, never origin (several host entries can share one origin).
- **Persist**: via the **existing** `setHostAccentColor(userDataDir(), entry.hostId, hex)` mutator in `app/desktop/src/hosts.ts` — its unchanged-value short-circuit and unknown-id membership guard are already there; no store change needed.
- **Non-view senders persist nothing**: a report from the welcome page (the window's own webContents) or an allowed-but-unknown sender (a just-destroyed view's late report) is a no-op that returns `{ ok: true }` — unlike `badge:set`, there is no welcome-page direct-paint branch because there is nothing to paint.
- **The view registry's `themeColor` cache is NOT touched by this channel** — it drives the window overlay tint (`applyOverlayColor`, `switchPaint`) and must stay the titlebar blend. `accent:set` feeds ONLY the hosts.json `accentColor` field. No overlay repaint happens here.

### 3. Precedence over the theme-color fallback (`app/desktop/src/main.ts`)

Once an `accent:set` report has been received from a host's view, the `did-change-theme-color` persistence seam (added in #588, `main.ts:397-403`) MUST stop persisting `accentColor` for that host — otherwise the muted blend would overwrite the raw accent on every theme-color report.

- **Mechanism**: a main-side per-host flag map like the existing `viewLoadFailed` map (`main.ts:147`) — e.g. `rawAccentReported = new Map<string, boolean>()` keyed on host id, set by the `accent:set` handler on a successful view-resolved persist, cleared when the view is destroyed (`destroyHostView` / `destroyAllViews`, alongside the `viewLoadFailed.delete/clear` calls at `main.ts:497,508`). In-memory, not persisted: after a shell restart an early theme-color report may transiently re-persist the blend, then the SPA's `accent:set` on initial resolve overwrites it — self-healing by the same mechanism as the migration story.
- **Gating**: the theme-color seam's `setHostAccentColor` call becomes conditional on the flag being unset for that host. Hosts whose view has never sent `accent:set` keep the persistence — that IS the older-SPA fallback (an older SPA has no reporter, so its titlebar blend is still better than nothing).
- **The overlay-repaint half of the theme-color wiring is untouched**: `setViewThemeColor`, the active-view `applyOverlayColor`, and the fallback-strip refresh all stay exactly as shipped.

### 4. Frontend bridge: accent group narrowing + `setShellAccent` (`app/frontend/src/lib/shell.ts` + `shell.test.ts`)

Follow the `badgeBridge`/`setShellBadge` narrowing pattern exactly (`shell.ts:229-260`): a structural `accentBridge()` narrowing of the additive `accent` group (absent group on older shells → `null`), and an exported `setShellAccent(hex: string): Promise<boolean>` that resolves `false` when the bridge/group is absent or the shell rejects/denies — never throws.

### 5. Frontend reporter: `ShellAccentReporter` (`app/frontend/src/components/`)

Mirror the existing shell badge-reporter pattern (`app/frontend/src/components/shell-badge-reporter.tsx` — a render-nothing mount-and-report component gated by the caller on `isShell()`):

- Reads the instance accent's **`stripeHex`** — the full-strength, contrast-guarded hex from `deriveAccentHexes` that the top-bar stripe and HOST hostname tint already use — via `useInstanceAccent()`. The context **already exposes `stripeHex`** (`app/frontend/src/contexts/instance-accent-context.tsx:30,110`), so no context change is needed.
- Calls `setShellAccent(stripeHex)` on change and on initial resolve, with the badge reporter's `lastReportedRef` change-guard so re-mounts don't duplicate reports.
- A `null` `stripeHex` (no accent set / value maps to no owned family) reports nothing — the stored `accentColor` is never cleared, matching the theme-color seam's null-never-clears semantics; a stale edge bar persists until the accent next resolves.
- Mounted wherever the badge reporter mounts: beside `ShellBadgeReporter` in `app/frontend/src/app.tsx`, behind the same `isShell()` gate.
- Component tests mirror `shell-badge-reporter.test.tsx`.

### 6. Self-healing, no migration

Already-persisted 35% blends get overwritten the first time each host is visited by a new-SPA + new-shell pair (the reporter fires on initial resolve). No migration code, no render-time color boosting. Older-shell-captured blends simply keep rendering as-is until overwritten.

### 7. No change to the menu bar rendering itself

`shellHostMenuRows` (`app/frontend/src/lib/shell-strip.ts`) hex validation and the edge-bar paint stay as shipped in #588.

### Tests

- **Desktop**: `node --test` over electron-free modules where the logic is pure — the hex-validation helper SHOULD land in an electron-free module (e.g. `hosts.ts` or a sibling) so the existing `node --test` convention covers it; handler wiring in `main.ts` follows the `badge:set` precedent (untested impure glue).
- **Frontend**: Vitest — `shell.test.ts` additions for the accent bridge narrowing + `setShellAccent`, and a `ShellAccentReporter` component test mirroring the badge reporter's.
- **No Playwright** (shell-only surface, per the #588 precedent).

## Affected Memory

- `run-kit/desktop-shell`: (modify) the `accent:set` channel (Bridge + IPC sections), the raw-accent-reported precedence flag, and the theme-color seam's demotion to older-SPA fallback semantics (§ Hidden Titlebar & Accent Strip, § Host-List Store `accentColor` notes)
- `run-kit/ui-patterns`: (modify) the strip/menu section's note on where the host-switcher edge-bar color comes from (raw `stripeHex` via `accent:set` when both sides are new; titlebar blend only as the version-skew fallback)

## Impact

- `app/desktop/src/preload.ts` — `accent` group with `set` invoker
- `app/desktop/src/main.ts` — `accent:set` handler (gate, hex validation, sender-view resolution, persist via `setHostAccentColor`), `rawAccentReported` per-host flag map, theme-color seam gated on that flag
- `app/desktop/src/hosts.ts` — likely no change (mutator exists); tests only if the validation helper lands there
- `app/frontend/src/lib/shell.ts` + `shell.test.ts` — accent bridge narrowing + `setShellAccent`
- `app/frontend/src/contexts/instance-accent-context.tsx` — no change (already exposes `stripeHex`)
- `app/frontend/src/components/` — `ShellAccentReporter` + test; mounted in `app/frontend/src/app.tsx` beside `ShellBadgeReporter`
- **Dependency**: builds directly on the seams added by change 260813-1i7j (PR #588, open draft on branch `260813-1i7j-host-switcher-color-reorder-waiting` — this worktree's current HEAD); the new branch stacks on that branch's HEAD. Branch creation belongs to the orchestrator.

## Open Questions

- None — the design discussion resolved the approach; remaining latitude is recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Option 1: report the raw accent over a dedicated `accent:set` channel; option 2 (render-time OKLCH punch-up) rejected | Discussed — user explicitly chose option 1 of 2 after screenshot comparison; option 2 explicitly rejected as a symptom patch | S:95 R:65 A:90 D:95 |
| 2 | Certain | Reported value is `stripeHex` from `deriveAccentHexes` (full-strength, contrast-guarded) | Explicit in the design; it is the hex the top-bar stripe and HOST hostname tint already use | S:95 R:85 A:95 D:95 |
| 3 | Certain | `accent:set` handler mirrors `badge:set`: `isHostsSender` gate, `findViewByWebContentsId` sender resolution, welcome/unknown senders persist nothing | Explicit in the design; verified against the shipped `badge:set` handler shape (main.ts:1249) | S:90 R:80 A:95 D:90 |
| 4 | Certain | View-registry `themeColor` cache untouched; `accent:set` feeds ONLY hosts.json `accentColor`; overlay-repaint wiring unchanged | Explicit in the design — the overlay tint must stay the titlebar blend | S:95 R:80 A:90 D:95 |
| 5 | Confident | Precedence flag is an in-memory per-host `Map` in main.ts (the `viewLoadFailed` pattern), cleared on view destroy, not persisted; post-restart blend re-persist window is transient and self-heals | Design suggested this mechanism ("a main-side per-host flag map like the existing viewLoadFailed map"); the ends (stop overwriting) are MUST, the mechanism is the stated suggestion | S:70 R:80 A:75 D:70 |
| 6 | Confident | Main-side hex validation accepts strict `#RGB`/`#RRGGBB`/`#RRGGBBAA`; anything else rejected without persisting | Design requires "plausible hex" with strip.ts precedent; mirroring the SPA consumer's exact pattern guarantees nothing persisted fails the row paint | S:60 R:85 A:80 D:70 |
| 7 | Confident | Null/unresolved `stripeHex` reports nothing; stored `accentColor` is never cleared (stale bar until next resolve) | Design silent on unset; consistent with the theme-color seam's null-never-clears and the store's lack of an unset mutator; trivially reversible | S:35 R:80 A:60 D:55 |
| 8 | Certain | `ShellAccentReporter` mirrors `ShellBadgeReporter` (render-nothing, change-guarded effect, reports on initial resolve) and mounts beside it in `app.tsx` behind `isShell()` | Explicit — "mounted wherever the badge reporter mounts"; mount point verified (app.tsx) | S:90 R:90 A:90 D:90 |
| 9 | Certain | No `instance-accent-context` change — `stripeHex` is already exposed | Verified in code: instance-accent-context.tsx:30 (type) and :110 (value) | S:95 R:95 A:100 D:95 |
| 10 | Certain | Self-healing, no migration, no render-time boosting; old blends overwritten on first new-pair visit, older-shell blends render as-is | Explicit in the design | S:90 R:85 A:85 D:90 |
| 11 | Certain | Menu rendering unchanged — `shellHostMenuRows` validation and edge-bar paint stay as shipped in #588 | Explicit in the design | S:95 R:90 A:95 D:95 |
| 12 | Certain | Tests: `node --test` electron-free desktop modules + Vitest frontend; no Playwright | Explicit, matching the #588 precedent and the desktop package's test convention | S:85 R:90 A:90 D:85 |
| 13 | Confident | Hex-validation helper lands in an electron-free module (hosts.ts or sibling) so `node --test` covers it | Design says "tests only if validation helpers land there [hosts.ts]"; the package convention keeps pure logic electron-free for Node's runner | S:55 R:90 A:80 D:65 |
| 14 | Certain | Change stacks on 260813-1i7j (PR #588) seams — `setHostAccentColor`, `accentColor` field, edge bars — all present on the dependency branch (this worktree's HEAD); branch creation is the orchestrator's | Explicit dependency note; seams verified present in the working tree | S:90 R:70 A:90 D:90 |

14 assumptions (10 certain, 4 confident, 0 tentative, 0 unresolved).

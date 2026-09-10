# Intake: GUI Desktop — Tile Strip and Launch Palette Rows (G2)

**Change**: 260910-vu4p-gui-desktop-tile-strip-and-palette
**Created**: 2026-09-10

## Origin

> Implement G2 from fab/plans/sahil/26-09-10-gui-desktop.md — Frontend: the bare-WM strip and the launch palette rows (slug: gui-desktop-tile-strip-and-palette). G1 (backend: IceWM rung, seeded profile, WM stamp, launcher) is already merged to main and present in this worktree. Read the full plan file in full, especially § Decision log (G-D1 through G-D9 — Certain, except non-apt package names in G-D2 which are Likely), § UX, and the G2 § Do / § Acceptance sections, before drafting the intake. Follow § Pickup protocol (read docs/specs/gui.md and the named memory files first).

One-shot invocation of `/fab-new`. No live discussion preceded it; the design record is the plan document `fab/plans/sahil/26-09-10-gui-desktop.md` (written from the bronze-crane `/fab-discuss` thread on 2026-09-10) — its § Decision log G-D1–G-D9 is binding and this intake does not re-open it. The pickup protocol was followed: the plan in full, the parent plan's § Decision log (D1–D10) and § C5 verdict, `docs/specs/gui.md`, the constitution, and the memory files `run-kit/gui`, `run-kit/daemon-lifecycle`, `run-kit/configuration`, `run-kit/tmux-sessions`, plus the UI sub-domain files `ui/lenses-and-layout` (§ GUI Surface) and `ui/keyboard-and-palette` (§ The `GUI:` palette family).

**Verified in this worktree (G1 is present, PR #905 merged as `2ef10e4b`)**: `internal/gui/status.go` — `StreamEntry.WM` (`json:"wm"`) and `Status.WM` / `Status.WMHint` (`json:"wm_hint,omitempty"`); `internal/gui/assemble.go` fills `WMHint` via `WMInstallHint(d.LookPath)` when enabled ∧ reachable ∧ bare; `api/gui.go` `handleGuiLaunch` answers `POST /api/gui/{id}/launch` with `200 {"ok":false,"app":…,"hint":…}` on a ladder miss and `200 {"ok":true,"app":…,"argv0":…,"pid":…}` on success (400 bad id/body/app, 409 `gui disabled` / `gui is on but not running — see 'rk gui status'`, 500 on a start failure). No `rk-jobs` session exists on the `rk-daemon` socket, so no C6 perf measurement is running (pickup protocol item 3).

**Nothing in the frontend consumes `wm` yet**: `GuiSignal` (`src/contexts/session-context.tsx`) and `GuiStatus` (`src/api/client.ts`) carry neither `wm` nor `wm_hint`; `buildGuiActions` (`src/lib/palette/gui.ts`) has no launch rows; `gui-surface.tsx` has no strip; the e2e fixtures in `tests/e2e/gui-surface.spec.ts` carry no `wm` key.

## Why

**The pain point.** After G1, a host with `icewm` installed shows a legible desktop in the gui tile — taskbar, start menu, clock, Terminal/Browser buttons. A host *without* it still shows a bare `#3b4252` ground in the tile, and the tile says nothing about why: every CLI surface (`rk gui on`, the supervisor pane, `rk gui status`, `rk doctor`) now prints the one install line, but the *tile* — the surface a person is actually looking at, often from a phone — is silent. And on a phone the IceWM taskbar is a 536-px-wide target row; a tap-reachable way to open a terminal or a browser that does not depend on hitting a toolbar button is missing. The plan's goal line: "When the window manager is missing, every surface says the one install line and what to do after it" — the tile is the last surface that does not.

**If we don't do it.** The desktop leg (G1) ships half its value: users on a fresh host see a blank blue tile and have to know to run `rk gui status` in a terminal to learn about `icewm`; agents and users on a phone have no launch route except the `rk gui launch` CLI verb. The backend contract (`wm` on the stream, `wm_hint` on the status document, the `launch` endpoint) sits unused by the dashboard.

**Why this shape.** G-D8 fixes the tile behavior: one strip above the canvas in the bare case (no "no apps yet" overlay — with IceWM the taskbar *is* the affordance), and two palette rows that call the G-D5 launcher. The strip is the only new UI (Constitution IV); the launch actions are palette rows (Constitution V — parity, and a phone gets a tappable route through the palette that does not depend on the taskbar). The plan's backend/frontend split (G1/G2, mirroring the parent's C2/C3) keeps this change small and lets its Playwright half be verified against a stubbed stream alone.

## What Changes

All code lives in `app/frontend/`. No backend file changes. Every user-visible string below is copy quoted from the plan's § UX and is exact.

### 1. API client: `wm` and `wm_hint` on the status document, `launchGuiApp`

`src/api/client.ts`:

- `GuiStatus` gains `wm: string` (always present in the document; `""` when bare or disabled) and `wm_hint?: string` (present only when enabled ∧ reachable ∧ bare — the backend's `omitempty`).
- New `launchGuiApp(app: GuiLaunchApp, id = "host")` — the `id`-defaulted-last shape of the sibling `fetchGuiStatus(id = "host")` / `restartGui(id = "host")` (the plan sketch writes `launchGuiApp(id, app)`; the codebase convention wins for the argument order). It POSTs `/api/gui/{id}/launch` with body `{"app": app}` and `Content-Type: application/json`, and resolves the parsed body on any 2xx:

  ```ts
  export type GuiLaunchApp = "terminal" | "browser";
  export type GuiLaunchResult =
    | { ok: true; app: GuiLaunchApp; argv0: string; pid: number }
    | { ok: false; app: GuiLaunchApp; hint: string };
  ```

  Non-2xx responses throw through the existing `throwOnError` path (409 `gui disabled` / not-running, 500 start failure) — the caller toasts `err.message`. A ladder miss is a **200 with `ok:false`**, deliberately (the backend memory: "the frontend toasts the hint through the success path — the client throws on non-2xx").

### 2. The host signal: `wm` on `GuiSignal`

`src/contexts/session-context.tsx`: `GuiSignal` gains `wm: string`; `narrowGuiEntry` fills it with `guiString(e.wm)` (the same untrusted-payload narrowing as `backend`/`display` — a missing key reads as `""`). This is the field the tile keys the strip on; the stream carries `wm` every tick, so the strip appears and disappears on the stream alone, with no polling.

### 3. The tile: the bare-WM strip (`src/components/gui-surface.tsx`)

**Render condition** (all four must hold):

```
enabled && reachable && gui.wm === "" && gui.backend !== "screen-sharing" && !dismissed
```

- `wm === ""` is the supervisor's "bare" stamp (G-D4 — `""` when no ladder rung resolved).
- `backend !== "screen-sharing"` guards macOS: the mirror backend never has a WM stamp (`wm` is `""` there by construction, G-D9 leaves the macOS branch alone), and there is no display to install a WM into. The tile already branches on this backend value for `viewOnly`.
- `dismissed` is the per-viewer flag below.

**Placement**: inside the existing `enabled && reachable` branch (the `data-testid="gui-surface-canvas"` wrapper, which is already `flex flex-col`), as a flex-row sibling rendered **above** the noVNC host `<div ref={hostRef} className="flex-1 min-h-0" />`. Because the host div is the `flex-1` child, the strip's height is subtracted from the canvas area by the flex layout — noVNC's `scaleViewport`/`resizeSession` observe the host div, so SetDesktopSize (parent D7) sees the reduced height and nothing else changes. The strip is *not* an absolute overlay (the reconnecting/credentials overlays are `absolute inset-0` and may cover it briefly — acceptable; macOS credentials never coexist with the strip anyway).

**Markup** — `data-testid="gui-wm-strip"`, `role="status"`, monospace (`font-mono text-xs`), one line that wraps to two at phone width (`flex flex-wrap items-center gap-x-2 gap-y-1 px-2 py-1 border-b border-border text-text-secondary select-none`):

```
No window manager on the GUI host — sudo apt install --no-install-recommends icewm · then Restart supervisor  [Copy] [×]
```

Segments:

| Segment | Rendering |
|---|---|
| `No window manager on the GUI host` | static text |
| ` — <install line>` | the `wm_hint` string from the status document (§ 3a); the segment is **omitted** while the hint is unknown |
| ` · then ` + **Restart supervisor** | `Restart supervisor` is an inline text button (`type="button"`) calling the existing `onRestart` seam — the same action the empty state's button fires (plan § UX: "`Restart supervisor` is the existing empty-state action, reused"). Its `ok:false` result is ignored here: a 409 means the switch flipped off and the stream unmounts the tile |
| **Copy** | a button (`aria-label="Copy install line"`, visible text `Copy`) that copies **only the install line** (`wm_hint`) via the existing `copyToClipboard` helper in `src/lib/clipboard.ts` (Clipboard API first, `execCommand("copy")` fallback — "falls back to a select-all on failure" in the plan is exactly this helper's fallback). Rendered only when the hint is known. On success the label reads `Copied` for 1.5 s (the `tmux-commands-dialog.tsx` precedent); on `false` nothing changes |
| **×** | the dismiss button (`aria-label="Dismiss"`, visible text `×`) |

Copy and × are built with the shared `Control` primitive (`src/components/control.tsx`) in its chip-class shape so coarse-pointer minimum sizes ride the shared button token rather than hand-written `coarse:` classes; the exact `variant`/`size` pair is apply's call against the primitive's documented grammar (a plain `<button>` with the primitive's `controlClass(...)` is equally acceptable). Both are reachable by Tab (Constitution V); the plan's § Constitution mapping row V decided that Tab-reachability suffices for the strip's two transient controls and that palette parity belongs to the launch actions.

#### 3a. Where the install line comes from

The stream entry carries `wm` but **not** the hint; the hint is package-manager-aware wording built server-side (G-D2) and rides only the status document as `wm_hint`. The frontend never hardcodes a package name. So the tile fetches `GET /api/gui/host` **once per bare transition** — the moment `enabled && reachable && wm === "" && backend !== "screen-sharing"` becomes true — and stores `s.wm_hint ?? ""`. This mirrors the existing reason fetch (once per unreachable transition, never polled, the stream drives re-fetch, a failed GET leaves the line absent, StrictMode-replay re-arm via the `reasonFetchedRef` idiom). While the fetch is pending or after it fails, the strip still renders (the user must learn there is no WM even if the GET failed) with the install-line segment and the Copy button omitted: `No window manager on the GUI host · then Restart supervisor [×]`. A `wm !== ""` or `reachable === false` flip re-arms the transition and clears the stored hint.

#### 3b. The per-viewer dismiss

- localStorage key **`runkit-gui-wm-strip-dismissed`**, value `"1"` when dismissed, removed otherwise (plan § UX names the key verbatim; it deliberately keeps the `runkit-` prefix the plan chose rather than the `rk-gui-*` prefix of the view/lock posture keys).
- Read/write helpers live in `src/lib/gui-posture.ts` beside `readGuiViewMode`/`writeGuiResizeLocked` — the per-viewer render-posture module: `readGuiWmStripDismissed(): boolean` and `writeGuiWmStripDismissed(dismissed: boolean): void`, both try/catch-guarded (untrusted-localStorage discipline; a throwing `localStorage` reads as not dismissed and writes are noops).
- The component reads the flag on mount into state; `×` sets state true and writes `"1"`.
- **Cleared when `wm` becomes non-empty**: an effect observing `gui.wm` calls `writeGuiWmStripDismissed(false)` and resets state whenever `wm !== ""` — so after the user installs icewm and restarts, a *future* bare state (e.g. a later host without a WM) shows the strip again. `reachable` flipping false does **not** clear the dismissal (plan: only "a later `wm != ""` clears it").

#### 3c. Restart flow, end to end

User installs icewm on the host → clicks **Restart supervisor** in the strip → `POST /api/gui/host/restart` → the stream flips `reachable:false` (the tile shows the empty state, the strip is gone with it) → the supervisor restarts, stamps `@rk_gui_wm icewm-session`, the stream flips `reachable:true, wm:"icewm-session"` → the canvas mounts with no strip, and any stored dismissal is cleared.

### 4. The palette: `GUI: Open terminal` / `GUI: Open browser` (`src/lib/palette/gui.ts` + `app.tsx`)

`GuiPaletteInput` gains:

```ts
  /** The host signal's `reachable` (the launch rows exist only on a live display). */
  reachable: boolean;
  /** The host signal's `backend` — the view-only mirror has no display to launch into. */
  backend: string;
  /** POST /api/gui/host/launch for the role; app.tsx owns the toast. */
  onLaunch: (app: GuiLaunchApp) => void;
```

`buildGuiActions` pushes, immediately after `GUI: Turn off` and before the tile-open verbs, when `input.enabled && input.reachable && input.backend !== "screen-sharing"`:

| id | label | onSelect |
|---|---|---|
| `gui-open-terminal` | `GUI: Open terminal` | `() => input.onLaunch("terminal")` |
| `gui-open-browser` | `GUI: Open browser` | `() => input.onLaunch("browser")` |

They do **not** require `tileOpen` (plan § Palette: `enabled && reachable`) — a phone user may launch from the palette and then switch to the gui tile. Omit-not-disable, like the rest of the family.

`app.tsx` supplies the new inputs from the existing `gui` signal (`gui?.reachable === true`, `gui?.backend ?? ""`) and the callback:

```ts
onLaunch: (app) => {
  void launchGuiApp(app)
    .then((r) => {
      if (!r.ok) addToast(r.hint, "error");
    })
    .catch((err: unknown) => {
      addToast(err instanceof Error && err.message ? err.message : `Failed to open ${app}`, "error");
    });
},
```

- `ok:false` ⇒ toast the server's `hint` verbatim (e.g. `no browser on the GUI host — sudo apt install chromium-browser`) through the existing `useToast().addToast` seam (the `onTurnOn` error-toast precedent).
- Success ⇒ **no toast** — the app appears on the desktop; the running-apps list picks it up.
- Thrown (409/500/network) ⇒ toast `err.message`.

The header comment block of `gui.ts` (the entries-per-state list) gains the two rows with their gate.

### 5. Tests

**Vitest**

- `src/components/gui-surface.test.tsx` (extends the existing `vi.mock("@novnc/novnc")` harness; `fetchGuiStatus` is already mocked there):
  - WM present (`wm: "icewm-session"`): canvas host mounts, **no** `gui-wm-strip`.
  - Bare (`wm: ""`, `backend: "Xtigervnc"`): the strip renders with the exact text, the install line from the mocked status document's `wm_hint`, the `Copy` and `×` buttons; the status GET fired **once** for the transition (not per render).
  - Bare + dismissed: `×` hides the strip and writes `runkit-gui-wm-strip-dismissed = "1"`; a remount with the key set renders no strip; a `wm` flip to `"icewm-session"` removes the key.
  - Bare with a failed status GET: the strip renders without the install segment and without `Copy`.
  - `backend: "screen-sharing"` with `wm: ""`: no strip.
  - `Copy` calls `copyToClipboard` with exactly the install line (mock `@/lib/clipboard`); the label flips to `Copied` and back.
  - `Restart supervisor` in the strip calls `onRestart`.
  - The strip sits above the host div inside the canvas wrapper (DOM order), so the fit subtracts it.
- `src/lib/palette/gui.test.ts`: rows present iff `enabled && reachable && backend !== "screen-sharing"` (four gating cases: off; on+unreachable; on+reachable; on+reachable+screen-sharing); they do not depend on `tileOpen`; `onSelect` routes `"terminal"`/`"browser"` to `onLaunch`; the R8-style worked example's ordering places them after `GUI: Turn off`.
- `src/api/client.test.ts` (if the file has gui coverage; otherwise a small addition): `launchGuiApp` POSTs the right URL/body and returns the parsed `ok:false` body without throwing; a 409 throws.
- `src/contexts/session-context` gui narrowing case: `wm` narrows to `""` when absent, passes through when a string.

**Playwright** — `tests/e2e/gui-surface.spec.ts`, the **ungated** mocked half (desktop 1280 px and mobile 375 px), file-header and per-test intent comments per the constitution's Test Intent rule (Proves / Steps; no change IDs):

- Fixtures: `GUI_OFF` and `GUI_ON_UNREACHABLE` gain `wm: ""`; new `GUI_ON_BARE = [{ …, reachable: true, width: 1280, height: 800, viewers: 0, wm: "" }]` and `GUI_ON_ICEWM = [{ …same, wm: "icewm-session" }]`. `mockGuiBackend`'s `GET /api/gui/host` stub takes the document to return (the bare document carries `wm: ""` and `wm_hint: "sudo apt install --no-install-recommends icewm"`). The stubbed `GUI_REASON` string is updated to G1's backend wording (`no VNC backend: sudo apt install --no-install-recommends tigervnc-standalone-server icewm`) — mock copy only.
- New test, desktop: with the stream `GUI_ON_BARE`, open the gui tile → `gui-wm-strip` is visible with the exact text `No window manager on the GUI host — sudo apt install --no-install-recommends icewm · then Restart supervisor`; click `Copy` (`context.grantPermissions(["clipboard-read", "clipboard-write"])`) → `navigator.clipboard.readText()` yields exactly the install line; `emitGui(GUI_ON_ICEWM)` → the strip is gone; the `/ws/gui/` route is still the tracked no-op (no rig).
- New test, desktop: `×` hides the strip; `page.reload()` with the same mocked stream → still hidden (localStorage survived); `emitGui(GUI_ON_ICEWM)` then `emitGui(GUI_ON_BARE)` → the strip is back (the non-empty `wm` cleared the dismissal).
- New test, mobile 375 px: the strip renders (wrapping is allowed) and both buttons are visible and tappable within the viewport; `×` hides it.
- New test, desktop: palette rows — with `GUI_ON_BARE` (reachable) the palette lists `GUI: Open terminal` and `GUI: Open browser`; with `GUI_ON_UNREACHABLE` it lists neither; selecting `GUI: Open browser` against a `POST /api/gui/host/launch` stub answering `200 {"ok":false,"app":"browser","hint":"no browser on the GUI host — sudo apt install chromium-browser"}` shows a toast containing that hint; the request body was `{"app":"browser"}`.
- The Xvnc-gated real-rig test is **unchanged** (it exercises the switch/zen/phone-fit/off-confirm cycle; on this VM the rig now runs icewm, so no strip appears there — no assertion is added).

### 6. Docs and plan bookkeeping

- `docs/specs/gui.md` gains a **§ The tile** section (after § Availability vs reachability) carrying the three tile states from the plan's § UX (reachable + WM present → the canvas; reachable + bare → the strip with its exact copy, Copy, ×, the dismiss key and its clearing rule, and the macOS exclusion; unreachable → the existing empty state) and the two palette rows with their gate, and the § The switch table's Palette row gains the launch rows. The `## Phasing` table's desktop-leg note already points at the child plan.
- `fab/plans/sahil/26-09-10-gui-desktop.md`: the G2 row in § Change breakdown filled with this change folder now (pickup protocol item 4 — done at intake), the PR link at ship, `Done` when merged; the § Status line updated.
- Memory via hydrate — see Affected Memory.

### Out of scope (G-D9 and the G1/G2 split)

No backend changes (the `wm`/`wm_hint`/`launch` contract is G1's and is consumed as-is); no auto-install; no theme editor; no "no apps yet" overlay; no per-viewer window managers; no macOS launch support (the rows are hidden on the mirror backend); no palette rows for Copy/Dismiss (plan § Constitution mapping V); the real-rig Playwright test is not extended (a rig-level bare-WM state needs a `PATH` without every ladder rung — the plan's § Acceptance names that as a manual check on this VM, not an automated one).

## Affected Memory

- `run-kit/ui/lenses-and-layout`: (modify) § GUI Surface — the content-state table gains the bare-WM strip row (render condition incl. the macOS exclusion, the exact copy, Copy via `copyToClipboard`, ×, the `runkit-gui-wm-strip-dismissed` key and its `wm`-non-empty clearing, the once-per-bare-transition `wm_hint` fetch mirroring the reason fetch, the flex placement that subtracts the strip from the fit); the e2e paragraph gains the new ungated tests; the unit-coverage sentence gains the strip cases.
- `run-kit/ui/keyboard-and-palette`: (modify) § The `GUI:` palette family — `GUI: Open terminal` / `GUI: Open browser` (ids, the `enabled && reachable && backend !== "screen-sharing"` gate, no `tileOpen` dependency, the `ok:false` hint toast, no success toast, placement after `GUI: Turn off`).
- `run-kit/ui/dialogs-and-state`: (modify) the per-viewer localStorage inventory gains `runkit-gui-wm-strip-dismissed` beside `rk-gui-view`/`rk-gui-lock` (the `gui-posture.ts` module now owns three keys).
- `run-kit/gui`: (modify) § The launcher and § HTTP routes — the frontend consumers are now real: the palette rows behind `launchGuiApp`, and the tile's strip as the consumer of `wm` (stream) and `wm_hint` (status document); one sentence each, the backend contract text is unchanged.

## Impact

- **Code**: `app/frontend/src/api/client.ts`, `src/contexts/session-context.tsx`, `src/components/gui-surface.tsx`, `src/lib/gui-posture.ts`, `src/lib/palette/gui.ts`, `src/app.tsx` (the `buildGuiActions` call site — inputs + `onLaunch`), plus tests `src/components/gui-surface.test.tsx`, `src/lib/palette/gui.test.ts`, `src/api/client.test.ts`, the session-context gui test, and `tests/e2e/gui-surface.spec.ts`. No backend files. No new routes, no settings keys, no new dependencies.
- **APIs consumed** (all shipped by G1): `event: gui` stream entry `wm`; `GET /api/gui/{id}` `wm`/`wm_hint`; `POST /api/gui/{id}/launch`.
- **Docs**: `docs/specs/gui.md` (§ The tile), the child plan's § Change breakdown/§ Status, four memory files via hydrate.
- **Verification gates** (code-quality.md): `just test-frontend` (vitest), `just test-e2e "gui-surface"` (the ungated half runs everywhere; the rig half skips without Xtigervnc — it is present on this VM), `npx tsc --noEmit` in `app/frontend`, `just test`, `just build`. Manual acceptance on this VM per the plan's G2 § Acceptance: hide `icewm-session` **and** `openbox` (and the rest of the ladder) from the supervisor's `PATH` (a `gui.wm=nonexistent` pin is not enough — it falls back to openbox), `rk gui restart` → the strip on desktop and at 375 px, `Copy` yields the apt line, `×` persists across reload; restore `PATH`, `rk gui restart` → strip gone; `GUI: Open terminal` opens a terminal on the desktop; `GUI: Open browser` toasts the chromium hint.
- **Risk**: the strip steals vertical space from the canvas (plan risk 4) — mitigated by the flex placement (the fit subtracts it) and by the strip existing only in the bare state, which is the state users are steered out of.

## Open Questions

None — the plan's decision log, § UX, and the shipped G1 contract answer every design point; the remaining choices are recorded as graded assumptions below.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Strip renders iff `enabled && reachable && wm === ""` and not dismissed; no "no apps yet" overlay; copy is the plan's exact line | Plan G-D8 + § UX — the decision log is Certain by the pickup protocol | S:95 R:90 A:95 D:95 |
| 2 | Certain | Palette rows `GUI: Open terminal` / `GUI: Open browser` (ids `gui-open-terminal`/`gui-open-browser`) call the G-D5 launcher via `POST /api/gui/host/launch {"app":…}` and toast `hint` on `ok:false`; no success toast | Plan G-D5/G-D8 + § Palette table | S:95 R:90 A:95 D:95 |
| 3 | Certain | Dismiss key is `runkit-gui-wm-strip-dismissed`, per-viewer localStorage, cleared only when `wm` becomes non-empty; `reachable` flips never clear it | Plan § UX names the key and the clearing rule verbatim | S:95 R:90 A:95 D:90 |
| 4 | Certain | Frontend-only change; the `wm`/`wm_hint`/`launch` contract is consumed as shipped by G1 — no backend edits, no auto-install, no macOS launch, no theme editor | Plan G-D9 and the G1/G2 split; G1 verified present in the worktree | S:95 R:85 A:95 D:95 |
| 5 | Certain | The strip's Copy and × are Tab-reachable buttons without palette rows; palette parity belongs to the two launch actions | Plan § Constitution mapping row V decided this explicitly; noted so review does not read it as a Constitution V gap | S:85 R:85 A:85 D:85 |
| 6 | Certain | `wm` lands on `GuiSignal` in `session-context.tsx` (narrowed with `guiString`) and `wm`/`wm_hint?` on `GuiStatus` in `client.ts`; the plan's `GuiEntry` name maps to the existing `GuiSignal` type | The stream type already lives in session-context; the codebase determines the landing spot | S:80 R:90 A:95 D:90 |
| 7 | Certain | The strip is a flex-row sibling above the `flex-1` noVNC host div inside the existing `flex-col` canvas wrapper, so the fit subtracts it with no explicit height math | The wrapper is already `flex flex-col`; noVNC observes the host div — the plan's "height subtracted from the canvas fit" falls out of the layout | S:80 R:90 A:90 D:85 |
| 8 | Certain | The strip and the launch rows are hidden when `backend === "screen-sharing"` (macOS mirror): `wm` is `""` there by construction and there is no display to launch into | G-D9 leaves the macOS branch alone; without the guard every macOS user would see a false "no window manager" strip; the tile already branches on this backend value | S:70 R:90 A:90 D:85 |
| 9 | Confident | The install line comes from `wm_hint` on `GET /api/gui/host`, fetched once per bare transition (the reason-fetch idiom); while unknown or after a failed GET the strip still renders without the install segment and without Copy | The stream carries `wm` but not the hint; hint wording is server-side by G-D2 so the frontend must not hardcode it; the once-per-transition never-poll rule is the tile's existing grammar | S:70 R:85 A:80 D:70 |
| 10 | Confident | `Restart supervisor` inside the strip is an inline text button firing the existing `onRestart` seam; its `ok:false` result is ignored | Plan § UX: "the existing empty-state action, reused"; a 409 means the switch flipped off and the stream unmounts the tile anyway | S:65 R:90 A:80 D:70 |
| 11 | Certain | `launchGuiApp(app, id = "host")` — app first, id defaulted last — returning the parsed `ok:true`/`ok:false` body on 2xx and throwing on non-2xx via `throwOnError` | Codebase convention (`fetchGuiStatus(id = "host")`, `restartGui(id = "host")`) over the plan sketch's `(id, app)`; the backend deliberately answers a ladder miss with 200 | S:70 R:95 A:85 D:75 |
| 12 | Confident | Launch rows sit right after `GUI: Turn off`, before the tile-open verbs, and do not require `tileOpen` | Plan § Palette gates them on `enabled && reachable` only; placement is the one free choice and the palette is search-driven | S:60 R:95 A:80 D:65 |
| 13 | Certain | Dismiss read/write helpers live in `src/lib/gui-posture.ts` (`readGuiWmStripDismissed`/`writeGuiWmStripDismissed`), try/catch-guarded like the view/lock posture | That module is the per-viewer gui posture home; same discipline, one more key | S:65 R:95 A:90 D:80 |
| 14 | Certain | Copy uses `src/lib/clipboard.ts` `copyToClipboard` (Clipboard API, `execCommand` fallback) and flips the label to `Copied` for 1.5 s on success | code-quality anti-pattern "duplicating existing utilities"; the plan's "falls back to a select-all on failure" is exactly this helper's fallback; the label flip is the `tmux-commands-dialog` precedent | S:70 R:95 A:90 D:80 |
| 15 | Confident | Copy and × use the shared `Control` primitive's chip-class shape (exact `variant`/`size` chosen at apply against `control.tsx`'s grammar) for coarse-pointer sizing | Plan: "coarse-pointer sizing via the shared button token"; `control.tsx` is where that token lives | S:55 R:90 A:70 D:60 |
| 16 | Certain | e2e coverage lands in the ungated mocked half of `gui-surface.spec.ts` (new fixtures with `wm`, a status-document stub with `wm_hint`, a `launch` POST stub, clipboard permission granted); the real-rig test is untouched | Plan G2 item 4 ("stubbed stream"); a rig-level bare state needs a PATH without every ladder rung and is the plan's manual acceptance on this VM | S:70 R:90 A:85 D:75 |
| 17 | Certain | The stubbed `GUI_REASON` mock string is updated to G1's backend wording (`--no-install-recommends tigervnc-standalone-server icewm`) | Mock copy only, never asserted against the backend; keeps the fixture honest to the shipped hint | S:60 R:100 A:90 D:85 |

17 assumptions (13 certain, 4 confident, 0 tentative, 0 unresolved).

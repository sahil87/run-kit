# Intake: xterm WebGL Fallback Telemetry

**Change**: 260916-jowy-xterm-webgl-fallback-telemetry
**Created**: 2026-09-16

## Origin

> When xterm loses its WebGL context and falls back to the DOM renderer, rk says so — a console.warn with the window id and a one-shot toast — so the fallback's frequency on real hardware becomes known before anyone sizes a fix.
>
> Full context lives in fab/plans/sahil/26-09-16-idle-cpu.md — read the whole file before starting, especially "## Change 4 — WebGL fallback telemetry", "## Pre-intake research" R5 (small, do this first), and "## Standing context". This is change 4 of 5 in the plan — light lane, no CPU claim of its own (use `just perf-idle-cpu`, already merged to main, only to prove zero regression). After intake, proceed through the full pipeline yourself (fab-fff) to implementation, review, hydrate, ship, and PR.

One-shot invocation via `/fab-new`, driven by the plan file `fab/plans/sahil/26-09-16-idle-cpu.md` (§ Change 4, § Standing context, § Pre-intake research R5). This is change 4 of 5 in that plan; it is file-disjoint from changes 1–3 and depends only on change 0 (the `just perf-idle-cpu` instrument, merged as #991 and present on this branch's base).

**R5 research result (done at intake, 2026-09-16, against `f3f58812`):**

- `app/frontend/src/components/terminal-client.tsx:500–517` — `new WebglAddon()` is constructed inside a `try`; `webgl.onContextLoss(...)` is registered before `terminal.loadAddon(webgl)`. On context loss the handler disposes the addon (so xterm drops to its DOM renderer and output keeps flowing) and calls `setActiveRenderer(windowId, "canvas")`. The `catch` path (construction threw) calls `setActiveRenderer(windowId, "canvas")` too. **Both paths are silent** — no `console.warn`, no toast, no counter.
- `grep -rni "contextloss\|context lost\|webgl" app/frontend/src` finds only `terminal-client.tsx` and its Vitest file — there is no existing telemetry anywhere.
- `window.__rkRenderer` (`terminal-client.tsx:131–139`) is a per-window-id map `"webgl" | "canvas"` written by `setActiveRenderer` at init and deleted by `unsetActiveRenderer` at cleanup. It is **not** DEV-gated (unlike `__rkTerminals`), so in every build its key count equals the number of `TerminalClient`s that have completed init and not yet unmounted — a free "mounted terminals" count.
- Toast path: `app/frontend/src/components/toast.tsx` exports `useToast()` (throws outside a provider) and `useOptionalToast()` (returns `null` outside a provider — "isolated component mounts degrade to no toast instead of throwing"). `ToastProvider` wraps the whole app at `app.tsx:316`, including the board route and the quake terminal, so every production `TerminalClient` is inside it; the Vitest harness `renderTerminalClient()` renders without it. `TerminalClient` is a component, so it can call the hook itself — no callback prop or `rk:` document event is needed (the plan named those two as the precedents; the provider-optional hook is a third, simpler one that already exists for exactly this case).
- Surface decision: client-only `console.warn` + one-shot toast. A `/api/...` post is rejected — Principle X forbids pushing state, and a frequency count on the user's own machine only needs a visible client signal.

## Why

**The problem.** The 2026-09-16 idle-CPU measurement found one run in nine where xterm's WebGL context was lost and the terminal silently fell back to the DOM renderer. That run cost 39.1% of a core on a tty route versus 21.4% with WebGL — the DOM renderer keeps ~15 000 DOM nodes live and `createRow`/`replaceChildren` dominate the profile. The fallback is correct behaviour (a frozen terminal would be worse), but today nothing tells anyone it happened: the only trace is a `window.__rkRenderer` entry that a latency harness reads in e2e and nobody reads in production.

**The consequence of not doing this.** The plan's decision of record is that the fallback is *not* fixed in this round: "Frequency on the user's Mac is unknown; without that number the fix cannot be sized." Candidate fixes (a WebGL-context budget for the hide-never-unmount tile set, unmounting hidden tty tiles, a canvas cap on boards) each carry real cost and trade-offs. Without a signal, the user cannot tell whether a slow afternoon in the desktop app is the fallback at work, and the backlog idea "xterm hidden-tile cap / WebGL context budget" has no data to reopen on. Chromium caps WebGL contexts at 16 per page and evicts the oldest when the cap is hit — the hidden-tile set in `surface-layout.tsx` and multi-pane boards are the likely trigger, so the mounted-terminal count at the moment of loss is the one datum that distinguishes "context budget" from "GPU reset / driver hiccup".

**Why this approach.** One `console.warn` per event (with server, window id, and the mounted-terminal count) gives a countable, greppable record in the Electron devtools console and in any Playwright run; one toast per page load makes the user aware the moment it first happens without nagging when many tiles fall back at once. Everything stays client-side (Principle X — nothing is pushed to the daemon), adds no setting (Principle IV), no user action (Principle V — a toast is a notice, not an action), and no CPU of its own (the handler body runs once per loss event). The plan's lane hint is light.

## What Changes

### 1. `terminal-client.tsx` — announce the fallback on both paths

File: `app/frontend/src/components/terminal-client.tsx`. Only the WebGL block (`:500–517` at `f3f58812`) and small additions near the renderer registry (`:120–139`) change.

**New imports/hook.** `import { useOptionalToast } from "@/components/toast";`. Inside `TerminalClient`, call `const toast = useOptionalToast();` and mirror it into a ref exactly as `onProgressChangeRef` is mirrored (`:272–273`) so the init effect's dependency list does not change:

```ts
const toastRef = useRef(toast);
toastRef.current = toast;
```

**New module-level constants and helpers** (beside `setActiveRenderer`):

```ts
/** Toast text on the first WebGL context loss of a page load. */
export const WEBGL_FALLBACK_TOAST = "Terminal GPU rendering lost — using the slower DOM renderer";

/**
 * Live xterm instances on this page: every TerminalClient that finished init and
 * has not unmounted holds a `__rkRenderer` entry. Chromium caps WebGL contexts
 * at 16 per page and evicts the oldest, so this count at the moment of a loss is
 * what separates "context budget" from "GPU reset".
 */
function mountedTerminalCount(): number {
  if (typeof window === "undefined" || !window.__rkRenderer) return 0;
  return Object.keys(window.__rkRenderer).length;
}

/** Once per page load — many tiles losing their context at once is one event to the user. */
let webglFallbackToastShown = false;

type WebglFallbackKind = "context-loss" | "unavailable";

function reportWebglFallback(
  kind: WebglFallbackKind,
  server: string,
  windowId: string,
  toast: { addToast: (message: string, variant?: "error" | "info") => void } | null,
): void {
  const n = mountedTerminalCount();
  const what = kind === "context-loss" ? "context lost" : "unavailable at load";
  console.warn(
    `rk: xterm WebGL ${what} for ${server}/${windowId} — using the DOM renderer (${n} terminal${n === 1 ? "" : "s"} mounted)`,
  );
  if (kind !== "context-loss" || webglFallbackToastShown) return;
  webglFallbackToastShown = true;
  toast?.addToast(WEBGL_FALLBACK_TOAST, "info");
}
```

The exact `console.warn` shape is the contract for counting: it MUST contain the literal `rk: xterm WebGL`, the `{server}/{windowId}` pair (e.g. `runKit/@99`), and `(N terminal(s) mounted)`. The exact toast text is `WEBGL_FALLBACK_TOAST`, variant `info` (a degradation, not a failure), no action button.

**Wiring.** The two existing silent sites gain one call each; nothing else in the block moves (the Unicode-before-WebGL load order and the `setActiveRenderer` writes stay):

```ts
try {
  const webgl = new WebglAddon();
  webgl.onContextLoss(() => {
    try { webgl.dispose(); } catch { /* already disposing */ }
    setActiveRenderer(windowId, "canvas");
    reportWebglFallback("context-loss", server, windowId, toastRef.current);
  });
  terminal.loadAddon(webgl);
  setActiveRenderer(windowId, "webgl");
} catch {
  setActiveRenderer(windowId, "canvas");
  reportWebglFallback("unavailable", server, windowId, toastRef.current);
}
```

`mountedTerminalCount()` runs *after* `setActiveRenderer` so the losing terminal counts itself (on the load-failure path the entry has just been written too).

**Load-time failure (`catch`) gets the warn but NOT the toast.** A host with no WebGL at all (software-rendered headless Chromium, some VMs) would otherwise toast on every page load and every e2e spec would carry a `role="alert"` box in the bottom-right corner; the console line is enough to count it. Only the runtime context loss — the thing the user would otherwise never notice — earns the toast.

**Naming.** The `__rkRenderer` value stays the legacy literal `"canvas"` (the echo-latency harness asserts on it); the human-facing text says "DOM renderer", which is what xterm 6 actually falls back to (the canvas renderer left xterm core in v5).

**Test isolation of the one-shot flag.** The module-level flag needs resetting between Vitest cases. Export a small reset (`export function resetWebglFallbackNoticeForTests(): void { webglFallbackToastShown = false; }`) — this file already carries test-only surface (`__rkTerminals`), so a named reset is in pattern; `vi.resetModules()` + dynamic re-import is the alternative if the apply agent prefers no export.

### 2. Vitest — `terminal-client.test.tsx`

Add a `describe("TerminalClient WebGL fallback telemetry", …)` block. The existing `@xterm/addon-webgl` mock (`:145–151`) returns `{ dispose: vi.fn(), onContextLoss: vi.fn() }`; the registered callback is reachable without changing the mock as `vi.mocked(WebglAddon).mock.results[0].value.onContextLoss.mock.calls[0][0]`. Spy `console.warn` with `vi.spyOn(console, "warn").mockImplementation(() => {})`. Cases:

1. **Context loss disposes and announces.** Render via `renderTerminalClient()`, wait for `WebglAddon` to be constructed, invoke the captured callback. Assert the mock's `dispose` was called, `window.__rkRenderer["@0"] === "canvas"`, and `console.warn` was called once with a string containing `rk: xterm WebGL context lost`, `default/@0`, and `1 terminal mounted`.
2. **The toast is one-shot per page.** Render inside `<ToastProvider>` (import from `@/components/toast`), fire the callback twice (or mount two clients with different window ids and fire both). Assert exactly one `role="alert"` with text `WEBGL_FALLBACK_TOAST`, and `console.warn` called once per firing.
3. **No provider, no throw.** `renderTerminalClient()` (no `ToastProvider`), fire the callback — no error, warn still fires, no alert in the document.
4. **Load-time failure warns without a toast.** `vi.mocked(WebglAddon).mockImplementationOnce(() => { throw new Error("no webgl"); })`, render inside `ToastProvider`. Assert `console.warn` contains `unavailable at load`, no `role="alert"`, and the terminal still initialises (`window.__rkRenderer["@0"] === "canvas"`, `Terminal` constructed, `loadAddon` for the other addons still called).

Call `resetWebglFallbackNoticeForTests()` (or `vi.resetModules()`) in `beforeEach`; clean `window.__rkRenderer` in `afterEach` (the existing suites already `cleanup()` and `vi.restoreAllMocks()`).

No e2e: no spec covers WebGL context loss and Playwright cannot force one reliably against a live tmux window (the plan's acceptance names Vitest).

### 3. Memory — `docs/memory/run-kit/ui/terminal.md`

- § Terminal Addons, the `@xterm/addon-webgl` row: replace "silently falls back to canvas renderer" with the announced fallback — both paths `console.warn` (`rk: xterm WebGL {context lost | unavailable at load} for {server}/{windowId} — using the DOM renderer (N terminals mounted)`), only a runtime context loss raises the one-shot-per-page-load `info` toast `WEBGL_FALLBACK_TOAST`; the count comes from `__rkRenderer`'s key count; the `"canvas"` literal is kept for the latency harness.
- § Design Decisions: add **"WebGL fallback is announced, not fixed"** in the four-field shape — Decision (warn per event + one toast per page, client-only) / Why (one run in nine fell back at 39% vs 21% renderer on 2026-09-16; frequency on real hardware unknown, so the fix — a context budget for hidden tiles — cannot be sized; Chromium's 16-context cap makes the mounted count the diagnostic datum) / Rejected (a `/api` post — Principle X and no need; a toast on the load-time path — would fire on every page load on WebGL-less hosts and every e2e run; per-event toasts — a board with many panes would spam) / Introduced by 260916-jowy.

### 4. Verification (plan `## Acceptance` must carry these)

- `cd app/frontend && npx tsc --noEmit` clean.
- The new Vitest block plus the whole `terminal-client.test.tsx` file green through the `just` recipe (`just test-frontend`; scope to the file if the recipe takes a filter).
- **Zero-regression instrument run, no CPU claim**: `just perf-idle-cpu <tty-route> 30` against the live daemon (`rk url`; a tty route is `/{server}/{windowId}` for any live window) before and after the change; record both lines in `plan.md`. Renderer % within the 3-point noise floor, and the `xtermScreens` inventory unchanged. If no daemon is reachable at run time, record "instrument not run — no live daemon" rather than failing the change.
- Never the full suite as a gate (plan § Standing context); `just build` only if time allows.

### Non-goals

- Fixing or reducing the fallback (context budget, hidden-tile unmount, board canvas cap) — that is the backlog idea "xterm hidden-tile cap / WebGL context budget", reopened only when this change shows fallbacks happen.
- Persisting or aggregating a count (no counter in localStorage, no tmux option, no daemon endpoint).
- A settings key to silence the toast (Principle IV — one-shot per page load is already the quiet form).
- Any change to which renderer xterm uses or to the addon load order.

## Affected Memory

- `run-kit/ui/terminal`: (modify) § Terminal Addons `@xterm/addon-webgl` row gains the announced-fallback contract (warn shape, one-shot toast, mounted-count source); § Design Decisions gains "WebGL fallback is announced, not fixed"

## Impact

- **Code**: `app/frontend/src/components/terminal-client.tsx` (one import, one hook + ref, ~30 lines of helpers, two one-line call sites); `app/frontend/src/components/terminal-client.test.tsx` (one new describe block, ~4 cases).
- **Runtime**: zero steady-state cost — the new code runs only when a WebGL context is lost or fails to construct. One `console.warn` per event; at most one toast per page load.
- **Dependencies**: none new. Uses the existing `useOptionalToast` seam and the existing `__rkRenderer` registry.
- **Docs**: `docs/memory/run-kit/ui/terminal.md` only; no spec change (`docs/specs/` has no terminal-renderer contract).
- **Constitution**: IV (no settings surface), V (no action added — a toast is a notice), X (nothing pushed to the daemon). No e2e touched, so the Test Intent Comments rule is not engaged. No change-ID/PR citations in code comments.
- **Sequencing**: file-disjoint from changes 1–3 of the plan (they touch `globals.css`, `status-dot.tsx`, `board-pane.tsx`, `sse.go`, `session-context.tsx`); rebases cleanly in either order.

## Open Questions

- None blocking. The apply agent picks the one-shot reset mechanism for tests (exported reset vs `vi.resetModules()`) — both are acceptable.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Surface is a client-only `console.warn` per event plus a one-shot toast; no `/api` post, no persisted counter | Given verbatim by the plan § Change 4 and R5; Principle X rules out pushing state; a frequency count only needs a visible client signal | S:95 R:90 A:95 D:95 |
| 2 | Confident | The toast reaches `TerminalClient` via the existing provider-optional `useOptionalToast()` hook mirrored into a ref — not a callback prop or an `rk:` document event | The plan named prop/event as the two precedents, but `useOptionalToast` exists for exactly this case (isolated mounts degrade to no toast); `ToastProvider` wraps every production mount at `app.tsx:316`; the ref mirror keeps the init effect's deps unchanged (the `onProgressChangeRef` pattern) | S:65 R:85 A:85 D:75 |
| 3 | Confident | One-shot means once per page load across all terminals (module-level flag); `console.warn` fires on every event | The user needs to learn it happened once; a board or hidden-tile set losing many contexts at once is one event to them, while the console keeps the per-event count the plan wants | S:75 R:90 A:75 D:70 |
| 4 | Confident | The mounted-terminal count is `Object.keys(window.__rkRenderer).length` — the existing registry written at init and deleted at cleanup, in all builds | No new registry; the map is not DEV-gated (unlike `__rkTerminals`); Chromium's 16-context cap makes this count the datum that distinguishes context budget from GPU reset | S:70 R:85 A:85 D:70 |
| 5 | Confident | The load-time `new WebglAddon()` throw gets the `console.warn` only, never the toast | A WebGL-less host (software headless Chromium, the e2e rig) would otherwise toast on every page load and put a `role="alert"` box in every e2e run; the plan says "also warn" for that path, toast only for context loss | S:65 R:90 A:75 D:65 |
| 6 | Confident | Toast variant `info`, no action button, text "Terminal GPU rendering lost — using the slower DOM renderer" | A working-but-slower terminal is a degradation, not an error (the two variants are `error`/`info`); Principle V needs no palette entry because a toast is a notice, not an action | S:60 R:95 A:80 D:70 |
| 7 | Certain | Human-facing text says "DOM renderer"; the `__rkRenderer` value keeps the legacy `"canvas"` literal | xterm 6 falls back to its DOM renderer (the canvas renderer left core in v5); the echo-latency harness asserts on `"canvas"`, so renaming it is out of scope | S:70 R:85 A:85 D:80 |
| 8 | Certain | Tests are Vitest in `terminal-client.test.tsx`, forcing the loss by invoking the callback captured from the mocked `onContextLoss`; no e2e | Plan § Change 4 acceptance names "a Vitest with a stub addon"; the mock already records the callback; Playwright cannot force a context loss reliably | S:90 R:90 A:95 D:95 |
| 9 | Certain | Zero-regression proof is one `just perf-idle-cpu` run on a tty route before and after, within the 3-point noise floor; "not run — no live daemon" is recorded, not failed, if the daemon is unreachable | Plan § Standing context and § Sequencing: change 4 has no CPU claim, the instrument only proves no regression; a live daemon answers on `rk url` at intake time | S:80 R:95 A:80 D:85 |
| 10 | Certain | Memory: `ui/terminal.md` addon row + one Design Decision; no spec change | Plan § Change 4 names `ui/terminal.md` § Renderer; `docs/specs/` carries no renderer contract | S:90 R:95 A:95 D:95 |
| 11 | Certain | `change_type` is `feat` | New user-visible signal; the description carries none of the `fix`/`refactor`/`docs`/`test`/`ci`/`chore` keywords | S:85 R:95 A:90 D:90 |
| 12 | Certain | Light lane — two files plus one memory file, at most five tasks | Plan § Sequencing lane hint for change 4; the fork rule is ≤ 5 tasks | S:90 R:95 A:90 D:90 |

12 assumptions (7 certain, 5 confident, 0 tentative, 0 unresolved).

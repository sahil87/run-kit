# Intake: Static xterm imports

**Change**: 260531-m3pl-static-xterm-imports
**Created**: 2026-05-31
**Status**: Draft

## Origin

> Hoist the 6 serial runtime `await import()` calls for the xterm family (`@xterm/xterm`, `addon-fit`, `addon-clipboard`, `addon-web-links`, `addon-unicode-graphemes`, `addon-webgl`) in `app/frontend/src/components/terminal-client.tsx` (lines 147, 148, 195, 200, 209, 216) to static top-of-file imports.

Conversational mode. This change emerged from a `/fab-discuss` session analyzing run-kit's transport model (HTTP/1.1 vs HTTP/2 over Tailscale). The investigation traced the long-standing board-route E2E hang to its true root cause — browser HTTP/1.1 6-connections-per-origin starvation on the plaintext test/dev origin — superseding both the earlier tmux-contention hypothesis and the later Vite-dep-optimizer hypothesis. See memory `e2e-flakiness-board-route-dynamic-import-hang`. This is the first of two drafted fixes (the second bounds persistent relay WebSockets on the desktop board row).

## Why

**Problem.** `TerminalClient`'s mount effect performs **6 sequential `await import()` calls** to load the xterm core and its addons. Each is a separate runtime module-graph fetch. On a board, the DesktopRow mounts N `<BoardPane>` simultaneously, so up to `6 × N` chunk requests burst concurrently.

**Consequence.** The entire E2E/dev path is a **plaintext HTTP/1.1 origin** (`http://localhost:3020` → Vite dev server, which proxies `/api`+`/relay` to the Go backend). Browsers cap persistent connections at ~6 per origin (HTTP/2 is only negotiated over TLS, which this origin lacks). The 6 slots are already under pressure from long-lived streams that **never release a slot**: the Vite HMR socket, one pooled SSE `EventSource` per attached server, and one `/relay/<wid>` WebSocket per visible pane (the DesktopRow never suspends panes). A 7th request — an xterm chunk fetch — waits for a slot that never frees and **hangs pending forever**. The import promise never resolves → `setTerminalReady(true)` never runs → the WS relay effect (gated on `terminalReady`) never opens → `.xterm-rows` never renders → pane stays blank → the E2E `expect.poll` for terminal marker text times out. This is the confirmed mechanism behind the board-route E2E flakiness (`boards-same-session-multi-pane`, `shell-rotation`). It is masked in production over Tailscale HTTPS (h2 multiplexes everything), so it only bites on plaintext origins — exactly where tests run.

**Why this approach over alternatives.** `terminal-client.tsx` is already lazy-loaded by the router (`router.tsx` lazy-loads `BoardPage`, and the terminal route is code-split). Converting the 6 runtime `await import()` calls to **static top-of-file imports** bundles the xterm family into that already-deferred chunk. It then loads **once when the route's chunk loads**, never per-pane-mount, and is never an in-flight request competing for a connection slot at terminal-init time. Every pane needs the identical modules anyway, so the per-pane dynamic `import()` repetition buys nothing — it only adds runtime connection-budget pressure. Rejected alternatives: (a) `Promise.all` to parallelize the 6 awaits — reduces 6 serial round-trips to one burst but still puts chunk fetches on the runtime budget; (b) `optimizeDeps.include` in `vite.config` — pre-bundles the dep but doesn't take the request off the per-pane runtime path; (c) one-pane-imports-others-reuse — adds cross-pane coordination complexity for no benefit over a plain static import.

## What Changes

### `app/frontend/src/components/terminal-client.tsx`

Convert these 6 runtime dynamic imports inside the mount effect to static top-of-file `import` statements:

| Current (runtime, inside `init()`) | Line |
|---|---|
| `const { Terminal } = await import("@xterm/xterm");` | 147 |
| `const { FitAddon } = await import("@xterm/addon-fit");` | 148 |
| `const { ClipboardAddon } = await import("@xterm/addon-clipboard");` | 195 |
| `const { WebLinksAddon } = await import("@xterm/addon-web-links");` | 200 |
| `const { UnicodeGraphemesAddon } = await import("@xterm/addon-unicode-graphemes");` | 209 |
| `const { WebglAddon } = await import("@xterm/addon-webgl");` | 216 |

After the change:

- Static named imports at the top of the file: `import { Terminal } from "@xterm/xterm";`, `import { FitAddon } from "@xterm/addon-fit";`, and the four addons likewise.
- The `init()` effect body references the statically-imported symbols directly — the `cancelled` re-checks that currently guard each post-`await` step (`terminal-client.tsx:151, 196, 201, 210, 221`) are re-examined: the font-load `await` (`:162-173`) remains, so the unmount-during-init guards around it stay; the guards that existed *solely* because of the now-removed `await import()` boundaries can be simplified, but correctness of the existing teardown (`terminal.dispose()` on cancel) must be preserved.
- The `WebglAddon` load is currently wrapped in `try/catch` for silent canvas fallback (`:215-220`). With a static import, the *module load* can no longer fail at that point (it's resolved at chunk load); the `try/catch` stays around `new WebglAddon()` / `loadAddon` since WebGL context creation can still throw at runtime.

### Unchanged (already static, leave as-is)

- CSS side-effect import `import "@xterm/xterm/css/xterm.css";` (`:1`).
- Type-only references `import("@xterm/xterm").Terminal` (`:60`, `:141`) — erased at compile, no runtime cost.

## Affected Memory

<!-- Implementation-only change: no spec-level behavior changes. The board route, relay
     protocol, and terminal rendering behavior are all identical post-change — only the
     module-load timing moves from runtime to chunk-load. No memory file is created or
     modified by this change itself. The root-cause memory (e2e-flakiness-board-route-
     dynamic-import-hang) was already updated in this session to record the cause and the
     two drafted fixes; it documents the bug, not this change's deliverable. -->

None — implementation-only; no spec-level behavior change.

## Impact

- **Code**: `app/frontend/src/components/terminal-client.tsx` (imports + `init()` effect body).
- **Tests**: `terminal-client.test.tsx` already does `import { Terminal } from "@xterm/xterm"` (static) and `vi.mock("@xterm/xterm", ...)` plus `vi.mock("@xterm/xterm/css/xterm.css", ...)`. Static imports in the source align with how the test already mocks — the mocks should continue to apply. The other five addons are *not* currently mocked; converting them to static imports means they are imported at module-eval time of `terminal-client.tsx` in the test environment, so the test may now need `vi.mock` stubs for `addon-fit`, `addon-clipboard`, `addon-web-links`, `addon-unicode-graphemes`, `addon-webgl` (or jsdom-safe behavior must be verified). This is the main test-side risk to validate at spec/apply.
- **Bundle**: xterm family moves from per-pane lazy chunks into the terminal-client route chunk. Initial app bundle is unaffected (terminal-client is already route-lazy); the terminal-route chunk grows by the xterm family size, loaded once.
- **No API, backend, or protocol impact.** Relay WS, SSE, and tmux behavior are untouched.

## Open Questions

- Does converting the five addons to static imports break `terminal-client.test.tsx` under jsdom (e.g., `WebglAddon` touching WebGL APIs at import), requiring new `vi.mock` stubs? Validate during apply.
- ~~Should the WebGL addon stay dynamically imported while the other five go static?~~ **Resolved**: all six go static. Keeping WebGL dynamic would leave one chunk fetch on the runtime connection budget — partially undercutting the root-cause fix. The `try/catch` stays around `new WebglAddon()`/`loadAddon` for GPU-context failures, but the module load becomes static.
<!-- clarified: all six xterm imports go static (incl. WebGL) — user chose the cleanest full-removal of chunk fetches from the connection budget over the one-fetch middle ground -->
- ~~Does converting the five addons to static imports require new `vi.mock` stubs?~~ **Resolved**: no. `terminal-client.test.tsx` already mocks all six modules (`@xterm/xterm` :10, `addon-fit` :31, `addon-clipboard` :37, `addon-web-links` :43, `addon-webgl` :49, `addon-unicode-graphemes` :55) and already statically imports three (:4-6). Static source imports align with the existing mocks — no new stubs needed.
<!-- clarified: no new test mocks required — verified all six vi.mock stubs already present in terminal-client.test.tsx -->>

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Root cause is HTTP/1.1 6-per-origin connection-pool starvation, not a Vite-optimizer race or tmux contention | Confirmed this session by transport analysis + the prior local repro/instrumentation; documented in memory e2e-flakiness-board-route-dynamic-import-hang | S:95 R:80 A:90 D:90 |
| 2 | Certain | All 6 xterm-family imports in terminal-client.tsx are genuine runtime `await import()`; only CSS + type-only refs are static | Verified by reading the file this session (lines 1, 60, 141 static; 147,148,195,200,209,216 runtime) | S:95 R:90 A:95 D:95 |
| 3 | Confident | Static imports are the right fix because terminal-client.tsx is already router-lazy, so xterm bundles into an already-deferred chunk loaded once per route | Established the lazy-loading via router.tsx; every pane needs identical modules so per-pane dynamic import has no upside | S:80 R:70 A:80 D:80 |
| 4 | Confident | change_type = fix | Repairs a confirmed defect (deterministic board-route E2E hang); matches keyword "fix"/"hang"/"regression" | S:85 R:90 A:90 D:85 |
| 5 | Certain | All six xterm imports (including WebGL) go static — none stay dynamic | Clarified — user chose full removal of chunk fetches from the runtime connection budget over keeping one WebGL fetch dynamic; the try/catch stays around WebglAddon construction for GPU-context failures | S:95 R:80 A:90 D:95 |
| 6 | Certain | No new vi.mock stubs are needed in terminal-client.test.tsx | Clarified — verified all six modules are already mocked (terminal-client.test.tsx:10,31,37,43,49,55) and three already statically imported (:4-6); static source imports align with existing mocks | S:95 R:90 A:95 D:95 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).

# Hydrate notes for g9uo

## Invariant to capture in memory

Target file: `docs/memory/run-kit/ui-patterns.md` (or nearest navigation/SSE-related memory file — likely better placed under a `navigation` or `sse-routing` section, or a new one).

**Navigation invariant (new, introduced by g9uo)**:

The route-to-session redirect logic in `app.tsx` MUST NOT fire a "session/window gone" redirect for a freshly-navigated URL whose (session, window) pair has not yet been observed as valid in the SSE `sessions` stream. A stale cached first SSE payload, or a session whose window-list enumeration hasn't propagated yet, is not proof that the URL is unreachable — it is proof only that fresh data hasn't arrived. The gate is `currentWindowEverSeen`: a ref reset on every URL (server, session, window) change, flipped `true` the first time `currentWindow` is non-null. Passed into `computeKillRedirect` as `currentWindowEverSeen`, which short-circuits to `null` when false.

Why it matters: on a fresh server load where the SSE stream replays cached data before sending current data, or when tmux session enumeration lags by one event, the old logic redirected to `/:server` dashboard — tearing down the just-mounted `TerminalClient` (and its `[role="application"]` wrapper). This surfaced as an e2e flake where `.xterm-screen` was briefly visible then disappeared.

## Scope of the fix

- `app/frontend/src/lib/navigation.ts`: added `currentWindowEverSeen?: boolean` param to `computeKillRedirect`; any "gone" branch is now gated.
- `app/frontend/src/app.tsx`: added `currentWindowEverSeenRef` keyed on `${server}|${session}|${window}`, wired into the redirect `useEffect`.
- `app/frontend/src/lib/navigation.test.ts`: two new unit tests for stale-SSE and empty-windows-transient cases.
- No changes to `terminal-client.tsx` — the component was not the root cause.

# Intake: Desktop shell terminal links open externally

**Change**: 260730-e9lz-shell-terminal-links-external
**Created**: 2026-07-30

## Origin

Promptless dispatch (`/fab-proceed` create-intake) from a live discussion session in which the root cause was verified in code and the design decisions were explicitly confirmed by the user.

> Desktop shell: xterm terminal links never open — fix WebLinksAddon handler and make all shell link-opens external.

Key decisions from the discussion (user-confirmed):
- **All links open externally** — every new-window link intent in the shell goes to the system browser; the registered-origin in-window `contents.loadURL(url)` branch is dropped.
- **Fix the root cause in the frontend** — give `WebLinksAddon` an explicit handler so the real URL reaches the shell's `setWindowOpenHandler` (the shell cannot fix this alone; it only ever sees `about:blank`).
- **The `will-navigate`/`will-redirect` guard stays unchanged** — only new-window intents change.

## Why

**Problem**: In the Electron desktop shell (`app/desktop`), clicking a URL in an xterm terminal does nothing. Root cause (verified in code this session):

1. `app/frontend/src/components/terminal-client.tsx:280` loads `new WebLinksAddon()` with **no custom handler**. The addon's default handler (pinned `@xterm/addon-web-links` `^0.12.0` in `app/frontend/package.json`) calls `window.open()` with **no URL** (to obtain a blank window whose `.opener` it clears), then assigns `location.href = uri` on that window.
2. The shell's `setWindowOpenHandler` (`app/desktop/src/main.ts:336`, added in PR #462 — links have **never** worked in the shell) therefore receives `url: "about:blank"`, which matches neither a registered origin nor `isHttpUrl`, so it returns `{ action: "deny" }`. `window.open()` returns `null` in the renderer and the addon bails with a console warning ("Opening link blocked as opener could not be cleared"). In a regular browser `window.open()` succeeds on the click gesture, which is why links work there.

**If not fixed**: terminal URLs (PR links, doc links, localhost URLs printed by tools) are dead in the desktop shell — a core viewer affordance silently broken, with only a console warning as evidence.

**Why this approach**: fixing only in the shell is impossible — `about:blank` carries no URL information by the time the main process sees it. The frontend handler fix is required regardless of shell policy, and is behavior-equivalent in the browser. Collapsing the shell policy to all-external removes the in-window hijack branch that no code depends on.

## What Changes

### 1. Frontend root cause — explicit WebLinksAddon handler

`app/frontend/src/components/terminal-client.tsx:280` — replace the handler-less addon load:

```ts
// before
terminal.loadAddon(new WebLinksAddon());

// after
terminal.loadAddon(
  new WebLinksAddon((_event, uri) => {
    window.open(uri, "_blank", "noopener,noreferrer");
  }),
);
```

- **Browser behavior**: equivalent to today — new tab, opener severed (`noopener,noreferrer` replaces the addon's manual `.opener = null` dance).
- **Shell behavior**: the real URL now reaches `setWindowOpenHandler` instead of `about:blank`, so the main process can route it.
- This matches the established frontend idiom — every existing `window.open` call in `app/frontend/src` uses `window.open(url, "_blank", "noopener,noreferrer")` (e.g. `app.tsx:2040`, `app.tsx:2103`, `board-page.tsx:673`).

### 2. Shell policy — all new-window intents open externally

`app/desktop/src/main.ts:336-344` — collapse `setWindowOpenHandler` to: http(s) → `shell.openExternal(url)`, everything else → deny. Drop the registered-origin in-window `contents.loadURL(url)` branch (it does not open a new surface — it hijacks the current page):

```ts
// before
contents.setWindowOpenHandler(({ url }) => {
  const origin = originOf(url);
  if (origin !== null && registeredOrigins().has(origin)) {
    void contents.loadURL(url);
  } else if (isHttpUrl(url)) {
    void shell.openExternal(url);
  }
  return { action: "deny" };
});

// after (shape; exact seam may extract the decision into a pure helper for testability — see Tests)
contents.setWindowOpenHandler(({ url }) => {
  if (isHttpUrl(url)) void shell.openExternal(url);
  return { action: "deny" };
});
```

**Constraints (MUST hold)**:
- The `will-navigate`/`will-redirect` guard (`main.ts:348-357`) stays **unchanged** — it is what allows normal in-window SPA navigation on registered origins and blocks server-issued redirect escapes. Only new-window intents (`setWindowOpenHandler`) change.
- Keep the http(s)-only gate before `shell.openExternal` — passing arbitrary schemes (`file:`, `smb:`) to `openExternal` is a known injection vector (Constitution I, Security First posture).
- No dead code results: `originOf` and `registeredOrigins` remain in use by `isAllowedNavigation` (`main.ts:84-88`).

### 3. Tests

- **Frontend unit** (`app/frontend/src/components/terminal-client.test.tsx`): the file already mocks `@xterm/addon-web-links` (line 124). Extend the mock to capture the constructor's handler argument; assert the addon is constructed **with** a handler, and that invoking the handler with a URI calls `window.open(uri, "_blank", "noopener,noreferrer")`.
- **Desktop shell** (`app/desktop`): the package's test convention is Node's built-in runner over compiled output — colocated `src/*.test.ts` importing electron-free pure modules, run via `pnpm run test` (`node --test "dist/**/*.test.js"`; see `servers.ts` / `servers.test.ts`). `main.ts` imports `electron` at module top, so it cannot be imported under `node --test` — extract the window-open policy decision into a pure exported function (e.g. `windowOpenAction(url: string): "open-external" | "deny"` in a small electron-free module beside `servers.ts`), have `main.ts` consume it, and cover it with a colocated node:test suite: `https://…` → external, `http://…` → external, `about:blank` → deny, `file:///…` → deny, `smb://…` → deny, and a registered-origin http URL → external (proving the in-window branch is gone).
- **No new Playwright e2e**: xterm renders links on a canvas — link-region clicks are not reliably automatable, and the changed behavior is a `window.open` call fully verifiable at unit level.

### Alternatives rejected (from the discussion)

- **Fixing only in the shell**: impossible — `about:blank` carries no URL information by the time the main process sees it.
- **Keeping the registered-origin in-window branch**: rejected by the user; it replaces the current page rather than opening anything, and no code depends on it (verified: every `window.open`/`target="_blank"` in `app/frontend/src` targets external URLs — GitHub PR links `app.tsx:2040`, HELP_URL, status-tip/settings/sidebar doc links).

## Affected Memory

- `run-kit/desktop-shell`: (modify) security wiring — `setWindowOpenHandler` policy is now all-external (http(s) → system browser, everything else denied); the registered-origin in-window branch is gone; `will-navigate`/`will-redirect` guard unchanged
- `run-kit/ui-patterns`: (modify) terminal relay — `WebLinksAddon` now carries an explicit `window.open(uri, "_blank", "noopener,noreferrer")` handler (required for the desktop shell to see real URLs)

## Impact

- `app/frontend/src/components/terminal-client.tsx` — one-line addon-load change (handler added)
- `app/frontend/src/components/terminal-client.test.tsx` — extend existing WebLinks mock + new assertions
- `app/desktop/src/main.ts` — `setWindowOpenHandler` collapse; consume extracted policy helper
- `app/desktop/src/` — new small pure policy module + colocated `*.test.ts` (node:test)
- No backend, API, or route changes. No dependency changes (`@xterm/addon-web-links` stays at `^0.12.0`).
- Verification: `just test-frontend` (Vitest), `cd app/desktop && pnpm run compile && pnpm run test`, `cd app/frontend && npx tsc --noEmit`.

## Open Questions

- None — all decisions were resolved in the originating discussion.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | All new-window link intents in the shell open externally; drop the registered-origin in-window `contents.loadURL(url)` branch | Discussed — user explicitly chose all-external; verified no frontend code depends on in-window opens | S:95 R:85 A:95 D:95 |
| 2 | Certain | Frontend root-cause fix: explicit `WebLinksAddon` handler calling `window.open(uri, "_blank", "noopener,noreferrer")` | Discussed and code-verified — addon default opens `about:blank`; handler matches the codebase's universal `window.open` idiom | S:95 R:90 A:95 D:95 |
| 3 | Certain | `will-navigate`/`will-redirect` guard (`main.ts:348-357`) stays unchanged | Discussed constraint — it carries in-window SPA navigation and redirect-escape blocking; only new-window intents change | S:90 R:90 A:95 D:90 |
| 4 | Certain | Keep the http(s)-only gate before `shell.openExternal` | Discussed constraint — arbitrary schemes to `openExternal` are a known injection vector; Constitution I (Security First) | S:90 R:80 A:95 D:95 |
| 5 | Confident | Desktop test seam: extract the window-open policy decision into a pure electron-free function covered by a colocated node:test suite | Inspected convention — `pnpm run test` runs `node --test` over compiled pure modules (`servers.test.ts`); `main.ts` imports electron and cannot be imported under node:test | S:70 R:85 A:85 D:70 |
| 6 | Confident | No new Playwright e2e; unit coverage in `terminal-client.test.tsx` (existing mock at :124) plus the desktop policy suite suffices | xterm canvas link clicks are not reliably automatable; changed behavior is a `window.open` call fully assertable at unit level | S:65 R:85 A:80 D:70 |

6 assumptions (4 certain, 2 confident, 0 tentative, 0 unresolved).

# Intake: E2E Fixed-Port Hardening

**Change**: 260903-u1b8-e2e-fixed-port-hardening
**Created**: 2026-09-03

## Origin

> Remove fixed-port assumptions from e2e specs — derive the dead-URL port, the 3939 stub fallback, and make the Playwright port fallback actually fail closed against ambient RK_PORT

Conversational: from the `/fab-discuss` cross-worktree test-interference analysis (sibling changes 260903-y60c, 260903-np2w). The hazard sweep found three fixed-port assumptions that survive the otherwise fully derived per-worktree identity. User approved the fix set.

## Why

1. **`:8080` as the "dead web tab" URL**: five specs stamp `http://localhost:8080/` as a URL that must render the *unreachable* tile state — `right-panel.spec.ts:80`, `present-auto-expand.spec.ts:50`, `top-bar-overflow.spec.ts:679`, `code-surface.spec.ts:381`, `compose-strip.spec.ts:120`. The browser genuinely attempts the iframe load, so **any** process on `:8080` (a sibling worktree's app, a stray dev server) flips the assertion from "unreachable" to "reachable" and fails the spec.
2. **Fixed `3939` stub-bind fallback**: `resolveCodePort()` (duplicated in `code-surface.spec.ts:90-95`, `code-folder-latch.spec.ts:89,106`, `focus-restore.spec.ts:82,108`, `surface-focus-chords.spec.ts:59,84`) uses the derived `RK_CODE_SERVER_PORT` under the harness but hardcodes `127.0.0.1:3939` when unset — two bare `pnpm exec playwright test` runs collide (`EADDRINUSE` or cross-run stub hits).
3. **The fail-closed `:3333` fallback never fails closed on this box**: `playwright.config.ts:3`, `_boards.ts:108`, `session-reorder.spec.ts:91`, `echo-latency.spec.ts:59`, `touch-focus-gate.spec.ts:23`, `mobile-touch-scroll.spec.ts:22` all read `process.env.RK_PORT ?? "3333"`. direnv exports `RK_PORT=3000` into every shell here (documented in `scripts/e2e-env.sh:14-16`), so a bare `playwright test` silently drives the **live dev server on :3000** — mutating real state through its host tmux servers — instead of connecting to nothing.
4. **Consequence if unfixed**: parallel-worktree runs flake on the `:8080` specs whenever anything occupies that port, and the fail-closed safety net for direct Playwright invocation is a no-op on any direnv-configured box.

## What Changes

### 1. Derive the dead-URL port instead of `:8080`

Add a shared helper in the e2e helper tree (e.g. `_ports.ts` or extend `_tmux.ts`): `deadUrl()` — bind a `net` server on `127.0.0.1:0`, read the assigned ephemeral port, close the listener, return `http://localhost:<port>/`. A just-released ephemeral port is guaranteed unbound at use time for the spec's purposes (the OS won't immediately reassign it to another process's listener in the assertion window, and no run-kit component ever binds ephemeral-range listeners the specs would hit). The five specs call the helper instead of stamping `8080`. Each spec resolves it once in `beforeAll` (the helpers are sync-unfriendly in `test()` bodies; `net` listen is callback-based — wrap in a small promise).

### 2. Ephemeral fallback for the code-lens stub bind

`resolveCodePort()` keeps the harness path (`RK_CODE_SERVER_PORT` env, the derived `E2E_PORT+2`) but replaces the fixed `3939` fallback with an ephemeral bind: when the env is unset, bind the stub server itself on port `0` and read the actual port from `server.address()`. The four duplicated copies are consolidated into the same shared helper file as change area 1 (one `resolveCodePort`/`startCodeStub` export), removing the duplication the sweep flagged. Specs that need the port number for URL assertions read it from the started stub, not from a constant.

### 3. Make the port fallback genuinely fail-closed

Switch the spec-side base-port read from the ambient-polluted `RK_PORT` to a dedicated harness-only variable:

- `scripts/test-e2e.sh` (`run_playwright`) and `scripts/pw.sh` additionally pass `E2E_PORT` into the Playwright env (they already compute it; `RK_PORT` stays for anything else that reads it).
- `playwright.config.ts` and the five spec/helper sites read `process.env.E2E_PORT ?? "3333"`. direnv does not export `E2E_PORT`, so a bare `playwright test` now really lands on the connect-to-nothing `:3333` — the fail-closed design as documented in `docs/memory/run-kit/test-sockets.md` § port-fallback rule.

### 4. Polish: stale docstring

`server-reorder.spec.ts:24` still names the retired shared `:3020` rig — update the comment to the derived-triple reality (doc-only).

## Affected Memory

- `run-kit/test-sockets`: (modify) the port-fallback rule section — `E2E_PORT` as the spec-side read, `RK_PORT` no longer consulted by Playwright, ambient-direnv rationale

## Impact

- `app/frontend/tests/e2e/` — new/extended shared helper (`_ports.ts` or `_tmux.ts`), the five `:8080` specs, the four `resolveCodePort` specs, the six `RK_PORT ?? 3333` sites, `server-reorder.spec.ts` docstring
- `app/frontend/playwright.config.ts` — baseURL port source
- `scripts/test-e2e.sh`, `scripts/pw.sh` — pass `E2E_PORT` into the Playwright env
- Test/harness-only: no production code, no API change

## Open Questions

- None blocking.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Confident | Dead URL via bind-port-0-then-close rather than a reserved derived port | Discussed as the option needing no new port-block bookkeeping; collision window is negligible for an assertion-scoped URL | S:70 R:85 A:80 D:60 |
| 2 | Confident | Consolidate the 4 duplicated `resolveCodePort` copies into one shared helper | code-quality.md anti-pattern (duplicating utilities); sweep flagged the duplication | S:70 R:85 A:90 D:80 |
| 3 | Confident | Dedicated `E2E_PORT` env read (harness-set) over unsetting/ignoring `RK_PORT` inside Playwright | An explicit variable direnv never exports restores fail-closed without fighting the ambient env; harness already computes it | S:75 R:80 A:80 D:70 |
| 4 | Tentative | Helper file placement (`_ports.ts` new vs extending `_tmux.ts`) | Layout choice with no behavioral difference; decided at apply against the helper tree's shape <!-- assumed: new _ports.ts — _tmux.ts is tmux-scoped by name --> | S:45 R:90 A:70 D:50 |
| 5 | Certain | `RK_PORT` remains untouched for the backend/dev rig; only the Playwright-side read changes | The derivation contract in `scripts/e2e-env.sh` and the justfile dev convention depend on it | S:85 R:85 A:95 D:90 |

5 assumptions (1 certain, 3 confident, 1 tentative, 0 unresolved).

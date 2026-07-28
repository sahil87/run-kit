# Intake: Open-Button SSH-Host Refresh + Last-Used Icon

**Change**: 260723-l317-open-button-ssh-refresh-icon
**Created**: 2026-07-23

## Origin

Promptless dispatch (`/fab-proceed` create-intake), synthesized from a live conversation in which both defects were root-caused by code reading. The user's raw report:

> I saved SSH host `sahil@mini` in the Settings dialog, but the Open In button's VS Code deeplink still embeds the derived fallback `sahil@runner-mini.bat-ordinal.ts.net` (`${sshUser}@${location.hostname}`). Also: the Open split-button's primary segment should show the last-used app's logo, like Conductor.

Bundled as ONE change by explicit decision in conversation — both are Open-in-App split-button (top-bar, Terminal route) correctness/polish, sharing the same components and test files.

Key decisions reached in conversation (source of truth for this intake):
- Fix 1 is a **frontend cache-staleness bug** — the backend is already correct (verified: `app/backend/api/health.go:28-35` resolves `sshHost` settings-first per request). No backend changes.
- Fix the cache at the settings-commit seam via an exported invalidation function, not per-render refetching and not polling (both rejected — see Why).
- Fix 2 renders the existing `OpenTargetIcon` in the primary segment when a last-used target resolves; no icon when it doesn't.

## Why

**Fix 1 — SSH-host setting doesn't reach editor deeplinks.**

1. *Pain point*: The Settings dialog (shipped change 260723-o7q8) made `ssh_host` runtime-mutable via `POST /api/settings/ssh-host`, and the backend serves the fresh value on every `GET /api/health` (`app/backend/api/health.go:28-35`: `~/.rk/settings.yaml` `ssh_host` first, else the startup-seeded `RK_SSH_HOST` env). But the frontend hook `app/frontend/src/hooks/use-open-targets.ts:24-27` holds a **module-level cache** (`let cached: OpenContext | null`) that fetches `GET /api/health` + `GET /api/open-apps` ONCE per page load and never invalidates. The cache design predates the Settings dialog (it was correct when `sshHost` was boot-time-static) and was never updated for runtime mutability.
2. *Consequence if unfixed*: a saved SSH host only takes effect after a full page reload. Until then, editor deeplinks (VS Code / Cursor / Windsurf `vscode-remote://ssh-remote+...`) embed the stale derived fallback `${sshUser}@${location.hostname}` — for the user, `sahil@runner-mini.bat-ordinal.ts.net` instead of `sahil@mini` — producing SSH targets that may not even be reachable. The Settings dialog silently appears broken.
3. *Why this approach*: invalidate exactly at the one seam where the data can change — the Settings dialog's successful `setSSHHost` commit. **Rejected**: refetching health on every Open-button render (wasteful; the once-per-load cache is fine everywhere except this seam); client polling (project anti-pattern — `fab/project/code-quality.md`: "Polling from the client — use the SSE stream").

**Fix 2 — primary segment shows the last-used app's logo.**

1. *Pain point*: The last-used mechanism is fully shipped (260722-6d0f, 260722-fc3b): the preference persists in localStorage `runkit-open-last-used`, the primary segment re-runs it (`handlePrimary` in `app/frontend/src/components/open-button.tsx`), and monochrome `currentColor` brand glyphs exist (`OpenTargetIcon` in `app/frontend/src/components/open-app-icons.tsx` — VS Code/Cursor/Windsurf + kind-based generic fallback). The menu rows and overflow rows already render the glyphs. The one gap: the primary segment renders the static text "Open" with no icon, so nothing visually indicates which app a primary click will launch.
2. *Consequence if unfixed*: minor but real affordance gap — the primary click's effect is discoverable only via the tooltip/aria-label.
3. *Why this approach*: reuse the shipped `OpenTargetIcon` component verbatim; it already handles per-app glyphs and the generic fallback via `currentColor`, so the icon inherits the segment's secondary→primary hover flip for free.

## What Changes

### 1. `use-open-targets.ts` — module cache becomes an invalidatable external store

File: `app/frontend/src/hooks/use-open-targets.ts`

Convert the module-level `cached`/`pending` pair into a small external store with a subscriber list (plain subscriber array or React's `useSyncExternalStore` — implementer's choice; the store must be usable from the existing two consumers: the TopBar entry at `app/frontend/src/components/top-bar.tsx:457` and the palette builder at `app/frontend/src/app.tsx:2015`). Exact behavior:

- **Export `invalidateOpenContext(): void`** — clears the cached context, triggers a refetch of the bundle (`GET /api/health` + `GET /api/open-apps` — the cache holds both halves; refetch both), and notifies subscribers when the fresh data resolves, so *mounted* consumers re-render with the fresh context without a reload. When no consumer is mounted, the next `useOpenTargets(true)` mount fetches fresh — invalidation must at minimum drop the stale cache even if it chooses not to eagerly refetch with zero subscribers.
- `useOpenTargets(enabled)` keeps its exact signature and semantics: `enabled` gates the fetch; data still returns when another consumer already populated the cache; both halves stay individually fail-silent (failing health read ⇒ `sshHost: ""`, deeplinks section hidden, never a thrown error).
- The once-per-page-load behavior is otherwise preserved — no polling, no per-render fetching. Invalidation is event-driven from the settings commit only.
- Keep (or adapt) the existing test hook `resetOpenTargetsCacheForTest()`.
- Update the file's doc comment: the context is no longer "static per page load" — it is static *between settings commits*.

### 2. `settings-dialog.tsx` — invalidate on successful SSH-host commit

File: `app/frontend/src/components/settings-dialog.tsx` (the SSH host `TextSetting`, currently lines ~342-352)

In the SSH host `commit` handler, after `await setSSHHost(...)` succeeds, call `invalidateOpenContext()`:

```tsx
commit={async (trimmed) => {
  await setSSHHost(trimmed === "" ? null : trimmed);
  setSSHHostState(trimmed);
  invalidateOpenContext();
}}
```

Only on success (a rejected `setSSHHost` must not invalidate — the commit failed, the server value is unchanged). This covers both set and clear: clearing the field falls back server-side to `RK_SSH_HOST` (or empty ⇒ deeplink section disappears from Open targets on next build).

### 3. `open-button.tsx` — primary segment renders the last-used target's icon

File: `app/frontend/src/components/open-button.tsx` (primary segment button, currently lines ~108-118)

- When `lastUsed` resolves (non-null from `resolveLastUsedTarget(targets, readLastUsedOpenTarget())`), render `<OpenTargetIcon target={lastUsed} />` inside the primary segment button, before the text.
- **Keep the "Open" text label** — the icon is additive decoration, not a replacement.
- **No icon when `lastUsed` is null** — no last-used stored, or the stored id no longer resolves against live targets (e.g. sshHost cleared removed the deeplink section). The segment then looks exactly as today.
- The icon is `aria-hidden` decoration (it already is inside `OpenTargetIcon` per the shipped menu-row usage); the accessible name stays `Open in {label}` when `lastUsed` resolves, `Open in app` otherwise — unchanged from today.
- `OpenTargetIcon` uses `currentColor`, so it inherits the segment's `text-text-secondary hover:text-text-primary` flip with no styling work.
- Scope: the split-button primary segment ONLY. The dropdown rows, overflow `OpenMenuRows`, and palette entries already carry icons and are untouched.

### 4. Tests (required — code-quality.md: changed behavior MUST include tests)

- `app/frontend/src/hooks/use-open-targets.test.tsx` (exists): store invalidation — cached context served; after `invalidateOpenContext()`, a fresh `/api/health` value (changed `sshHost`) reaches a mounted consumer; zero-subscriber invalidation drops the cache so the next mount fetches fresh.
- `app/frontend/src/components/settings-dialog.test.tsx` (exists): committing the SSH host field calls the invalidation seam on success; a failing `setSSHHost` does not invalidate.
- `app/frontend/src/components/open-button.test.tsx` (exists): primary segment contains the target icon when a last-used target resolves; no icon when localStorage is empty or the stored id doesn't resolve; accessible names unchanged.
- E2E guard (project memory: Playwright specs assert top-bar chrome details): `app/frontend/tests/e2e/open-in-app.spec.ts` asserts the primary segment by *accessible name* (`Open in app`, `Open in iTerm`) — an `aria-hidden` icon does not break these. Grep `app/frontend/tests/` for Open-button assertions before altering its DOM further. If the e2e spec is extended (e.g. icon-visible-after-launch), the sibling `open-in-app.spec.md` companion MUST be updated in the same commit (Constitution — Test Companion Docs).
- Run tests only via `just` recipes (`just test-frontend`, `just test-e2e`, `just pw test open-in-app`) — never raw `go test`/`pnpm test`/`playwright test` (dedicated port 3020 + isolated tmux server; check `lsof -i :3020` for a cross-worktree squatter if e2e fails on phantom missing DOM).

## Affected Memory

- `run-kit/ui-patterns`: (modify) Open-in-App control — open-context freshness (settings-commit invalidation replaces "static per page load") and the primary segment's last-used icon.

## Impact

- **Frontend only** — no backend, API, or route changes. `app/backend/api/health.go` is already correct and untouched.
- Files: `app/frontend/src/hooks/use-open-targets.ts` (rework), `app/frontend/src/components/settings-dialog.tsx` (one-line seam call), `app/frontend/src/components/open-button.tsx` (icon in primary segment), plus their three colocated test files.
- Consumers of `useOpenTargets`: `top-bar.tsx:457` and `app.tsx:2015` — both consume the hook's return value only; signature unchanged, so no call-site edits expected (they benefit automatically via re-render on invalidation).
- Constraints honored: Constitution II (no backend persistence for the per-client last-used pref — stays localStorage `runkit-open-last-used`), Constitution IV (no new settings surface), code-quality anti-pattern "no client polling".

## Open Questions

- (none — all decision points were resolved in the originating conversation)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Bundle both fixes as one change | Discussed — explicitly decided; both are Open-button correctness/polish touching the same components and tests | S:95 R:85 A:90 D:90 |
| 2 | Certain | Frontend-only fix; backend untouched | Confirmed by code reading in conversation — `health.go:28-35` already resolves `sshHost` settings-first per request | S:95 R:90 A:95 D:95 |
| 3 | Certain | Invalidate at the settings-commit seam via exported `invalidateOpenContext()`; rejected per-render refetch (wasteful) and polling (code-quality anti-pattern) | Discussed — decided fix with alternatives explicitly rejected | S:90 R:85 A:90 D:90 |
| 4 | Confident | Store primitive is implementer's choice: subscriber list or `useSyncExternalStore` | Conversation named both as acceptable ("subscriber list or useSyncExternalStore"); behavior contract (invalidate → mounted consumers re-render) is fixed, primitive is reversible detail | S:75 R:80 A:80 D:60 |
| 5 | Confident | Invalidation refetches the full bundle (health + open-apps), not health alone | Conversation said "next read refetches /api/health"; the cache is one object holding both halves — refetching both is the simplest correct behavior and open-apps is cheap/fail-silent | S:60 R:85 A:80 D:70 |
| 6 | Confident | Invalidation eagerly refetches and pushes to mounted subscribers (settings dialog and TopBar are mounted simultaneously) | Conversation: "mounted consumers (the TopBar Open control and the palette builder in app.tsx) re-render with the fresh context" — lazy-only invalidation would leave the visible button stale until remount | S:80 R:75 A:80 D:75 |
| 7 | Certain | Icon is `aria-hidden` decoration; keep "Open" text; accessible name stays `Open in {label}` / `Open in app`; no icon when `lastUsed` is null | Discussed — explicit decision, including the null case (stale/absent stored id) | S:95 R:90 A:90 D:90 |
| 8 | Certain | Last-used preference stays client-side localStorage only | Constitution II — no backend persistence for per-client prefs; explicitly constrained in conversation | S:90 R:90 A:95 D:95 |
| 9 | Confident | Invalidate only on *successful* `setSSHHost`; a rejected commit does not invalidate | Follows from "calls it after a successful setSSHHost commit" — server value unchanged on failure, so invalidating would be wrong | S:70 R:85 A:85 D:80 |
| 10 | Confident | Existing e2e spec `open-in-app.spec.ts` needs no changes for the icon (asserts accessible names only); any e2e extension updates the `.spec.md` companion in the same commit | Verified by grepping `app/frontend/tests/` — assertions are role/name-based; Constitution's Test Companion Docs rule binds if the spec is extended | S:75 R:80 A:85 D:80 |
| 11 | Confident | `resetOpenTargetsCacheForTest()` is preserved or adapted; `useOpenTargets(enabled)` signature unchanged so `top-bar.tsx`/`app.tsx` call sites need no edits | Minimizes blast radius; both consumers verified to use only the returned context | S:70 R:85 A:85 D:80 |

11 assumptions (5 certain, 6 confident, 0 tentative, 0 unresolved).

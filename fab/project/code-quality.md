# Code Quality

## Principles

- Readability and maintainability over cleverness
- Follow existing project patterns unless there's compelling reason to deviate
- Prefer composition over inheritance
- `execFile` with argument arrays for all subprocess calls — never `exec` or backtick shell strings
- Server Components by default; Client Components only when interactivity requires it (keyboard handlers, xterm.js, SSE consumers)
- Type narrowing over type assertions — prefer `if` guards and discriminated unions over `as` casts
- Derive state from tmux + filesystem — no in-memory caches unless explicitly justified by performance measurement
- Wrap fab-kit scripts in typed async functions (`lib/*.ts`) — never call shell scripts directly from components or API routes

## Anti-Patterns

- God functions (>50 lines without clear reason)
- Duplicating existing utilities instead of reusing them — check `lib/tmux.ts`, `lib/worktree.ts`, `lib/fab.ts` first
- Magic strings or numbers without named constants
- `exec()` or `execSync()` anywhere — always `execFile` / `execFileSync` with argument arrays
- Inline tmux command construction — all tmux interaction goes through `lib/tmux.ts`
- `useEffect` for data fetching — use Server Components or server actions
- Client-side state for data that should come from the server (session lists, window status)
- Adding pages beyond the three-route structure without explicit spec justification
- Polling from the client — use the SSE stream (`/api/sessions/stream`), not `setInterval` + fetch
- Database/ORM/migration imports — this project has no database by constitution

## Verification

Before considering a change complete, run these gates in order:

1. **Type check** — `npx tsc --noEmit` (must exit 0, no errors)
2. **Production build** — `pnpm build` (must succeed — catches SSR issues, missing imports, and build-time env var problems that tsc alone misses)

When a test runner is configured, add `pnpm test` between steps 1 and 2.

## Test Strategy

Tests live in `__tests__/` folders adjacent to the code they test. Each code directory has at most one `__tests__/` folder. Test files use the `.test.ts` or `.test.tsx` extension.

```
src/lib/
  validate.ts
  config.ts
  __tests__/
    validate.test.ts
    config.test.ts
src/components/
  session-card.tsx
  __tests__/
    session-card.test.tsx
```

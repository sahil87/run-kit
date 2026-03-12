# Code Quality

## Principles

- Readability and maintainability over cleverness
- Follow existing project patterns unless there's compelling reason to deviate
- Prefer composition over inheritance
- **Go backend**: Use `exec.CommandContext` with timeouts for all subprocess calls — never shell strings
- **Frontend**: Type narrowing over type assertions — prefer `if` guards and discriminated unions over `as` casts
- Derive state from tmux + filesystem — no in-memory caches unless explicitly justified by performance measurement
- New features and bug fixes MUST include tests covering the added/changed behavior
- UI changes SHOULD include Playwright e2e tests where possible

## Anti-Patterns

- God functions (>50 lines without clear reason)
- Duplicating existing utilities — check `internal/tmux/`, `internal/sessions/`, `internal/fab/` (Go) and `src/api/client.ts` (frontend) first
- Magic strings or numbers without named constants
- Shell string construction for subprocess calls — always use `exec.CommandContext` with argument slices (Go)
- Inline tmux command construction — all tmux interaction goes through `internal/tmux/` (Go)
- Polling from the client — use the SSE stream, not `setInterval` + fetch
- Database/ORM/migration imports — this project has no database by constitution
- Adding routes without explicit spec justification

## Verification

Before considering a change complete, run these gates in order:

1. **Go tests** — `cd app/backend && go test ./...`
2. **Frontend type check** — `cd app/frontend && npx tsc --noEmit`
3. **Smoke check** — `just test` (runs backend + frontend + e2e tests)
4. **Production build** — `just build`

## Test Strategy

### Go backend (`app/backend/`)
Tests live alongside the code they test using Go conventions (`*_test.go` in the same package).

```
api/
  sessions.go
  sessions_test.go
internal/tmux/
  tmux.go
  tmux_test.go
```

### Frontend (`app/frontend/src/`)
Tests use `.test.ts` or `.test.tsx` extension, colocated with source files.

```
src/components/
  sidebar.tsx
  sidebar.test.tsx
  command-palette.tsx
  command-palette.test.tsx
src/api/
  client.ts
  client.test.ts
```

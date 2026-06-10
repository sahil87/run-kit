# Plan: Restore O(1) display-message lookup in ResolveWindowSession

**Change**: 260609-enic-restore-display-message-resolve-window
**Status**: In Progress
**Intake**: `intake.md`

## Requirements

### tmux: ResolveWindowSession owning-session lookup

#### R1: O(1) targeted owning-session resolution
`ResolveWindowSession` (`app/backend/internal/tmux/tmux.go`) SHALL resolve a window's owning
session via a single targeted `tmux display-message -t <windowID> -p "#{session_name}"` call
through the existing `tmuxExecServer` helper, instead of enumerating every window on the server
with `list-windows -a`. The function signature `(ctx context.Context, server, windowID string)
(string, error)` and the not-found error contract `fmt.Errorf("window %q not found", windowID)`
MUST be preserved unchanged. No `RelaySessionPrefix` filtering SHALL be introduced (the move-based
model removed window sharing and the symbol no longer exists). The implementation MUST stay on
`exec.CommandContext` via `tmuxExecServer` (Constitution I) — no shell strings.

- **GIVEN** a window ID `@N` that exists in exactly one session on the server
- **WHEN** `ResolveWindowSession(ctx, server, "@N")` is called
- **THEN** it returns that session's name with a nil error, derived from a single
  `display-message -t @N -p "#{session_name}"` call (not a full enumeration)
- **AND** the resolved session may be a normal home session OR a `_rk-pin-*` pin-session — both
  are valid results

#### R2: Not-found contract on missing or empty resolution
`ResolveWindowSession` SHALL return `fmt.Errorf("window %q not found", windowID)` when the window
ID does not exist. Both a tmux non-zero exit (tmux errors when `-t @N` names a missing window) AND
an empty/whitespace-only `#{session_name}` result MUST map to the not-found contract so the relay's
"any error ⇒ close 4004" behavior is preserved.

- **GIVEN** a window ID `@999999` that does not exist on the server
- **WHEN** `ResolveWindowSession(ctx, server, "@999999")` is called
- **THEN** it returns a non-nil error (so the relay emits code 4004 "Window not found")

#### R3: Doc comment reflects the targeted lookup
The doc comment above `ResolveWindowSession` (`app/backend/internal/tmux/tmux.go` ~lines 899-904)
SHALL describe a targeted `display-message` lookup that resolves the window's single owning
session. The "the first match is authoritative" enumeration phrasing MUST be removed. The comment
SHOULD retain the home-session vs `_rk-pin-*` pin-session duality and the not-found error contract
note that callers (the relay) depend on.

- **GIVEN** a reader of the `ResolveWindowSession` doc comment
- **WHEN** they read it after this change
- **THEN** it describes a single targeted `display-message` lookup, with no "first match"
  enumeration language

#### Non-Goals

- No changes to `app/backend/api/relay.go` — signature and error contract unchanged; the 5s
  relay timeout is intentionally left as-is (the algorithm, not the timeout, is the root cause).
- No changes to `app/backend/api/windows.go` (`handleWindowSelect`) — unchanged signature.
- No changes to `resolveWindowSessionIndex` (`tmux.go`) — already uses the targeted pattern and
  serves positional reorder.
- No `RelaySessionPrefix` filtering (symbol removed by #233).

#### Design Decisions

1. **Targeted `display-message` over enumeration**: resolve via `display-message -t @N -p
   "#{session_name}"` — *Why*: the move-based model (#233) makes a window live in exactly one
   session, removing the session-group ambiguity that the O(n) `list-windows -a` scan worked around
   in #205; restoring O(1) removes a latency regression on busy servers. — *Rejected*: bumping the
   5s relay timeout (pushes the cliff to larger servers and delays genuine not-found failures).
2. **Follow `resolveWindowSessionIndex` precedent**: mirror its format-string, `len(lines)==0`
   guard, and `strings.TrimSpace` style for consistency within the same file.

#### R4: Test coverage for both branches
The existing `TestResolveWindowSession_findsOwningSession` (`tmux_test.go`) MUST remain green
against the new implementation (it is contract-only). A new test SHALL cover the not-found branch:
resolving a non-existent window ID returns a non-nil error. Both reuse the existing
`withRealSessionTmux` live-tmux harness. (Unit `*_test.go` files are exempt from the `.spec.md`
companion-doc rule.)

- **GIVEN** the live-tmux `withRealSessionTmux` harness
- **WHEN** the found-case and not-found-case tests run
- **THEN** the found case returns the owning session and the not-found case returns a non-nil error

## Tasks

### Phase 2: Core Implementation

- [x] T001 Rewrite `ResolveWindowSession` body in `app/backend/internal/tmux/tmux.go` to a single `tmuxExecServer(ctx, server, "display-message", "-t", windowID, "-p", "#{session_name}")` call; on error return it, on empty lines OR empty trimmed `session` return `fmt.Errorf("window %q not found", windowID)`, else return the trimmed session — following the `resolveWindowSessionIndex` precedent; keep the signature unchanged <!-- R1 R2 -->
- [x] T002 Update the doc comment above `ResolveWindowSession` (`app/backend/internal/tmux/tmux.go` ~899-904) to describe the targeted `display-message` lookup, removing the "first match is authoritative" enumeration phrasing while keeping the home/pin-session duality and not-found-contract notes <!-- R3 -->

### Phase 3: Integration & Edge Cases

- [x] T003 Add a not-found-branch test to `app/backend/internal/tmux/tmux_test.go` reusing `withRealSessionTmux`: call `ResolveWindowSession(ctx, server, "@999999")` and assert a non-nil error; verify the existing `TestResolveWindowSession_findsOwningSession` stays green <!-- R4 -->

## Execution Order

- T001 blocks T003 (the not-found test exercises the new implementation)
- T002 is independent of T001/T003 (doc-only) and may run in any order

## Acceptance

### Functional Completeness

- [x] A-001 R1: `ResolveWindowSession` resolves the owning session via a single `display-message -t <windowID> -p "#{session_name}"` call through `tmuxExecServer`; the `list-windows -a` enumeration and linear scan are gone
- [x] A-002 R1: The function signature `(ctx, server, windowID) (string, error)` is unchanged and no `RelaySessionPrefix` filtering is present
- [x] A-003 R2: The not-found path returns `fmt.Errorf("window %q not found", windowID)` for both a tmux error and an empty/whitespace `#{session_name}` result
- [x] A-004 R3: The doc comment describes a targeted `display-message` lookup with no "first match" enumeration language, retaining the home/pin-session duality and not-found contract note

### Behavioral Correctness

- [x] A-005 R1: A valid window ID resolving to a `_rk-pin-*` pin-session OR a home session both return successfully (no ephemeral filtering rejects either)
- [x] A-006 R2: A non-existent window ID surfaces a non-nil error so the relay emits code 4004

### Scenario Coverage

- [x] A-007 R4: `TestResolveWindowSession_findsOwningSession` passes against the new implementation
- [x] A-008 R4: A new not-found-branch test asserts `ResolveWindowSession(ctx, server, "@999999")` returns a non-nil error, reusing `withRealSessionTmux`

### Code Quality

- [x] A-009 Pattern consistency: The rewrite mirrors `resolveWindowSessionIndex` (format string, `len(lines)==0` guard, `strings.TrimSpace`) and surrounding tmux.go conventions
- [x] A-010 No unnecessary duplication: Reuses the existing `tmuxExecServer` helper rather than introducing new exec plumbing
- [x] A-011 Security (Constitution I): All subprocess execution stays on `exec.CommandContext` via `tmuxExecServer` with explicit arg slices and a timeout context — no shell strings

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- Memory follow-up (hydrate): correct the `run-kit/tmux-sessions` bullet that documents
  `ResolveWindowSession` as a `list-windows -a` first-match lookup; cross-reference
  `resolve-window-session-on-relay-connect`.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `display-message -t <windowID> -p "#{session_name}"` via `tmuxExecServer` for the O(1) lookup | Command, helper, and Constitution I constraint specified verbatim in intake; `resolveWindowSessionIndex` demonstrates the exact pattern in the same file | S:98 R:80 A:95 D:95 |
| 2 | Certain | Preserve signature and `fmt.Errorf("window %q not found", windowID)` not-found contract | Explicitly required so the relay's "any error ⇒ 4004" path is preserved; confirmed against current source | S:98 R:85 A:95 D:95 |
| 3 | Certain | Do NOT filter `RelaySessionPrefix` | #233 deleted those ephemerals; the symbol no longer exists — filtering would not compile | S:95 R:80 A:98 D:95 |
| 4 | Certain | Scope limited to `tmux.go` + `tmux_test.go`; relay.go/windows.go and the 5s timeout untouched | Explicit scope boundary; signature unchanged so call sites need no edits | S:98 R:85 A:95 D:95 |
| 5 | Confident | Treat empty `display-message` output AND a tmux error as not-found | Intake says "handle empty output as window not found"; tmux also exits non-zero for a missing `-t @N`, so both branches map to the same contract — belt-and-suspenders, one obvious interpretation | S:85 R:80 A:80 D:78 |
| 6 | Confident | Add a not-found-branch test reusing `withRealSessionTmux`, keeping the existing found-case test | Intake asks for a unit test with cited precedent; the found-case test is contract-only and already exists, so the additive gap is the not-found path | S:88 R:75 A:85 D:80 |

6 assumptions (4 certain, 2 confident, 0 tentative).

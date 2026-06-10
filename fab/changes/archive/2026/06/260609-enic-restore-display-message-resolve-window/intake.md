# Intake: Restore O(1) display-message lookup in ResolveWindowSession

**Change**: 260609-enic-restore-display-message-resolve-window
**Created**: 2026-06-09
**Status**: Draft

## Origin

> Title: restore O(1) display-message lookup in ResolveWindowSession (relay-connect latency regression)
>
> PROBLEM: `app/backend/internal/tmux/tmux.go` `ResolveWindowSession` (~line 905) resolves a window's owning session by running `tmux list-windows -a -F "#{session_name}<delim>#{window_id}"` — this enumerates EVERY window in EVERY session on the server (O(total windows)) and linear-scans for the target windowID. It is called at relay WebSocket connect time (`app/backend/api/relay.go` ~line 78) under a 5-second timeout context, and by `handleWindowSelect` (`app/backend/api/windows.go`). On a busy box with many sessions/windows, the scan can approach the 5s timeout → relay closes with code 4004 "window not found" → terminal fails to connect.
>
> ROOT CAUSE / HISTORY (latency regression): The original implementation (commit `0b74816`, #204) used an O(1) targeted lookup: `tmux display-message -t <windowID> -p "#{session_name}"`. Commit `d59ae04` (#205) switched it to the O(n) `list-windows -a` enumeration to dodge a tmux SESSION-GROUP ambiguity — back then a window appeared under every group member and `display-message -t @N` could resolve to the ephemeral relay session (`RelaySessionPrefix`) instead of the real one. The enumeration filtered out `RelaySessionPrefix` sessions. Commit `11f467a` (#233) introduced the MOVE-BASED model which removed window sharing entirely (a window now lives in exactly ONE session — see the comment at `tmux.go:900-904` "the first match is authoritative"), eliminating the ambiguity that justified the scan. But #233 did NOT restore the fast path. The 5s relay timeout was never resized for the O(n) cost.
>
> FIX: Restore `ResolveWindowSession` to use `tmux display-message -t <windowID> -p "#{session_name}"` (O(1) targeted lookup). The move-based model makes this safe — there is no longer session-group ambiguity, so no `RelaySessionPrefix` filtering is needed. Trim a trailing newline / handle empty output as "window not found" (matching current error semantics: return `fmt.Errorf("window %q not found", windowID)`). Keep the same function signature and the same error contract callers rely on (relay treats the error as window-not-found → 4004).
>
> CONSTRAINTS: Constitution I (Security First) — must stay on `exec.CommandContext` with explicit arg slices and a timeout — use the existing `tmuxExecServer` helper, which already does this. No shell strings. Add/adjust a Go unit test in `app/backend/internal/tmux/tmux_test.go` covering the resolve (the pre-#205 version was tested — there is precedent). Do NOT change the 5s relay timeout — the algorithm is the root cause, not the timeout duration. Scope: `app/backend/internal/tmux/tmux.go` + its test only. Do NOT touch `relay.go` / `windows.go` call sites — the function signature is unchanged.
>
> change-type: fix

Interaction mode: one-shot. The change arrived fully diagnosed — root cause, commit
archaeology, the exact replacement command, the error contract, and an explicit scope
boundary were all supplied. No clarification was required.

## Why

**The problem.** `ResolveWindowSession` is on the hot path of every terminal connection.
The relay handler (`app/backend/api/relay.go:78-84`) calls it under a 5-second context the
moment a WebSocket opens, and uses its result to pick the tmux session to attach the PTY
to. The current implementation enumerates **every window in every session on the server**:

```go
// app/backend/internal/tmux/tmux.go:906
lines, err := tmuxExecServer(ctx, server, "list-windows", "-a", "-F",
    "#{session_name}"+listDelim+"#{window_id}")
// ... then linear-scan `lines` for the row whose window_id == windowID
```

This is O(total windows on the server). On a busy operator box (many sessions, many windows,
plus the `_rk-pin-*` board pin-sessions and the `_rk-ctl` anchor), the `list-windows -a`
round-trip plus the scan can approach the relay's 5-second budget. When it does, the resolve
context deadlines out, `ResolveWindowSession` returns an error, and the relay treats *any*
error as window-not-found and closes the socket with **code 4004 "Window not found"**
(`relay.go:82-84`). The terminal silently fails to connect — a window that exists appears
"not found" purely because of enumeration latency.

**Consequence if unfixed.** Terminal connect reliability degrades with server size. The
larger and busier the box (exactly the operator-orchestration use case run-kit targets), the
more often a healthy window fails to attach. This is a latent reliability cliff, not a
cosmetic slowdown.

**Why this approach.** The O(n) scan was never the desired design — it was a workaround for a
constraint that no longer exists. The original code (commit `0b74816`, #204) used an O(1)
targeted lookup, `tmux display-message -t <windowID> -p "#{session_name}"`. Commit `d59ae04`
(#205) replaced it with the enumeration to dodge a tmux **session-group ambiguity**: in the
old grouped-relay model, a window appeared under *every* member of its session group, so
`display-message -t @N` could resolve to the ephemeral relay session
(`RelaySessionPrefix = "rk-relay-"`) instead of the real home session. The enumeration scanned
the full list and filtered those ephemerals out. Commit `11f467a` (#233 — the move-based board
model) **removed window sharing entirely**: a window now lives in exactly ONE session at a
time (its home session or a single `_rk-pin-*` pin-session — never both). The grouped-relay
ephemerals were deleted wholesale (`RelaySessionPrefix`, `newEphemeralRelayName`, etc.). The
ambiguity that justified the scan is gone — the existing function comment already states "the
first match is authoritative" — but #233 did not restore the fast path. Restoring O(1) is the
correct fix: it removes a regression rather than papering over it, and `display-message -t @N`
is now unambiguous because the window has exactly one owning session.

**Why not bump the 5s timeout instead.** The algorithm is the root cause. Raising the timeout
would only push the cliff to a larger server size while making every genuine "window gone"
case wait longer before failing. The fix targets the cost, not the symptom.

## What Changes

### 1. Rewrite `ResolveWindowSession` to an O(1) targeted lookup (`app/backend/internal/tmux/tmux.go`)

Replace the `list-windows -a` enumeration + linear scan with a single targeted
`display-message`:

**Before** (`tmux.go:905-926`):

```go
func ResolveWindowSession(ctx context.Context, server, windowID string) (string, error) {
	lines, err := tmuxExecServer(ctx, server, "list-windows", "-a", "-F", "#{session_name}"+listDelim+"#{window_id}")
	if err != nil {
		return "", err
	}
	for _, line := range lines {
		parts := strings.SplitN(line, listDelim, 2)
		if len(parts) != 2 {
			continue
		}
		session := strings.TrimSpace(parts[0])
		id := strings.TrimSpace(parts[1])
		if id != windowID {
			continue
		}
		if session == "" {
			continue
		}
		return session, nil
	}
	return "", fmt.Errorf("window %q not found", windowID)
}
```

**After** (shape — the exact form follows the existing `resolveWindowSessionIndex` precedent at
`tmux.go:931-948`, which already does a `display-message -t <windowID> -p` targeted lookup):

```go
func ResolveWindowSession(ctx context.Context, server, windowID string) (string, error) {
	lines, err := tmuxExecServer(ctx, server, "display-message", "-t", windowID, "-p", "#{session_name}")
	if err != nil {
		return "", err
	}
	if len(lines) == 0 {
		return "", fmt.Errorf("window %q not found", windowID)
	}
	session := strings.TrimSpace(lines[0])
	if session == "" {
		return "", fmt.Errorf("window %q not found", windowID)
	}
	return session, nil
}
```

Key points:

- **Same signature, same error contract.** `func ResolveWindowSession(ctx context.Context, server, windowID string) (string, error)` is unchanged. The not-found path still returns
  `fmt.Errorf("window %q not found", windowID)` so the relay's "any error ⇒ 4004" behavior is
  preserved bit-for-bit. (Note: tmux returns a non-zero exit when `-t @N` names a missing
  window, so `tmuxExecServer` will already surface an `err` in the common not-found case; the
  empty-output guard is the belt-and-suspenders path that also satisfies "empty output ⇒
  not found".)
- **No `RelaySessionPrefix` filtering.** Those ephemerals were deleted by #233; the symbol no
  longer exists, and there is no session-group ambiguity to filter against. `display-message
  -t @N` resolves to the window's single owning session — a normal home session OR a
  `_rk-pin-*` pin-session, both of which are valid resolve results (the relay attaches
  directly to whichever it is).
- **Trailing-newline handling.** `tmuxExecServer` already returns stdout split into lines with
  empty lines filtered (see `tmux.go:227-228`). `strings.TrimSpace(lines[0])` covers any
  residual whitespace, matching the trimming the old code applied to its parsed fields.
- **`listDelim` is no longer needed by this function** — the format string is the single
  `#{session_name}` with no tab-delimited second field. Leave `listDelim` as-is (other
  functions still use it).
- **Security (Constitution I).** Stays on `tmuxExecServer(ctx, ...)`, which wraps
  `exec.CommandContext` with explicit argument slices and the server's `-L`/`-f` flags. No
  shell strings introduced. `windowID` is already a validated `@N` token by the time it reaches
  here (path params go through `validate.ValidateWindowID`, `^@[0-9]+$`), and it is passed as a
  discrete arg, not interpolated.

### 2. Update the doc comment (`app/backend/internal/tmux/tmux.go:899-904`)

The current comment already correctly describes the move-based "exactly ONE session" invariant
and "first match is authoritative." Adjust the wording so it no longer implies an enumeration
("first match") — describe it as a targeted `display-message` lookup that resolves the window's
single owning session, still noting the home-vs-pin-session duality and the not-found error
contract callers (the relay) depend on.

### 3. Add/adjust the Go unit test (`app/backend/internal/tmux/tmux_test.go`)

There is existing precedent and an existing test, `TestResolveWindowSession_findsOwningSession`
(`tmux_test.go:1154-1172`), which spins a real tmux server via `withRealSessionTmux(t)`, grabs
a real window ID, and asserts `ResolveWindowSession` returns the owning session. Keep that test
green (it is implementation-agnostic — it only checks the contract, so it validates the new
fast path unchanged). Add coverage for the **not-found** branch — call
`ResolveWindowSession(ctx, server, "@999999")` (a window ID that does not exist on the test
server) and assert it returns a non-nil error (the relay relies on this to emit 4004). This
exercises the new empty/error path explicitly. Follow the existing live-tmux test harness
patterns in the file (`withRealSessionTmux`, `tmuxExecServer`, 5s context). Unit tests
(`*_test.go`) are exempt from the `.spec.md` companion-doc rule (Constitution — Test Companion
Docs).

### Out of scope (explicit)

- **No changes to `app/backend/api/relay.go`** — the signature and error contract are
  unchanged, so the call site at `relay.go:78-84` (5s `WithTimeout`, 4004 on error) is
  untouched.
- **No changes to `app/backend/api/windows.go`** — `handleWindowSelect` (`windows.go:192`) and
  any other caller continue to work against the unchanged signature.
- **Do NOT change the 5s relay timeout** (`relay.go:78`). The algorithm is the root cause; the
  timeout duration is correct.
- No changes to `resolveWindowSessionIndex` (`tmux.go:931`) — it already uses the targeted
  `display-message` pattern and serves a different purpose (positional reorder).

## Affected Memory

- `run-kit/tmux-sessions`: (modify) The "Impact on Other Operations" section currently
  documents `ResolveWindowSession` as resolving "via `list-windows -a -F
  '#{session_name}\t#{window_id}'`, returning the first matching session." Update that bullet to
  reflect the O(1) `display-message -t <windowID> -p "#{session_name}"` targeted lookup, noting
  it is safe under the move-based one-session-per-window invariant and needs no
  `RelaySessionPrefix` filtering. This is a behavior-relevant (latency/correctness-of-method)
  detail already captured in memory, so it must be corrected. Cross-reference the existing
  memory note resolve-window-session-on-relay-connect, which already flags this regression.

## Impact

- **Code**: `app/backend/internal/tmux/tmux.go` (`ResolveWindowSession` body + doc comment);
  `app/backend/internal/tmux/tmux_test.go` (add not-found-branch coverage; keep the existing
  found-case test green).
- **Behavior**: relay-connect resolve latency drops from O(total windows) to O(1) per
  connect. Fewer spurious 4004 "Window not found" closes on busy servers. No API surface
  change.
- **Callers (unchanged)**: `app/backend/api/relay.go` (direct-attach relay), `app/backend/api/windows.go` (`handleWindowSelect`), `tmux.Pin` (home-session lookup), `ProjectRoot`. All
  consume the same `(string, error)` contract.
- **Dependencies**: none added. Uses the existing `tmuxExecServer` helper.
- **Constitution**: I (Security First) — preserved via `exec.CommandContext`/`tmuxExecServer`,
  explicit arg slices, timeout context. Test Integrity / Test Companion Docs — unit test,
  exempt from `.spec.md`.

## Open Questions

None. The change is fully specified: the exact replacement command, the error contract, the
scope boundary, and the test expectation are all given, and all were verified against the
current source (`tmux.go:905`, `relay.go:78`, `tmux_test.go:1154`).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `tmux display-message -t <windowID> -p "#{session_name}"` via `tmuxExecServer` as the O(1) lookup | Command, helper, and Constitution I constraint specified verbatim; `resolveWindowSessionIndex` already demonstrates the exact pattern in the same file | S:98 R:80 A:95 D:95 |
| 2 | Certain | Keep the signature `(ctx, server, windowID) (string, error)` and the `fmt.Errorf("window %q not found", windowID)` not-found contract | Explicitly required so the relay's "any error ⇒ 4004" path (`relay.go:82-84`) is preserved; confirmed against current source | S:98 R:85 A:95 D:95 |
| 3 | Certain | Do NOT filter `RelaySessionPrefix` | The move-based model (#233) deleted those ephemerals and the session-group ambiguity; symbol no longer exists — filtering would not compile | S:95 R:80 A:98 D:95 |
| 4 | Certain | Do NOT change the 5s relay timeout (`relay.go:78`) | Explicit constraint — algorithm is the root cause, not the duration | S:98 R:90 A:95 D:98 |
| 5 | Certain | Scope limited to `tmux.go` + `tmux_test.go`; no edits to `relay.go` / `windows.go` | Explicit scope boundary; signature is unchanged so call sites need no edits | S:98 R:85 A:95 D:95 |
| 6 | Confident | Treat empty `display-message` output AND a tmux error as "window not found" | Description says "handle empty output as window not found"; tmux also exits non-zero for a missing `-t @N`, so both branches map to the same not-found contract — belt-and-suspenders, one obvious interpretation | S:85 R:80 A:80 D:78 |
| 7 | Confident | Add a not-found-branch unit test alongside the existing `TestResolveWindowSession_findsOwningSession`, reusing the `withRealSessionTmux` live-tmux harness | Description asks for a unit test with cited precedent; the found-case test already exists and is contract-only, so the additive gap is the not-found path; harness pattern is established in the file | S:88 R:75 A:85 D:80 |
| 8 | Confident | Update the `tmux-sessions` memory bullet describing `ResolveWindowSession`'s method | Memory explicitly documents the current `list-windows -a` method; correcting it keeps memory authoritative, and it is the only memory entry naming the mechanism | S:85 R:80 A:85 D:82 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).

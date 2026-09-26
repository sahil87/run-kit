# Intake: Surface brew info stderr in rk update

**Change**: 260926-9h42-brew-info-stderr-surface
**Created**: 2026-09-26

## Origin

Adopted from branch `sunlit-howler` (no PR yet). The code was authored off-pipeline in a
conversational session and is being brought in via `/fab-adopt`.

The trigger was a real `rk update` failure diagnosed by the user: Homebrew refused to load
`sahil87/tap/hexokit` because the tap was untrusted, but run-kit printed only

> could not determine latest version: exit status 1

The real reason ("Refusing to load formula … untrusted tap") appeared only because `shll` then fell
back to a plain `brew upgrade` that streamed to the terminal. The diagnosis (pasted into the session)
asked for: (1) surface brew's stderr when `info` fails, the same way the `--quiet` path already does
for update/upgrade; (2) optionally, when that stderr contains "untrusted tap", add a hint
`run: brew trust sahil87/tap`.

## Why

`runBrewFn`'s `info` branch ran `cmd.Output()`, which captures only stdout. On a non-zero exit, brew's
stderr lands in `exec.ExitError.Stderr` and nothing read it, so the caller's error was a bare
`exit status 1` — the failure reason was destroyed. This violates the toolkit's errors-always-survive
rule (Principle 9 / R2) that the `--quiet` update/upgrade path already honors.

Homebrew's tap-trust enforcement will hit every user once it applies to them, and the run-kit →
hexokit formula rename makes a fresh (untrusted) tap more likely — so the untrusted-tap case deserves
an actionable hint rather than just the raw message.

Alternative considered: streaming `info`'s stderr live like non-quiet upgrade. Rejected — `info` is a
data query whose stdout is parsed; wrapping stderr into the error keeps output quiet on success and
diagnostic on failure, regardless of `--quiet`.

## What Changes

### `app/backend/cmd/rk/upgrade.go`

- The `info` branch of `runBrewFn` now inspects the `cmd.Output()` error: when it is an
  `*exec.ExitError` (via `errors.As`), the captured `ee.Stderr` is wrapped into the error.
- The `--quiet` streamed path's inline "trim errBuf, wrap if non-empty" logic moved into a new shared
  helper used by both paths:

  ```go
  func withBrewDetail(err error, stderr string) error {
      detail := strings.TrimSpace(stderr)
      if detail == "" {
          return err
      }
      if strings.Contains(detail, "untrusted tap") {
          detail += "\nhint: run: brew trust " + path.Dir(selfpath.BrewFormula)
      }
      return fmt.Errorf("%w: %s", err, detail)
  }
  ```

  `path.Dir("sahil87/tap/hexokit")` yields `sahil87/tap`, so the hint tracks the formula constant.
- `runBrewFn`'s doc comment notes that `info`'s stderr is wrapped into the error on failure.
- New import: `path`.

Resulting error for the original failure:

```
could not determine latest version: exit status 1: Error: Refusing to load formula sahil87/tap/hexokit from untrusted tap
hint: run: brew trust sahil87/tap
```

Non-quiet update/upgrade behavior is unchanged (stderr streams live; bare exit error). The hint also
applies on the `--quiet` update/upgrade path since it shares the helper.

### `app/backend/cmd/rk/upgrade_test.go`

- New `TestRunBrewFn_InfoFailureSurfacesStderrDetail`: a fake `brew` (existing `withFakeBrew`
  helper) writes an untrusted-tap refusal to stderr and exits 1; asserts the error from
  `runBrewFn(ctx, "info", "--json=v2", "sahil87/tap/hexokit")` contains both the stderr detail and
  `brew trust sahil87/tap`.

## Affected Memory

- `run-kit/toolkit-standards`: (modify) the "brew-stderr-in-error nuance in `update`" bullet currently
  covers only the `--quiet` buffered path; extend it to the `info` version lookup (stderr from
  `exec.ExitError` wrapped into the error on every run) and the untrusted-tap `brew trust` hint.

## Impact

- 2 files, ~45 lines added, backend CLI only (`rk update`). No API, frontend, or config surface.
- Test coverage: one new unit test exercising the real `exec.CommandContext` path via a stub `brew`
  on PATH; existing `TestRunBrewFn_QuietFailureSurfacesStderrDetail` still covers the quiet path.

## Open Questions

- None.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Wrap `info` stderr into the error rather than stream it | Mirrors the existing quiet-path rule; info stdout is parsed data | S:90 R:90 A:90 D:85 |
| 2 | Confident | Match the literal substring "untrusted tap" to trigger the hint | Taken from the observed Homebrew message; a wording change only drops the hint, never the detail | S:75 R:90 A:65 D:75 |
| 3 | Confident | `brew trust <tap>` is the correct remediation command | Stated in the diagnosis and was the fix the user actually applied; not verified against Homebrew docs in-session | S:70 R:90 A:55 D:80 |
| 4 | Confident | Change type is `fix` | Restores lost diagnostics; the hint is a small additive nicety | S:80 R:95 A:80 D:70 |
| 5 | Confident | Only `toolkit-standards` memory needs updating | It holds the brew-stderr-in-error rule; build-and-release mentions `brew info` only for version comparison | S:70 R:85 A:75 D:70 |

5 assumptions (1 certain, 4 confident, 0 tentative, 0 unresolved).

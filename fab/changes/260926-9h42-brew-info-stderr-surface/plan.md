# Plan: Surface brew info stderr in rk update

**Change**: 260926-9h42-brew-info-stderr-surface
**Intake**: `intake.md`

> Adopted change — code authored off-pipeline. Apply was skipped; this plan is reverse-engineered from the branch diff to feed hydrate.

## Requirements

### rk update: brew failure diagnostics

When `brew info --json=v2 sahil87/tap/hexokit` (the version lookup in `rk update`) exits non-zero,
`runBrewFn` wraps brew's trimmed stderr — captured by `cmd.Output()` into `exec.ExitError.Stderr` —
into the returned error. This applies on every run, quiet or not, because `info` never streams. The
caller's message therefore reads `could not determine latest version: exit status 1: <brew stderr>`
instead of a bare `exit status 1`. Empty stderr leaves the error unchanged.

The `--quiet` update/upgrade path keeps its existing behavior (buffered stderr wrapped into the error
on failure) and now shares the same helper, `withBrewDetail`, with the `info` path. Non-quiet
update/upgrade is unchanged: stderr streams live and the bare exit error is returned.

### rk update: untrusted-tap hint

When the captured brew stderr contains the substring `untrusted tap` (Homebrew's refusal to load a
formula from a tap the user has not trusted), the wrapped detail gains a trailing line
`hint: run: brew trust sahil87/tap`. The tap is derived from `selfpath.BrewFormula` via `path.Dir`,
so it follows the formula constant. The hint rides every path that uses the helper (info, and quiet
update/upgrade).

## Tasks

- [x] Adopted: implementation authored outside the pipeline (see branch `sunlit-howler`, commit cdde3def).

## Acceptance

- [x] Adopted: code already authored; a diff-only review runs in this pipeline.

## Assumptions

0 assumptions.

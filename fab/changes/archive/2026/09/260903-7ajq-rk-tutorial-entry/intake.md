# Intake: rk tutorial — one-command tour entry on a fast tier

**Change**: 260903-7ajq-rk-tutorial-entry
**Created**: 2026-09-03

## Origin

Backlog item `[7ajq]` (fab/backlog.md, added 2026-09-03), invoked via `/fab-new 7ajq` (one-shot, no prior discussion in-session). Raw backlog text:

> rk tutorial — one-command tour entry on a fast tier (like the operator launcher pattern): opens a window named 'tutorial' in the current session, launches the agent resolved for a fast tier ('fab agent <fast-tier> --print' via the existing internal/riff ResolveLauncher seam; plain-launcher fallback when fab absent; --tier override), and types in the kickoff prompt 'Run rk skill tutorial and follow it exactly'. Rationale: tour turns must be snappy (small/fast model suffices for narration) and the entry must be human-typable — a brand-new user runs 'rk tutorial', no skills knowledge needed. Validate the pacing contract holds on the fast tier before defaulting to it. Complements PR #799 (tutorial v3) and the /run-kit-tutorial invoker skill.

Intake-time verification: `fast` is a real fab role (`fab agent fast --print` resolves — valid selectors today: roles `default, doing, fast, hydrate, operator, review`); the named precedent (`fab operator`, fab-kit `cmd/fab/operator.go`) opens a window via `tmux new-window -c <dir> -n <name> "<launcher> '/fab-operator'"` with a singleton exact-name probe and a shell fallback — the kickoff rides the launcher as a **positional argument**, not typed keys.

## Why

1. **Pain point**: the guided tour (PR #799, `rk skill tutorial`) has no human-typable entry. Today a user must already have an agent running inside a run-kit window and know to ask it for the tutorial (or have the `/run-kit-tutorial` Claude Code skill deployed). The tour's own target persona — a first-time user, "a product manager, not a terminal native" — has neither.
2. **Consequence if unfixed**: the tutorial only reaches users who already cleared the hardest onboarding step (getting an agent running in run-kit), i.e., exactly the people who need it least. First-run activation stays gated on tribal knowledge.
3. **Why this approach**: a top-level `rk tutorial` command is the minimal human-typable surface — one word after the binary they just installed. The fast tier matters because tour turns are short narration beats gated on the user saying "next"; a heavyweight session model adds latency to every beat and burns budget on narration a small model handles fine. Reusing `internal/riff.ResolveLauncher` (which shells out to `fab agent <tier> --print`) keeps rk out of fab's tier→provider→command schema (constitution §III) and gives the fab-absent fallback for free (the seam already degrades silently to `DefaultLauncher` = `claude --dangerously-skip-permissions`).

## What Changes

### New command: `rk tutorial` (`app/backend/cmd/rk/tutorial.go`)

Cobra command registered in `main.go` alongside the existing top-level commands. Surface:

```
rk tutorial [--tier <role>]     # --tier defaults to "fast"
```

Behavior, mirroring the operator launcher pattern (fab-kit `cmd/fab/operator.go` `runOperator`):

1. **Precondition — inside tmux**: require the caller to be inside a tmux session (`internal/tmux.OriginalTMUX` non-empty, the same captured-`$TMUX` mechanism `cmd/rk/riff.go` `checkPreconditions` uses). On failure, exit 1 (shll exit-code convention: operational failure) with a message telling the user to open the run-kit dashboard and create a session/window first — consistent with the tutorial topic's own gate paragraph.
2. **Singleton probe**: enumerate window names in the **current session** and exact-match `tutorial`. If found, `select-window` to it (window-id targeting, `@N`, to dodge tmux prefix/glob target resolution — the `findWindowExact` lesson in operator.go) and report `Switched to existing tutorial tab.` — re-running `rk tutorial` returns to the tour rather than stacking `tutorial-2` windows.
3. **Resolve the launcher**: `riff.ResolveLauncher(ctx, cwd, tier)` with `tier` from `--tier` (default `"fast"`). This runs `fab agent fast --print` with `Dir` = process cwd and falls back silently to `riff.DefaultLauncher` on any failure (fab absent, non-zero exit, timeout, malformed output) — the backlog's "plain-launcher fallback" is the seam's existing contract, no new code.
4. **Compose the pane command** with the kickoff prompt as the launcher's positional argument, via riff's skill-pane composition (`buildSkillShellString`: `<launcher> '<escaped prompt>'`, wrapped `${SHELL:-/bin/sh} -i -c '…'` so rc-file aliases reach the launcher, suffixed `; exec "${SHELL:-/bin/sh}"` so the pane stays interactive after the agent exits). The kickoff prompt is a named constant, exact text:

   ```go
   const tutorialKickoffPrompt = "Run rk skill tutorial and follow it exactly"
   ```

5. **Open the window**: `tmux new-window -c <cwd> -n tutorial <shellCmd>` on the caller's current server (restored `$TMUX` in the child env — the riff CLI-path pattern, `childEnv`/`OriginalTMUX`).

All subprocess calls are argv-slice `exec.CommandContext` with timeouts (constitution §I); the launcher string remains the one documented shell-expansion exception, identical to riff's posture, and the kickoff prompt goes through the same single-quote escaping as riff task text.

### `internal/riff`: export the skill-shell composition seam

`buildSkillShellString` (internal today) becomes reachable by `cmd/rk/tutorial.go` — either exported directly or via a small exported helper (e.g. `riff.SkillPaneCommand(launcher, prompt string) string`). No behavior change for riff itself; existing tests keep passing byte-identically. Duplicating the three-layer composition in cmd/rk is ruled out (code-quality anti-pattern: duplicating existing utilities).

### Conformance and docs

- Toolkit standards (constitution §Toolkit Standards): new CLI surface → check against `shll standards` for help output/README/docs-site rules; `help_dump` snapshot regenerates with the new command; `docs/memory/run-kit/toolkit-standards.md` new-surface posture extends to `rk tutorial`.
- README / docs/site: name `rk tutorial` as the tour entry point where the tutorial is introduced (the `docs/site/skill/tutorial.md` topic page stays static-only; if its gate paragraph gains a pointer to `rk tutorial`, the synced embed under `cmd/rk/skill/` regenerates via `scripts/sync-skill.sh`).

### Validation: pacing contract on the fast tier

The backlog requires validating that the tour's pacing contract (one act per reply, stop-on-"next") holds on the fast tier before defaulting to it. This lands as an acceptance step in this change: launch `rk tutorial` against the resolved fast launcher and confirm the first act honors one-beat-per-reply pacing. If the fast tier's provider cannot follow the contract, the contingency is `--tier` default flipping to `""` (fab's default tier) with `fast` as the documented opt-in — a one-line change.

## Affected Memory

- `run-kit/rk-riff`: (modify) ResolveLauncher/skill-shell composition gains a second consumer (`rk tutorial`); the exported composition helper is a new seam fact.
- `run-kit/architecture`: (modify) CLI subcommand inventory gains `rk tutorial` (Cobra registration, tour entry point).
- `run-kit/toolkit-standards`: (modify) new-surface conformance row for `rk tutorial` (help-dump + principles check).

## Impact

- `app/backend/cmd/rk/`: new `tutorial.go` + `tutorial_test.go`; `main.go` registration; `help_dump` snapshot refresh. Unit tests must run under `env -u TMUX -u TMUX_PANE` (ambient-env false-green, PR #793 lesson).
- `app/backend/internal/riff/`: small export of the skill-shell composition (no behavior change).
- Docs: README/docs-site mention; possible `docs/site/skill/tutorial.md` gate-paragraph pointer (+ synced embed).
- No frontend, no HTTP API, no daemon changes. No new tmux options.

## Open Questions

- None blocking. The pacing-contract contingency (fast default vs opt-in) is resolved by the in-change validation step described above.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Top-level `rk tutorial` command; window named `tutorial`; `--tier` flag defaulting to `fast`; kickoff prompt exactly "Run rk skill tutorial and follow it exactly" | Backlog specifies every element verbatim; `fast` verified as a real fab role at intake | S:90 R:85 A:95 D:95 |
| 2 | Certain | Launcher resolution via `riff.ResolveLauncher` (`fab agent <tier> --print`), silent `DefaultLauncher` fallback when fab absent/failing | Backlog names the seam; the fallback is the seam's existing tested contract | S:95 R:90 A:95 D:95 |
| 3 | Certain | Must run inside tmux; exit 1 otherwise with a message directing the user to the dashboard flow | riff CLI precondition pattern + the tutorial topic's own `$TMUX_PANE` gate; shll exit-code convention fixes the code | S:65 R:90 A:90 D:85 |
| 4 | Confident | Kickoff delivered as the launcher's positional argument (riff skill-pane composition), not typed via send-keys | The named precedent (`fab operator`) passes its kickoff positionally too — the backlog's "types in" reads loosely; positional avoids the known send-keys Enter-delivery trap and reuses the proven task-injection seam | S:60 R:80 A:85 D:70 |
| 5 | Confident | Singleton per current session: an existing exact-name `tutorial` window is selected, not duplicated | Operator-pattern behavior (the backlog's named precedent); scoped to the session rather than operator's server-wide probe since a tour belongs to the project session it started in | S:55 R:85 A:75 D:65 |
| 6 | Confident | Ship with `--tier` default `fast`; pacing validation is an in-change acceptance step, contingency = flip default to fab's default tier | Backlog orders validation "before defaulting"; doing it inside this change satisfies that ordering without a second change; the default is a one-line reversal | S:55 R:85 A:50 D:60 |
| 7 | Confident | Window cwd = process cwd (also the `Dir` for launcher resolution); no repo-root requirement | The tour is project-agnostic; operator itself falls back to cwd; fab's own cwd-walk handles repo discovery when present | S:50 R:85 A:70 D:60 |
| 8 | Confident | Reuse riff's `buildSkillShellString` via a small export rather than duplicating the composition in cmd/rk | Code-quality anti-pattern rule (no duplicated utilities); export is behavior-preserving | S:60 R:85 A:90 D:80 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).

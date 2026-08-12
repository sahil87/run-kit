# Intake: Condense agent-setup Consent Output

**Change**: 260812-7a58-condense-agent-setup-consent-output
**Created**: 2026-08-12

## Origin

One-shot `/fab-new 7a58` from the backlog entry:

> [7a58] 2026-08-12: agent-setup consent output is pages long (~230 lines fresh-run, surfaced via shll agent-setup): 1) stop dumping the full 135-line rk-owned tmux shim as a diff — diff/confirm exists to protect user-authored files, one summary line with the path suffices; 2) renderArtifactDiff prints full current+proposed bodies for settings.json — use a unified diff or semantic summary (adds 6 rk-owned hook entries: SessionStart, PreToolUse, UserPromptSubmit, Stop, Notification x2), full bodies only under --dry-run/verbose. Target ~15 lines while keeping the consent prompt honest

No prior conversation context — the intake is grounded in the backlog text plus a read of `app/backend/cmd/rk/agent_setup.go` and the affected memory files.

## Why

1. **The pain point**: a fresh `rk agent-setup` run prints ~230 lines before the first `[y/N]` prompt. `renderArtifactDiff` (`agent_setup.go:592`) prints the **complete** current and proposed bodies at three call sites: the settings.json hooks merge (`applyAgentHooks`, `:458` — two full JSON documents, ~90 lines fresh-run), the tmux guard shim (`installTmuxShimFile`, `:1010` — the full ~135-line shim script), and each startup-file PATH block (`applyTmuxGuardPathBlocks`, `:1129` — the **entire** `.zshenv`/`.bashrc` content, current and next, even though the owned change is a 3-line block). The consent question drowns in the dump, and `shll agent-setup` (which aggregates per-tool setup runs) multiplies the noise per tool.

2. **The consequence if unfixed**: users scroll pages to find each prompt, stop reading the diffs entirely (which defeats the honesty the diff exists for), and the aggregated `shll agent-setup` transcript becomes unusable as more tools adopt the pattern.

3. **Why this approach**: the full-body diff's protective value is misplaced. rk **never overwrites files it does not own** — marker-less files are skipped before any diff renders (`installTmuxShimFile:983`, `skillHasMarker`) — so the shim diff only ever shows rk-owned→rk-owned or fresh-install content; for user-authored startup files the honest unit of change is the exactly-known 3-line marker block, not the surrounding user content; and for settings.json the semantic content of the merge ("adds these 6 rk-owned hook entries, preserves everything else") is what a consenting user actually needs to know. Full bodies stay available where they are explicitly requested data: `--dry-run`.

## What Changes

All changes are presentation-only in `app/backend/cmd/rk/agent_setup.go`. Consent semantics (`consent`, `authorizeWrite`, non-TTY refusal), channel routing (`consent.diffWriter` — chatter on `--yes`, data on interactive/`--dry-run`), write behavior, idempotence, and marker-ownership rules are all unchanged.

### 1. Settings hooks merge — semantic summary instead of full JSON bodies

`applyAgentHooks` currently renders `mustMarshalIndent(current)` vs `mustMarshalIndent(next)` — two complete settings.json documents. Replace the interactive/`--yes` rendering with a per-entry semantic summary derived from the registry rows plus the merge's replace/remove accounting, e.g. (fresh install):

```
Claude Code: will install run-kit agent-state hooks in ~/.claude/settings.json
  + UserPromptSubmit → active
  + PreToolUse → active
  + Notification (permission_prompt|elicitation_dialog|agent_needs_input) → waiting
  + Notification (idle_prompt) → idle
  + Stop → idle
  + SessionStart → chat stamp
  (all other settings and non-rk hooks preserved)
```

On a re-run that replaces old-generation entries, the summary notes it (e.g. `(replaces 6 existing rk-owned entries in place)`); on `--uninstall` the lines flip to `- removes 6 rk-owned hook entries (…)`. The count and event names come from the actual computed merge, not a hardcoded string.

### 2. tmux shim — one summary line

`installTmuxShimFile` currently diffs the full ~135-line shim script. Replace with a single line, e.g.:

- fresh install: `tmux guard: will install the tmux shim at ~/.local/share/rk/shims/tmux (rk-owned guard script, ~135 lines).`
- rk-owned content update (e.g. embedded rk path changed): `tmux guard: will update the rk-owned tmux shim at ~/.local/share/rk/shims/tmux.`

Marker-less foreign files never reach this point (skipped earlier with the existing note), so no protective information is lost.

### 3. Startup-file PATH blocks — show the owned block, not the whole file

`applyTmuxGuardPathBlocks` currently renders the entire startup-file content as current+proposed. Replace with the exact 3-line marker block plus target and placement, e.g.:

```
tmux guard: will add the rk PATH block to ~/.zshenv (appended at end):
  # >>> rk tmux guard >>>
  export PATH="$HOME/.local/share/rk/shims:$PATH"
  # <<< rk tmux guard <<<
```

On uninstall: `tmux guard: will remove the 3-line rk PATH block from ~/.bashrc.` These files are user-authored, but the change shown is byte-exactly the region rk owns (replace-in-position or append per `upsertMarkerBlock`), so the consent prompt stays fully honest without printing the user's file back at them.

### 4. `--dry-run` keeps the full bodies

The `--dry-run` path retains today's full `renderArtifactDiff` output at all three sites — it is the explicitly-requested preview data (and already routes to the never-gated data channel). No new `--verbose` flag is added; the backlog's "--dry-run/verbose" is satisfied by the existing flag. Interactive and `--yes` paths get the summaries above; `--yes --quiet` stays fully silent on success (R5 net-effect unchanged).

### 5. Tests

`agent_setup_test.go` assertions that match the current full-body output are updated to the new summary forms; new/updated cases cover: fresh-install summary content (entry count + event names from the real merge), uninstall summary, `--dry-run` still emitting full bodies, and the PATH-block excerpt rendering (append vs in-position replace wording). Per constitution Test Integrity, tests follow the new spec.

Fresh-run interactive total lands at roughly 15–25 lines across the three consent stops (vs ~230 today).

## Affected Memory

- `run-kit/agent-state`: (modify) — the installer's diff/consent presentation: semantic hook-entry summary on interactive/`--yes`, full bodies only under `--dry-run`
- `run-kit/tmux-guard-shim`: (modify) — install contract's presentation: one-line shim summary and 3-line PATH-block excerpt replace whole-file diffs

## Impact

- `app/backend/cmd/rk/agent_setup.go` — the three `renderArtifactDiff` call sites, new summary helper(s), `renderArtifactDiff` retained for `--dry-run`
- `app/backend/cmd/rk/agent_setup_test.go` — output assertions
- No API, frontend, or tmux-behavior changes; no changes to what is written, only to what is printed before the prompt
- Verification: `go test ./...` in `app/backend`

## Open Questions

None — the backlog entry is specific, and the remaining choices grade Confident or above (see Assumptions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The tmux shim diff collapses to a one-line summary (path + rk-owned description) | Backlog states it directly ("one summary line with the path suffices"); display-only and trivially reversible | S:90 R:90 A:85 D:85 |
| 2 | Confident | settings.json uses a **semantic per-entry summary**, not a unified diff | Backlog offers both but spells out the semantic summary's content inline; a unified-diff engine is new machinery contra Constitution III (wrap, don't reinvent) and the summary is more legible for a JSON merge | S:70 R:85 A:75 D:65 |
| 3 | Confident | Full bodies live behind the existing `--dry-run` only; no new `--verbose` flag | Minimal surface (Constitution IV posture for CLI too); `--dry-run` already routes the diff to the never-gated data channel as requested output; "--dry-run/verbose" in the backlog reads as one gate, not two flags | S:55 R:90 A:70 D:55 |
| 4 | Confident | The startup-file PATH-block sites are in scope, compacted to the exact 3-line marker block + target file + placement | Not one of the backlog's two numbered items, but the ~15-line fresh-run target is unreachable while whole-file dumps remain, and the owned block is the honest unit of change for user-authored files | S:45 R:80 A:70 D:60 |
| 5 | Certain | Consent semantics, channel routing, and write behavior are untouched — presentation only | The backlog asks to keep "the consent prompt honest"; `consent`/`authorizeWrite`/`diffWriter` machinery is orthogonal to what is rendered | S:85 R:90 A:90 D:85 |

5 assumptions (2 certain, 3 confident, 0 tentative, 0 unresolved).

# Intake: Dashboard update job — append `--yes` to the shll update argv

**Change**: 260815-wdr4-shll-update-yes-flag
**Created**: 2026-08-15

## Origin

Promptless dispatch (`/fab-proceed` create-new) from a live conversation with a verified reproduction. The user endorsed a specific recommendation after the bug was traced in code and observed live (2026-08-15 screenshot: an rk-jobs `update` run completed 7/7 tools, then stalled forever at an interactive consent prompt).

> Append `--yes` to the `shll update` argv spawned by the dashboard update button, so unattended background updates in rk-jobs never hang on an interactive consent prompt.

Key decisions from the conversation:
- Append `--yes` on **both** the scoped path and the force/full-roster path — the button-driven flow is unattended by definition, so prompting is never correct there.
- Append **unconditionally** — no version probe, no `--help` sniffing, no gating on the checker snapshot. The graceful version-gate alternative was offered and explicitly rejected (for complexity).
- The upstream shll-side flag (`shll update -y/--yes` → `shll agent-setup -y/--yes` → `run-kit agent-setup --yes`) is filed as shll backlog item `[3ovi]` (2026-08-15, ~/code/sahil87/shll) and is **out of scope** here; this change notes the release-sequencing dependency only.

## Why

**The pain point.** The dashboard update button (`POST /api/update`) is handled by `handleShllUpdate` in `app/backend/api/update.go`, which spawns `shll update <matched tools…>` (scoped path) or `shll update` (force path, full roster) via the `runJobFn`/`daemon.RunJob` seam into a tmux window named `update` in the `rk-jobs` session on the rk-daemon socket. `shll update` ends by re-running `shll agent-setup`, which delegates to `run-kit agent-setup` (deprecated alias of `rk agent setup`) with no consent flag.

`rk agent setup` (`app/backend/cmd/rk/agent_setup.go`) already implements `-y/--yes` (non-interactive consent), `--dry-run`, and a non-TTY refusal (`errNonInteractiveConsent`, agent_setup.go:287) that names `--yes`. But an rk-jobs tmux pane **is** a TTY, so the refusal never fires — the interactive `Write these changes? [y/N]` prompt fires instead, and the job hangs forever because nobody is attached to rk-jobs. Verified live 2026-08-15.

**Consequence of not fixing.** Every dashboard-triggered toolkit update that reaches the agent-setup write path silently stalls: the update chip never clears, the job window sits at a prompt indefinitely, and the user has no signal short of opening the rk-jobs window manually.

**Why this approach.** Appending `--yes` at the spawn site makes the argv honest about what the flow is — unattended. The unconditional append was chosen over a version-gated one because an older shll without the flag hard-errors on the unknown flag (cobra), which is a *visible, diagnosable* failure in the job window — strictly better than the current *silent indefinite hang*. The version-gate alternative was rejected for complexity.

## What Changes

### `handleShllUpdate` argv (app/backend/api/update.go)

Append `--yes` to the job argv on **both** paths, by placing it in the initial args slice immediately after the `update` subcommand:

```go
args := []string{shllPath, "update", "--yes"}
```

- **Scoped path** (non-force): argv becomes `shll update --yes <matched tools…>` — cobra parses interspersed flags, so tool positionals after the flag are fine.
- **Force path** (full roster): argv becomes `shll update --yes`.

Positioning the flag before the tool names (rather than appending after them) means one insertion covers both paths and the flag can never be visually confused with a tool positional. Either position is functionally equivalent under cobra; this is the chosen one. The flag is added by the handler itself and never passes through tool-name validation — `validate.ValidateToolName` (app/backend/internal/validate/validate.go:429) continues to guard only the remote-manifest tool names (dropping names starting with `-`), unchanged.

Update the `handleShllUpdate` doc comment to state the unattended-consent rationale (the job window has a TTY but no operator, so `--yes` is mandatory) and the sequencing dependency on shll gaining the flag.

### Tests (app/backend/api/update_test.go)

The `jobRecord` seam captures the RunJob argv and existing tests assert it exactly. Update the expected argv in:

- `TestHandleUpdateShllScopedSpawnsMatched` — want `[shll update --yes fab-kit run-kit]`
- `TestHandleUpdateShllDropsFlagLikeToolName` — want `[shll update --yes fab-kit]` (hostile `--force` manifest name still dropped; the handler-added `--yes` is present by construction, not via the manifest)
- `TestHandleUpdateShllForceFullRoster` — want `[shll update --yes]`
- `TestHandleUpdateShllPresentIgnoresBrew409` — want `[shll update --yes fab-kit]`

Coverage of `--yes` presence on both scoped and force paths falls out of these exact-argv assertions; add an explicit assertion only if the exact-match style is loosened. The shll-absent fallback tests (`TestHandleUpdateAcceptedSpawns`, `TestHandleUpdateForceSkipsQualifyKeepsBrew`, etc.) stay byte-identical — see Out of scope.

### Out of scope (verified)

- **`handleSelfUpdate` (shll absent → `rk update`)**: code reading confirms `rk update` (app/backend/cmd/rk/upgrade.go, `updateCmd`) runs three legs — brew CLI upgrade, desktop app update, code-server update — with no agent-setup leg and no consent read anywhere. It cannot hang on a prompt; its argv stays `[<selfPath> update]`.
- **The shll side** (`shll update` / `shll agent-setup` accepting `-y/--yes` and propagating to `run-kit agent-setup --yes`): shll backlog item `[3ovi]`, implemented in the shll repo.

### Release sequencing (dependency note, not a task)

Today's released shll does **not** accept `--yes` on `shll update`; until `[3ovi]` ships, a dashboard update spawned by this build hard-errors in the job window with cobra's unknown-flag message. That is the accepted trade (visible failure > silent hang). Ship this change with or after the shll flag for the clean end-to-end path.

## Affected Memory

- `run-kit/architecture`: (modify) the REST API / rk-jobs job-window section — the update job's `shll update` argv now carries `--yes` unconditionally (unattended-consent contract; sequencing dependency on shll `[3ovi]`)

## Impact

- `app/backend/api/update.go` — one-line argv change in `handleShllUpdate` + doc-comment update
- `app/backend/api/update_test.go` — four exact-argv assertions updated
- No API-shape, frontend, or validation changes; no new dependencies
- Behavioral: with a `--yes`-capable shll, unattended updates complete end to end; with an older shll, the job fails loudly instead of hanging silently

## Open Questions

- (none)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Append `--yes` to the `shll update` argv on BOTH the scoped and the force/full-roster paths | Discussed — user endorsed this exact recommendation; button flow is unattended by definition | S:95 R:90 A:95 D:95 |
| 2 | Certain | Append unconditionally — no version probe, `--help` sniffing, or checker-snapshot gating | Discussed — version-gate alternative was offered and rejected for complexity; older shll's unknown-flag hard error is visible and strictly better than the silent hang | S:90 R:85 A:90 D:90 |
| 3 | Confident | Place the flag immediately after `update` in the initial args slice (`{shllPath, "update", "--yes"}`) rather than after the tool names | Conversation allowed either position (cobra parses interspersed flags); this one covers both paths with a single insertion and keeps the flag visually separate from tool positionals | S:75 R:95 A:90 D:70 |
| 4 | Certain | `handleSelfUpdate` (shll-absent `rk update` fallback) needs no change | Code-read verified: `rk update` runs brew/desktop/code-server legs only — no agent-setup delegation, no consent prompt anywhere in upgrade.go | S:80 R:90 A:95 D:90 |
| 5 | Certain | Update the four exact-argv test assertions in update_test.go; `--yes` coverage on both paths rides the exact-match assertions | Constitution Test Integrity + code-quality "changes MUST include tests"; the jobRecord seam already asserts argv byte-exactly | S:85 R:95 A:95 D:90 |
| 6 | Certain | shll-side `-y/--yes` support is out of scope; record the release-sequencing dependency (`[3ovi]`) in this intake only | Discussed — upstream change filed as shll backlog `[3ovi]` in ~/code/sahil87/shll; user scoped this change to the run-kit argv | S:90 R:90 A:90 D:95 |

6 assumptions (5 certain, 1 confident, 0 tentative, 0 unresolved).

# Intake: Agent-setup tutorial invoker skill

**Change**: 260903-kqps-agent-setup-tutorial-invoker-skill
**Created**: 2026-09-03

## Origin

One-shot `/fab-new kqps` from the backlog:

> [kqps] 2026-09-03: rk agent setup should install the run-kit-tutorial invoker skill: write ~/.claude/skills/run-kit-tutorial/SKILL.md (tracked source in-repo beside the other agent-setup payloads, generation-stamped like the guard shim) — a thin router: gate rk+TMUX_PANE, run 'rk skill tutorial', follow it exactly; description triggers on tutorial/tour/onboarding phrasing and forbids the ONBOARDING.md detour. Found live: latest rk on another machine has the tour content but no discovery route (2026-09-03). Complements [7ajq] rk tutorial (human-typed entry); this covers the ask-a-running-agent entry.

No prior conversation on this topic — the intake is grounded in the backlog entry plus a code read of `cmd/rk/agent_setup.go`, `cmd/rk/tmux_guard.go`, `cmd/rk/skill.go`, `cmd/rk/skill/tutorial.md`, and `cmd/rk/doctor.go`.

## Why

1. **The pain point**: the run-kit tutorial content ships in the binary (`rk skill tutorial`, PR #799) and has a human-typed entry (`rk tutorial`, backlog [7ajq], done), but the most natural entry for the target audience — asking an agent already running in a run-kit pane "give me a tour of run-kit" — has **no discovery route**. Observed live 2026-09-03: a machine with the latest rk had the full tour content installed, and an agent asked for a tour could not find it; the known failure mode is improvising or detouring into a repo's `ONBOARDING.md`.
2. **If we don't fix it**: the tutorial investment is invisible exactly where new users are — in front of an agent. Every "show me around" ask lands on improvisation, which is inconsistent, misses the live companion pages, and skips the pacing/cleanup contract the real tour carries.
3. **Why this approach**: a user-global Claude Code skill is the discovery mechanism the harness itself provides — a skill description is what makes an agent find the tour from natural phrasing. `rk agent setup` is the existing user-global installer with the exact managed-artifact contract this needs (marker ownership, diff + consent, idempotent replace-in-place, `--uninstall`). The skill is a **thin router**, not content: the tour itself stays behind `rk skill tutorial` served by the binary, so content updates track `brew upgrade rk` with zero skill churn — the same freeze-avoidance rationale that moved the agent-state hooks to `rk agent hook` delegation and retired the fat `rk-display` skill. The router only encodes what cannot live in the binary: the trigger description and the two-line invocation route.

## What Changes

### 1. New tracked payload: the invoker skill source

A new markdown payload, tracked in-repo and embedded in the binary via `//go:embed`, containing the full `SKILL.md` to install. Location: a dedicated path under `cmd/rk/` (e.g. `cmd/rk/agentskill/run-kit-tutorial.md`) — deliberately **not** under `cmd/rk/skill/` (that directory is the `rk skill` bundle namespace, synced from `docs/site/` by `scripts/sync-skill.sh` with embed drift-guard tests; this payload is an installer artifact, not a servable topic and not docs/site-synced) and **not** a Go string const (multiline markdown reviews and diffs better as a file). The exact subdir name is decided at apply (Assumption 5).

Payload content (the installed `~/.claude/skills/run-kit-tutorial/SKILL.md`):

- **Frontmatter**: `name: run-kit-tutorial`; an ownership/generation marker comment (see §3); a `description:` written to trigger on tutorial / tour / onboarding / walkthrough / "show me around" phrasing about run-kit, and stating explicitly that this skill — not a repo's `ONBOARDING.md`, and not an improvised tour — is the route for such requests.
- **Body** (thin router, mirroring the gate `rk skill tutorial` itself opens with):
  1. Gate: `command -v rk >/dev/null 2>&1 && [ -n "$TMUX_PANE" ]` — if either fails, STOP and tell the user to open the run-kit dashboard, create a session/window for this directory, run the agent inside it, and ask again.
  2. On pass: run `rk skill tutorial` and follow its output **exactly** — it owns the chapters, pacing, degradation posture, and cleanup. Do not summarize, reorder, or substitute content.

### 2. Installer: a third managed artifact family in `rk agent setup`

`rk agent setup` currently manages two artifact families (per-agent hooks merge; user-global tmux guard shim). This change adds a third: the tutorial invoker skill, installed per-agent at `{skillsDir}/run-kit-tutorial/SKILL.md` for every registry row with a non-empty `skillsDir` (v1: Claude Code only → `~/.claude/skills/run-kit-tutorial/SKILL.md`).

The install step follows the existing managed-artifact contract verbatim (pattern: `installTmuxShimFile` + `removeLegacySkill`):

- **Ownership**: only a file carrying the rk ownership marker is ever overwritten or removed. An existing marker-less file at the path (user-authored, including zero-byte — existence-aware read via `readFileIfExists`) is left untouched with a skip note.
- **Idempotence**: installed content byte-equal to the embedded payload → reported no-op, no prompt. Content drift (an older generation) → replace in place after consent.
- **Consent**: reuses the `consent{yes, dryRun, stdinIsTTY}` machinery — interactive [y/N] with a summary, `--dry-run` full diff via `renderArtifactDiff`, `--yes` narration to chatter (Principle 9 channel routing as in the existing steps), non-TTY refusal unchanged.
- **`--uninstall`**: removes the marker-owned `run-kit-tutorial/` directory (`os.RemoveAll` after consent, dir-level like the legacy rk-display cleanup); absent file is silent.
- **Ordering**: runs inside the per-agent loop (`applyAgentConfig`), independent of the hooks merge — declining or no-op-ing one step never skips the other, matching the existing step independence.

Housekeeping in the same file: the `agent_setup.go` header comment ("manages two artifact families", "no longer installs any skill") and the `agentConfig.skillsDir` doc comment are updated — `skillsDir` gains a real consumer again and its "scheduled for removal" note is rescinded; the **legacy rk-display cleanup** (`removeLegacySkill` and its constants) is untouched and keeps its own one-release removal schedule. The `rk agent setup` `Long` help text gains a line naming the skill install.

### 3. Generation stamping

Ownership marker embedded in the payload's frontmatter comment, following the shim's parenthesized-family pattern: `managed-by: rk agent-setup (run-kit-tutorial skill)` — frozen text once shipped (it must match artifacts already on user machines, same rule as `tmuxShimMarker`). Currency is determined by byte-comparing the installed file against the embedded payload — the marker identifies *ownership*, the content compare identifies *staleness*, and a re-run of `rk agent setup` (the documented upgrade action) replaces a stale generation in place. No numeric generation counter (Assumption 6).

### 4. Out of scope (non-goals)

- **No `rk doctor` row** for the skill in v1: absence is a valid state (setup not run), drift is repaired by the documented re-run of `rk agent setup`, and the backlog doesn't ask for one. A doctor row (mirroring the agent-hooks generation row) is a clean follow-up if drift proves common (Assumption 7).
- **No other-agent rows**: only the Claude Code registry row has a `skillsDir`; codex/copilot/gemini rows remain additive follow-ups.
- **No change to `rk skill tutorial` content** and no change to `rk tutorial` ([7ajq]).

## Affected Memory

- `run-kit/agent-state.md`: (modify) the `rk agent setup` installer section — document the third managed artifact family (run-kit-tutorial invoker skill): install path, marker, contract, uninstall; note the `skillsDir` field's revived consumer alongside the still-scheduled legacy rk-display cleanup.

## Impact

- `app/backend/cmd/rk/agent_setup.go` — new install/uninstall step + registry/comment updates (primary surface)
- `app/backend/cmd/rk/agent_setup_test.go` — new cases: fresh install, idempotent re-run, stale-generation replace, marker-less file skip, `--uninstall`, `--dry-run`, non-TTY refusal unchanged
- New embedded payload file under `app/backend/cmd/rk/` (+ its `//go:embed` wiring)
- No frontend, API, daemon, or tmux-substrate changes; no new settings keys (Constitution IV untouched)
- Note for apply: new `cmd/rk` tests must run with `env -u TMUX -u TMUX_PANE` to avoid ambient-tmux false greens (known project gotcha)

## Open Questions

- None — the backlog entry is specific and the installer contract is fully established by existing code.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | v1 installs for Claude Code only, at `{skillsDir}/run-kit-tutorial/SKILL.md` (`~/.claude/skills/...`), located via the registry's existing `skillsDir` field | Backlog names the exact path; the registry already carries `skillsDir` for exactly one agent | S:90 R:85 A:95 D:90 |
| 2 | Certain | Managed-artifact contract mirrors `installTmuxShimFile`/`removeLegacySkill`: marker ownership, marker-less skip, content-equal no-op, consent modes, dir-level `--uninstall` | The contract is established three times over in the same file; deviating would be the surprising choice | S:85 R:80 A:95 D:90 |
| 3 | Certain | Router content: gate `command -v rk` + `TMUX_PANE`, then run `rk skill tutorial` and follow exactly; description triggers on tutorial/tour/onboarding phrasing and forbids the ONBOARDING.md detour | Backlog states this verbatim; the gate mirrors `rk skill tutorial`'s own opening gate | S:95 R:90 A:90 D:90 |
| 4 | Confident | Marker text `managed-by: rk agent-setup (run-kit-tutorial skill)` in the skill frontmatter, frozen once shipped | Follows `tmuxShimMarker`'s parenthesized-family pattern; contains the legacy bare marker as a substring, harmless since `removeLegacySkill` keys on the rk-display path | S:70 R:60 A:80 D:70 |
| 5 | Confident | Payload is a standalone embedded `.md` under `cmd/rk/` outside `cmd/rk/skill/` (exact subdir at apply), not a Go const and not an `rk skill` topic | `cmd/rk/skill/` is the docs/site-synced bundle namespace with drift guards; an installer payload doesn't belong in it; markdown-as-file reviews better | S:70 R:75 A:80 D:65 |
| 6 | Confident | Generation currency = byte-compare against the embedded payload; no numeric generation counter | Matches how shim/hook generations are recognized (marker + content sniffing); a counter adds state with no consumer | S:65 R:80 A:75 D:60 |
| 7 | Confident | No `rk doctor` row in v1; drift repaired by re-running `rk agent setup` | Backlog silent on doctor; add-only follow-up if needed, easily reversed | S:40 R:85 A:60 D:55 |
| 8 | Confident | `skillsDir`'s "scheduled for removal" note is rescinded (field regains a consumer); legacy rk-display cleanup keeps its own removal schedule untouched | Direct consequence of reusing the field; the two schedules were always independent | S:60 R:85 A:85 D:75 |

8 assumptions (3 certain, 5 confident, 0 tentative, 0 unresolved).

# Intake: rk skill bundle + agent-setup hooks-only

**Change**: 260717-agst-rk-skill-agent-setup-hooks-only
**Created**: 2026-07-18

## Origin

One-shot `/fab-new` invocation referencing backlog item `[agst]` (not present in this repo's
`fab/backlog.md` — it is the user's cross-toolkit tracking ID; the pre-created worktree branch
`agst-skill` carries it). The task text was exhaustive; no clarifying questions were needed.

> Task: Implement `rk skill` (the toolkit skill-bundle contract) and slim `rk agent-setup` to
> hooks-only, per backlog item [agst] and the shll toolkit standard docs/site/standards/skill.md
> (already merged in sahil87/shll, commit b9aca55 / PR #42).
>
> Background: this repo (run-kit) is graduating cross-toolkit machine wiring to shll
> (`shll agent-setup` + `shll skill`, coming in a later shll change). Before that lands, run-kit
> needs its own `<tool> skill` bundle so shll's aggregator has something to compose, and
> `rk agent-setup` needs to stop installing its own context-injection skill (the "rk-display"
> SKILL.md it currently writes to the agent's global skills dir) since that responsibility moves
> into the new `rk skill` bundle instead.
>
> 1. Author `docs/site/skill.md` (canonical source) as run-kit's skill bundle. Seed its content
>    from the run-kit-owned rows already gisted in fab-kit's src/kit/skills/_cli-external.md
>    (section "## rk (run-kit)"): the notify fail-silent contract (`rk notify <message> [--title]`,
>    fail-silent by contract, operator's default notification channel), and the STATIC half of
>    `rk context` — iframe window creation (`@rk_type`/`@rk_url` tmux options), the proxy URL
>    pattern (`{server_url}/proxy/{port}/...`), and the Visual Display Recipe's 4 steps. Do NOT
>    include the dynamic Environment section (current session/pane/server URL) — that stays
>    exclusive to `rk context`. Write it as a usage briefing per the standard's "Content" section:
>    when to use rk, a capabilities map (notify, context, iframe windows, proxy, visual display),
>    composition patterns, output/exit-code contracts, and gotchas. Stay within the 150-line budget.
> 2. Add a new `rk skill` subcommand (cobra command in app/backend/cmd/rk/) that prints
>    docs/site/skill.md's content to stdout, byte-identical, via the same embed + sync-script +
>    drift-guard-test pattern this repo (or fab-kit/shll) already uses for embedding docs at build
>    time — reuse an existing pattern rather than inventing a new one.
> 3. Slim `rk agent-setup` (app/backend/cmd/rk/agent_setup.go): remove the "rk-display" SKILL.md
>    installation entirely (the rkDisplaySkillDir/rkDisplaySkillFile/rkDisplaySkillContent
>    machinery and the code that writes it) — agent-setup should now install ONLY the agent-state
>    hooks. Update or remove now-dead tests. Keep --uninstall symmetric: it should stop trying to
>    remove the rk-display skill file too (or, if simpler and safer, keep --uninstall removing a
>    stale rk-display skill from a previous install for one release as a cleanup courtesy — use
>    your judgment on the cleanest approach given the existing code; net behavior going forward is
>    hooks-only).
> 4. Update any docs/specs referencing rk agent-setup's context-injection behavior to reflect the
>    split (agent-setup = hooks only; rk skill = usage briefing).
>
> Tests green. Normal fab change — full pipeline (intake → apply → review → hydrate → ship →
> review-pr). Nothing else is in scope; do not touch shll or other repos.

## Why

1. **The problem**: nothing today serves an agent *using* an installed run-kit from an arbitrary
   repo, offline. `rk help-dump` is flag structure, README/docs/site need a checkout or network,
   and the current stopgap — `rk agent-setup` writing a user-global `rk-display` SKILL.md into
   `~/.claude/skills/` — is a Claude-Code-specific context-injection hack that couples run-kit to
   one harness's skills convention and duplicates responsibility that the toolkit is centralizing.
2. **The consequence of not doing it**: when `shll agent-setup` lands (it will aggregate every
   installed tool's `<tool> skill` output and delegate hook installation to `run-kit agent-setup`),
   run-kit would have nothing for the aggregator to compose, and `rk agent-setup` would fight the
   aggregator by installing its own overlapping skill file. The Toolkit Standards constitution
   article (§ Additional Constraints) binds this repo to the published standard now that it is
   merged (shll b9aca55 / PR #42).
3. **Why this approach**: the standard prescribes the exact shape — a static, embedded,
   byte-identical, ≤150-line `docs/site/skill.md` served by a `skill` subcommand — and names the
   sync + drift-guard mechanism `shll standards` established as the one to reuse. Splitting
   agent-setup to hooks-only is the standard's own "Forward design" section, verbatim.

## What Changes

### 1. `docs/site/skill.md` — the canonical skill bundle (new file)

A usage briefing per the standard's Content section, ≤150 lines, static-only (no timestamps, no
environment lookups, no session state). Renders automatically at `/run-kit/skill` on shll.ai as
part of the pulled `docs/site/**` tree — no nav registration needed (sibling pages: `install.md`,
`notifications.md`, `status-dot.md`, `workflows.md`; heading style: `# Title` + one-paragraph
lede, no frontmatter).

Content plan (seeded from fab-kit `_cli-external.md` § "## rk (run-kit)" and the static half of
`cmd/rk/context.go` — `writeCapabilities`/`writeConventions`, NOT `writeEnvironment`):

- **When to use** — you are an agent in a tmux pane that run-kit may be managing; reach for rk to
  notify the human out-of-band or to display web content visually. Detection gate first:
  `command -v rk >/dev/null 2>&1` and `$TMUX_PANE` set; when absent, skip silently (never error,
  never warn).
- **Capabilities map** — one line each, keyed to the subcommand:
  - `rk notify <message> [--title <t>]` — Web Push to every subscribed browser/device.
  - `rk context` — agent-optimized environment info (session, pane, **server URL**) + the current
    canonical recipes. Dynamic — run it at use-time, never cache or hardcode its values.
  - Iframe windows — `tmux new-window -n <name>`, `tmux set-option -w @rk_type iframe`,
    `tmux set-option -w @rk_url <url>`; change URL by re-setting `@rk_url`.
  - Proxy — `{server_url}/proxy/{port}/...` reaches local services through the run-kit server;
    relative form `/proxy/{port}/...` works from the frontend behind any origin/reverse proxy.
  - Visual Display Recipe — the 4 steps: (1) generate HTML to a known location; (2) serve it via a
    loopback-bound HTTP server (`python3 -m http.server --bind 127.0.0.1 <port> -d <dir> &`);
    (3) open an iframe window with relative `@rk_url /proxy/<port>/<filename>`; (4) fail silently
    if any step's prerequisite is unavailable — skip remaining steps without surfacing an error.
- **Composition patterns** — server-URL discovery at use-time
  (`rk context 2>/dev/null | grep 'Server URL' | awk '{print $NF}'`); `rk skill` is the static
  briefing, `rk context` the dynamic complement; operators use `rk notify` as the default
  non-blocking escalation channel, gated on `command -v rk`.
- **Output & exit-code contracts** — `rk notify` is fail-silent **by contract**: any error
  (server unreachable, no subscriptions, non-2xx) exits 0 and prints nothing, so it never stalls a
  calling loop. `rk skill` / `rk context` / `rk help-dump` print data to stdout (principle №2);
  other commands exit non-zero (generic 1) on error.
- **Gotchas** — `@rk_type`/`@rk_url` changes are picked up by SSE polling automatically (no
  refresh/API call); killing a tmux window kills the backing process (no separate cleanup);
  `set-option -w` targets the *current* window — create the window first, then set options from
  within it (or pass `-t`); the server URL changes between sessions — always rediscover.

Explicitly OUT of the bundle: the dynamic Environment section (session/window/pane/server URL —
stays exclusive to `rk context`), flag tables (defer to `-h`), the command tree (defer to
`rk help-dump`), install prose (stays in `docs/site/install.md`).

### 2. `rk skill` subcommand — embed + sync + drift-guard (new)

The repo has **no** committed-doc embed precedent (`build/tmux.conf` is a build-time copy that is
gitignored, so it cannot satisfy "clean `go build` compiles" + drift-guard), so mirror shll's
`standards` mechanism exactly (the standard names it as the one to reuse):

- **Committed embedded copy**: `app/backend/cmd/rk/skill/skill.md` — copied from the canonical
  `docs/site/skill.md`. Committed so a clean `go build ./...` compiles without running any script.
- **Sync script**: `scripts/sync-skill.sh` (`set -euo pipefail`, `cd "$(dirname "$0")/.."`,
  `cp -f docs/site/skill.md app/backend/cmd/rk/skill/skill.md`, echo a confirmation). Constitution
  VIII: logic in scripts/, justfile stays an index (no new recipe required; a
  `//go:generate ../../scripts/sync-skill.sh` directive in skill.go mirrors shll's).
- **Command**: `app/backend/cmd/rk/skill.go` — cobra `Use: "skill"`,
  `Short: "Print run-kit's agent skill bundle (static usage briefing)"`,
  `//go:embed skill/skill.md`, RunE writes the embedded bytes to `cmd.OutOrStdout()` verbatim (no
  added framing, no trailing modification) and returns nil. Registered in `root.go` via
  `rootCmd.AddCommand(skillCmd)`. stdout is the bundle byte-identical; stderr empty; exit 0.
- **Drift-guard test**: `app/backend/cmd/rk/skill_test.go` —
  `TestSkillEmbedMatchesCanonical` reads `../../../../docs/site/skill.md` (test file lives at
  `app/backend/cmd/rk/`, repo root is four levels up) and `bytes.Equal`s it against the embedded
  copy, failing with a "run scripts/sync-skill.sh" hint (mirrors shll's
  `TestStandardsEmbedMatchesCanonical`). Plus: command-level test that stdout equals the embedded
  bytes exactly with empty stderr, and a budget guard asserting the bundle is ≤150 lines.
- `rk skill` appears in `rk help-dump` automatically (it walks the cobra tree — no schema change);
  add `"skill"` to the expected-subcommands map in `root_test.go:17`.

### 3. `rk agent-setup` — hooks-only + one-release legacy cleanup

Remove the install half of the rk-display machinery from `app/backend/cmd/rk/agent_setup.go`:

- **Delete**: `rkDisplaySkillContent` (the SKILL.md literal), the install branch of
  `applyAgentSkill` (diff/confirm/`writeSkill`), `writeSkill`, and the "SECOND managed artifact"
  header comment block.
- **Keep for one release (legacy cleanup courtesy)**: `rkDisplaySkillDir`/`rkDisplaySkillFile`/
  `skillManagedByMarker`, `readSkill`, `skillHasMarker`, and the removal flow
  (`uninstallAgentSkill`, renamed to something like `removeLegacySkill`) — run on **both** install
  and uninstall passes via `applyAgentConfig`: if a marker-owned
  `{skillsDir}/rk-display/SKILL.md` exists, offer removal (confirm prompt, `os.RemoveAll` of the
  directory); a marker-less (user-rewritten) file gets the existing skip note; an **absent** file
  is silent in both modes (a fresh machine should see zero rk-display output — change from
  today's "absent — nothing to do" line on uninstall). `agentConfig.skillsDir` stays (it locates
  the legacy skill); its doc comment is rewritten to say "legacy rk-display cleanup only —
  scheduled for removal one release after <this change>".
- **Help text**: the cobra `Short`/`Long` already describe hooks only — verify no skill mention
  creeps in; the file-header comment is updated to the hooks-only + legacy-cleanup reality.
- **Tests** (`agent_setup_test.go`): delete `TestApplyAgentSkillInstallWritesAt0644`,
  `TestApplyAgentSkillDeclineDoesNotWrite`, `TestApplyAgentSkillReinstallIsNoOp`,
  `TestApplyAgentSkillDiffRendersCurrentAndProposed`; adapt `TestSkillHasMarker` (drop the
  `rkDisplaySkillContent` assertion — the literal is gone; keep marker/no-marker cases on inline
  fixtures) and `TestApplyAgentSkillUninstallRemovesOnlyWhenMarked` to the renamed cleanup
  function (seed the legacy file with an inline marker-bearing fixture instead of installing).
  Add: install-mode run on a machine with a marker-owned legacy skill offers and performs
  removal; install-mode run on a fresh machine writes no skill file and prints no rk-display
  output.

### 4. Docs updates (the split: agent-setup = hooks only; rk skill = usage briefing)

Verified current references: `docs/specs/agent-state.md` contains **no** skill/rk-display
references (hook registry only — no spec edit needed); `README.md` and `docs/site/install.md`
already describe agent-setup as hooks-only (no stale context-injection prose to fix). Remaining
doc work:

- `README.md` § Commands table: add a `run-kit skill` row ("Print the agent skill bundle — a
  static usage briefing for agents operating run-kit; canonical source `docs/site/skill.md`").
- `cmd/rk/context.go` `writeCapabilities` "### CLI Commands" → **Info** group: add
  `run-kit skill — Print the static agent skill bundle` beside `run-kit context` (keeps the two
  complements discoverable from each other).
- The `docs/memory/run-kit/agent-state.md` rewrite (installer is hooks-only + legacy cleanup;
  rk-display section superseded by `rk skill`) happens at **hydrate**, per pipeline — listed under
  Affected Memory, not a task here.
- Out of scope: fab-kit's `_cli-external.md` (different repo), shll (different repo),
  `docs/site/install.md` (already correct).

## Affected Memory

- `run-kit/agent-state`: (modify) installer section — two-managed-artifacts becomes hooks-only +
  one-release legacy rk-display cleanup; rk-display skill artifact section marked superseded by
  `rk skill`
- `run-kit/architecture`: (modify) CLI surface — new `rk skill` command + the committed-embed /
  sync-script / drift-guard pattern under `cmd/rk/skill/`

## Impact

- **Backend (Go)**: `app/backend/cmd/rk/skill.go` (new), `app/backend/cmd/rk/skill/skill.md`
  (new, committed embed copy), `app/backend/cmd/rk/skill_test.go` (new),
  `app/backend/cmd/rk/agent_setup.go` (slimmed), `app/backend/cmd/rk/agent_setup_test.go`
  (pruned/adapted), `app/backend/cmd/rk/root.go` + `root_test.go` (register + expect `skill`),
  `app/backend/cmd/rk/context.go` (one Info line).
- **Scripts**: `scripts/sync-skill.sh` (new).
- **Docs**: `docs/site/skill.md` (new canonical), `README.md` (command-table row).
- **No frontend, API, or e2e impact**; test gate is `just test-backend` (plus the full
  `just test` for the ship gate). No new dependencies.
- **Behavior change for existing installs**: `rk agent-setup` stops installing `rk-display` and
  instead offers to remove a previously installed one; users who want the display capability in an
  ordinary session get it via the (coming) shll aggregation of `rk skill` — interim, `rk context`
  remains fully functional.

## Open Questions

None — the task text plus the merged standard resolve every decision point.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `agst` as the 4-char change ID (`fab change new --change-id agst`) even though `[agst]` is not in this repo's `fab/backlog.md` | User's task names backlog item [agst] and the pre-created branch/worktree is `agst-skill`; collision-checked via `fab resolve --id agst` (no match) | S:90 R:85 A:90 D:95 |
| 2 | Certain | Bundle contract taken verbatim from the merged shll standard: command name `skill`, raw markdown to stdout, stderr empty, exit 0, byte-identical to `docs/site/skill.md`, ≤150 lines, static-only | Standard is merged (shll b9aca55/PR #42) and constitution § Toolkit Standards binds it; read via `shll standards skill` | S:95 R:90 A:95 D:100 |
| 3 | Certain | Bundle content = fab-kit `_cli-external.md` rk rows (notify contract) + static half of `context.go` (iframe/proxy/Visual Display Recipe), Environment section excluded | User's task enumerates exactly this seed list and the exclusion | S:95 R:85 A:90 D:95 |
| 4 | Confident | Embed mechanism mirrors shll's `standards` pattern: committed copy at `app/backend/cmd/rk/skill/skill.md`, `scripts/sync-skill.sh`, `//go:generate` directive, drift-guard test at `../../../../docs/site/skill.md` | This repo has no committed-doc embed precedent (tmux.conf copy is gitignored build-time — fails the commit+drift-guard requirement); the standard explicitly names shll's mechanism as the one to reuse; file location/script name are my adaptation | S:75 R:75 A:85 D:75 |
| 5 | Confident | Legacy rk-display cleanup runs on BOTH install and uninstall passes for one release (remove-if-marker-owned behind confirm; silent when absent); the install machinery (content literal, writeSkill, install branch) is deleted outright | User granted judgment; install-time cleanup is needed because re-running plain `rk agent-setup` is the documented upgrade action (install.md), so uninstall-only cleanup would never reach most machines | S:70 R:80 A:80 D:60 |
| 6 | Confident | Add a `run-kit skill` row to README's command table and an Info line in `rk context`'s CLI Commands list | Keeps the static/dynamic complements cross-discoverable; consistent with how every other command surfaces; small and reversible | S:60 R:90 A:80 D:75 |
| 7 | Confident | Drift-guard test additionally enforces the ≤150-line budget in CI | The standard's "Verifying conformance" checklist requires the bound before every ship; encoding it as a test is the only non-manual enforcement point | S:60 R:90 A:80 D:80 |
| 8 | Certain | No `docs/specs/` edits needed; the only context-injection doc is `docs/memory/run-kit/agent-state.md`, updated at hydrate | Verified by grep: `docs/specs/agent-state.md`, `README.md`, `docs/site/install.md` carry no rk-display/skill-install references | S:75 R:85 A:90 D:85 |

8 assumptions (4 certain, 4 confident, 0 tentative, 0 unresolved).

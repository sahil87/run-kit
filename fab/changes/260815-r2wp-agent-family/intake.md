# Intake: The rk agent family — `agent setup` / `agent hook`

**Change**: 260815-r2wp-agent-family
**Created**: 2026-08-15

## Origin

Part 2 of the `docs/specs/cli-layering.md` Execution Plan (run-kit repo), invoked one-shot via `/fab-new` with a detailed directive. Key excerpts from the user's input:

> Scope: (1) rename `rk agent-setup` to `rk agent setup` — human-typed verb, rename + deprecation alias (the old agent-setup form keeps working, warns/points at the new form). (2) rename `rk agent-hook` to `rk agent hook` — this one is machine-invoked: installed Claude Code settings.json hook lines carry the LITERAL command line `agent-hook`, so `agent-hook` MUST remain a permanent hidden root alias forever (never just a deprecation warning) — `rk agent-setup` regenerates hook lines to write the new `rk agent hook` form going forward, but existing installs must keep working unmodified. `role` stays at root (not part of this family — it marks the operator window, not instrumentation, per the spec).
>
> Every run-kit CLI-surface part in this plan implicitly includes: the shll standards audit (run `shll standards` and conform), the help-dump test, and `rk skill` topic-page updates for the family — these are not itemized elsewhere, do not skip them.
>
> This change was drafted to run AFTER Part 1 (rk mux send/await, PR #617) merged … you are starting fresh off origin/main which already includes that merge, so there should be no overlap to worry about. When shipped, this unblocks the operator to proceed with Part 3 (mux consolidation) next.

Authoritative spec sections: `docs/specs/cli-layering.md` § "The `rk agent` family (instrumentation)" (the two-row member table + the `role` stays-at-root note), § "Hidden plumbing" (permanent aliases are hidden), § Delegation rule 3 ("Machine-invoked entry points are contracts"), and the Execution Plan row for Part 2.

## Why

1. **Root-noise reduction with a contract-safe migration.** `rk -h` lists ~23 visible root commands; the cli-layering spec targets ~15 by grouping human-facing verbs into families (Part 1 shipped `rk mux`) and hiding machine-invoked plumbing. `agent-setup` and `agent-hook` are the instrumentation pair — one human-typed installer, one hook-invoked writer — and belong under one `rk agent` family.
2. **The machine-invoked form is a permanent contract, not a deprecation.** Installed `~/.claude/settings.json` hook entries carry the literal command line `"<abs-rk>" agent-hook --agent claude <state>` frozen at install time (and again in each harness session's config snapshot). If `agent-hook` ever stopped resolving — or started printing warnings — every existing install would break or degrade: the hook's NEVER-FAIL contract (always exit 0, print nothing) is what keeps a broken hook from blocking an agent's turn. Per delegation rule 3, renames of machine-invoked entry points ship with permanent hidden aliases, and the installer writes the new form going forward.
3. **Sequencing.** Part 2 is parallel-safe with everything else in the plan but overlaps Parts 1/3/4 on `root.go` and the help-dump test; Part 1 (PR #617) is already merged into origin/main, and shipping Part 2 unblocks the operator to start Part 3 (mux consolidation).

Not doing this leaves the root surface inconsistent with the spec's published grouping plan (mux grouped, agent not), and blocks the plan's sequencing (operator waits on Part 2 before Part 3).

## What Changes

### 1. New `rk agent` family parent (`app/backend/cmd/rk/agent.go`)

A new cobra parent command, following the `mux.go` precedent from Part 1 (PR #617):

```go
var agentCmd = &cobra.Command{
    Use:   "agent",
    Short: "Agent instrumentation (state hooks setup and reporting)",
    Long:  "...", // instrumentation family: setup installs the harness hooks; hook is the stable interface they invoke
}
```

Registered in `root.go` via `rootCmd.AddCommand(agentCmd)`. Unlike `mux`, the family carries **no shared persistent flag** — `setup` and `hook` have disjoint flag sets (`--uninstall/--yes/--dry-run` vs `--agent`), so the parent is a pure grouping node. Bare `rk agent` prints the family help (cobra default).

### 2. `rk agent setup` (rename of `rk agent-setup`) + deprecation alias

- The existing `agentSetupCmd` becomes the family member: `Use: "setup"`, same flags, same `runAgentSetup` core. All behavior (JSON merge, diff+consent, `--uninstall`, tmux-shim leg, legacy rk-display cleanup) is unchanged.
- A **deprecation alias** stays registered at root: `Use: "agent-setup"`, `Hidden: true`, delegating to the same core with identical flags. On invocation it prints a one-line pointer to stderr before running normally:
  ```
  rk agent-setup is deprecated; use `rk agent setup`
  ```
  (Exact mechanism — cobra's `Deprecated` field vs a manual stderr note in RunE — is an apply-time choice; the observable contract is: still works, exits with the same codes, warns once on stderr, hidden from `rk -h` and from the help-dump.)
- Because one cobra command object cannot have two parents, the command is built by a **factory function** (`newAgentSetupCmd(use string)` or equivalent) so the family member and the root alias are two instances sharing the same RunE core; flag variables bind per-instance to avoid cross-instance state.

### 3. `rk agent hook` (rename of `rk agent-hook`) + **permanent hidden root alias**

- The existing `agentHookCmd` becomes the family member: `Use: "hook <state>"`. All logic (`runAgentHook`, the ancestor walk, `@rk_agent_state`/`@rk_chat` writes) is unchanged.
- The root form `agent-hook` remains registered **forever** as a hidden alias: `Use: "agent-hook <state>"`, `Hidden: true`, **no deprecation warning of any kind** — it is machine-invoked and its NEVER-FAIL contract (always exit 0, silent on every path) must hold byte-for-byte for existing installs. This is a permanent alias per delegation rule 3, not a one-release courtesy; a code comment marks it as permanent so no future cleanup sweep removes it.
- **Both instances** must carry the full never-fail machinery: `Args: cobra.ArbitraryArgs`, `FParseErrWhitelist{UnknownFlags: true}`, `SilenceErrors/SilenceUsage`, and the per-command `SetFlagErrorFunc(→ nil)` that shadows root's usage-error func (see the root.go comment at line 76–84 — that comment's "except agent-hook" wording is updated to name both instances). Factory-built for the same two-parents reason as setup.

### 4. Installer writes the new form; recognition accepts all generations

`agentStateHookCommand` (agent_setup.go:110) changes to emit the new invocation:

```
/bin/sh -c '[ -n "$TMUX_PANE" ] || exit 0; "<abs-rk>" agent hook --agent <comm> <state> 2>/dev/null || true'
```

Recognition (`isRkEntry`) currently matches two generations of rk-owned entries: `rkHookMarker` (the legacy inlined `@rk_agent_state` option name) and `rkHookMarkerAgentHook` (`" agent-hook "`). A **third marker** `" agent hook "` is added so:
- a re-run of `rk agent setup` on the new binary strips ANY older-generation entry and replaces it in place (idempotent),
- `--uninstall` removes all three generations,
- re-running on a settings file already carrying the new form is a no-op (no prompt).

Existing installs are **not** proactively migrated — the old hook lines keep working unmodified via the permanent alias; they roll over to the new form only when the user next runs `rk agent setup`.

### 5. What does NOT change (guard rails)

- **`role` stays at root** — it marks the operator window (operator-workflow verb), not instrumentation, per the spec.
- **On-disk ownership markers are recognition literals and MUST NOT change**: `skillManagedByMarker = "managed-by: rk agent-setup"` (agent_setup.go:80) and `tmuxShimMarker = "managed-by: rk agent-setup (tmux guard shim)"` (tmux_guard.go:95) identify artifacts already installed on user machines. Newly *written* shim content keeping the old marker text is correct — the marker is an identity string, not an invocation.
- The tmux guard shim body and `tmux-guard` command are untouched (Part 4's scope). The shim leg of setup runs as before.
- `@rk_agent_state` / `@rk_chat` value schemas, readers (internal/tmux, sessions, frontend), and the shell reconciler: untouched.
- `resolveRkPath`, `validateHookPath`, consent flow: untouched.

### 6. Documentation, help, and hints

- **README.md**: § "Agent state — `run-kit agent-setup`" heading and body → `run-kit agent setup`; the command table row; the troubleshooting line; quick-start line 42. Note the heading rename changes its anchor (`#agent-state--run-kit-agent-setup`) — update the in-repo README table link and the cross-link in `docs/site/install.md:28`.
- **docs/site/install.md**: lines 16/28/38 → new form (the upgrade note keeps making sense: re-running setup swaps hook lines to the newest generation).
- **doctor.go**: the three hint strings naming `rk agent-setup` → `rk agent setup`.
- **Code comments** that name the invocation forms (agent_setup.go header, agent_hook.go header + wrapper comment, root.go's flag-error comment, tmux_guard.go:25/89, role.go:29, internal/tmux/tmux.go references): update to the new form where they describe what gets *typed or written*, keep where they describe historical/installed artifacts.
- **`rk skill` topic pages**: audit `docs/site/skill.md` + topic pages for the family. Current state: neither the core bundle nor the `display`/`mux` topics name `agent-setup`/`agent-hook` (verified by grep), so the expected outcome is a no-op or a one-line touch-up if the audit finds an indirect reference; adding a new `agent` topic page is NOT in scope.

### 7. Tests and conformance (implicit obligations for every CLI-surface part)

- **help-dump test** (`help_dump_test.go`): extend `TestCaptureNodeRealTreeSelfExcludesAndDepth` — assert the `agent` family is present with exactly two members (`setup`, `hook`), and that root-level `agent-setup`/`agent-hook` are absent from the dump (hidden). Mirrors the existing mux assertions.
- **root_test.go**: the command-inventory map (lines 34–35) and the NoArgs usage-error case (line 204) reference `agent-setup`/`agent-hook`; update for the new tree while keeping alias coverage (the aliases still exist at root — the test's expectation for them flips to hidden, not gone).
- **agent_setup_test.go / agent_hook_test.go**: update generated-command expectations (`agent hook` in the wrapper literal), add marker-recognition cases for the third generation (new-form entries recognized, replaced in place, uninstalled), and add alias-parity tests: `rk agent-hook <state>` and `rk agent hook <state>` behave identically (including never-fail paths); `rk agent-setup` warns on stderr and still runs.
- **shll standards audit**: run `shll standards` and check the change against the governing standards — `help-dump` (aliases hidden ⇒ excluded from the dump), `principles` (ten CLI principles; deprecation-warning channel), `readme-extraction` (README/docs-site structure after the rename), `skill` (topic-page audit above). Record the audit result in the PR/hydrate notes.

## Affected Memory

- `run-kit/agent-state`: (modify) command forms throughout — `rk agent setup` / `rk agent hook` as canonical, `agent-setup` deprecation alias + `agent-hook` permanent hidden alias, the three-generation hook-entry recognition
- `run-kit/toolkit-standards`: (modify) new-surface check gains the `rk agent` family; help-dump posture for hidden aliases
- `run-kit/architecture`: (modify) CLI subcommand inventory — `agent` family added, root pair demoted to aliases

## Impact

- `app/backend/cmd/rk/`: `agent.go` (new), `agent_setup.go`, `agent_hook.go`, `root.go`, `doctor.go`, comment touches in `tmux_guard.go`/`role.go`; tests: `agent_setup_test.go`, `agent_hook_test.go`, `root_test.go`, `help_dump_test.go`, `doctor_test.go` (if hint strings are asserted)
- `README.md`, `docs/site/install.md`; audit-only: `docs/site/skill.md` + `docs/site/skill/*.md`
- `internal/tmux/tmux.go`: comment-only references
- No API, frontend, daemon, or schema changes. No behavior change for installed hooks (alias parity is the load-bearing guarantee).
- Overlap warning from the spec: Parts 3/4 also touch `root.go` + help-dump test — this part ships before Part 3 starts (sequencing handled by the operator).

## Open Questions

*(none — the directive + spec resolve scope; remaining choices are graded assumptions below)*

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | `agent-hook` root alias is permanent, hidden, and never warns — full never-fail machinery on both instances | Mandated verbatim by the directive and spec rule 3; the hook contract requires silence | S:95 R:90 A:95 D:95 |
| 2 | Certain | Installer emits `agent hook` in new hook lines; recognition adds a third marker `" agent hook "` alongside the two existing generations | Directive says setup writes the new form; idempotency/uninstall require recognizing what setup itself writes | S:90 R:85 A:95 D:90 |
| 3 | Confident | `agent-setup` deprecation alias is hidden from help + help-dump (warns on stderr when run) | Spec's root-count math (~23→~15) counts renamed forms out of the visible root; § Hidden plumbing hides permanent aliases, and a visible deprecated twin would defeat the grouping. Easily flipped if review disagrees | S:70 R:85 A:75 D:70 |
| 4 | Certain | Two-instance factory pattern for both commands (cobra command objects cannot be parented twice); flag vars bound per-instance | Standard cobra constraint; mux precedent covers the family parent but not aliasing — factory is the minimal correct mechanism | S:75 R:80 A:90 D:80 |
| 5 | Confident | On-disk ownership markers (`managed-by: rk agent-setup`, tmux shim marker) stay byte-identical | They are recognition literals matching artifacts already on user machines; changing them orphans existing installs. Verified both sites in code | S:80 R:60 A:90 D:85 |
| 6 | Certain | Skill topic pages: audit-only, expected no-op; no new `agent` topic page | Grep shows no `agent-setup`/`agent-hook` mention in skill.md or topic pages; spec's implicit obligation is conformance, not new content | S:70 R:90 A:85 D:75 |
| 7 | Certain | `agent` family parent carries no shared persistent flag (unlike mux's `-L`) | setup/hook flag sets are disjoint; a shared flag would be dead weight on one member | S:75 R:90 A:90 D:85 |
| 8 | Confident | README § heading rename updates the `#agent-state--run-kit-agent-setup` anchor; both in-repo links (README table, install.md:28) re-pointed | Anchor churn is easy to miss; external links to the old anchor will soft-break (GitHub falls back to top-of-file) — accepted as normal docs drift | S:60 R:75 A:70 D:55 |

8 assumptions (5 certain, 3 confident, 0 tentative, 0 unresolved).

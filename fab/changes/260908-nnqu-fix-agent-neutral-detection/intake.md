# Intake: Fix agent-neutral detection and transcript-backed actions

**Change**: 260908-nnqu-fix-agent-neutral-detection
**Created**: 2026-09-09

## Origin

Conversational investigation started with a screenshot of the sidebar flyout for `riff-solar-margay`, where “Fix tab name” was missing despite a Codex agent running in the tab.

> “Right now Codex agents aren't being detected correctly in runKit. If it were, we would have seen the fix tab name option over here. Find the cause”
>
> “Also check the latest `shll standards` for skills - Ideally we want this to work for all agents not just codex and claude”
>
> “aren't there agent agnostic hooks in .agents/ standards?”
>
> “Create an intake for this using $fab-draft”

The user requested a queued intake after reviewing the cause and a proposed shared integration architecture. This draft captures investigation and intended behavior, not implemented changes. No activation, branch creation, hook installation, live-agent messaging, or restart is part of drafting.

Live inspection confirmed the screenshot's exact subject on the `fabKit` socket: window `@32`, pane `%72`, name `riff-solar-margay`, current command `codex`. Both `@rk_pane_agent_session` and its legacy fallback `@rk_pane_chat` were empty, as was `@rk_pane_agent_state`. An operator existed at window `@20` with `@rk_win_role=operator`. Other live Codex panes also lacked identity/state. These are investigation-time observations, not stable fixture IDs or assumptions about future live state.

## Why

run-kit can launch arbitrary agent commands, but its dashboard integration currently recognizes agent sessions only when Claude-specific hooks supply their identity. Process-name visibility alone does not populate `agentSessionRef`. Consequently Codex tabs lose transcript-backed actions and reliable lifecycle signals despite containing working agents.

There are two independent implementation gaps. `app/backend/cmd/rk/agent_setup.go`'s `agentRegistry` contains only Claude Code; `agent_hook.go` resolves the writer's `--agent` through that same registry and silently returns for an unknown harness. `internal/transcript` registers only the Claude adapter. Even manually supplying `codex:<session-ref>` would merely move the failure from a hidden action to the request-time error `no adapter for provider "codex"`.

The frontend's `canRequestWindowOperatorAction` in `components/sidebar/row-flyout-card.tsx` requires an operator, a non-empty agent session reference, and a subject that is not the operator. The backend `fix-tab-name` template requires a transcript. Fixing only the menu, identifying a binary name, or rerunning the existing Claude-only setup cannot satisfy that contract.

The existing reader is already provider-neutral: `parseAgentSessionRef` accepts well-formed provider tokens, including Codex, and `sessions.ResolveAgentPane` rolls identity up from the active agent pane or the first identified pane. Extend these established contracts instead of creating separate dashboards or duplicated lifecycle writers per agent.

## What Changes

### Shared identity and lifecycle implementation

Generalize the existing hook writer around a common validated representation of provider, opaque session reference, lifecycle event/state, and agent process liveness. Keep provider parsing, pane/server targeting, state formatting, dual writes during the current migration, and stale-agent reconciliation shared. Separate runtime provider handling from installation-specific config paths and formats; a provider must not be rejected merely because it lacks a Claude-shaped installer entry.

Retain the current external tmux contracts unless implementation evidence requires an explicitly documented compatible extension:

```text
@rk_pane_agent_session = <provider>:<session-ref>
@rk_pane_agent_state   = <active|waiting|idle>:<epoch>[:<agent-pid>]
```

Identity, lifecycle, and transcript availability are distinct capabilities. Do not infer a session ID from the executable name, fabricate idle/waiting states when a harness exposes no relevant event, or associate a pane with the newest transcript in its working directory. Preserve active-pane-first selection, wrapped-process liveness, and clearing both identity and lifecycle when the recorded agent dies. Session changes must update identity without incorrectly marking a mid-turn compaction idle. Ensure child/subagent events cannot replace the root pane's identity or falsely complete its turn.

### Verified cross-harness installation and event mappings

Extend `rk agent setup` with small harness adapters for native config placement, event mapping, payload normalization, and process identification. Shared commands perform the actual writes. Setup remains idempotent and preserves unrelated user configuration, current dry-run/uninstall behavior, stable binary references, and the hook's never-fail behavior. Support sessions launched by hand as well as through `rk riff`; integration must not depend solely on run-kit owning the launch.

Audit the harnesses relevant to the requested cross-agent scope: Claude Code, Codex, Gemini CLI, GitHub Copilot, OpenCode, Kimi CLI, and Antigravity, plus any additional harness already advertised by run-kit when implementation begins. This roster is a coverage-audit baseline, not an assertion that each currently offers the same events. For each, record the verified version/source, native hook or plugin mechanism, install location, identity field, lifecycle coverage, process validation, transcript resolution, and unavailable capabilities. Implement the documented integrations that support this contract; provide explicit reasons for gaps rather than silently narrowing delivery to a Claude/Codex pair or claiming universal parity.

Codex is the mandatory end-to-end regression case; Claude must retain its existing behavior. Other harnesses with usable documented mechanisms belong in the same integration work. Use native hook/plugin mechanisms where available; do not make the model remember to emit lifecycle state through skill instructions. Unknown or unsupported mechanisms must degrade honestly and remain extensible without frontend provider allowlists.

Re-check native installation/trust/reload requirements against current vendor documentation and the installed versions. For example, current Codex documentation describes hook discovery in `~/.codex/hooks.json` or inline hooks in `~/.codex/config.toml`, equivalent project config layers, and review/trust before non-managed hooks run. Do not bypass native trust or represent a written-but-inactive hook as operational. Any verification that requires restarting an existing user session must use an isolated test session instead.

### Portable hooks and shll skill standards

The investigation ran `shll standards` and `shll standards skill` and fetched the upstream `sahil87/shll` standard; they matched. Preserve their ownership split: `shll setup agent` places the shared bootstrap skill and delegates dashboard hook installation to `run-kit agent setup`. `.agents/skills/` is the unconditional shared skills channel; additional brand placements are gated and only used where needed. Runtime usage knowledge remains in the installed binary's `skill` bundle, not duplicated per-agent skill files.

Portable hooks exist as separate projects/conventions, not as a lifecycle-hook clause of the Agent Skills `SKILL.md` specification. In particular, dot-agents stores `HOOK.yaml` bundles below `~/.agents/hooks/` and renders native configurations through per-platform mappings. That is useful prior art for shared definitions, but a file placed in `.agents/hooks/` is not proof every harness discovers or executes it. Evaluate reuse of its portable concepts against the actual native mechanisms; introducing a dependency on `da`, a new toolkit-wide standard, or another configuration manager was not agreed in the discussion and is not required by this intake.

Any changed CLI/help/site surface must be checked against the latest relevant `shll standards` at implementation time. If an agent integration topic is needed, use `docs/site/skill/<topic>.md` and the existing sync/drift-guard machinery; core and topics stay static and at most 150 lines, with topic enumeration and budgets tested. Do not add installation prose to usage bundles where the skill standard assigns it to installation documentation.

### Conversation resolution and capability-based actions

Extend the existing `internal/transcript` capability seam to resolve the supported harnesses' exact session references to readable conversation sources. Preserve Claude's path behavior and distinguish invalid reference, missing conversation, and unsupported provider. Validate references before filesystem access and respect the harness's verified storage/config roots; never treat an arbitrary client-supplied path as authoritative. Derive transcript location from native files/session identity where possible, consistent with Constitution II and X; do not add a database or persistent session registry.

Codex's documented common hook fields include `session_id` and nullable `transcript_path`. This establishes that identity is available, not that its transcript layout is a stable cross-agent format. Verify actual storage and lookup on the supported version before choosing a locator. If some harness cannot resolve a transcript from available identity without changing the contract, record that limitation and its evidence rather than making an unsafe guess.

Make the flyout and palette use the same server-derived capability for “Fix tab name”: operator available, subject not the operator, and conversation access supported/available. Determine the minimal payload extension and bounded filesystem lookup strategy during planning; avoid adding per-pane unbounded scans to every derive tick. Revalidate on POST and queue drain because a conversation or pane may disappear after rendering. Identity-only providers must not advertise an action that predictably fails for lack of an adapter. Preserve the existing operator-request endpoint, busy queue behavior, and shared injection path.

Exercise other consumers of the shared identity/transcript seam (agent-targeted send, operator facts, and auto-name) for compatibility. This does not broaden Claude-only fork/resume semantics to other providers automatically. A terminal-scrollback fallback was suggested during discussion but never selected; exclude it from the default implementation so “Fix tab name” keeps its transcript-based meaning.

### Observable acceptance and verification

- In an isolated tmux server with an operator and a supported Codex subject, startup/first supported event yields the correct session identity; flyout and palette offer the rename request once conversation access is available. The request resolves the subject's real conversation and reaches the operator without a provider-adapter error. Verify the resulting rename using an isolated operator or controlled fixture, never by sending to the user's live operator.
- Retain the same behavior for Claude, including legacy option compatibility and existing hook settings.
- For each additional integrated harness, test its real payload/config shape and declared capabilities. Maintain a capability matrix with versioned evidence for supported and unavailable behaviors.
- Cover startup/resume, prompt/turn activity, supported waiting events, stop/idle, session rotation, compaction, root/subagent identity, wrapped launches, crash/exit, plain shells, malformed payloads/refs, unavailable transcripts, and unknown providers. Missing events must remain unknown instead of manufacturing transitions.
- Verify setup repeatability and config preservation, native trust/disabled-hook handling, and action capability consistency across API, flyout, palette, and queued request revalidation.
- Use the project's `just` test recipes, isolated tmux socket family, and existing test tools. Run the relevant frontend/backend checks and production build as required by project policy. A passing fabricated `codex:<id>` parser fixture alone is insufficient to prove integration.

## Affected Memory

- `run-kit/agent-state`: (modify) Shared writer, harness event mappings, setup contract, capability coverage, session and lifecycle reconciliation.
- `run-kit/agent-send`: (modify) Transcript adapters, lookup capabilities, errors, and agent-targeted consumer compatibility.
- `run-kit/operator-actuation`: (modify) Transcript-backed request availability and revalidation across providers.
- `run-kit/tmux-sessions`: (modify) Derived identity/capability fields and window rollup behavior.
- `run-kit/ui/status-signals`: (modify) Flyout action availability and honest lifecycle degradation.
- `run-kit/ui/keyboard-and-palette`: (modify) Palette parity for the same rename capability.
- `run-kit/toolkit-standards`: (modify) Applicable skill/setup/CLI standards verification and ownership boundaries.

## Impact

Primary code areas are `app/backend/cmd/rk/agent_setup.go`, `agent_hook.go`, their tests, `internal/tmux`, `internal/sessions`, `internal/transcript`, `api/operator.go`, related API/auto-name tests, frontend API types, `components/sidebar/row-flyout-card.tsx`, and `app.tsx` palette wiring. Extract shared internal packages only where they remove concrete coupling; this intake does not prescribe a new framework.

Documentation includes current hook/setup guidance and the affected memory above. `docs/specs/agent-state.md`, `api.md`, and `agent-messaging.md` are design references to reconcile during planning; specs remain human-curated. No new database, route family, settings page, orchestration engine, cross-provider fork feature, or mandatory external hook manager is intended.

Research evidence (consulted during this conversation; re-verify versions before implementation):

- [shll skill standard](https://github.com/sahil87/shll/blob/HEAD/docs/site/standards/skill.md): shared bootstrap placement, hook delegation, binary-owned bundles and conformance tests.
- [Agent Skills specification](https://agentskills.io/specification): skill format and resources, not lifecycle hook registration.
- [dot-agents hooks](https://agorcha.dev/guides/hooks/): canonical bundles rendered to native harness configuration; platform support varies.
- [Codex hooks](https://learn.chatgpt.com/docs/hooks): native discovery, event/input contracts, trust, and nullable transcript path.

## Open Questions

No unresolved user intent blocks this draft. The all-agent goal is explicit; exhaustive native capability parity has not been demonstrated. Implementation must resolve the following technical research items and record evidence before committing to adapter behavior:

- Which audited harness versions expose trustworthy root-session identity, lifecycle events, and readable conversations, and which capabilities are absent? Do not silently call the audit complete after Codex and Claude.
- What bounded server-derived capability representation keeps flyout/palette availability accurate without excessive per-tick filesystem work?
- Can exact session-to-transcript lookup be implemented from native state for each harness, and which require a documented limitation or a separately reviewed contract extension?

These are implementation discovery tasks rather than assertions that every agent already implements a shared hook standard.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Agent-neutral support is the goal; Codex is the concrete regression and Claude must keep working. | Discussed — user explicitly broadened the task beyond Codex and Claude; both failure layers were confirmed in source and live state. | S:100 R:85 A:95 D:95 |
| 2 | Certain | Keep shared tmux identity/lifecycle contracts and deterministic reporting. | Existing reader is provider-neutral; constitution requires derived state, process safety, and tmux independence. | S:95 R:85 A:95 D:90 |
| 3 | Confident | Audit Claude, Codex, Gemini CLI, Copilot, OpenCode, Kimi CLI, Antigravity, and any additionally advertised harness; implement verified capabilities and document gaps. | User requested all agents without a finite roster; this baseline covers the discussed ecosystem without inventing native support. Exact mappings are technical discovery. | S:75 R:70 A:75 D:70 |
| 4 | Confident | Use shared hook logic with native registration mappings; no mandatory dot-agents dependency. | Portable hook projects need native mappings too; discussion established prior art but did not select a new manager or toolkit-wide schema. | S:75 R:80 A:80 D:70 |
| 5 | Confident | Use conversation capability for rename availability and preserve the transcript-based action. | Proposed fix directly addresses both observed failure layers; terminal-capture fallback was an unselected suggestion. | S:80 R:80 A:80 D:75 |
| 6 | Certain | Create only an inactive draft now. | User explicitly invoked fab-draft after investigation; no implementation or installation was requested. | S:100 R:100 A:100 D:100 |

6 assumptions (3 certain, 3 confident, 0 tentative, 0 unresolved).

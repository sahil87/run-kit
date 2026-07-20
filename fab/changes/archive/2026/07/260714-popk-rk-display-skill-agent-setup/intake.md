# Intake: rk-display Skill Installed by rk agent-setup

**Change**: 260714-popk-rk-display-skill-agent-setup
**Created**: 2026-07-14

## Origin

Synthesized from a `/fab-discuss` conversation; created via `/fab-proceed`'s promptless create-intake dispatch (`{questioning-mode} = promptless-defer` — no questions asked; would-be-asked decisions deferred as Unresolved rows).

> Every time I ask an agent (running in a run-kit tmux pane) to show me an output, I have to remind it to run `rk context`.

Nothing puts run-kit's display capabilities (iframe windows, `/proxy/{port}/`, the Visual Display Recipe) into an agent's context at the moment the user asks "show me". Today that knowledge reaches only operator skills via `_cli-external.md`; ordinary agent sessions never load it.

**Decision reached in discussion**: deploy a **user-global Claude Code skill** — `~/.claude/skills/rk-display/SKILL.md` — installed and managed by the existing `rk agent-setup` command. The skill's `description:` frontmatter is the trigger surface (always in context, matched against "show/display/render/open/visualize output" requests); the body is a **thin pointer** telling the agent to run `rk context` and follow its Visual Display Recipe, never reproducing recipe content. Same anti-freeze principle as the `rk agent-hook` indirection (260707-qfps): capability content ships with the binary via `rk context`, so recipe changes reach agents on `brew upgrade rk` with no skill-file churn.

**Alternatives explicitly rejected by the user**:
1. **SessionStart hook injecting context** — injected once, can compact away, costs tokens in every session. User chose skill-only.
2. **User-global CLAUDE.md pointer** — passive prose, ignored more often, noise on non-run-kit sessions.
3. **Launch-time `--append-system-prompt "$(rk context)"` in riff/session_command** — only covers run-kit-launched sessions; misses hand-launched `claude` in a pane.
4. **MCP server with a `display_html` tool** — largest new surface (constitution §IV Minimal Surface Area); same per-harness distribution problem; duplicates what two tmux options already do.

## Why

1. **The pain point**: when a user asks an agent in a run-kit pane to "show me" output, the agent has no idea run-kit can display it — it describes the output in text or opens nothing, and the user must manually remind it to run `rk context`. This repeats on every session, because nothing persistent carries the display capability into agent context at the trigger moment.
2. **The consequence of not acting**: the Visual Display Recipe (already built, already shipped in `rk context` — verified present in `cmd/rk/context.go` / `context_test.go`) stays effectively undiscoverable to the agents it was built for. The recurring manual reminder is exactly the kind of friction run-kit exists to remove.
3. **Why this approach**: a skill's `description:` frontmatter is *always* in the harness's context and is matched at request time — it fires precisely when the user says "show/display/render/open/visualize", costs near-zero tokens otherwise, and survives compaction (unlike a SessionStart injection). Making `rk agent-setup` the installer reuses an existing, proven, interactive, diff-and-confirm install surface (no new command), and keeping the body a thin pointer to `rk context` means the recipe's single source of truth stays in the binary — the skill file never freezes stale recipe content (the exact failure mode 260707-qfps eliminated for hooks).

## What Changes

### 1. New skill artifact — `~/.claude/skills/rk-display/SKILL.md` (installed at user's machine, content shipped in the rk binary)

Proposed file content (authoritative shape; exact prose may be polished at apply):

```markdown
---
name: rk-display
description: "Display HTML, diagrams, reports, or any local web service visually to the user in a run-kit iframe window. Use whenever the user asks to 'show', 'display', 'render', 'open', or 'visualize' output and you are running inside a tmux pane — run-kit may be managing it. Covers serving generated HTML and proxying local dev-server ports."
metadata:
  managed-by: rk agent-setup
---
# rk-display

1. **Gate**: check `command -v rk >/dev/null 2>&1` and that `$TMUX_PANE` is set.
   If either check fails, silently fall back to describing the output in text —
   never surface an error or warning.
2. **Discover**: run `rk context` and read its Capabilities section — the
   authoritative, current recipe.
3. **Display**: follow the Visual Display Recipe from that output. Do not
   reproduce the recipe from memory — the binary's output wins.
```

Key properties:
- `description:` is the entire trigger surface. The agreed wording covers "show / display / render / open / visualize", the tmux-pane framing, and both capability families (serving generated HTML; proxying local dev-server ports). If the skill under-fires in practice, this string is the tuning knob (candidate additional trigger verbs: "screenshot", "preview", "report") — post-ship tuning, not in scope now.
- `metadata: managed-by: rk agent-setup` is the ownership marker (see §3 below).
- The body never embeds the recipe, server URL, or pane identity — the agent learns those at use-time from `rk context` (accepted consequence; the recipe already instructs exactly that).
- Fail-silent discipline matches the project-wide rk rule: every rk invocation is gated and silent on absence.

### 2. Installer extension — `app/backend/cmd/rk/agent_setup.go`

1. **`agentConfig` gains a `skillsDir string` field.** The Claude Code registry row sets it to `filepath.Join(home, ".claude", "skills")`. Future registry rows (codex/copilot/gemini/opencode) may leave it empty — empty means "no skill install for that agent".
2. **Skill content lives in the binary** — a Go const (or `//go:embed`; apply picks whichever matches existing `cmd/rk` patterns). One source of truth, versioned with rk, updated by `brew upgrade rk` + re-running `rk agent-setup`. The content embeds no machine-derived interpolation (no rk path, no user input), so it adds no new path-safety surface beyond the existing `resolveRkPath`/`validateHookPath` ones.
3. **`applyAgentConfig` grows a second artifact** alongside the settings-hooks merge (skipped when `skillsDir` is empty): propose `{skillsDir}/rk-display/SKILL.md`, reusing the existing flow — tolerant read of current content (missing file → empty), render diff of current vs proposed, no-op skip with a message when identical, y/N `confirm` before writing. `MkdirAll` for `{skillsDir}/rk-display/`; file mode **0644** (skill text is not a secret — deliberately unlike settings.json's 0600).
4. **Ownership**: the path plus the `managed-by: rk agent-setup` frontmatter marker (analogous to `isRkEntry`, but rk owns the **whole file** — no merging into user content). The marker's job is to protect `--uninstall`: delete the `rk-display/` directory only when the marker is present in the installed file; a user-rewritten file without the marker is left alone with a note explaining why it was skipped.
5. **Hand-edited file that still carries the marker**: shows up as a diff at reinstall; the existing confirm gate is the protection (user sees their edits being overwritten and can decline).
6. **Command surface unchanged**: same `rk agent-setup` / `rk agent-setup --uninstall`, now managing two artifacts per agent. No new flags, no new commands.

Existing patterns to follow (already in `agent_setup.go`): pure functions over injected `io.Reader`/`io.Writer` for TTY-free testability, tolerant reads (missing → empty, malformed → loud error, never silent clobber), explicit y/N confirm defaulting to No, per-artifact "already installed / absent — nothing to do" no-op reporting.

### 3. Unit tests — `app/backend/cmd/rk/agent_setup_test.go` conventions

New unit tests alongside the existing ones, covering at minimum:
- **Marker detection**: a file with `managed-by: rk agent-setup` in frontmatter is recognized as rk-owned; a rewritten file without it is not.
- **Idempotent reinstall**: installing over an identical installed skill is a no-op (no prompt, "nothing to do" message).
- **Uninstall-only-with-marker**: `--uninstall` removes the `rk-display/` directory when the marker is present; leaves a marker-less file untouched and prints the skip note.
- **Diff rendering**: the current-vs-proposed diff for the new artifact renders through the same confirm flow as the settings merge.

## Affected Memory

- `run-kit/agent-state`: (modify) — the `rk agent-setup` installer section (`## rk agent-setup — Hook Installer`) gains the second managed artifact: the user-global `rk-display` skill, its `managed-by` ownership marker, the marker-gated uninstall, and the thin-pointer/anti-freeze rationale shared with the `rk agent-hook` indirection.

## Impact

- **Code**: `app/backend/cmd/rk/agent_setup.go` (+ `agent_setup_test.go`). No API, frontend, tmux, or daemon changes. No new CLI surface.
- **User machines**: `rk agent-setup` now proposes a second write — `~/.claude/skills/rk-display/SKILL.md` (0644) — behind the same per-artifact diff + y/N confirm; `--uninstall` gains a marker-gated directory removal.
- **Constitution**: §I satisfied — skill content is a fixed literal with nothing user-provided or machine-derived interpolated; all writes go through Go. §IV satisfied — no new command, page, or server surface; the rejected MCP alternative was ruled out on exactly this principle.
- **Explicit non-goals**: no SessionStart hook, no CLAUDE.md snippet, no MCP server, no launch-time `--append-system-prompt` injection, no trigger-verb expansion beyond the agreed description wording, no UI surfacing.

## Open Questions

- None — the `/fab-discuss` session resolved all design decisions; the trigger-description wording is a documented post-ship tuning knob, not an open question.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Delivery mechanism is a user-global Claude Code skill installed by `rk agent-setup`; SessionStart hook, CLAUDE.md pointer, launch-time injection, and MCP server are all out of scope | Discussed — user explicitly chose the skill after weighing and rejecting the four alternatives | S:95 R:75 A:90 D:95 |
| 2 | Certain | Skill body is a thin pointer (gate → `rk context` → follow the Visual Display Recipe), never reproducing recipe content | Discussed — same anti-freeze principle as the 260707-qfps `rk agent-hook` indirection; binary output wins | S:95 R:80 A:95 D:95 |
| 3 | Certain | Installer shape: `agentConfig.skillsDir` field (empty = no skill install), second artifact in `applyAgentConfig` reusing the read/diff/no-op/confirm flow, `MkdirAll` + 0644, command surface unchanged | Discussed — agreed design enumerated points 1–6 verbatim | S:95 R:85 A:90 D:90 |
| 4 | Certain | Ownership/uninstall semantics: `managed-by: rk agent-setup` frontmatter marker; `--uninstall` deletes `rk-display/` only when the marker is present; marker-less user rewrite left alone with a note; marker-carrying hand edits surface as a reinstall diff behind the existing confirm gate | Discussed — marker's job and both edge behaviors specified in the conversation | S:90 R:85 A:90 D:90 |
| 5 | Certain | Trigger surface is the agreed `description:` wording (show/display/render/open/visualize + tmux-pane framing + both capability families); extra verbs (screenshot/preview/report) deferred as a post-ship tuning knob | Discussed — wording given near-verbatim; the string is explicitly named as the tuning knob | S:80 R:95 A:85 D:80 |
| 6 | Certain | Skill body fail-silent gate: `command -v rk >/dev/null 2>&1` and `$TMUX_PANE` set; on failure silently describe output in text, never error | Discussed — and mirrors the project-wide rk fail-silent discipline in `_preamble.md` § Run-Kit Reference | S:95 R:90 A:95 D:95 |
| 7 | Certain | Accepted consequence: the agent learns server URL and pane identity only at use-time via `rk context` | Discussed — explicitly accepted; the recipe already instructs exactly that | S:90 R:85 A:90 D:90 |
| 8 | Certain | Unit tests follow `agent_setup_test.go` conventions: marker detection, idempotent reinstall no-op, uninstall-only-with-marker, diff rendering | Discussed — plus code-quality.md mandates tests for new behavior | S:90 R:90 A:95 D:90 |
| 9 | Confident | Skill content storage: pick Go const vs `//go:embed` at apply time following existing `cmd/rk` patterns — either satisfies the one-source-of-truth requirement | Discussion left "const (or `//go:embed`)" open; trivially reversible, codebase pattern check answers it | S:55 R:90 A:85 D:60 |
| 10 | Confident | Uninstall removes the whole `rk-display/` directory (marker present), including any user-added files within it — the marker on SKILL.md marks the directory rk-owned, and the confirm prompt surfaces the removal before it happens | Directory-level deletion is the agreed design; extra files in the directory are not an expected state | S:70 R:80 A:75 D:70 |

10 assumptions (8 certain, 2 confident, 0 tentative, 0 unresolved).

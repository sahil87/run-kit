## Conformance Report — sahil87 toolkit standards @ shll v0.0.23

Audited against a **HEAD build** of `run-kit` (`bin/rk`, built from `app/backend/cmd/rk/` with an ldflags version), never the installed brew binary (v3.7.2, which predates `rk skill` and would false-negative). Standards enumerated at apply time via `shll standards`:

```
principles         foundation   The ten toolkit CLI principles every tool is built against
help-dump          binary       Machine-readable help contract every tool must emit
readme-extraction  repo         README + docs/site structure standard for toolkit repos
skill              binary+repo  Agent skill bundle standard: docs/site/skill.md served by `<tool> skill`
```

`shll version` shll row (the revision this claim is made against): **`shll v0.0.23`**.

> Version drift note: shll moved `v0.0.23` → `v0.1.0` between the audit and this review. The cited rules (principles, help-dump, readme-extraction, skill) were spot-checked and are unchanged across that bump, so every claim in this report stays pinned at the audited **`shll v0.0.23`**.

> Note: all "fixed here" gaps in this report are committed in a single commit on this branch: `60e96d75` ("chore: Toolkit standards conformance @ shll v0.0.23").

---

### principles — PASS with gaps (2 fixed here, 2 deferred)

Assessed each of the ten principles against `bin/rk` behavior + `app/backend/cmd/rk/` source.

| # | Principle | Verdict |
|---|-----------|---------|
| 1 | Non-interactive by default | GAP → fixed here (agent-setup) |
| 2 | stdout is data, stderr is diagnostics | GAP → fixed here (status/doctor `--json`) |
| 3 | Help is a published contract | PASS (help-dump emitted; see help-dump section) |
| 4 | Fail fast with actionable errors | GAP → deferred to [rex1] |
| 5 | Visible mutation boundaries | GAP → fixed here (agent-setup `--dry-run`) |
| 6 | Stateless, therefore retry-safe | PASS (no DB/state files per constitution; re-derives from tmux + fs) |
| 7 | Compose, don't reinvent | PASS (wraps `wt`/`fab`/`brew`; `update` probes `--skip-brew-update` before use) |
| 8 | Graceful degradation | PASS (`notify` fail-silent exit 0; `doctor` reports missing dep, doesn't crash; `riff` degrades to default launcher when `fab` absent) |
| 9 | Bounded, high-signal output | GAP → deferred to [f8yv] |
| 10 | Agent-discoverable documentation (SHOULD) | PASS (README + docs/site pulled; `rk skill` bundle shipped — see skill section) |

**Gaps and dispositions:**

- **P1 (Non-interactive by default) — `agent-setup` could neither consent non-interactively nor refuse a non-TTY prompt — fixed here.** `run-kit agent-setup` mutates `~/.claude/settings.json` but its confirmation was satisfiable only by an interactive `[y/N]` prompt (no `--yes`/`-y`), so an agent could not complete an install non-interactively. The principle's non-TTY clause has two halves and BOTH are now met: (a) **consent by flag** — added `--yes`/`-y` (skip the prompt and write) and `--dry-run` (preview, no consent needed); (b) **non-TTY refusal** — with neither flag, a pending write, and a non-TTY stdin, the command now refuses with an error naming `--yes` (stderr, non-zero exit, nothing written), instead of the prior silent EOF-decline that exited 0 (a success-looking no-op — the exact agent trap Principle 1 targets; reference impl: `shll uninstall`). The auto-answered `--yes`/`--dry-run` paths also no longer print the `[y/N]` prompt suffix (it was emitted but never read — reads as a hang in a transcript). `app/backend/cmd/rk/agent_setup.go` (`consent` type — `yes`/`dryRun`/`stdinIsTTY` — threaded through `runAgentSetup`→`applyAgentConfig`→`applyAgentHooks`/`removeLegacySkill`, TTY detected via `term.IsTerminal` — the `isTerminal` helper, deliberately NOT a bare `os.ModeCharDevice` check, which false-classifies `/dev/null` as a TTY and would make the refusal silently not fire on `agent-setup </dev/null`; pinned by `TestIsTerminalRejectsNonTTYFiles`); tests in `agent_setup_test.go` (non-TTY refusal, `--yes`/`--dry-run` on both the hooks write and the legacy-skill removal).
- **P2 (stdout is data) — `status` and `doctor` offered no machine format — fixed here.** `run-kit status` (session summary — data meant for programmatic consumption) and `run-kit doctor` (the toolkit's *named* `--json` reference in the principle's enforcement receipt) had no `--json`. Added `--json` to both, emitting stable JSON to **stdout** (`status`: array of `{name, windows}`; `doctor`: `{ok, checks:[{name, ok, hint}]}` with worst-check-wins `ok`). `doctor`'s human diagnostic stays on stderr (it is diagnostics; `--json` is the data path). `app/backend/cmd/rk/status.go`, `doctor.go`; tests in `status_test.go` (new), `doctor_test.go`.
  - **`status --json` empty-vs-error semantics** (both verified empirically, both mirror the human path): a **cleanly-absent server** — no tmux server running for the `runkit` socket — is **empty-success**: `[]` on stdout, exit 0, stderr empty. This is deliberate `internal/tmux.ListSessions` behavior (a "no server running" condition is not an error), matching the human path's `No tmux sessions found` + exit 0 — an empty result is data, not a failure. An **errorful unreachability** (a stale socket, a permission error — a genuine tmux failure) surfaces the error on **stderr** with a **non-zero exit** and **no partial JSON** on stdout, so a machine consumer never parses a truncated document as complete. The split is by the nature of the condition (absent ≠ unreachable), not by a flag.
- **P4 (Fail fast — exit-code convention) — usage errors exit 1, not the convention's 2 — deferred to [rex1].** `run-kit shell-init` and `run-kit riff` already return exit 2 for their own usage errors, but every other command inherits cobra's default exit 1 for unknown commands, missing/excess args, and unknown flags (the shared `main.execute()` blanket-`os.Exit(1)`s). Unifying this is a cross-cutting error-model change across the whole command tree (central usage-error classification), not a per-command missing exit code → deferred per the proportionality rule.
- **P9 (Bounded, high-signal output) — no `--quiet`; `reaper` list uncapped — deferred to [f8yv].** No command offers `--quiet`, and `run-kit reaper`'s match list is uncapped (~4485 lines in the audit environment). Both are global output-model changes (a shared quiet-gating convention; a default list cap + `--all` + truncation notice) rather than a single additive flag → deferred.

*Nuance noted, not a violation:* the help-dump `version` field is `v`-prefixed (`v3.8.0`); the standard's example shows bare semver but its text mandates only "from the built binary", and `shll version` itself renders `v`-prefixed rows — left as-is.

---

### help-dump — PASS (1 violation fixed here)

Ran the standard's verification checklist verbatim against `bin/rk help-dump`:

- Exits 0, writes valid JSON to **stdout** only, **stderr empty** — PASS.
- `completion`, `help`, and all hidden commands (incl. `help-dump` itself) absent from the tree — PASS.
- `version` reflects the built binary (ldflags), not a literal — PASS.
- `help-dump` declared `Hidden: true`, absent from `-h` — PASS.
- Envelope shape — **VIOLATION (fixed here)**: the envelope emitted `captured_at`, which the standard forbids as a rule "with teeth" ("Do not emit `captured_at` — the capture timestamp is owned by shll.ai; a tool cannot know its own capture time"). Removed the `captured_at` field, the `nowUTC`/timestamp plumbing, and the `time` import; the envelope is now exactly `{tool, version, schema_version, root}`. `app/backend/cmd/rk/help_dump.go`; tests updated in `help_dump_test.go` (dropped the captured-at/clock tests, added `TestBuildDumpOmitsCapturedAt` pinning the exact key set).

Re-verified after the flag-adding fixes (status/doctor/agent-setup changed the tree): envelope still `{tool, version, schema_version, root}`, exit 0, stdout-only JSON, no forbidden nodes, and the new `--json`/`--yes`/`--dry-run` flags appear in the affected commands' captured `text`.

---

### readme-extraction — PASS (2 violations fixed here)

Ran the standard's verification checklist against `README.md` + `docs/site/`:

- README head order (`#` H1 → toolkit blockquote → badges → tagline prose) — PASS. The H1 carries an inline `<img>` logo (a markdown-`#` heading with an inline image, not an HTML `<h1>` and not chrome above the H1) — conformant.
- No `#gh-*-mode-only` fragments — PASS.
- No `docs/site/` page named `overview`/`readme`/`commands` — PASS (`install`, `notifications`, `skill`, `status-dot`, `workflows`).
- No relative images anywhere — PASS.
- README cross-links its `docs/site/` pages and the absolute command-reference URL (`https://shll.ai/tools/run-kit/commands/`, README tail) — PASS.
- `docs/site/**` closure (no relative link/image escapes the tree, rule 1) — **VIOLATION (fixed here)**: `docs/site/install.md` linked `../../README.md#agent-state--run-kit-agent-setup` — a `..` escape out of the published `docs/site/` tree, which 404s on the rendered shll.ai page (the closure rule mandates every relative link inside `docs/site/**` resolve to a path *inside* `docs/site/`). Rewritten to the absolute form `https://github.com/sahil87/run-kit/blob/main/README.md#agent-state--run-kit-agent-setup`. Re-ran the closure sweep over `README.md` + `docs/site/**` afterward: zero remaining relative escapes (the README's only relative links are the 5 auto-rewritten `docs/site/*.md` hub links). `docs/site/install.md`.
- Links leaving the published set are absolute (README rule 5 / docs/site rule 2) — **VIOLATION (fixed here)**: the README linked `docs/specs/agent-state.md` with a relative path, which 404s on the rendered shll.ai page (only the README slice + `docs/site/**` are published). Rewritten to the absolute form `https://github.com/sahil87/run-kit/blob/main/docs/specs/agent-state.md`. `README.md`.

---

### skill — PASS (fully conformant, no changes)

The `skill` standard's "deferred, not yet adopted" contingency does NOT apply — `rk skill` + `docs/site/skill.md` exist at HEAD (PR #381), so the standard is audited in full. Ran its verification checklist against `bin/rk skill`:

- Exits 0, writes the bundle to **stdout** only, **stderr empty** — PASS.
- stdout is **byte-identical** to the repo's canonical `docs/site/skill.md` — PASS (drift-guard test `TestSkillEmbedMatchesCanonical` pins it; embedded copy `app/backend/cmd/rk/skill/skill.md` matches canonical).
- Bundle is **≤150 lines** (83 lines) and carries no dynamic/environment-derived content — PASS (dynamic environment state lives in the separate `rk context`, per the standard's static-only rule).
- Bundle stays in genre — a usage briefing (when to use, capabilities map, composition, output/exit-code contracts, gotchas), not a README clone or flag table — PASS.
- Renders at `/run-kit/skill` on shll.ai for free (it is part of the pulled `docs/site/**` tree) — PASS.

No changes required.

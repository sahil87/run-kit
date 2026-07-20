# Intake: Skill Display Topic Page, `rk url`, Retire `rk context`

**Change**: 260718-icxz-skill-display-topic-url-retire-context
**Created**: 2026-07-18

## Origin

> Adopt skill-standard topic pages: add `rk skill display` topic page, add `rk url`, retire `rk context`

Conversational — drafted from a `/fab-discuss` session (2026-07-18) that walked the full design:

1. User asked whether `rk context` is deprecated now that `rk skill` exists (PR #381). Established: complementary by design — `rk skill` static, `rk context` dynamic, per the toolkit skill standard's static-only rule.
2. User asked whether to merge `rk context` into `rk skill` (e.g. `rk skill display` / `rk skill context`). Initially rejected against the then-current standard.
3. User is amending the skill standard **in a parallel session** (shll repo, worktree `brave-avocet`, PR being sent): **topic pages** — `<tool> skill <topic>`, each canonical at `docs/site/skill/<topic>.md`, each independently ≤150 lines, static-only, byte-identical, drift-guarded, rendered at `/<tool>/skill/<topic>` on shll.ai. This unlocks the merge for the *static* half only.
4. Dissected `rk context` output: of ~115 lines, only the 4-line Environment block (Session, Window, Pane ID, Server URL) is dynamic. User asked whether `rk context` can be deleted entirely by teaching agents the derivations. Verified in `context.go`: yes — every value is a thin derivation (see What Changes §4).
5. User approved: one change covering the topic page + `rk url` + `rk context` deletion. Ecosystem precedent for `rk url` confirmed (see Why).

## Why

**Problem**: `rk context` now duplicates ~100 lines of static capability prose that the `rk skill` bundle owns (iframe windows, proxy, Visual Display Recipe, conventions), violating the spirit of the skill standard's static/dynamic split — and its genuinely dynamic residue is 4 lines, every one derivable by the agent directly. Keeping the command means two sources for the same static content (drift risk) and one extra subcommand on the CLI surface (Constitution §IV minimal surface).

**If we don't**: the duplication grows stale independently (rk context's copy has no drift guard against the bundle), and agents keep being taught two overlapping entry points.

**Why this approach**:
- The amended skill standard's **topic pages** give the static depth a canonical, drift-guarded home: `rk skill display`.
- Constitution §X's own rule — "when a fact is available both ways, derivation wins" — applied to rk's own CLI: the Environment values are all derivable (`$TMUX_PANE`, `tmux display-message`, env vars). A **derivation recipe is static content even though its result is dynamic**, so the bundle can teach it without violating static-only.
- The server URL is the one derivation that deserves a stable command seam: `rk url`. Ecosystem precedent is strong — `gh browse --no-browser` (prints destination URL; verified locally), `docker port` (verified locally), `minikube service --url`, `jupyter server list`. In-toolkit there is no precedent only because run-kit is the toolkit's sole server-bearing tool (shll, hop, wt, tu, idea, fab have no server) — so no naming collision and no divergence concern. `rk url` also preserves the natural home for smarter URL discovery later (port-owner verification) without freezing the heuristic into prose.
- Net CLI surface: −1 `context`, +1 `url`, + topic arg on existing `skill` — zero growth, less duplication.

## What Changes

### 1. New: `rk skill display` topic page

- New canonical file **`docs/site/skill/display.md`** (≤150 lines, static-only), absorbing `rk context`'s static content:
  - **Terminal Windows** (`tmux new-window -n <name>`)
  - **Iframe Windows** (`@rk_type iframe` + `@rk_url <url>`, including changing an existing window's URL)
  - **Proxy** (`/proxy/{port}/...` pattern)
  - **Visual Display Recipe** (the canonical 4-step flow, fail-silent discipline intact)
  - **Conventions**: `@rk_type` / `@rk_url` option schema, Window Lifecycle (killing a window kills the process), SSE Reactivity (option changes auto-detected) — these land on the topic page, NOT the core bundle (agreed in discussion: they only matter to an agent doing iframe work; save core headroom)
- Live values referenced symbolically: relative `/proxy/<port>/<file>` paths, and "get the server URL from `rk url`" — never literal host:port.
- **Subcommand**: `rk skill display` prints the topic page byte-identical to `docs/site/skill/display.md`, stdout-only, empty stderr, exit 0 — same contract as the core bundle.
- **Embed mechanism**: extend the existing sync + drift-guard pattern — `scripts/sync-skill.sh` copies `docs/site/skill/display.md` → `app/backend/cmd/rk/skill/display.md` (module-root reachability is why the copy exists), `//go:embed` in `skill.go`, and a `TestSkillEmbedMatchesCanonical`-style drift-guard test per topic file. Renders at `/run-kit/skill/display` on shll.ai for free (pulled tree).
- The old `rk context` **CLI Commands** section is **deleted, not moved** — command trees are explicitly out of bundle genre per the standard (defer to `-h` / `help-dump`), and the core bundle's capabilities map already covers when-to-use.
- **Verified against the merged standard** (shll PR #47, merged 2026-07-18 — § Topic pages): path shape, per-topic ≤150 budget, same invocation contract, sync + drift-guard, and topic-index requirements all match this intake. One additional contract requirement to implement: **an unknown topic fails fast — non-zero exit, an error on stderr naming the valid topics — never a silent empty stdout** (e.g. `rk skill bogus` exits non-zero with `unknown topic "bogus" (valid: display)` on stderr). Also confirmed: bare `rk skill` never inlines topic pages, and aggregation reads core bundles only.

### 2. New: `rk url`

- Prints the derived run-kit server URL to stdout, newline-terminated, exit 0, empty stderr:
  ```
  $ rk url
  http://127.0.0.1:3000
  ```
- **v1 derivation is byte-equal to today's `rk context` Server URL line**: `config.Load()` — `RK_HOST`/`RK_PORT` env vars with `127.0.0.1:3000` defaults, port-validated (`context.go:60-63` today). No `.env` file reading, no probing.
- Help text states plainly it is a config-derived heuristic (what the server *would* bind given this environment), not a liveness probe.
- **Non-goal (deferred)**: port-owner/liveness verification (the `daemon_portowner.go` machinery). `rk url` existing is what keeps that door open.

### 3. Removed: `rk context`

- Delete `app/backend/cmd/rk/context.go` + `context_test.go` and the cobra registration. Outright removal — **no deprecation stub or alias** (user: "completely get rid of").
- Safe-removal reasoning: the binary embed makes removal atomic per-install — a binary lacking `rk context` also ships the updated bundle that no longer references it. External callers (fab-kit operator skills) follow the fail-silent rk discipline and degrade to no-op; their doc update is a sibling change (Out of Scope).

### 4. Core bundle updates (`docs/site/skill.md` + embedded mirror)

- Add the **topic index** — the standard's one-line-per-topic pattern, e.g. `panes, iframes & visual display → rk skill display` (exact wording per the merged standard's format, if it prescribes one).
- Add a **"Where am I"** derivation block (~6 lines) teaching what `rk context` used to return:
  ```sh
  echo "$TMUX_PANE"                                # pane ID, e.g. %82 (empty ⇒ not in tmux)
  tmux display-message -t "$TMUX_PANE" -p '#S'     # session
  tmux display-message -t "$TMUX_PANE" -p '#W'     # window
  tmux show-option -w -t "$TMUX_PANE" -qv @rk_type # window type (empty ⇒ terminal)
  rk url                                           # server URL (config-derived)
  ```
- Replace all `rk context` references (~6 occurrences), including the `rk context 2>/dev/null | grep 'Server URL' | awk '{print $NF}'` extraction recipe → `rk url`, and the "static briefing / dynamic complement" framing paragraph.
- Update README.md's `rk context` references likewise. Also update the stale doc-comment in `skill.go` ("that stays exclusive to `rk context`").

### Dependency (sequencing constraint)

**Apply MUST NOT start until the shll skill-standard topic-pages amendment merges** (PR in flight from the user's parallel session). The topic-page shape here (`docs/site/skill/<topic>.md`, per-topic ≤150, drift-guard, topic index) must be re-checked against the merged standard's final wording at apply entry — Constitution § Toolkit Standards binds CLI-surface changes to the standards, and `shll standards skill` is the canonical read. This is why the change is drafted, not activated.

### Out of Scope

- **fab-kit `_cli-external.md` § rk** update (it documents `rk context` as carrying the recipes) — sibling change in the fab-kit repo, to land in the same window as this change ships.
- Softening the skill standard's Precedent prose ("stays in separate commands like `run-kit context`") — handled in the user's in-flight standard PR, not here.
- Smarter URL discovery (port-owner verification) — deferred, see §2.

## Affected Memory

- `run-kit/architecture`: (modify) CLI Subcommands section — remove `context` row, add `url` row, extend the `skill` row with the topic-page mechanism (per-topic embed + drift guard)
- `run-kit/toolkit-standards`: (modify) skill-standard conformance — record topic-page adoption (`rk skill display`), the static-derivation-recipe pattern replacing `rk context`, and the standard-amendment dependency

## Impact

- **Backend** (`app/backend/cmd/rk/`): `context.go` + `context_test.go` deleted; `url.go` + `url_test.go` new; `skill.go` gains topic subcommand + embed; `skill/display.md` new committed embed copy; drift-guard test extended.
- **Scripts**: `scripts/sync-skill.sh` extended to sync topic files.
- **Docs**: `docs/site/skill/display.md` (new), `docs/site/skill.md` (edits), `README.md` (reference updates).
- **Help surface**: `help-dump` output changes shape (command added/removed) — generated programmatically, no manual step, but downstream shll.ai command reference reflects it on next pull.
- **No frontend, no API, no tmux-layer changes.** No test-path changes beyond the Go tests named above.

## Open Questions

- None — all decisions were resolved during the `/fab-discuss` session (see Assumptions). The only external unknown (final merged wording of the amended standard) is handled by the sequencing constraint, not a question.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Topic named `display` (`rk skill display`, canonical `docs/site/skill/display.md`) | User proposed the name themselves; amended standard defines the path shape | S:90 R:85 A:90 D:90 |
| 2 | Certain | `rk context` deleted outright — no deprecation stub/alias | User: "completely get rid of"; version-locked embed makes removal atomic per-install; external callers are fail-silent by discipline | S:95 R:70 A:85 D:85 |
| 3 | Certain | Conventions (`@rk_type`/`@rk_url`, lifecycle, SSE) land on the display topic page, not the core bundle | Explicitly agreed in discussion ("2 - agreed"); only relevant to iframe work | S:90 R:90 A:85 D:85 |
| 4 | Certain | Old CLI Commands section deleted, not migrated | Standard explicitly excludes command trees from bundle genre (defer to `-h`/`help-dump`); disposition table presented and accepted | S:80 R:95 A:95 D:90 |
| 5 | Certain | Topic page embedded via the existing sync + drift-guard pattern (`sync-skill.sh` + `//go:embed` + byte-equality test) | Standard mandates the mechanism; it already exists for the core bundle — pure extension | S:85 R:85 A:95 D:90 |
| 6 | Confident | `rk url` v1 = `config.Load()` env+default heuristic, byte-equal to today's derivation; port-owner verification deferred | Discussed as the minimal v1; additive enhancement later is cheap; user endorsed the command, not a specific smartness level | S:70 R:90 A:80 D:65 |
| 7 | Confident | "Where am I" derivation block lives in the core bundle (not the topic page) | Universal need (any agent, not just display work); ~6 lines fits the core's 67-line headroom; proposed in discussion without objection | S:70 R:90 A:80 D:70 |
| 8 | Confident | Apply gated on the shll standard amendment merging; final topic-index wording re-checked against `shll standards skill` at apply entry | User confirmed the amendment is in flight; drafting (not activating) chosen for exactly this reason | S:85 R:80 A:75 D:80 |
| 9 | Confident | fab-kit `_cli-external.md` update is out of scope — sibling change in fab-kit repo, same shipping window | Discussed and accepted as migration touchpoint #2; different repo, different pipeline | S:80 R:75 A:80 D:80 |

9 assumptions (5 certain, 4 confident, 0 tentative, 0 unresolved).

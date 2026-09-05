# Intake: Mux Sessions Role Query

**Change**: 260905-csk9-mux-sessions-role-query
**Created**: 2026-09-05

## Origin

Created via `/fab-new csk9` from the backlog item, with a mid-conversation user directive shaping scope:

> [csk9] 2026-09-05: [fab-kit follow-up] Expose a session-role / user-facing-session query from rk (e.g. @rk_ses_role, or 'rk mux sessions --json' with user-facing/attached/window facts) so fab's operator can source spawn-target-session structure from rk instead of hard-coding the _rk-* reserved prefix (adopted in fab-kit cx52 / PR #645)

User directive during intake: review fab-kit PR #645 (cx52, unmerged — the operator spawn-session inference change that adopted the hard-coded `_rk-*` prefix) and design both sides holistically — simplify the fab operator skill AND make rk's session inference surface better. **Split agreed**: run-kit changes land via this change (this worktree); fab-kit consumption edits are amended onto PR #645 in the `~/code/sahil87/fab-kit.worktrees/operator-spawn-session-ux` worktree — they are NOT part of this change's diff.

## Why

**The pain point.** fab-kit's operator (cx52 / PR #645) needs to know which tmux sessions are legitimate spawn targets. Lacking an rk query, it adopted run-kit's `_rk-*` reserved-infrastructure prefix as a hard-coded naming convention — its own memory records this as "the right long-term home is a run-kit session-role query, deferred to a run-kit backlog idea." That idea is this change. run-kit already owns the classification: `PinSessionPrefix` (`_rk-pin-*`), `ControlAnchorSessionName` (`_rk-ctl`), and `OperatorSessionName` (`_rk-operator`) are constants in `app/backend/internal/tmux/tmux.go`, and the `ListSessions`/`parseSessions` chokepoint already filters pin/anchor sessions from every user-facing enumeration. The knowledge exists; it just has no CLI fact surface.

**The consequence of not fixing it.** Every downstream consumer (fab's operator today; any future orchestrator) must copy run-kit's reserved-name internals as prose, and each new reserved name rk introduces (a 4th infrastructure kind) silently breaks their exclusion rules — the classic drift failure the cli-layering delegation rule ("each tool delegates to the other for facts the other layer owns") exists to prevent. fab's operator skill also carries a paragraph of prefix taxonomy that shrinks to one delegation sentence once the query exists.

**Why this approach.** A **query verb** (`rk mux sessions`), not a stamped `@rk_ses_role` option: role is fully derivable from session names + reserved constants at request time, so Constitution II (derive from tmux at request time) and Constitution X (options carry only the underivable) both rule out stamping. The verb is the session-level sibling of `rk mux panes` — same enumeration posture, same JSON/table conventions, same inherited `-L`. The backlog entry offered both options; the constitution decides.

## What Changes

### 1. New verb: `rk mux sessions [--json] [--all]`

A whole-server session enumeration query — the 13th `rk mux` family member, sibling of `rk mux panes` (same "query consumes inherited `-L/--server`" rule; no daemon dependency; tmux addressed directly). One row per session with **substrate facts only** (no change/stage — enrichment is fab's layer per `docs/specs/cli-layering.md`):

- `name` — session name
- `role` — the classification (see §2)
- `attached` — count of size-arbitrating human clients, group-credited: a client attached via a session-group copy counts against the leader (the existing `ListClients`/group-key join semantics — control-mode/ignore-size attaches already excluded, so the dashboard's own relay never inflates this)
- `windows` — window count
- `path` — session start directory (`#{session_path}`)
- group facts as needed (`grouped`; group copies MUST NOT appear as separate rows — the leader-keeps-name rule the dashboard already applies)

**Default output lists user-facing sessions only** (`role: user`). `--all` includes infrastructure sessions, each labeled with its role — this is what fab's operator consumes to learn both the candidate set and the exclusions from one call (in practice the default no-flag form IS the candidate set). Example:

```
$ rk mux sessions --json
[
  {
    "name": "fabKit",
    "role": "user",
    "attached": 1,
    "windows": 15,
    "path": "/home/sahil/code/sahil87/fab-kit"
  }
]

$ rk mux sessions --all --json
[
  { "name": "_rk-ctl", "role": "control", "attached": 0, "windows": 1, ... },
  { "name": "_rk-operator", "role": "operator", "attached": 0, "windows": 1, ... },
  { "name": "fabKit", "role": "user", "attached": 1, "windows": 15, ... }
]
```

Output shapes and exit codes mirror `rk mux panes`: aligned table by default (rows are data — stdout; diagnostics to stderr), `--json` emits a two-space-indented array, exit 0 on success including an alive server with nothing to list (`[]` under `--json`), 1 operational (no server on the resolved socket, tmux failure), 2 usage.

### 2. Role taxonomy — derived, never stamped

Classification happens at request time from the session name against the reserved constants (no new tmux option, no `@rk_ses_role`):

| Role | Rule |
|------|------|
| `pin` | name has `PinSessionPrefix` (`_rk-pin-*`) |
| `control` | name == `ControlAnchorSessionName` (`_rk-ctl`) |
| `operator` | name == `OperatorSessionName` (`_rk-operator`) |
| `reserved` | any other `_rk-*`-prefixed name (future infrastructure — consumers excluding non-`user` roles stay correct when rk adds a 4th kind) |
| `user` | everything else |

The `reserved` fallback is the future-proofing that makes the query strictly better than prefix-copying: rk formally documents `_rk-*` as its reserved session-name namespace, and a consumer that filters on `role != "user"` never needs to learn a new name.

`role: operator` is **structural, unconditional** classification — deliberately distinct from the dashboard's content-conditional `Hidden` rule (`operatorSessionHidden` in `internal/sessions/sessions.go`: hidden only while every window carries role `operator`). For spawn-target purposes the operator session is never a candidate regardless of its current window population; the dashboard rule is a rendering concern and is untouched.

### 3. Enumeration mechanics

The existing `parseSessions` chokepoint unconditionally drops `_rk-pin-*` and `_rk-ctl` rows, so the `--all` form cannot ride it as-is. The verb enumerates raw `list-sessions` and classifies, while reusing the chokepoint's group handling (`baseGroupName` — group-list based, never the numeric `#{session_group}`) so group copies fold onto the leader exactly as the dashboard does. **No behavior change to `parseSessions` or any existing consumer** (REST, SSE, board derivation, `rk mux panes`) — whether the verb internally shares a classifier helper with the chokepoint is a plan/apply decision.

### 4. Surface conformance

New CLI surface obligations: `rk mux sessions` joins the mux help groups (beside `panes` as an enumeration query), the help-dump standard check (`shll standards`, toolkit-standards posture — mux family grows 12 → 13 members), and the `rk skill mux` usage bundle.

### Companion fab-kit amendment (coordination note — NOT in this diff)

Once the verb exists, fab-operator.md §6 step 2's exclusion rule is amended on PR #645 (cx52, `operator-spawn-session-ux` worktree) to delegate: candidate sessions come from `rk mux sessions --json` (`role: user` rows, minus the operator's own session) behind the standard fail-silent `command -v rk` gate **plus a capability probe** (an installed rk may predate the verb — non-zero/no-output falls back), with the current hard-coded `_rk-*` + own-session rule surviving verbatim as the rk-absent fallback. The `attached`/`windows` supporting facts for default-and-announce ride the same JSON instead of ad-hoc tmux queries. The "Fab Adopts run-kit's `_rk-*` Reserved-Infrastructure Prefix" memory Design Decision gets its "deferred to a run-kit backlog idea" clause resolved: primary source = the rk query; the prefix remains fallback knowledge only. Net effect: the operator skill's exclusion paragraph shrinks to a delegation + fallback sentence — the simplification the user asked for.

### Non-goals

- **No fab-kit edits in this change** — amended separately onto PR #645 (see coordination note).
- **No per-session repo-affinity rollup** — mapping pane cwds to repos/changes stays fab's `fab pane map` join (cli-layering delegation rule); the operator's evidence tier (b) is unchanged.
- **No `@rk_ses_role` tmux option** — rejected (derivable; Constitution II/X).
- **No dashboard behavior change** — `parseSessions` filtering, the `Hidden` operator-home rule, and all existing enumeration consumers are untouched.

## Affected Memory

- `run-kit/agent-messaging`: (modify) mux family grows to 13 members — `sessions` joins the enumeration queries beside `panes` (help-group placement, inherited `-L` consumption, exit-code conventions)
- `run-kit/tmux-sessions`: (modify) document the derived session-role taxonomy (`user`/`pin`/`control`/`operator`/`reserved`) and `_rk-*` as run-kit's formally reserved session-name namespace with the query as its consumer-facing surface
- `run-kit/toolkit-standards`: (modify) help-dump + P9 new-surface posture now covers the 13-member mux family incl. `sessions`

## Impact

- **Files**: `app/backend/cmd/rk/mux_sessions.go` (+ `mux_sessions_test.go`) — new, modeled on `mux_panes.go` (seam-function test pattern); `app/backend/internal/tmux/tmux.go` — small role-classifier helper (or equivalent placement) reusing the existing reserved constants + `baseGroupName`; help-dump fixtures/goldens per the toolkit standard; `rk skill mux` bundle text.
- **Behavioral surface**: additive CLI query only. No API, SSE, frontend, or daemon changes; no existing enumeration path altered.
- **Cross-repo coupling**: fab-kit's operator becomes the first consumer (PR #645 amendment, separate worktree). Version skew handled fab-side by capability probe with prefix fallback — rk ships no compatibility shim.
- **Tests/CI**: Go unit tests for the classifier + command (seam pattern, `env -u TMUX -u TMUX_PANE` hygiene per cmd/rk convention); help-dump test updates.

## Open Questions

- None blocking.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Surface is a query verb (`rk mux sessions`), role derived at request time from reserved-name constants — no stamped `@rk_ses_role` option | Constitution II (derive from tmux at request time) + X (options carry only the underivable) decide between the backlog's two offered options | S:85 R:80 A:95 D:90 |
| 2 | Certain | 13th `rk mux` family member, sibling of `panes`: enumeration query, consumes inherited `-L`, substrate facts only (no change/stage) | Direct application of the cli-layering delegation rule + the established `mux panes` pattern | S:85 R:80 A:90 D:90 |
| 3 | Confident | Role vocabulary `user\|pin\|control\|operator\|reserved`, with `reserved` catching future `_rk-*` names | Three kinds are verified constants; the generic fallback future-proofs consumers, small naming latitude remains | S:70 R:85 A:80 D:70 |
| 4 | Confident | Default output = `role: user` rows only; `--all` adds labeled infrastructure rows | Matches the "user-facing session query" framing in the backlog; flag name/polarity is reversible detail | S:70 R:90 A:80 D:75 |
| 5 | Confident | Field set: name, role, attached (group-credited human clients via the ListClients join), windows, path, group facts; exact final set settled at plan/apply | These are the facts cx52's inference announced/used (attached state, window count) plus identity; additive JSON keys keep it reversible | S:65 R:90 A:80 D:70 |
| 6 | Certain | Group copies never appear as separate rows (leader-keeps-name via `baseGroupName`); `parseSessions` and all existing consumers untouched | The chokepoint's own documented semantics; additive verb enumerates raw list-sessions itself | S:80 R:75 A:90 D:85 |
| 7 | Certain | fab-kit consumption is a separate amendment to cx52/PR #645 in the `operator-spawn-session-ux` worktree — not in this diff; fab keeps the hard-coded `_rk-*` rule as fail-silent fallback behind `command -v rk` + capability probe | User directed the repo split mid-conversation; fab's rk-optional + version-skew posture is standing fab-kit doctrine | S:90 R:85 A:90 D:90 |
| 8 | Confident | No per-session repo-affinity rollup — repo/change enrichment stays fab's pane-map join | cli-layering delegation rule; affinity adds little prose savings to the operator skill while expanding rk's scope into git derivation | S:70 R:80 A:80 D:70 |
| 9 | Certain | Output/exit-code conventions mirror `rk mux panes` (table default, `--json` array, 0 incl. empty `[]`, 1 operational, 2 usage); help-dump + shll standards check ride the change | Toolkit standards bind new CLI surfaces (constitution Toolkit Standards clause); `panes` is the in-repo precedent | S:75 R:85 A:90 D:85 |
| 10 | Confident | `role: operator` is unconditional structural classification; the dashboard's content-conditional `Hidden` rule stays untouched and unrelated | Spawn-target exclusion is structural; `operatorSessionHidden` is a rendering rule with a different truth table | S:65 R:80 A:80 D:70 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).

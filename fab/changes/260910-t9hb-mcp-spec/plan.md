# Plan: rk MCP Spec — W0 of the rk MCP plan

**Change**: 260910-t9hb-mcp-spec
**Intake**: `intake.md`

## Requirements

### Specs: the new MCP spec

#### R1: `docs/specs/mcp.md` exists as a standalone normative document
`docs/specs/mcp.md` MUST exist and MUST be written as a normative RFC 2119 document in the house style of `agent-messaging.md` / `cli-layering.md` (a `>` provenance blockquote under the H1, tables for matrices, prose for invariants, a Non-goals section). It MUST cite the plan doc only in the provenance note and MUST NOT defer to the plan for any design statement ("per the plan" is forbidden in normative text). It MUST contain, as sections: Roles (five actors); Principles (D2 CLI-as-contract, D3 allowlist default-excluded with the ≤ 40 budget, D4 flat tools with `tab_web` + `board` as the only action-enum tools, D5 opt-in `--json`, D6 receipts behind `--json`, D7 timeout cap, D8 explicit target, D9 argv exec via `os.Executable()` + in-process Cobra introspection for schemas, D11 official Go SDK pinned); the Target rule (required `target`/`window` inputs, optional `server` → `-L`, `cron_add` requires one of `pane|session|role`); the `--json` envelope with the exact JSON shapes and the exit-code ⇔ `ok`/`code` mapping; the Receipts table per family; the Timeout contract (`ToolTimeoutCap = 45 s`, bounded-wait verbs clamp `--timeout` to 40 s and return `running` as `ok:true`, backstop `reason:"timeout"`); the Policy-table schema (fields `tool`, `path`, `args`, `stdin`, `result: json|text|image`, `annotations`, `timeout`, `description`; startup drift test); the Allowlist v1 (30 rows, columns Intent / Tool / verb / Ann. / Structured today, **no wave column**), Tier two, and Never tools (including `mcp` itself); the two new verb families (`rk operator request …`, `rk board …`) with their route mapping; Server instructions (`rk skill` bundle) + static tool list; Transports (`rk mcp` stdio; `/mcp` streamable HTTP: tailnet-only, no auth, Origin validation, CORS allowlist unchanged, `POST`+`GET`+`DELETE` as the recorded Constitution IX exception, `rk url --mcp`, doctor rows, per-connection in-memory session state only); Security mapping (Constitution I, II, III, IV, IX, X); Non-goals; Deferred.

- **GIVEN** a W1 agent handed only `docs/specs/mcp.md` and the always-load layer
- **WHEN** it implements `internal/mcp` and `rk mcp`
- **THEN** it can write the policy-table type, the envelope parser, the executor, the timeout cap, and the structured-today read rows without consulting the plan doc

#### R2: The spec states verified CLI facts, not the plan's stale claims
Every factual statement about the current CLI in `mcp.md` MUST match `app/backend/cmd/rk/` at HEAD: `mux panes --json` and `status --json` exist ("Structured today: yes"); `mux send` prints a report word + pane id on stdout (`delivered`/`staged`/`sent`); `POST /api/windows/{id}/send` returns `{"ok":true}` on 200 and `{"error","code"}` 409s with `code ∈ {probe_failure, staged_send_failure, submit_unverified}`; the nine operator templates and six registry declarations; the five board routes and their body shapes; exit codes 0/1/2 (+3 riff); `rk url` has no flags today. The `send --json` receipt MUST reuse the report words and the three 409 `code` tokens — no synonym vocabulary.

- **GIVEN** the allowlist row for `panes` or `status`
- **WHEN** a reader checks the "Structured today" column
- **THEN** it reads `yes`, and the W2a scope text nowhere claims the flag is missing

### Specs: amendments to existing specs

#### R3: `docs/specs/api.md` records `/mcp` and the Constitution IX exception
`api.md` MUST gain: a sentence after Design Principle 1 scoping the `/mcp` exception; a `### MCP` section with `#### /mcp` (methods table, SDK handler sharing `internal/mcp`, tailnet-only + no auth, Origin validation, CORS allowlist unchanged, pointer to `mcp.md`, an explicit "Constitution IX exception" statement); Route Summary rows for `POST|GET|DELETE /mcp` and for the existing-but-unlisted routes the MCP spec proxies (`GET /api/boards`, `GET /api/boards/{name}`, `POST /api/boards/{name}/pin|unpin|reorder`, `POST /api/windows/{windowId}/operator-request`, `POST /api/operator-request`, `POST /api/windows/{windowId}/send`, `POST /api/notify`, `POST /api/riff`) with handler files taken from `api/router.go`. The CORS `AllowedMethods` statement in § Middleware MUST remain `GET POST OPTIONS`.

- **GIVEN** a reader of `api.md` § Route Summary
- **WHEN** they look for the only non-GET/POST route
- **THEN** they find `/mcp` with `POST|GET|DELETE` and a pointer to § MCP explaining the exception

#### R4: `docs/specs/cli-layering.md` records `rk mcp`, `rk board`, and `rk operator request`
`cli-layering.md` MUST gain: the MCP-proxy clause in the Substrate row of "The model"; `mcp` and `board` in "Stays flat (deliberately)"; a `### New families for API-only capabilities` subsection with the two-row table (`rk operator request` as a subcommand of `operator`; `rk board show|pin|unpin|reorder` as a flat family) and the rule "a capability that exists only as a daemon route gets a CLI verb before any other door"; a Non-goals line "No MCP tool that is not an `rk` verb; the MCP server is a consumer of this layer, not a third layer." Delegation rule 4 is unchanged.

- **GIVEN** a reader asking where `rk board` lives and why it exists
- **WHEN** they open `cli-layering.md`
- **THEN** the new-families subsection answers both in one table row

#### R5: `docs/specs/agent-messaging.md` records the fourth door and keeps three lanes
`agent-messaging.md` MUST gain: the "fourth door" sentence in the Surface row (MCP `send`/`answer`/`await` = `rk mux send --json` as argv onto the same engine; the receipt is the frozen report word + evidence, never a new lane); the sentence after the three-lanes table stating `rk operator request` is a CLI door onto the request lane and the lane count stays three; the `--json` clause appended to the "Report-word contract is frozen" bullet (envelope wraps the word; failure reasons reuse the `/send` 409 codes); the inbound/outbound distinction in the channel-matrix Conversation row.

- **GIVEN** the single-engine invariant in "The model"
- **WHEN** the MCP `send` tool is described
- **THEN** it is named a door onto `internal/inject`, and no text introduces a fourth operator lane

### Docs landscape and plan bookkeeping

#### R6: `docs/specs/index.md` lists the new spec
`docs/specs/index.md` § Project Specs MUST gain one row for `[MCP](mcp.md)` whose description matches the intake § What Changes 5 wording (roles, CLI-as-contract + argv-exec, envelope + receipts, timeout, explicit target, policy-table schema, 30-tool allowlist + tier two + never-tools, two transports with the Constitution IX exception). `docs/specs` is not a `fab docs-index` root, so the row is hand-added.

- **GIVEN** `docs/specs/index.md`
- **WHEN** the Project Specs table is read
- **THEN** an `MCP` row links to `mcp.md`

#### R7: The plan doc reflects W0's state and the corrected facts
`fab/plans/sahil/26-09-10-rk-mcp.md` MUST carry: a Status line naming `260910-t9hb-mcp-spec` and its PR once known, stating that `docs/specs/mcp.md` becomes design authority on merge and that merging confirms D4–D9 + D11 (D12 stays Proposed); the W0 row annotated with the change id and PR; the W2a-row intake note and the corrected evidence bullet (`mux panes`/`status` already `--json`; `mux send` prints a report word). The Decision-log Status cells for D4–D9 and D11 MUST read "Confirmed on merge of W0 (PR #N)" once the PR exists — never a bare "Confirmed" before merge.

- **GIVEN** the plan doc after ship
- **WHEN** the next agent reads its Status line
- **THEN** it learns W0's PR, that the spec supersedes the plan on merge, and that W1 is the next pickup

### Non-Goals

- No Go code, no tests, no frontend — spec-only (intake § Impact)
- No amendment to `fab/project/constitution.md` — the IX exception is recorded at spec level; the governance question is flagged in the PR body, not decided here
- No re-waving of plan rows — stale-fact corrections are notes + a recommendation
- No memory writes — Affected Memory is empty (spec-only; memory is post-implementation)

### Design Decisions

#### Wave-free allowlist in the spec
**Decision**: The spec's Allowlist v1 carries Intent / Tool / verb / Annotations / Structured-today columns and no "Enters" wave column.
**Why**: After W0 the plan doc owns execution shape; a wave column in the spec would make two documents authoritative for sequencing.
**Rejected**: Copying the plan's "Enters" column — it would go stale the first time the operator re-waves a row.
*Introduced by*: 260910-t9hb-mcp-spec

#### Confirmation by merge
**Decision**: D4–D9 and D11 are written as normative MUST text; the plan's Decision log is updated to "Confirmed on merge of W0 (PR #N)".
**Why**: The invocation asked for normative text for proposed decisions; the PR review is the confirmation gate the pickup protocol describes.
**Rejected**: A per-decision "Status: proposed" badge inside the spec — a normative document with hedged clauses is not a contract W1 can build on.
*Introduced by*: 260910-t9hb-mcp-spec

## Tasks

### Phase 1: Core Implementation

- [x] T001 Write `docs/specs/mcp.md` per intake § What Changes 1 (sections 1.1–1.12), using the verified facts recorded in intake § Origin; house style of `agent-messaging.md`; RFC 2119 throughout; no wave column <!-- R1, R2 -->
- [x] T002 [P] Amend `docs/specs/api.md`: Design Principle 1 exception sentence, new `### MCP` / `#### /mcp` section before "SPA Fallback", Route Summary rows for `/mcp` and the existing unlisted routes (handler files from `app/backend/api/router.go`) <!-- R3 --> <!-- rework: cycle 1 — /api/notify handler is push.go, not notify.go -->
- [x] T003 [P] Amend `docs/specs/cli-layering.md`: Substrate-row MCP clause, `mcp` + `board` in "Stays flat", `### New families for API-only capabilities` table, Non-goals line <!-- R4 --> <!-- rework: cycle 1 — refresh the `rk -h` root-command count for mcp + board -->
- [x] T004 [P] Amend `docs/specs/agent-messaging.md`: fourth-door sentence in the Surface row, request-lane sentence after the three-lanes table, `--json` clause on the report-word bullet, inbound/outbound distinction in the Conversation row <!-- R5 -->

### Phase 2: Landscape and bookkeeping

- [x] T005 Add the `[MCP](mcp.md)` row to `docs/specs/index.md` § Project Specs; verify `fab/plans/sahil/26-09-10-rk-mcp.md` carries the Status line, W0 row, W2a note, and corrected evidence bullet (already stamped at intake), and prepare the Decision-log cells for D4–D9/D11 to read "Confirmed on merge of W0 (PR #N)" — the PR number is filled at ship <!-- R6, R7 --> <!-- rework: cycle 1 — evidence bullet names `unverified %5` too -->

## Acceptance

### Functional Completeness

- [x] A-001 R1: `docs/specs/mcp.md` exists with every section enumerated in R1 present under a heading, and contains no phrase deferring to the plan ("per the plan", "the plan says") outside the provenance blockquote
- [x] A-002 R3: `docs/specs/api.md` has the Principle-1 exception sentence, the `### MCP` section, and Route Summary rows for `/mcp` plus the eight existing unlisted routes (rework cycle 1 verified: the `POST /api/notify` row now names `push.go` — `handleNotify` is defined at `api/push.go:54`, registered at `api/router.go:971`)
- [x] A-003 R4: `docs/specs/cli-layering.md` has the Substrate clause, `mcp` and `board` under "Stays flat", the new-families subsection, and the Non-goals line
- [x] A-004 R5: `docs/specs/agent-messaging.md` has the fourth-door sentence, the request-lane sentence, the `--json` report-word clause, and the inbound/outbound Conversation row
- [x] A-005 R6: `docs/specs/index.md` § Project Specs has an `MCP` row linking to `mcp.md`
- [x] A-006 R7: the plan doc's Status line names `260910-t9hb-mcp-spec`, the W0 row carries the change id, the W2a note and corrected evidence bullet are present (PR number is filled at ship per plan)

### Behavioral Correctness

- [x] A-007 R2: every "Structured today" cell in the allowlist matches the presence of a `--json` flag (or report-word stdout) in `app/backend/cmd/rk/` at HEAD — in particular `panes` and `status` read `yes` (verified: `mux_panes.go:62`, `status.go:83`, and every other `yes` row's flag registration)
- [x] A-008 R2: the `send --json` receipt uses only the report words `delivered`/`staged`/`sent` and the failure tokens `probe_failure`/`staged_send_failure`/`submit_unverified`; no synonym appears (verified: `mux_send.go:310/332/334`, `api/send.go:115/120/125`)
- [x] A-009 R1: the envelope section shows both JSON shapes and the exit-code mapping (0 ⇔ `ok:true`; 2 ⇔ `usage`; 1 and riff's 3 ⇔ `operational`) and states `--json` is opt-in everywhere
- [x] A-010 R1: the timeout section names one constant (45 s), the 40 s clamp for bounded-wait verbs, `running` as `ok:true`, and the never-tools list (by reference to § Never tools)

### Scenario Coverage

- [x] A-011 R1: the allowlist has exactly 30 rows, the two action-enum tools are `tab_web` and `board`, `mux kill --force` is stated as not exposed, and the `answer` key enum is listed verbatim (30 data rows counted)
- [x] A-012 R3: `api.md` § Middleware still states CORS methods `GET POST OPTIONS` (api.md:36), and the `/mcp` text says the allowlist is unchanged (api.md:528)

### Edge Cases & Error Handling

- [x] A-013 R1: the spec states what happens when a policy row's `path` no longer resolves (startup drift test fails the build — mcp.md § Policy table "Drift guard") and when the proxy deadline fires (`ok:false`, `reason:"timeout"`, child killed — § Timeout contract)
- [x] A-014 R5: `agent-messaging.md` still says "three lanes" and no text introduces a fourth operator lane (the added sentence explicitly states the lane count stays three)

### Code Quality

- [x] A-015 Pattern consistency: `mcp.md` follows the H1 + `>` provenance + tables + Non-goals shape of `agent-messaging.md` and `cli-layering.md`; the four amended specs keep their existing heading structure
- [x] A-016 No unnecessary duplication: `mcp.md` does not restate the injection engine, the operator lanes, or the route table — it points at the owning spec for each
- [x] A-017 No comment narration: the amendments state present-truth contracts; none cite change IDs or PR numbers in spec prose (the plan doc is the one file that may) — change-ID/PR citations found in the specs (cli-layering.md:102, index.md:42/60) pre-date this change and are untouched

### Security

- [x] A-018 R1: the `/mcp` section carries tailnet-only, no public exposure, Origin validation, and the argv-exec / no-shell-string rule; the never-tools list includes `serve`, `daemon *`, `update`, `agent setup|hook`, `remote *`, `desktop *`, `mcp`

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Light lane — five tasks, one per file; the spec is authored inline with the intake's verified facts in context | ≤ 5 tasks per the fork rule; a fresh worker would only re-derive what the intake already verified | S:90 R:90 A:95 D:90 |
| 2 | Confident | The plan's Decision-log cells read "Confirmed on merge of W0 (PR #N)" rather than a bare "Confirmed" | Merge is the confirmation act; a bare "Confirmed" before merge would misstate state | S:75 R:90 A:85 D:75 |
| 3 | Confident | The eight existing unlisted routes are added to `api.md` § Route Summary with handler files from `api/router.go` | Intake assumption 12; additive and verifiable | S:60 R:90 A:85 D:70 |

3 assumptions (1 certain, 2 confident, 0 tentative).

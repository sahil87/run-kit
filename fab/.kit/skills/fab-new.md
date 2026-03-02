---
name: fab-new
description: "Start a new change from a natural language description. Creates the change folder and generates the intake."
---

# /fab-new <description>

> Read and follow the instructions in `./fab/.kit/skills/_preamble.md` before proceeding.

---

## Pre-flight

1. Verify `fab/project/config.yaml` and `fab/project/constitution.md` exist
2. **If either missing, STOP**: `fab/ is not initialized. Run /fab-setup first to bootstrap the project.`

---

## Arguments

- **`<description>`** *(required)* — natural language, Linear ticket ID (`DEV-988`), or backlog ID (`90g5`)

If no description: ask *"What change do you want to make?"*

---

## Behavior

### Step 0: Parse Input

Detect input type (check in order):

1. **Linear ticket ID** (`[A-Z]+-\d+`) — fetch via `mcp__claude_ai_Linear__get_issue`; extract title, description, state, labels, branchName. On failure, fall back to natural language.
2. **Backlog ID** (`[a-z0-9]{4}`) — read `fab/backlog.md`, search for `\[{id}\]`. Check for an optional `[ISSUE_ID]` bracket immediately after (e.g., `[ni3o] [DEV-1011]`); if found, extract and fetch per #1. Store backlog ID for folder name.
3. **Natural language** — use as-is

### Step 1: Generate Slug

Generate a 2-6 word slug (lowercase, hyphen-joined, no articles/prepositions) from the description. The slug SHALL NOT include the Linear issue ID — it contains only the descriptive portion (e.g., `add-oauth`). This slug is passed to `changeman.sh` as the `--slug` value.

### Step 2: Gap Analysis

Check for existing mechanisms or scope concerns covering the idea. If covered: present findings, let user decide. If not: proceed.

### Step 3: Create Change

Run `lib/changeman.sh new` with appropriate flags:
- `--slug <slug>` — the slug from Step 1 (descriptive only, no issue ID)
- `--change-id <4char>` — only if a backlog ID was detected in Step 0 (the 4-char backlog ID becomes the change ID)
- `--log-args <description>` — the original description text

Capture the folder name from stdout. The script handles date generation, random ID generation (if no `--change-id`), collision detection, directory creation, `created_by` detection, `.status.yaml` initialization, `statusman.sh` integration, and command logging via logman (when `--log-args` is provided).

If a Linear ticket was detected in Step 0, record the issue ID via statusman:
`fab/.kit/scripts/lib/statusman.sh add-issue fab/changes/{name}/.status.yaml DEV-988` (using the actual detected ID).

### Step 4: Conversation Context Mining

Before generating the intake, scan the current conversation for prior discussion of this change's topic — whether from `/fab-discuss`, free-form exploration, or any conversation that preceded this `/fab-new` invocation. Extract:

- **Decisions made** — specific choices with rationale (e.g., "OAuth2 over SAML because no enterprise requirement")
- **Alternatives rejected** — options considered and why they were ruled out
- **Constraints identified** — boundaries or requirements surfaced during discussion
- **Specific values agreed upon** — config structures, API shapes, exact behaviors

Encode extracted decisions as Certain or Confident assumptions in the intake's Assumptions table with rationale referencing the discussion (e.g., "Discussed — user chose X over Y"). These feed directly into SRAD scoring and reduce downstream ambiguity.

If no prior discussion exists in the conversation, skip this step — behavior is identical to a cold `/fab-new`.

### Step 5: Generate `intake.md`

Follow the **Intake Generation Procedure** (`_generation.md`). Load context per `_preamble.md` Layer 1 and generate from `fab/.kit/templates/intake.md`. Incorporate any decisions extracted in Step 4.

### Step 6: Infer Change Type

After generating `intake.md`, infer the change type from the intake content using keyword matching (case-insensitive, evaluated in order, first match wins):

1. Contains any of: "fix", "bug", "broken", "regression" → `fix`
2. Contains any of: "refactor", "restructure", "consolidate", "split", "rename" → `refactor`
3. Contains any of: "docs", "document", "readme", "guide" → `docs`
4. Contains any of: "test", "spec", "coverage" → `test`
5. Contains any of: "ci", "pipeline", "deploy", "build" → `ci`
6. Contains any of: "chore", "cleanup", "maintenance", "housekeeping" → `chore`
7. Otherwise → `feat`

Write the inferred type to `.status.yaml`:
```bash
fab/.kit/scripts/lib/statusman.sh set-change-type fab/changes/{name}/.status.yaml <type>
```

### Step 7: Indicative Confidence

After generating `intake.md` and inferring the change type, compute and display an indicative confidence score:

1. Count assumptions from the intake's `## Assumptions` table (certain, confident, tentative, unresolved)
2. Look up `expected_min` for the **intake** stage using the inferred `change_type`:
   - `fix`=2, `feat`=4, `refactor`=3, others=2
3. Compute the indicative score using the coverage-weighted formula:
   ```
   base = max(0.0, 5.0 - 0.3 * confident - 1.0 * tentative)
   cover = min(1.0, total_decisions / expected_min)
   score = base * cover  (or 0.0 if unresolved > 0)
   ```
4. Display: `Indicative confidence: {score} / 5.0 ({N} decisions, cover: {cover})`

This is **display-only** — NOT written to `.status.yaml`. The authoritative score is computed at the spec stage by `calc-score.sh`.

### Step 8: SRAD-Based Question Selection

Apply SRAD (`_preamble.md`). No fixed question cap — SRAD scoring determines count. Zero questions for clear inputs. **Conversational mode**: when 5+ Unresolved, ask one at a time until resolved or user signals done.

### Step 9: Advance Intake to Ready

After all intake work is complete (generation, type inference, confidence, questions), advance intake to `ready`:

```bash
fab/.kit/scripts/lib/statusman.sh advance fab/changes/{name}/.status.yaml intake
```

This signals that the intake artifact exists and is open for `/fab-clarify` refinement. The user runs `/fab-continue` when ready to proceed to spec generation.

---

## Output

```
{if Linear: "Fetching Linear issue DEV-988...\n"}
{if backlog: "Reading fab/backlog.md for [90g5]...\nFound: DEV-988 ...\n"}
Created fab/changes/{name}/

## Intake: {Change Name}

{intake content}

Intake complete.

{if assumptions: "## Assumptions\n\n| # | Grade | Decision | Rationale | Scores |\n..."}

Indicative confidence: {score} / 5.0 ({N} decisions, cover: {cover})

Next: {per state table — activation preamble + intake state}
```

---

## Error Handling

| Condition | Action |
|-----------|--------|
| Config/constitution missing | Abort: "Run /fab-setup first." |
| No description | Ask for one |
| Intake template missing | Abort: "Kit may be corrupted." |
| `changeman.sh` failure | Surface stderr output to user and stop |
| Linear ticket not found / API error | Warn, treat as natural language |
| Backlog ID not found | Abort with guidance |
| `fab/backlog.md` missing | Abort: "Use natural language or Linear ID instead." |

---

Next: `/fab-switch {name} to make it active, then /fab-continue or /fab-fff or /fab-clarify`

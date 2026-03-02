# Intake: {CHANGE_NAME}

**Change**: {YYMMDD-XXXX-slug}
**Created**: {DATE}
**Status**: Draft

## Origin

<!-- How was this change initiated? Include the user's raw input/prompt, the interaction
     mode (one-shot vs. conversational), and key decisions from the conversation.
     This section provides traceability — downstream agents need to understand not just
     WHAT was decided, but HOW the decision was reached. -->

> {USER_INPUT}

## Why

<!-- Explain the motivation substantively:
     1. What problem does this solve? (the pain point)
     2. What happens if we don't fix it? (the consequence)
     3. Why this approach over alternatives? (the reasoning)
     A single sentence is almost never enough. -->

## What Changes

<!-- Be specific about new capabilities, modifications, or removals.
     Use subsections (### per change area) for multi-part changes.
     Include concrete examples: code blocks, config snippets, exact behavior.
     This section is the primary input for spec generation — if a design decision
     was made with specific values, include them here. Do not summarize or abstract. -->

## Affected Memory

<!-- Which memory files will be created, modified, or removed by this change.
     Use kebab-case identifiers matching docs/memory/ paths. Mark each with (new), (modify), or (remove).
     Only list if spec-level behavior changes — implementation-only changes don't need memory updates. -->

- `{domain}/{file-name}`: ({new|modify|remove}) {description}

## Impact

<!-- Affected code areas, APIs, dependencies, systems. Helps scope the spec. -->

## Open Questions

<!-- Clarifying questions the agent couldn't resolve from context alone.
     SRAD handles prioritization at spec generation time — no need for explicit
     blocking/deferred labels here. Just list the questions. -->

- {question}

## Assumptions

<!-- STATE TRANSFER: This table is the sole continuity mechanism between the intake-stage
     agent and the spec-stage agent. Pipeline stages may execute in separate agent contexts
     with no shared memory — this table is what gives downstream agents visibility into
     what was decided, assumed, or left open. Every row must be substantive.

     All four SRAD grades (Certain, Confident, Tentative, Unresolved) are recorded.
     Scores column is required for every row.
     Unresolved rows must include status context in Rationale (e.g., "Asked — user undecided"). -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | {Certain|Confident|Tentative|Unresolved} | {decision summary} | {why this grade} | S:nn R:nn A:nn D:nn |

{N} assumptions ({Ce} certain, {Co} confident, {T} tentative, {U} unresolved).

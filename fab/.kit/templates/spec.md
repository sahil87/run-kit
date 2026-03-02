# Spec: {CHANGE_NAME}

**Change**: {YYMMDD-XXXX-slug}
**Created**: {DATE}
**Affected memory**: `docs/memory/{domain}/{file-name}.md`

<!--
  CHANGE SPECIFICATION
  Describes the requirements relevant to this change. No delta markers needed —
  the agent compares against existing memory files during hydration to
  determine what's new, changed, or removed.

  Requirements use RFC 2119 keywords: MUST/SHALL (mandatory), SHOULD (recommended), MAY (optional).
  Every requirement MUST have at least one scenario.
  Scenarios use GIVEN/WHEN/THEN format.
  Organize by domain section when the change touches multiple domains.
  Mark unresolved ambiguities with [NEEDS CLARIFICATION] inline. /fab-clarify resolves these.
-->

<!--
  OPTIONAL SECTIONS — add any of these when needed, omit entirely when not:

  ## Non-Goals
  Include after metadata, before domain sections. Each entry:
    - {what is excluded} — {brief reason, if not obvious}

  ## Design Decisions
  Include after domain sections. Each entry:
    1. **{Decision}**: {chosen approach}
       - *Why*: {rationale}
       - *Rejected*: {alternative and why it was worse}

  ## Deprecated Requirements
  Include only when this change removes existing requirements. Each entry:
    ### {Requirement Name}
    **Reason**: {why removed}
    **Migration**: {what replaces it, or "N/A"}
-->

## {Domain}: {Topic}

### Requirement: {Requirement Name}
{Requirement text using SHALL/MUST/SHOULD/MAY}

#### Scenario: {Scenario Name}
- **GIVEN** {precondition}
- **WHEN** {action or event}
- **THEN** {expected outcome}
- **AND** {additional outcome, if needed}

#### Scenario: {Another Scenario}
- **GIVEN** {precondition}
- **WHEN** {action}
- **THEN** {outcome}

### Requirement: {Another Requirement}
{Requirement text}

#### Scenario: {Scenario Name}
- **GIVEN** {precondition}
- **WHEN** {action}
- **THEN** {outcome}

## Assumptions

<!-- SCORING SOURCE: calc-score.sh reads only this table — intake.md assumptions are
     state transfer, not scored. This is the authoritative decision record for confidence
     scoring.

     The spec-stage agent reads intake.md's Assumptions as a starting point, then
     confirms, upgrades, or overrides each assumption based on spec-level analysis.
     New assumptions discovered during spec generation are added here.

     All four SRAD grades (Certain, Confident, Tentative, Unresolved) are recorded.
     Scores column is required for every row.
     Unresolved rows must include status context in Rationale (e.g., "Asked — user undecided"). -->

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | {Certain|Confident|Tentative|Unresolved} | {decision summary} | {why this grade} | S:nn R:nn A:nn D:nn |

{N} assumptions ({Ce} certain, {Co} confident, {T} tentative, {U} unresolved).


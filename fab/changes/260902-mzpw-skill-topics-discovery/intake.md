# Intake: rk skill Topic Discovery Conformance

**Change**: 260902-mzpw-skill-topics-discovery
**Created**: 2026-09-02

## Origin

Conversational (`/fab-discuss` session, 2026-09-02). The user asked whether `rk skill` has an easy way to list all topics — `rk skill -h` names none. Investigation found the topic list is only discoverable indirectly (the core bundle's `## Topics` section, or the unknown-topic error message). The user then asked to check the latest `shll standards skill`, which turned out to **mandate** exactly the two missing affordances, making this a conformance gap under the constitution's Toolkit Standards clause. The user approved starting a fab change.

> rk skill topics conformance — add the shll skill-standard's two mandated topic-discovery affordances: (1) enumerate shipped topic names in `rk skill` help text (Topics: code, display, mux, tutorial), (2) implement the reserved positional topic `rk skill topics` printing content-topic names one per line to stdout, exit 0, excluded from the help line and core bundle topic index

Key decisions from the conversation:

- A `--list` flag was considered and is **ruled out** — the `shll standards skill` document explicitly rejected it: the shll composer (`shll skill <tool> <topic>`) forwards positional args verbatim, so `shll skill rk topics` composes with zero composer changes, while a flag would be intercepted by the composer's own flag parsing.
- Verified current non-conformance against the live standard: `rk skill topics` exits 2 with `unknown topic "topics" (valid: code, display, mux, tutorial)`, and `rk skill -h` says "Pass a topic" while naming none — the exact blind spot the standard calls out ("'Pass a topic' prose that names none is a blind spot").
- `skillTopicNames()` (app/backend/cmd/rk/skill.go:73) already produces the sorted topic list for the error message; both new affordances reuse it.

## Why

1. **Pain point**: An agent (or user) consulting `rk skill -h` — the surface you check *before* paying the ~150-line core bundle's context cost — cannot learn which topic pages exist. And there is no scriptable way to enumerate topics: the only machine path today is parsing an error message off stderr from a deliberately-invalid invocation.
2. **Consequence if unfixed**: run-kit is non-conformant with the toolkit `skill` standard, which the constitution (§ Toolkit Standards) binds it to — "Standards added or revised there bind this repo without further amendment." The standard mandates both affordances for **all** adopting tools ("binds every adopting tool"), and `shll skill rk topics` (the composer form) fails against run-kit today.
3. **Why this approach**: The approach is prescribed by the standard itself, including the rejected alternative (`--list` flag) and the rationale. There is no design latitude to spend — this change implements the published contract.

## What Changes

Both changes are confined to `app/backend/cmd/rk/skill.go` plus its test file. No canonical docs change: the reserved `topics` name is a machine affordance with **no** `docs/site/skill/topics.md`, no line budget, and it must NOT be added to the core bundle's `## Topics` index (`docs/site/skill.md` stays untouched, so the sync + drift-guard mechanism is unaffected).

### 1. `Topics:` enumeration in help text

The `skill` subcommand's help text MUST enumerate the shipped content-topic names. Per the standard: "e.g. a `Topics: code, display, mux, tutorial` line in the long help. The mandate is that the names appear; the exact format is illustrative, not prescribed."

- Append a `Topics:` line to `skillCmd.Long`, composed from `skillTopicNames()` (e.g. `"\n\nTopics: " + strings.Join(skillTopicNames(), ", ")`). Since topics are embedded at build time, composing from the map at init is static by construction — the standard explicitly notes "The enumeration is static by construction (topics are embedded at build time — no runtime lookups)". Composing rather than hardcoding means adding a fifth topic page can never leave the help line stale.
- The reserved name `topics` MUST NOT appear in this line (it enumerates content topics only).
- Note: `skillCmd.Long` is currently a `var` initialization; composing with a function call in the same `var` block is fine in Go (initialization order within the file handles `skillTopics` being a composite literal), but if ordering proves awkward, set `Long` in an `init()` or compose the line in a small helper — implementation detail, either is acceptable.

### 2. Reserved positional topic `topics`

`rk skill topics` prints the content-topic names, **one per line**, raw to stdout — stderr empty, exit 0:

```
code
display
mux
tutorial
```

- Intercept `args[0] == "topics"` in `RunE` **before** the `skillTopics` map lookup (the map has no `topics` key and must never gain one — the name is reserved in every tool's topic namespace).
- Ordering: the standard leaves it to the tool; sorted order (what `skillTopicNames()` returns) matches the deterministic error-message ordering. This also matches the core bundle's topic-index ordering, which happens to be alphabetical today.
- Output is exactly the names joined by `\n` with a trailing newline, nothing else (stdout is data — no header, no framing).
- The unknown-topic error path is unchanged: `rk skill bogus` still exits non-zero naming the valid content topics (which do not include `topics`).

### 3. Tests

Extend `app/backend/cmd/rk/skill_test.go` following its existing patterns (the `runSkill` seam):

- `rk skill topics` → stdout is exactly the sorted content-topic names one per line, stderr empty, err nil (exit 0).
- The `Topics:` help line: assert `skillCmd.Long` contains every name from `skillTopicNames()` and does not list `topics` as a topic — so a future topic page added to `skillTopics` without help-text coverage fails the guard automatically (composition makes this structurally true; the test pins the contract).
- Guard: `skillTopics` map contains no `topics` key (the reserved-name rule with teeth).
- Existing tests (byte-identical printing, canonical drift guards, line budgets, unknown-topic fail-fast) are unaffected.

## Affected Memory

- `run-kit/toolkit-standards`: (modify) the `skill` standard's conformance posture — record the two topic-discovery affordances (help-text `Topics:` line, reserved `topics` positional) as implemented, and the standard's `--list`-rejected/composer-forwarding rationale as it applies to rk

## Impact

- `app/backend/cmd/rk/skill.go` — help text + one reserved-name branch in `RunE` (small)
- `app/backend/cmd/rk/skill_test.go` — new test cases per above
- No API, frontend, tmux, or docs/site changes. No new embed, no sync-script change, no canonical-file change.
- Conformance checklist (from the standard's "Verifying conformance"): `<tool> skill topics` prints names one per line / stdout only / exit 0; help text names every shipped topic; no content topic named `topics`.

## Open Questions

- (none)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Positional reserved topic `topics`, not a `--list` flag | Prescribed by `shll standards skill`, which explicitly rejected the flag (composer forwards positionals verbatim) | S:95 R:90 A:100 D:100 |
| 2 | Certain | `topics` output is sorted names one per line, trailing newline, stdout only, exit 0 | Standard fixes the shape ("one per line, raw to stdout — stderr empty, exit 0"); ordering left to the tool — sorted matches the existing deterministic error-message ordering | S:90 R:95 A:95 D:90 |
| 3 | Certain | `topics` excluded from the help `Topics:` line and the core bundle's topic index; no `docs/site/skill/topics.md` | Standard: the reserved name "is not listed in the `Topics:` help line or the core bundle's topic index" and "has no canonical docs/site/skill/topics.md" | S:95 R:90 A:100 D:95 |
| 4 | Confident | Compose the `Topics:` help line from `skillTopicNames()` rather than hardcoding | Standard's format is illustrative not prescribed; composition is static by construction (embeds fixed at build time) and cannot go stale when a topic is added | S:80 R:90 A:85 D:75 |
| 5 | Confident | Core bundle `docs/site/skill.md` needs no edit | Its `## Topics` index already lists all four content topics; the reserved name is explicitly excluded from that index | S:85 R:85 A:90 D:85 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).

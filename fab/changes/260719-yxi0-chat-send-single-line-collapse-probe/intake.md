# Intake: Chat-Send Long-Single-Line Paste-Collapse Probe Fix

**Change**: 260719-yxi0-chat-send-single-line-collapse-probe
**Created**: 2026-07-20

## Origin

<!-- Backlog item [yxi0], picked up by the backlog-bugs sweep (BUG scope). The item asked for empirical verification of an unverified assumption; the verification was performed live before this intake and DISPROVED the assumption, converting the item from "unverified note" to "confirmed bug". -->

> [yxi0] Chat-send long-single-line paste-collapse assumption (unverified): the NOVELTY echo probe counts the [Pasted text ...] collapse placeholder only for MULTILINE text, assuming a long single line never collapses into the chip; not empirically re-verified across TUI widths. (relocated from docs/memory/run-kit/chat.md by /docs-distill-memory)

**Empirical verification (2026-07-20, Claude Code 2.1.215, tmux 3.6a)** — performed with the exact production mechanism (`set-buffer -b <named> -- <text>` then `paste-buffer -d -p`) into a live Claude Code composer on an isolated tmux server, across 60/80/200-column widths:

| Input | Observed composer echo |
|-------|------------------------|
| Single line, 203 chars (80 cols) | Raw text, wrapped — no collapse |
| Single line, 500 chars (60 cols, ~9 wrapped rows) | Raw text, wrapped — no collapse |
| Single line, 700 chars (80 cols) | Raw text — no collapse |
| Single line, 800 chars (80 cols) | Raw text — no collapse |
| Single line, 801 chars (80 cols) | **Collapsed: `[Pasted text #N]`** — NO `+M lines` suffix |
| Single line, 850 / 900 / 1001 chars (80 cols) | **Collapsed: `[Pasted text #N]`** |
| Single line, 900 chars (200 cols) | **Collapsed: `[Pasted text #N]`** — width-independent |
| 12-line multiline | Collapsed: `[Pasted text #N +11 lines]` |

Conclusions: the collapse is a **pure character-count threshold (>800 chars)**, independent of TUI width; the single-line collapse chip carries **no `+M lines` suffix**; the multiline chip format matches the existing regex.

## Why

1. **The pain point** (two-layer bug in `app/backend/api/chat.go`):
   - `injectChatMessage` computes `multiline := strings.Contains(text, "\n")` and `countProbeOccurrences` counts the paste-collapse placeholder **only when `multiline` is true**. A single-line message over 800 chars collapses into a chip, so its raw needle never appears in the capture, the placeholder is not counted, the count never exceeds the baseline, and the probe **always returns 409** — Enter withheld, the (successfully pasted) text stranded in the agent's composer. Long single-line sends are deterministically broken.
   - Even if the multiline gate were dropped, `pasteCollapseRe` (`\[Pastedtext#\d+\+\d+lines?\]` against the whitespace-stripped capture) **requires** the `+\d+lines` part — the suffix-less single-line chip `[Pastedtext#5]` would not match.

2. **The consequence if unfixed**: any chat-send of a long single line (a long prompt, a pasted URL list, a minified snippet — all common) fails with 409 even though the paste demonstrably reached the input buffer (the TUI only renders the chip for content it accepted). Worse, the 409 error message tells the user the text remains in the composer and warns against blind retry — every retry pastes a second chip. The feature is unusable for exactly the messages long enough to be worth sending from the web UI.

3. **Why this approach**: extend the existing placeholder-counting mechanism rather than redesign the probe. The NOVELTY baseline design (pre-paste count must strictly increase) is what makes chip-counting sound — a stale chip from a prior 409 is in the baseline floor; only THIS paste adds a fresh occurrence. That soundness argument is grade-independent of whether the text is multiline, so widening when the chip is counted is safe. Alternatives rejected: counting the chip **unconditionally** for all sends (needlessly widens the concurrent-fresh-chip false-positive window to short interactive sends that never collapse); keying the gate to the exact observed threshold 801 (brittle — an upstream Claude Code release can lower it silently; a conservative lower bound keeps working).

## What Changes

### `app/backend/api/chat.go` — regex + gate

1. **Make the `+M lines` suffix optional** in `pasteCollapseRe` so both chip forms match:

```go
var pasteCollapseRe = regexp.MustCompile(`\[Pastedtext#\d+(?:\+\d+lines?)?\]`)
```

Update the comment above it: the TUI renders `[Pasted text #N +M lines]` for collapsed multiline pastes and the suffix-less `[Pasted text #N]` for collapsed long single-line pastes (empirically: >800 chars on Claude Code 2.1.215, width-independent).

2. **Widen the placeholder gate from `multiline` to `collapsible`**. Add a named constant and derive a `collapsible` flag where `multiline` is derived today (`injectChatMessage`):

```go
// chatSendCollapseMinRunes is the single-line length at or above which the
// paste-collapse placeholder is counted as an echo signal. Claude Code
// collapses a single-line paste over 800 chars into a suffix-less
// "[Pasted text #N]" chip (empirical, CC 2.1.215, width-independent);
// 200 is a deliberately conservative lower bound so an upstream threshold
// reduction cannot silently break long-single-line sends again, while
// short interactive sends keep exact-needle-only matching.
const chatSendCollapseMinRunes = 200

collapsible := strings.Contains(text, "\n") || len([]rune(text)) >= chatSendCollapseMinRunes
```

Thread `collapsible` through where `multiline` is threaded today: `injectChatMessage` → `countProbeOccurrences(capture, needle, collapsible)` and `probeChatEcho(..., collapsible, baseCount)`. Rename the parameter (`multiline` → `collapsible`) in both functions and update their doc comments — the parameter no longer means "text has newlines", it means "the TUI may have collapsed this paste into a chip, so the chip is a valid fresh-echo signal". The baseline capture count and the strict-increase comparison are unchanged.

### `app/backend/api/chat_send_test.go` — tests

- **Regex/unit coverage** (extend the existing probe-matching unit tests): `countProbeOccurrences` counts the suffix-less chip (`[Pasted text #7]` → stripped `[Pastedtext#7]`) when `collapsible` is true; still counts the multiline form; does NOT count either chip when `collapsible` is false; short single-line text (< 200 runes) is not collapsible.
- **Handler-level test**: a >800-char single-line send whose post-paste capture shows only `[Pasted text #1]` (baseline without it) succeeds — 200, Enter sent. A companion assertion that a stale chip already in the baseline does not satisfy the probe (409) — mirroring the existing stale-placeholder test for multiline, if one exists; otherwise add it for the single-line form.
- Follow the existing `mockTmuxOps`/`chatSessions`/`sendReq` seams and the file's comment style. Prefer inserting new tests adjacent to the existing paste-collapse/probe tests (mid-file) rather than appending at EOF.

## Affected Memory

- `run-kit/chat`: (modify) — the send-path probe description: placeholder counting is gated on *collapsible* (multiline OR ≥200-rune single line), both chip forms (`+M lines` and suffix-less) match, and the empirical collapse threshold (>800 chars, width-independent, CC 2.1.215) is recorded. The former "single-line pastes never collapse" claim is removed wherever stated.

## Impact

- `app/backend/api/chat.go` — one regex edit, one named constant, a `multiline` → `collapsible` rename threaded through `injectChatMessage` / `probeChatEcho` / `countProbeOccurrences` with comment updates.
- `app/backend/api/chat_send_test.go` — new/extended unit + handler tests.
- No API-shape change, no frontend change, no tmux-layer change.
- **Merge-overlap note**: change `260719-t9uk-chat-send-control-byte-sanitize` (PR #402, unmerged) also touches both files (sanitize helper + tests appended at EOF). This branch is cut from the same base; whichever merges second resolves small textual conflicts (different regions in chat.go; EOF-adjacent in the test file — hence the insert-mid-file guidance above).

## Open Questions

_None._

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The bug is real and the assumption in the code comment is false | Empirically reproduced with the production paste mechanism: single-line >800 chars collapses to a suffix-less chip on CC 2.1.215, at 60/80/200 cols | S:95 R:90 A:95 D:95 |
| 2 | Certain | Fix = optional-suffix regex + widen the placeholder gate; the NOVELTY baseline keeps chip-counting sound | The strict-increase-over-baseline design already absorbs stale chips; soundness is independent of the multiline property | S:85 R:90 A:90 D:85 |
| 3 | Confident | Gate constant `chatSendCollapseMinRunes = 200` (conservative lower bound, not the observed 801) | Robust to upstream threshold reductions; keeps short interactive sends on exact-needle matching; exact value is a judgment call within a safe range | S:70 R:90 A:80 D:60 |
| 4 | Certain | Parameter renamed `multiline` → `collapsible` (semantics changed, name must follow) | Code-quality: the gate no longer tests for newlines; keeping the old name would lie | S:80 R:95 A:95 D:85 |
| 5 | Confident | Scope excludes re-verifying other providers (codex/gemini) — claude is the only registered send adapter in v1 | Adapter registry has claude only; provider-agnostic seam noted in code for later | S:75 R:90 A:85 D:75 |

5 assumptions (3 certain, 2 confident, 0 tentative, 0 unresolved).

# Intake: Echo Probe Recognizes the `[Image #N]` Composer Chip

**Change**: 260904-svfv-inject-image-chip-probe
**Created**: 2026-09-04

## Origin

> Sending a bare image path from the dashboard compose strip (the exact shape an attachment-only send produces) always fails the injection engine's echo probe: Claude Code converts a bracketed paste whose entire content is one existing image-file path into an `[Image #N]` composer chip, so the raw path text never echoes, the probe exhausts its retries, and Enter is withheld (`ProbeFailure`) even though delivery succeeded. Reported by the user 2026-09-04 ("generally when sending just the image link"); root cause verified empirically on Claude Code 2.1.260 on an isolated tmux rig using the engine's own set-buffer → bracketed `paste-buffer -d -p` mechanism.

Created via promptless dispatch (`/fab-proceed` create-new). All facts below were verified during the preceding investigation session — the empirical chip matrix, the code anchors, and the fix shape were user-approved before dispatch. No open design questions remain.

## Why

1. **The pain point**: A dashboard user who uploads an image (or types a bare image path) and hits Send gets the error toast "Text is staged in the pane but unsent. Pressing Send again would duplicate it." (`app/frontend/src/components/compose-strip.tsx:546`, fired on ApiError codes `probe_failure`/`staged_send_failure`) — every time, for the most common attachment-only send shape. Uploads append the uploaded file path as a line of textarea text (`compose-strip.tsx:749`), so an attachment-only send is exactly a bare image path. The delivery actually succeeded — the path landed in Claude Code's composer as an `[Image #N]` chip — but the engine's fail-closed probe withheld Enter, so the user must manually press Enter in the pane after every image send.

2. **The consequence if unfixed**: The image-attachment flow is effectively broken for its primary use case. The fail-closed design (correct in general — never blind-Enter unverified text) is producing a guaranteed false negative for a whole input class, training users to distrust the staged-send toast.

3. **Why this approach**: The probe currently accepts two echo signals — the raw needle and the `[Pasted text #N]` collapse chip (gated on `collapsible`). Claude Code has a third composer transformation the probe doesn't know about: the image chip. Teaching the probe that third signal, gated the same way the collapse chip is gated, is the minimal fix consistent with the file's existing design stance (narrow false-positive windows via content-shape gates, strict-increase-over-baseline for staleness). The fix is engine-side only; the frontend toast behavior is correct once the probe passes.

## What Changes

Scope: `app/backend/internal/inject/inject.go` + its package tests. No frontend change, no API change, no new subprocess surface.

### Root cause (verified, CC 2.1.260)

Claude Code converts a bracketed paste whose entire (whitespace-trimmed) content is exactly ONE existing image-file path into an `[Image #N]` composer chip — the raw path text never echoes into the pane. The probe in `inject.go` accepts only:

- the raw needle — last ≤40 chars of the last non-empty line (`Needle()`, `NeedleMaxLen`), and
- the paste-collapse chip `pasteCollapseRe` (pattern `\[Pastedtext#\d+(?:\+\d+lines?)?\]`, matching the whitespace-stripped form), gated on `collapsible` (multiline or ≥200 runes, `CollapseMinRunes`).

Neither matches `[Image #N]`, so `CountOccurrences` never exceeds the pre-paste baseline → `probeEcho` exhausts its 8 attempts → `ProbeFailure` → Enter withheld → the handler's 409 → the frontend toast.

### Verified empirical matrix (CC 2.1.260, 2026-09-04, isolated tmux rig, engine's own paste mechanism)

| Paste content | Result in composer |
|---------------|--------------------|
| Bare existing image path | `[Image #N]` chip. Extensions that chip: `.png`, `.jpg`, `.gif`, `.webp` (matches Claude API image media types; `.jpeg` untested but assumed — include it) |
| Bare existing `.svg` / `.bmp` path | Raw text (no chip) |
| Nonexistent image path | Raw text (no chip) — chip-vs-raw depends on filesystem state the engine cannot predict from text alone |
| 293-char existing image path | `[Image #N]`, NOT `[Pasted text #N]` — the image chip wins at every length; the existing collapsible arm can never catch it |
| Bare path + trailing newline | Still chips |
| Mixed text + path in one paste ("look at this /path.png please") | Raw text, no chip (today's probe passes this case) |
| Two newline-separated paths in one paste | Raw text, no chips (today's probe passes) |
| Unquoted path containing spaces | Chips (dashboard upload paths are timestamp-sanitized and space-free anyway — `app/backend/api/upload.go:127-128`) |
| Repeated pastes in a session | Chip numbering increments per paste (`[Image #2]`, `#3`, …) — the engine's strict-increase-over-baseline rule already handles stale chips correctly |

The nonexistent-path row is why the fix MUST accept **either signal** (fresh chip OR fresh raw needle): the engine cannot predict from text alone whether the TUI will chip or leave raw text.

### Fix shape (user-approved)

1. **New regex**: `imageCollapseRe` with pattern `\[Image#\d+\]` (via `regexp.MustCompile` with a raw-string literal, like `pasteCollapseRe`) matching the whitespace-stripped capture (`stripForProbe` output), mirroring `pasteCollapseRe`'s style and doc-comment conventions. The file documents empirical CC behavior with version numbers (e.g. the `CollapseMinRunes` comment at inject.go:75-84 cites CC 2.1.215) — follow that pattern, citing CC 2.1.260 and the observed extension set.
2. **New gate**: compute in `Send` alongside `collapsible`: the text, whitespace-trimmed, is a **single line ending in a recognized image extension** (case-insensitive: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`). When the gate is on, `CountOccurrences` counts fresh `[Image #N]` chips IN ADDITION to raw needle occurrences, under the unchanged strict-increase-over-baseline rule. Gated rather than unconditional to keep the concurrent-fresh-chip false-positive window as narrow as the existing collapsible gate keeps its own — that reasoning is documented in the `CountOccurrences` doc comment (inject.go:573-582); mirror it.
3. **Threading**: thread the flag through the internal call chain: `Send` → `retrySubmit` → `probeEcho` → `verifySubmit` → `CountOccurrences`. `CountOccurrences` has NO callers outside `internal/inject/` (verified by grep), so the signature change is package-local (plus the package's own tests). Consider whether a small probe-spec struct (needle + collapsible + imageish) reads better than a third bool parameter — follow existing file style; either is acceptable.
4. **Tests**: unit tests in the inject package mirroring the existing paste-collapse tests:
   - chip counted only under the gate (mixed-text case NOT gated),
   - baseline strict-increase with stale chips already in-frame,
   - either-signal acceptance (raw needle still passes when the file doesn't exist / the TUI leaves raw text),
   - extension-set and case-insensitivity coverage of the gate predicate.

### Alternatives rejected (from the investigation)

- **Counting `[Image #N]` unconditionally (no gate)**: rejected to keep the false-positive window narrow, consistent with the existing collapsible-gate design stance.
- **Matching Claude Code's exact chip-eligibility rule (file existence + media sniffing)**: impossible from text alone; the either-signal design makes it unnecessary.
- **Frontend workaround (e.g. wrapping the path in text)**: would change what the agent receives; rejected.

## Affected Memory

- `run-kit/chat`: (modify) chat.md documents the shared pane-typed injection engine including the "novelty echo probe" and its signal set — add the third echo signal (the gated `[Image #N]` image-chip arm alongside the raw needle and paste-collapse chip) and the either-signal rationale. No other memory file covers the probe; `docs/specs/api.md` needs no change (no API surface change).

## Impact

- `app/backend/internal/inject/inject.go` — new package-level regex, new gate predicate, extended `CountOccurrences` signal set, flag threaded through `Send`/`retrySubmit`/`probeEcho`/`verifySubmit` (all package-internal signatures).
- `app/backend/internal/inject/*_test.go` — new unit tests mirroring the paste-collapse test shape.
- Consumers unchanged: `POST /api/windows/{id}/send` (incl. `target:"agent"` mode) and the operator-request routes get the fix for free through the shared engine. Frontend untouched.
- Constitution I (exec.CommandContext, argv slices): no new subprocess surface expected — the change is pure string/regex logic over existing captures.

## Open Questions

None — all design decisions were resolved and user-approved during the preceding investigation session.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Fix is engine-side only: `app/backend/internal/inject/inject.go` + package tests; no frontend, API, or subprocess change | Discussed — user-approved fix shape after the investigation; toast behavior is correct once the probe passes | S:95 R:85 A:95 D:95 |
| 2 | Certain | Add `imageCollapseRe` = `\[Image#\d+\]` over the whitespace-stripped capture, mirroring `pasteCollapseRe` style and the file's empirical doc-comment convention (cite CC 2.1.260) | Verified empirically on CC 2.1.260; exact regex and convention specified in the approved design | S:95 R:90 A:95 D:90 |
| 3 | Certain | Chip arm is GATED (single trimmed line ending in a recognized image extension) and EITHER-signal (fresh chip OR fresh raw needle), under the unchanged strict-increase-over-baseline rule | Verified matrix: nonexistent paths stay raw text, so either-signal is required; gating mirrors the documented collapsible-gate false-positive stance (inject.go:573-582) | S:95 R:85 A:90 D:90 |
| 4 | Confident | Extension set is `.png .jpg .jpeg .gif .webp` case-insensitive — `.jpeg` included though empirically untested (matches Claude API image media types); `.svg`/`.bmp` excluded (verified: no chip) | User directed including `.jpeg`; low risk — a wrongly-gated raw-text send still passes via the raw-needle signal (either-signal) | S:75 R:90 A:70 D:80 |
| 5 | Confident | Parameter threading shape (probe-spec struct vs a third bool through `Send`→`retrySubmit`→`probeEcho`→`verifySubmit`→`CountOccurrences`) left to apply's judgment per existing file style | User-approved delegation ("either is acceptable"); `CountOccurrences` has no callers outside `internal/inject/` (verified by grep), so fully reversible and package-local | S:70 R:90 A:85 D:60 |
| 6 | Certain | Affected memory is `run-kit/chat` (modify) — it documents the injection engine's echo-probe signal set; `docs/specs/api.md` unchanged | Domain index confirms chat.md owns "novelty echo probe, probe-gated Enter"; no API surface changes | S:85 R:95 A:90 D:90 |
| 7 | Confident | Test scope: package unit tests only, mirroring the existing paste-collapse tests; no e2e (the probe is a backend-internal signal with no UI contract change) | Fix shape names unit tests explicitly; existing paste-collapse behavior is covered the same way | S:75 R:85 A:85 D:80 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).

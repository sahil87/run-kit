# Intake: Operator Semantic Tab Coloring

**Change**: 260824-4940-operator-semantic-tab-coloring
**Created**: 2026-08-24

## Origin

Backlog item `[4940]` (fab/backlog.md, 2026-08-24), created via `/fab-new 4940` (one-shot, no prior conversation):

> Operator: semantic tab coloring — a server-scoped operator template (e.g. color-tabs) that asks the operator to read each tab (adapter transcript, else rk mux capture fallback) and assign row colors/@rk_flair by inferred category (feature/bugfix/infra, or risk) so the sidebar self-organizes visually. Actuation: operator sets the existing @rk_* options via tmux set-option (or an rk verb if one exists). CAVEAT: user-option mutations emit no control-mode event — direct set-option only repaints on the ~12s safety poll; either route through the color POST handlers' hub-wake seam or accept the lag. Rides the closed-registry seam from 260822-fih1/rfz2; degrade-to-absent, confirm not needed (non-destructive, reversible via the label picker).

Intake-time findings that shaped the decisions below:

- No rk CLI verb exists for setting window label options (checked `app/backend/cmd/rk/` — the `mux` family has send/await/capture/kill/process/panes/new/reap/snapshot/init-conf/guard, nothing option-setting), so the backlog's "or an rk verb if one exists" branch is empty.
- The window-options POST handler (`app/backend/api/windows.go` `handleWindowOptions`) validates against closed value sets and **wakes the SSE hub** (`s.sseHub.wake(server)`, windows.go:539) — the backlog's hub-wake seam. Raw `tmux set-option` repaints only on the ~12s safety poll.
- `tmux.WindowInfo` already carries `Color`/`Marker`/`Flair` on the sessions payload (tmux.go:562,611,622), so exposing current label state to the operator is a same-fetch read in `buildServerOperatorFacts`.

## Why

1. **Pain point**: a busy server's sidebar is a wall of visually identical tabs. The label vocabulary (color families, markers, flairs — 260723-wwoi, 260819-9hh6, 260822-6dlb) exists but labeling is manual per-tab work through the picker, so in practice most tabs stay unlabeled and the visual channel goes unused.
2. **Consequence of not fixing**: the categorical color axis stays a per-tab manual chore; users scan tab names instead of color-grouping, and the investment in the label vocabulary under-delivers.
3. **Why this approach**: semantic categorization ("this tab is bugfix work", "this is infra") requires reading each tab's content — judgment run-kit cannot derive (the inside/outside razor). The operator actuation seam (260822-fih1/wyn3/rfz2) exists exactly for this shape: run-kit derives the facts (routing table, transcript paths, current labels), delivers ONE templated prompt, the operator reads and actuates through its own shell, and the result surfaces on the normal derive tick. `sort-tabs` (260822-ga8z) is the deterministic sibling — it reorders by derivable keys; this template covers the non-derivable semantic half. A new closed-registry template is additive: no new endpoint, no new delivery machinery, degrade-to-absent UI.

## What Changes

### 1. New server-scoped registry entry: `color-tabs` (`app/backend/api/operator.go`)

Add to the closed `operatorTemplates` registry:

```go
"color-tabs": {
    serverScoped: true,
    // no acceptsText, no requiresChatRef, no requiresWaiting
    renderServer: renderColorTabs,
},
```

- Rides the existing seam unchanged: `POST /api/operator-request?server=` → registry + scope validation → one `FetchSessions` → `buildServerOperatorFacts` → busy gate → `deliverOperatorPrompt` → `injectChatMessage`. No queue, no retry, no response channel, success `200 {"ok":true}`.
- Empty routing table (zero non-operator windows) still delivers a trivially-answerable prompt — the `brief-me` posture; only `whats-stuck` rejects an empty subject set.

### 2. Current label state joins the shared fact row (`buildServerOperatorFacts`)

Extend `operatorWindowFact` with the subject's current `Color` (string, "" when unset), `Marker`, and `Flair`, read off the same fetched `WindowInfo` (no second fetch, Constitution X). Follows the rfz2 precedent ("digest fields ride the shared fact row, not a parallel table"); templates that don't need the fields ignore them. `renderColorTabs` renders them per row as e.g. `labels: color=blue marker=- flair=-` so the operator sees what is already set.

### 3. The `renderColorTabs` prompt

Plain string composition (no `text/template`), self-contained (operator needs no rk-specific knowledge). Content, in order:

1. **The routing table** — every non-operator window: session name, `@N`, window name, worktree path, agent state, fab change/stage when non-empty, current labels (from §2), and the transcript JSONL path when resolvable or a `transcript unavailable` note (the shared builder's broken-ref degradation).
2. **Read instruction** — for each tab, infer what kind of work it holds: read the transcript tail (~30 lines of the JSONL path — never capture-pane for agent tabs; agent TUIs run alt-screen with zero scrollback). For a tab with no transcript, fall back to `rk mux capture @N` (plain shell windows have real scrollback).
3. **Categorize** — suggested default scheme: one color family per work category, e.g. feature → `blue`, bugfix → `red`, infra/tooling → `slate`, docs → `teal`, experiments → `purple`; the operator may substitute a scheme that better fits the server's actual work mix (risk-based, project-based) but MUST apply one coherent scheme across all tabs — the point is that same-category tabs share a hue. Consistency beats any particular mapping.
4. **Actuate** — the exact commands, valid values enumerated verbatim:
   - `tmux set-option -t @N '@color' '<value>'` — value: one of the family names `red orange amber olive green teal blue purple magenta slate`, optionally suffixed `-dark`/`-light` for shade (risk/priority may ride the shade axis).
   - Optionally `tmux set-option -t @N '@rk_marker' '<value>'` (`pipe dotted dashed solid double thick hatch block`) and/or `tmux set-option -t @N '@rk_flair' '<value>'` (`rain scan nyan naruto onepiece pacman matrix aquarium roadrunner invaders cube warp`) as secondary accents — sparingly; color is the primary channel.
   - Unset with `tmux set-option -t @N -u '@color'` etc. when a tab genuinely fits no category.
5. **Judgment clauses** — DO NOTHING to a tab whose current labels already fit the scheme (the fix-tab-name no-op precedent); existing manual colors MAY be reassigned to fit the scheme (reversible via the label picker).
6. **Repaint note** — one line telling the operator the sidebar repaints within ~15 seconds of the last `set-option` (the safety poll); no further action needed.
7. **Bounds** — set only the three named options, only on the listed non-operator windows; do not rename, kill, or send keys to any window; do not reply to this message.

**Actuation route decision**: raw `tmux set-option` + accept the ~12s safety-poll repaint lag (the backlog caveat's second option — Assumptions #3; the curl-POST hub-wake alternative is one prompt-text edit away if the lag proves annoying).
Rationale: matches the actuation style of every shipped template (`tmux rename-window`, `tmux kill-window`, `rk riff`, `rk mux send`); zero new failure modes (no daemon-URL resolution, no curl, works on remote-host operators unchanged); the operation is a fire-and-forget batch taking the operator O(minutes) to read transcripts, so a trailing ≤12s repaint is marginal. Rejected: instructing the operator to `curl POST $(rk url)/api/windows/@N/options?server=…` (immediate per-write repaint + server-side validation, but a longer, more fragile prompt introducing an operator→HTTP dependency no template has today); adding an rk label verb (CLI-surface expansion + toolkit-standards audit for a cosmetic-latency win). Invalid typed values are harmless: `parseWindows` drops unknown marker/flair tokens to `""` and an unparseable color renders as unlabeled — both reversible via the picker.

### 4. Frontend: one palette entry, degrade to absent

- Palette entry `Operator: Color tabs` beside `Operator: Brief me` / `Operator: What's stuck` (the non-destructive server-scoped pattern): rendered only when the server has an operator window (`role === "operator"` in the sessions payload), OMITTED otherwise (never disabled), fires directly with no confirmation (non-destructive, backlog-explicit), one `sendServerOperatorRequest(server, "color-tabs")` behind the in-flight guard.
- Success toast: `"Sent to operator — tabs will be colored shortly"`; failure toasts the server's structured 409/404 message (existing `throwOnError` shape).
- No new client function, no dialog, no flyout row (no subject window), no compose-dialog mode (no text lane).

### 5. Explicitly NOT changing

- No new endpoint, no registry contract change (no new flags), no `acceptsText` lane on this template.
- No rk CLI verb, no hub-wake change, no SSE/safety-poll cadence change.
- Session-level colors (`@session_color`/`@rk_session_flair`) untouched — scope is window rows (tabs) only.
- The label picker, its vocabulary, and the validate closed sets untouched.

## Affected Memory

- `run-kit/operator-actuation`: (modify) new `color-tabs` template requirement (registry entry, prompt content, bounds); the label-state fact-row extension; Design Decision for the set-option-over-hub-wake actuation route
- `run-kit/ui/keyboard-and-palette`: (modify) `Operator: Color tabs` palette entry joins the operator action list

## Impact

- `app/backend/api/operator.go` — registry entry, `operatorWindowFact` label fields in `buildServerOperatorFacts`, `renderColorTabs` (+ `operator_test.go` render/handler tests following the brief-me test shape)
- `app/frontend/src/` palette action registry (the file carrying the `Operator: Brief me` entry) — one entry, gated on operator presence (+ existing e2e/unit pattern for palette operator entries if present)
- No API-client, router, endpoint, or tmux-layer changes. Small change: ~4–6 tasks, backend-weighted.

## Open Questions

- None — all decision points graded Confident or above (see Assumptions).

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Template id `color-tabs`, server-scoped, closed-registry entry riding the fih1/wyn3/rfz2 seam unchanged (one fetch, busy gate, shared delivery core, no queue) | Backlog names the template, the scope, and the seam explicitly | S:90 R:85 A:95 D:95 |
| 2 | Confident | No `acceptsText` — fixed prompt with a suggested default scheme; the operator's judgment picks the final categorization | Backlog describes inferred category, mentions no user text; the closed lane is the registry default; adding a text lane later is additive | S:65 R:85 A:80 D:70 |
| 3 | Confident | Actuation = raw `tmux set-option` accepting the ~12s safety-poll repaint lag, over the curl-POST hub-wake route and over a new rk verb | Backlog sanctions both routes; set-option matches every shipped template's actuation style, has zero new failure modes, and the lag is marginal for a minutes-long batch task; flipping to curl-POST is one prompt-text edit | S:60 R:85 A:60 D:45 |
| 4 | Confident | Extend `operatorWindowFact` with current Color/Marker/Flair off the same fetch, rendered only by `color-tabs` | rfz2 Design Decision precedent (digest fields ride the shared row); fields already on `WindowInfo`; the operator needs current state for the no-op judgment | S:55 R:80 A:85 D:75 |
| 5 | Certain | Per-tab reading = transcript JSONL tail when resolvable, else `rk mux capture @N` fallback (never capture for agent tabs — alt-screen zero scrollback) | Backlog specifies the fallback order verbatim; matches brief-me's transcript posture; `rk mux capture` accepts @N targets | S:85 R:85 A:90 D:90 |
| 6 | Confident | Channel semantics: `@color` is the primary category channel (family names, shade axis for risk); `@rk_marker`/`@rk_flair` offered as sparing secondary accents, full closed vocab enumerated in the prompt | Backlog names "row colors/@rk_flair"; color families are the categorical axis by design (260822-6dlb); enumerating valid values bounds operator typos | S:60 R:85 A:75 D:65 |
| 7 | Confident | Prompt instructs one coherent scheme across all tabs; DO NOTHING when current labels already fit; existing manual colors may be reassigned (reversible via picker) | fix-tab-name's no-op precedent; backlog calls the action reversible via the label picker; coherence is the feature's point | S:55 R:90 A:70 D:60 |
| 8 | Certain | Entry point: one palette entry `Operator: Color tabs`, direct-fire (no confirm — non-destructive per backlog), degrade to absent without an operator; reuses `sendServerOperatorRequest` | Backlog explicit on confirm-not-needed and degrade-to-absent; exact brief-me/whats-stuck pattern | S:80 R:85 A:90 D:85 |
| 9 | Confident | Zero non-operator windows still delivers a trivially-answerable prompt (no `requiresWaiting`-style rejection) | brief-me posture is the seam's documented default; a new rejection flag for a cosmetic template is over-engineering | S:50 R:90 A:85 D:80 |

9 assumptions (3 certain, 6 confident, 0 tentative, 0 unresolved).

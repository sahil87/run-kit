# Intake: Per-Tab Status Note (@rk_note)

**Change**: 260824-bb5n-tab-status-note
**Created**: 2026-08-24

## Origin

One-shot `/fab-new bb5n` from the backlog (no prior design conversation in-session). Raw backlog entry:

> [bb5n] 2026-08-24: Per-tab one-line status note (@rk_note) — a window-scoped user option carrying a one-liner like 'blocked on flaky e2e', rendered as the sidebar row's tooltip/subtitle. Read side is mechanical: derive in the sessions snapshot like other @rk_* options (same no-control-mode-event caveat: repaint rides the ~12s safety poll unless a hub-wake seam is added). Writers: the operator via a template (annotate-tab, or fold into brief-me: 'also write a one-line @rk_note per tab'), agents themselves, or the user via UI. Staleness matters — consider an epoch suffix like @rk_agent_state so old notes can fade/expire rather than lie. Degrade-to-absent: no option, no subtitle.

## Why

1. **Pain point**: with many agent tabs in flight, the derived signals (status dot, `@rk_agent_state`, PR register) say *what state* a window is in but never *why*. "Waiting 2h" doesn't distinguish "blocked on flaky e2e" from "awaiting design decision" — today the only way to recover that context is attaching to each pane and reading scrollback.
2. **Consequence if unfixed**: triage across tabs stays O(attach-per-tab); the operator's brief-me/whats-stuck outputs evaporate in the operator transcript instead of landing on the rows they describe.
3. **Approach**: a window-scoped `@rk_note` tmux user option, exactly parallel to the existing `@rk_marker`/`@rk_flair` window options — user/agent-authored annotation (not derived state, so Constitution X's derivation-wins rule is not in play; this is the user-preference class like markers and colors). It rides the existing derive path (`parseWindows` → sessions snapshot → SSE), needs no storage (Constitution II — it lives in tmux), and dies with the window. An epoch prefix (the `@rk_agent_state` staleness precedent) lets the UI age notes honestly instead of letting them lie.

## What Changes

### 1. `@rk_note` option — value schema + registry

- New window-scoped (`-w`) tmux user option, const `tmux.NoteOption = "@rk_note"`.
- **Value schema**: `<unix-epoch>:<text>` — epoch prefix, `SplitN(v, ":", 2)`, so colons inside the text are safe. Example: `1756036800:blocked on flaky e2e`.
- **Tolerant parse**: if the segment before the first `:` is not all digits, treat the whole value as text with epoch 0 (rendered without an age, never dropped). Unlike marker/role/flair this is free text, NOT a closed set — no value validation on read.
- Empty/absent option = no note (degrade-to-absent everywhere).
- **Writers**: agents via plain `tmux set-option -wt "$TMUX_PANE" @rk_note "$(date +%s):text"` (no rk/server dependency — the `@rk_agent_state` hook precedent); the rk API (below); the operator via template (below). Unset via `set-option -wu` or an empty write.

### 2. Read side — derive in the sessions snapshot

- Append `#{@rk_note}` as field 14 of the `list-windows` format (`app/backend/internal/tmux/tmux.go` ~1071) and parse in `parseWindows` (~line 949). Because the note is free text and the format is tab-delimited, the field MUST be last and the parser rejoins the tail: `strings.Join(parts[13:], "\t")` (write-side sanitization also strips tabs — belt and braces).
- `WindowInfo` gains `Note string` + `NoteEpoch int64`; the window payload gains `note` + `noteEpoch` (frontend computes age from epoch). Frontend `types.ts` `Window` gains `note?: string; noteEpoch?: number`.
- **Repaint caveat** (known): user-option mutations emit no control-mode event, so agent-written notes appear on the ~12s safety poll. The rk POST handler wakes the hub after writing (the `@rk_marker`/row-color POST precedent), so UI-initiated writes repaint immediately.

### 3. Write API — `POST /api/windows/{windowId}/note`

- Body `{"note": "text"}`; empty string (or absent) unsets the option. POST-only (Constitution IX).
- **Server stamps the epoch prefix** — clients send bare text; the server owns the clock (no client-skew lies).
- Validation (Constitution I): windowId validated like sibling window endpoints; text trimmed, capped at 120 chars, control characters (tabs, newlines) stripped; `exec.CommandContext` with timeout via `internal/tmux/` setters (`SetWindowNote` / `UnsetWindowNote`).
- Wakes the SSE hub after the write.

### 4. Frontend rendering — tip line + card row, not a row-height change

- **Fine pointer**: the window row's identity tip gains a note line — note text plus relative age, e.g. `blocked on flaky e2e · 2h ago` (the `sidebar/identity-tip.tsx` shell; tier-2 by the tooltip promotion rule).
- **Flyout card**: the three-tier row flyout's window card gains a note row (same text + age).
- **Coarse pointer**: hover doesn't exist — the note line rides the rail-triggered window card instead.
- **Staleness**: age always shown next to the text; when the note is older than 24h it renders dimmed (secondary/reduced opacity) — faded, not hidden. Notes never auto-expire or auto-delete; only an overwrite or explicit clear removes them. Epoch-0 (tolerant-parse) notes render text-only, undimmed.
- **Degrade-to-absent**: no `note` on the payload → no line, no row, no reserved space. The sidebar row itself does NOT grow a visible second line (render-performance constraint on row anatomy; virtualized row height stays fixed).
- **User write affordance**: palette action `Window: Set note…` (Constitution V — palette is the action registry) opening a text prompt pre-filled with the current note; empty submit clears. Registered for the current window on the terminal route.

### 5. Operator writer — `annotate-tab` template

- New **window-scoped** entry in the closed `operatorTemplates` registry (`app/backend/api/operator.go` ~108), mirroring `fix-tab-name`'s shape: instructs the operator to inspect the subject window (facts from the shared one-FetchSessions block) and write a one-line `@rk_note` via `set-option` with the epoch prefix.
- Delivered through the existing `deliverOperatorPrompt` core over `POST /api/windows/{windowId}/operator-request`; busy-gate 409 semantics unchanged.
- Frontend entry points mirror fix-tab-name: palette action (`Operator: Annotate tab`) + the window flyout card row.
- **Not in scope**: folding a note-writing line into `brief-me`, and any auto-fire (the fix-tab-name busy→idle auto-name tracker has no note counterpart) — both are cheap follow-ups once the option exists.

### 6. Snapshot capture

- Add `#{@rk_note}` to the layout-snapshot window capture set (`app/backend/internal/tmux/layout.go` ~85, optional-field idiom like field 12 `@rk_flair`) and restore it with the other window options. A note annotates the work, which survives a restart; the epoch keeps its age honest across restore.

## Affected Memory

- `run-kit/tmux-sessions`: (modify) `@rk_note` row in the `@rk_*` user-option registry table; `parseWindows` field count + free-text tail-join caveat
- `run-kit/ui/sidebar`: (modify) window-row identity tip note line; row-anatomy note (no visible subtitle, fixed row height)
- `run-kit/ui/status-signals`: (modify) window flyout card note row; staleness dimming rule
- `run-kit/ui/keyboard-and-palette`: (modify) `Window: Set note…` + `Operator: Annotate tab` palette actions
- `run-kit/operator-actuation`: (modify) `annotate-tab` registry entry (window-scoped, no acceptsText)
- `run-kit/layout-snapshots`: (modify) capture set gains `@rk_note`
- `run-kit/architecture`: (modify) `POST /api/windows/{windowId}/note` endpoint row

## Impact

- **Backend**: `internal/tmux/tmux.go` (format string, `parseWindows`, `WindowInfo`, `SetWindowNote`/`UnsetWindowNote`), `internal/tmux/layout.go` (capture set), `api/` (note handler + route, hub wake, `operator.go` template registry), `internal/validate` if a shared text sanitizer is added. Go tests alongside (`parseWindows` cases incl. tab-in-value tail join and tolerant epoch parse; handler validation tests; operator template scope test).
- **Frontend**: `types.ts`, `api/client.ts`, `sidebar/identity-tip.tsx` (or window-row tip equivalent), flyout card components, palette action registry, prompt dialog reuse. Vitest colocated tests; a Playwright spec (+ mandatory sibling `.spec.md`) for the tip/card rendering if e2e-reachable.
- **No new pages/routes** (Constitution IV), no database (II), no new env vars/settings keys (the feature has no configuration).

## Open Questions

- None — the backlog entry plus existing precedents (`@rk_flair` option idiom, `@rk_agent_state` epoch, `fix-tab-name` template, row-color hub wake) resolve all decision points; see Assumptions.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | The note POST handler wakes the SSE hub; agent-written notes ride the ~12s safety poll | Documented precedent — user-option mutations emit no control-mode event; the row-color POST established the hub-wake seam | S:80 R:60 A:95 D:90 |
| 2 | Confident | Value schema is a single option `<epoch>:<text>` (epoch prefix, SplitN-2, tolerant fallback to epoch-0 text) | Backlog explicitly points at the `@rk_agent_state` epoch precedent; one atomic option beats a sibling `@rk_note_ts` pair | S:60 R:70 A:80 D:70 |
| 3 | Confident | Rendered as identity-tip line + flyout-card row (+ coarse card), NOT a visible always-on subtitle | Backlog says "tooltip/subtitle" (either); sidebar render-perf constraints and fixed virtualized row height favor the tip; coarse card covers touch | S:55 R:75 A:55 D:40 |
| 4 | Confident | Staleness = relative age always shown, dimmed past 24h, never auto-expired/deleted | Backlog wants fade/expire "rather than lie"; dimming keeps the note honest without destroying user data; threshold is a trivially tunable constant | S:40 R:85 A:60 D:55 |
| 5 | Confident | Operator writer is a new window-scoped `annotate-tab` template; brief-me fold + auto-fire are non-goals | Backlog lists annotate-tab first; mirrors fix-tab-name's registry shape exactly; brief-me contract change is a cheap follow-up | S:50 R:80 A:60 D:45 |
| 6 | Confident | User write affordance is the palette action `Window: Set note…` (prompt, empty clears); server stamps the epoch | Constitution V makes the palette the mandatory registry; server-owned clock avoids client skew | S:35 R:80 A:70 D:60 |
| 7 | Confident | Validation: trim, 120-char cap, strip control chars (tabs/newlines), server-side | Operator acceptsText capping + Constitution I input-validation precedents; tab stripping protects the tab-delimited format | S:50 R:85 A:85 D:80 |
| 8 | Confident | `@rk_note` is included in the layout-snapshot capture/restore set | Capture set already carries window user options (`@rk_flair` optional-field idiom); only `@rk_origin` is excluded, for a reason that doesn't apply here | S:45 R:85 A:75 D:70 |

8 assumptions (1 certain, 7 confident, 0 tentative, 0 unresolved).

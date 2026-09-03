# Intake: Voice Round-Trip, Phase 1 — Push-to-Talk Dictation + Spoken Replies

**Change**: 260902-s4gw-voice-round-trip
**Created**: 2026-09-03

## Origin

Synthesized from a `/fab-discuss` design conversation (2026-09-02/03). Created via promptless dispatch (`/fab-proceed` create-new path) — no clarifying questions were asked; would-be questions are recorded as deferred Unresolved rows in `## Assumptions`.

> Voice round-trip, phase 1 — push-to-talk dictation + spoken replies, behind a `voice.enabled` setting off by default. Voice is an input/output modality layered onto run-kit's existing seams — explicitly NOT a new agent brain. Understanding is distributed: an agent pane (Claude in a worktree) receives the raw transcript as dictation and interprets it itself; a bare shell pane is served by the operator, which translates intent into a concrete command and stages it into the target pane.

An interactive design study produced during the discussion (a dashboard mock with a 6-stage playable loop: listen → transcribe → deliver → work → speak back → ask back, plus a wire-log panel) is preserved at `fab/changes/260902-s4gw-voice-round-trip/voice-round-trip.html` (copied from the session scratchpad, which does not outlive the session). It is the visual reference for the voice HUD's card anatomy and the loop's stage semantics.

## Why

1. **Pain point**: run-kit is operated from phones and tablets via the PWA as much as from desktops. On touch devices, typing long instructions to an agent pane — or a shell command with correct paths — is the single highest-friction interaction. There is currently no hands-free input path and no way to *hear* an agent's answer without watching the terminal.
2. **Consequence of not doing it**: mobile/away-from-keyboard operation stays read-mostly. The existing push-on-agent-waiting notification tells you an agent needs you, but answering still requires opening the dashboard and typing — the round trip is broken exactly where voice would close it.
3. **Why this approach**: layer voice onto seams that already exist (compose strip, `rk mux send` injection with paste probe + probe-gated Enter, the `/ws/state` socket, `rk notify` Web Push, the `waiting` agent-state, the operator translation seam) rather than build a conversational voice agent. A realtime voice agent was explicitly rejected — it would be a second brain duplicating the orchestrated agents, an always-open mic, and a much bigger surface. Phase 1 is dictation in, spoken replies out, with a human confirm gate in the middle.

## What Changes

### 1. Outbound leg — push-to-talk capture

- **Triggers** (all three, per Constitution V — the palette is the complete action registry):
  - Hold **⌥Space** chord (push-to-talk: record while held, stop on release). The chord must be registered through the existing keyboard-tier system and vetted against the claimed-keys register at plan time.
  - A **mic button** in the compose strip (press-and-hold on touch).
  - A **`Voice: hold to talk`** command-palette entry.
- **Capture**: browser records **opus** via `MediaRecorder`/`getUserMedia`. The **Web Speech API was REJECTED** (inconsistent quality/availability across browsers; Chrome ships audio to Google — wrong for the self-hosted posture).
- **Secure-context constraint**: `getUserMedia` requires a secure context — the mic is silently absent on plaintext LAN origins. The UI MUST degrade gracefully (mic control hidden or marked unavailable), never error. Escape hatches already exist and need no new work in this change: the Electron desktop shell, HTTPS on the daemon, or a tunnel. The entire return leg (TTS, cards, push) works on plaintext today.

### 2. Outbound leg — server-side transcription

- New route **`POST /api/voice/transcribe`**: accepts the recorded opus audio, runs STT on the daemon box, returns the transcript. Mutating-shape endpoint → POST (Constitution IX).
- STT engine: **whisper.cpp on the daemon** — committed. **Hosted STT is dropped from phase 1** (adds a provider choice and a key-storage question for little gain once local whisper works). Provisioning is **rk-managed** following the code-server installer pattern: a pinned whisper.cpp release binary + ggml model fetched into the state dir, with archive-containment checks (the code-server symlink lesson) and never run implicitly against a live box; an `rk doctor` row reports presence/version/model. Default model **`small.en` (quantized)** — the accuracy/latency sweet spot for short jargon-dense utterances; a **`voice.stt_model`** settings-registry key allows stepping up (e.g. `large-v3-turbo`). The daemon primes whisper's **initial prompt with derived vocabulary** (session/window/worktree names, "tmux", "fab") at transcription time — request-time derivation per Constitution II. <!-- clarified: STT backend + provisioning — user confirmed server-side rk-managed whisper.cpp, model per recommendation (2026-09-03) -->

### 3. Outbound leg — confirm gate + delivery

- The final transcript settles in a **voice HUD card** with a **~3 s auto-send** countdown the user can tap to **edit or cancel**. **Raw STT text NEVER hits tmux send-keys unreviewed** (Constitution I posture: validated input only).
- **Agent-pane delivery** reuses the existing injection machinery — `rk mux send` with sanitized paste, paste probe, and probe-gated Enter. No new injection path.
- **Pane context**: the utterance carries the pane context (`%N`) of the window whose compose strip hosted the mic — "this terminal" is unambiguous; no target inference.
- **Shell-pane targeting (operator translation)**: a bare shell pane is served by the operator. Referents are derived **at request time** per Constitution II (pane_current_path, git toplevel, justfile — never a stored map). Delivery uses mux send's **`staged` mode**: the command is typed into the prompt with **NO Enter**; the user submits. **Referent ambiguity comes back as a question, never a guessed command.**
- **Routing wiring (decided)**: the shell-pane arm rides the **operator-actuation seam** — a new **closed-registry template (`voice-shell-command`)** carrying the derived facts (pane `%N`, cwd, git root) is posted over the existing operator work-item POST routes. The operator stages the translated command into the target pane (`rk mux send` staged mode) and replies via `rk say`; the question-back path is the existing `waiting` agent-state card. A **busy operator surfaces the seam's no-queue 409 as a spoken "operator's busy"** — never a queue. <!-- clarified: operator routing — user chose the actuation-seam wiring (option A) over direct transcript send / daemon-side LLM / deferral (2026-09-03) -->

### 4. Return leg — `rk say` + HUD + TTS

- New CLI verb **`rk say "<text>"`** — a sibling of `rk notify` with the **same fail-silent contract**: any failure exits 0 and prints nothing. The operator/agent ends its turn with `rk say` to reply.
- The daemon fans the say event out over the **existing `/ws/state` socket** every open dashboard already holds (**push, not polling** — no new socket, no client poll).
- The browser renders a **reply card in the voice HUD** and speaks the text with **browser `speechSynthesis`** (on-device TTS, zero infra, works on plaintext LAN origins).
- **No-dashboard degradation**: with no connected dashboard (or tab hidden), `rk say` degrades to the existing **`rk notify` Web Push** path (push-on-agent-waiting already ships); tapping the notification opens the PWA on the operator window.
- **Questions from the agent** reuse the existing **`waiting` agent-state** (which already carries the pending question text — Constitution X: hooks carry only the underivable): the HUD renders an **amber question card** and **auto-arms the mic (barge-in)** so the user answers by voice.
- **HUD cards are ephemeral** — NO transcript store (Constitution II); the pane itself is the durable record. Replay derives from tmux.

### 5. Feature gating

- **One boolean `voice.enabled`, default `false`**, in the `internal/settings` registry / `~/.config/run-kit/config.yaml` (Constitution IV: the single settings surface). **NO new `RK_*` env var** — only the three bootstrap keys have env forms. A feature-flag framework was rejected.
- **Fail closed server-side**: `/api/voice/transcribe` **404s** when off; the STT worker never spawns; the say fan-out is **suppressed (or degrades to plain notify)**. Hiding the UI is not the gate.
- **Frontend mounts nothing when off** — gate at the **caller** so no voice component frames/effects exist when disabled (a return-null self-gate leaves caller wrappers + own effects alive — the project's self-gating-component lesson).
- **`rk say` itself stays flag-unaware** (its fail-silent contract covers the disabled case).
- **Later, out of scope now**: once shipped, "speak replies aloud" becomes a per-viewer localStorage preference; during development the single instance-level key suffices.

### 6. Design-study artifact

- Commit the interactive design study as `docs/wiki/voice-round-trip-studies.html` (or similar) per the project's design-study convention, adding a row to the specs index's Wiki table. Source: the copy preserved at `fab/changes/260902-s4gw-voice-round-trip/voice-round-trip.html`.

### Explicitly OUT of scope (rejected for phase 1)

- **Tier-2 intent interpretation** (utterance → palette-action/tool mapping via an LLM over the palette registry) — deferred to a later change.
- **A realtime conversational voice agent** (realtime APIs, barge-in TTS conversation) — rejected: a second brain duplicating the orchestrated agents, an always-open mic, and a much bigger surface.
- **Client-side polling of any kind; new state stores; new env vars.**
- **HTTPS/daemon TLS work** — the secure-context escape hatches already exist.

## Affected Memory

- `run-kit/voice`: (new) The voice round-trip subsystem end-to-end — push-to-talk capture, `/api/voice/transcribe` + STT worker, confirm gate + HUD card anatomy, `rk say` + `/ws/state` fan-out + `speechSynthesis`, Web Push degradation, `waiting`-state question cards with barge-in, `voice.enabled` fail-closed gating.
- `run-kit/api-and-sockets`: (modify) New `POST /api/voice/transcribe` route; new say event on the `/ws/state` socket fan-out.
- `run-kit/architecture`: (modify) New `rk say` CLI subcommand; new STT-hosting internal package (whisper.cpp subprocess).
- `run-kit/configuration`: (modify) `voice.enabled` and `voice.stt_model` join the `internal/settings` registry key inventory (defaults `false` / `small.en`, no env forms).
- `run-kit/daemon-lifecycle`: (modify) rk-managed whisper.cpp install (code-server installer pattern) + the voice `rk doctor` row.
- `run-kit/pwa-and-push`: (modify) `rk say` no-dashboard degradation into the existing Web Push path.
- `run-kit/ui/compose-and-bottom-bar`: (modify) Mic button in the compose strip; secure-context graceful degradation.
- `run-kit/ui/keyboard-and-palette`: (modify) ⌥Space hold-to-talk chord; `Voice: hold to talk` palette entry.

## Impact

- **Backend** (`app/backend/`): new `api/` route handler (`/api/voice/transcribe`, gated 404 when off); new internal package for STT invocation (whisper.cpp subprocess via `exec.CommandContext` with timeout per Constitution I, initial-prompt vocabulary priming) plus the rk-managed installer + doctor row; `cmd/rk/` gains `say`; the `/ws/state` hub gains a say fan-out message type; `internal/settings` registry gains `voice.enabled` + `voice.stt_model`; the say→notify degradation touches the push layer; the operator-actuation template registry gains `voice-shell-command`.
- **Frontend** (`app/frontend/src/`): compose-strip mic control; voice HUD component (transcript confirm card, reply card, amber question card) mounted only when enabled, gated at the caller; `MediaRecorder` capture; `speechSynthesis` playback; palette registration + keyboard chord; `/ws/state` say-event handling.
- **Delivery seams reused, not modified**: `rk mux send` (paste probe + probe-gated Enter, `staged` mode), operator translation, `waiting` agent-state, `rk notify` Web Push.
- **Tests**: Go handler/gating tests (`*_test.go`), Vitest for HUD/gating derivation, Playwright e2e for the mic-visible/hidden gating and HUD card flow (with STT stubbed; e2e specs carry Proves/Steps intent comments per constitution).
- **Docs**: design study into `docs/wiki/`; memory updates at hydrate per Affected Memory.

## Open Questions

- None — the STT backend/provisioning question was resolved in the 2026-09-03 clarification session (see `## Clarifications`): whisper.cpp on the daemon, rk-managed install, `small.en` default with `voice.stt_model` override; hosted STT dropped from phase 1.

## Clarifications

### Session 2026-09-03

| Q | A |
|---|---|
| Which STT backend ships in phase 1, and how is it provisioned? | whisper.cpp on the daemon box; rk-managed install per the code-server pattern (pinned release + ggml model into the state dir, containment checks, doctor row); default model `small.en` quantized with a `voice.stt_model` registry override; whisper initial-prompt vocabulary priming from derived names; hosted STT API dropped from phase 1. |
| How does a shell-pane utterance route to/from the operator? | Option A — the operator-actuation seam: new closed-registry template `voice-shell-command` with derived facts over the existing work-item POST routes; operator stages via `rk mux send` staged mode, replies via `rk say`; question-back = `waiting` agent-state card; busy operator = no-queue 409 surfaced as a spoken "operator's busy". (Options B — direct transcript send, C — daemon-side LLM, D — defer the shell arm — were explained and declined.) |

### Session 2026-09-03 (bulk confirm)

| # | Action | Detail |
|---|--------|--------|
| 7 | Confirmed | — |
| 11 | Confirmed | — |
| 18 | Confirmed | — |
| 20 | Confirmed | — |
| 22 | Confirmed | — |

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Voice is an input/output modality layered on existing seams — NOT a new agent brain; realtime conversational voice agent rejected | Discussed — explicit core framing of the design conversation | S:90 R:75 A:85 D:90 |
| 2 | Certain | Push-to-talk triggers: hold ⌥Space chord + compose-strip mic button + `Voice: hold to talk` palette entry | Discussed — decided; palette entry mandated by Constitution V | S:90 R:85 A:90 D:85 |
| 3 | Certain | Browser records opus via MediaRecorder/getUserMedia; server-side STT via new `POST /api/voice/transcribe`; Web Speech API rejected | Discussed — rejected Web Speech for quality/availability and Chrome-ships-audio-to-Google | S:90 R:75 A:85 D:85 |
| 4 | Certain | Confirm gate: transcript settles in a HUD card with ~3 s auto-send, tap to edit/cancel; raw STT never hits tmux send-keys unreviewed | Discussed — Constitution I posture applied to voice input | S:95 R:80 A:90 D:90 |
| 5 | Certain | Agent-pane delivery reuses existing injection machinery: `rk mux send` with paste probe + probe-gated Enter; no new injection path | Discussed — Constitution III (wrap, don't reinvent); chat/injection seam already proven | S:90 R:80 A:90 D:85 |
| 6 | Certain | Utterance carries the pane context (%N) of the window whose compose strip hosted the mic — no target inference | Discussed — "this terminal" made unambiguous by construction | S:90 R:80 A:90 D:90 |
| 7 | Certain | Shell-pane arm: operator translates intent → command; referents derived at request time (Constitution II); delivery via mux send `staged` mode (no Enter); ambiguity returns a question, never a guessed command | Clarified — user confirmed; wiring pinned by row 17 | S:95 R:70 A:80 D:80 |
| 8 | Certain | New CLI verb `rk say "<text>"`, sibling of `rk notify` with the same fail-silent contract (any failure exits 0, prints nothing) | Discussed — contract copied verbatim from the shipped `rk notify` | S:95 R:85 A:90 D:90 |
| 9 | Certain | Say events fan out over the existing `/ws/state` socket; browser renders a HUD reply card and speaks via `speechSynthesis`; push, not polling | Discussed — zero-infra TTS, works on plaintext origins; polling is a project anti-pattern | S:90 R:75 A:90 D:85 |
| 10 | Certain | No connected dashboard (or hidden tab) → `rk say` degrades to the existing `rk notify` Web Push path; notification tap opens the PWA on the operator window | Discussed — push-on-agent-waiting already ships; pure reuse | S:90 R:85 A:85 D:85 |
| 11 | Confident | Agent questions reuse the existing `waiting` agent-state (already carries pending question text); HUD renders an amber question card and auto-arms the mic (barge-in) | Clarified — user confirmed | S:95 R:70 A:75 D:75 |
| 12 | Certain | HUD cards are ephemeral — no transcript store; the pane is the durable record; replay derives from tmux | Discussed — Constitution II directly | S:90 R:80 A:95 D:90 |
| 13 | Certain | Gate = one boolean `voice.enabled`, default false, in the `internal/settings` registry / config.yaml; no new RK_* env var; feature-flag framework rejected | Discussed — Constitution IV; settings-home-not-env-vars is settled project policy | S:95 R:85 A:95 D:95 |
| 14 | Certain | Fail closed server-side: `/api/voice/transcribe` 404s when off, STT worker never spawns, say fan-out suppressed (or degrades to plain notify); hiding the UI is not the gate | Discussed — decided explicitly | S:90 R:80 A:90 D:85 |
| 15 | Certain | Frontend mounts nothing when off — gated at the caller so no voice frames/effects exist when disabled | Discussed — project's self-gating-component lesson applied by name | S:90 R:85 A:90 D:90 |
| 16 | Certain | `rk say` stays flag-unaware; its fail-silent contract covers the disabled case | Discussed — decided explicitly | S:90 R:90 A:90 D:90 |
| 17 | Confident | Shell-pane routing rides the operator-actuation seam: new closed-registry `voice-shell-command` template (derived facts: pane %N, cwd, git root) over the existing work-item POST routes; operator stages via `rk mux send` staged mode + replies via `rk say`; question-back = `waiting` agent-state card; busy operator = no-queue 409 → spoken "operator's busy" | Clarified — user chose the actuation-seam wiring (option A) | S:95 R:45 A:45 D:40 |
| 18 | Confident | Mic control hidden/marked unavailable on plaintext origins (no error); return leg fully functional there; no HTTPS/TLS work in this change | Clarified — user confirmed | S:95 R:75 A:75 D:70 |
| 19 | Tentative | Phase-1 STT = whisper.cpp on the daemon, rk-managed install (code-server installer pattern + doctor row), default `small.en` quantized with `voice.stt_model` registry override, initial-prompt vocabulary priming; hosted STT dropped | Clarified — user confirmed server-side rk-managed whisper.cpp, model per recommendation | S:95 R:35 A:25 D:20 |
| 20 | Confident | Commit the design study to `docs/wiki/` (with a specs-index Wiki row) as part of this change, sourcing the copy preserved in the change folder | Clarified — user confirmed | S:95 R:85 A:70 D:60 |
| 21 | Certain | Keyboard-first parity: everything voice does remains reachable by keyboard; voice is additive | Discussed — Constitution V restated as a hard constraint | S:90 R:90 A:95 D:90 |
| 22 | Certain | `speechSynthesis` speaking is governed by the single instance-level `voice.enabled` during this phase; the per-viewer "speak replies aloud" localStorage preference is explicitly later work | Clarified — user confirmed | S:95 R:85 A:80 D:75 |

22 assumptions (17 certain, 4 confident, 1 tentative, 0 unresolved).

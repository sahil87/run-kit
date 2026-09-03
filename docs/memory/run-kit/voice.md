---
type: memory
description: "Voice round-trip — push-to-talk dictation (⌥Space hold, mic chip, palette toggle) via browser capture → 16kHz WAV → POST /api/voice/transcribe (rk-managed whisper.cpp, internal/stt), a HUD confirm gate before any tmux delivery (agent pane: window send; shell pane: the voice-shell-command operator template), and spoken replies (rk say → /api/say → /ws/state say event → HUD reply card + speechSynthesis, Web Push degradation). Fail-closed behind voice_enabled; no transcript store."
---
# Voice Round-Trip

**Domain**: run-kit

## Overview

The voice round-trip layers a voice input/output modality onto run-kit's existing seams — dictation in, spoken replies out, with a human confirm gate in the middle. It is explicitly NOT a new agent brain: an agent pane receives the confirmed transcript as ordinary dictation and interprets it itself, while a bare shell pane is served by the operator, which translates the utterance into one staged shell command. Everything is gated fail-closed behind the `voice_enabled` settings-registry key (default `false`, [configuration](/run-kit/configuration.md)). HUD cards are ephemeral — there is no transcript store (Constitution II); the pane itself is the durable record.

## Requirements

### Requirement: Fail-closed feature gating
The gate SHALL be one boolean, `voice_enabled` (default `false`), in the `internal/settings` registry — with `voice_stt_model` (default `small.en`) beside it; neither has an env form. When `voice_enabled` is false: `POST /api/voice/transcribe` SHALL return 404 (evaluated before any body read or subprocess) and no whisper subprocess SHALL ever spawn; `POST /api/say` SHALL suppress the `/ws/state` fan-out and degrade to the plain notify path. Hiding the UI is not the gate. The frontend SHALL gate at the CALLER — `lib/voice-enabled.ts` reads the registry once per app lifetime (false until the read settles, false on read failure; a flip applies on reload) and mounts NOTHING voice-related when off: no mic chip, no HUD, no chord listener, no palette entry (no return-null self-gates). `rk say` itself SHALL stay flag-unaware — its fail-silent contract covers the disabled case.

#### Scenario: Disabled voice closes every surface
- **GIVEN** `voice_enabled: false`
- **WHEN** `POST /api/voice/transcribe` arrives with a valid audio body
- **THEN** the response is 404 and no whisper process is spawned; **AND GIVEN** `POST /api/say`, **THEN** no `say` event is broadcast and the request takes the notify push path; **AND GIVEN** the app shell mounts, **THEN** no voice component, listener, or palette entry exists.

### Requirement: Capture and triggers
Capture SHALL be browser-side: `getUserMedia({audio})` + `MediaRecorder` (opus), decoded via `AudioContext.decodeAudioData`, resampled to 16kHz mono, and PCM16-encoded into a WAV blob (`lib/voice-capture.ts`, all browser APIs injectable/stubbable, no runtime dependencies). Mic support SHALL be `isMicSupported()` (`window.isSecureContext && "mediaDevices" in navigator`) — on a plaintext LAN origin every mic affordance is OMITTED (never an error), while the entire return leg (cards, TTS, push) still works. Three triggers SHALL exist (Constitution V): the ⌥Space hold chord (record while held — see [ui/keyboard-and-palette](/run-kit/ui/keyboard-and-palette.md)), the compose-strip mic chip (press-and-hold — see [ui/compose-and-bottom-bar](/run-kit/ui/compose-and-bottom-bar.md)), and the `Voice: hold to talk` palette toggle (terminal route only).

### Requirement: Transcription endpoint
`POST /api/voice/transcribe` SHALL accept a 16kHz mono PCM WAV body, bounded by `http.MaxBytesReader` (`voiceMaxAudioBytes` 10 MiB, oversize ⇒ 413 before any subprocess), stage it to a temp file that never outlives the request, and invoke whisper through `internal/stt.Transcribe` (`whisper-cli -m <model> -f <wav> -nt --no-prints`, argv slice under one 30s `TranscribeTimeout` context; `[BLANK_AUDIO]` collapses to the empty transcript), returning `200 {"text": "<transcript>"}`. A missing install SHALL map to 503 with `whisper is not installed — run rk voice install`; a whisper failure or timeout SHALL map to 502. The handler SHALL prime whisper's `--prompt` with derived vocabulary: base terms (`tmux`, `fab`, `run-kit`, `worktree`, `pane`) plus — when `?server=` is given — the server's session, window, and worktree directory names from ONE `FetchSessions` pass at request time (Constitution II), deduplicated and capped at `voiceVocabMaxTerms` 50; a fetch failure degrades to base-only, never an error. Full endpoint contract in [api-and-sockets](/run-kit/api-and-sockets.md).

### Requirement: STT provisioning is rk-managed and explicit-only
`internal/stt` SHALL own the install layout under the state dir (`$XDG_STATE_HOME/run-kit/whisper/` — `bin/whisper-cli`, `models/ggml-<tag>-<quant>.bin`; a Constitution II droppable carve-out), the model-tag → ggml filename mapping (default quantization `q5_1`; `large-v3-turbo` maps to `q5_0`; a tag already carrying a `-q` suffix passes through), and a presence probe. Provisioning SHALL be the explicit `rk voice install` verb only — pinned whisper.cpp release archive SHA256-verified against the pinned digest (fail-closed on missing/mismatch), extracted through the shared `internal/archive` containment core, never run implicitly (no daemon auto-install, no spawn from the transcribe path). `rk doctor` SHALL carry a `whisper` row (presence/version/model, always OK-shaped with the `rk voice install` remediation note — the `codeServerCheck` posture; see [daemon-lifecycle](/run-kit/daemon-lifecycle.md)).

#### Scenario: Hostile archive fails closed
- **GIVEN** a release archive containing a `../escape` entry or a symlink escaping the destination
- **WHEN** `rk voice install` extracts it
- **THEN** extraction fails closed with no writes outside the target dir.

### Requirement: Confirm gate before any tmux delivery
The settled transcript SHALL render as a voice HUD confirm card (the design-study anatomy: `who` header, transcript body, meta chip row — `docs/wiki/voice-round-trip-studies.html`) with a ~3s auto-send countdown (`CONFIRM_COUNTDOWN_SECONDS`); tapping the card pauses the countdown and makes the transcript editable inline (edit then send, or cancel); a cancel control discards the utterance. Raw STT text SHALL NEVER reach tmux send-keys unreviewed — every tmux-bound send passes through the confirmed card (Constitution I posture).

### Requirement: Delivery routing — agent pane vs shell pane
On confirm, the transcript SHALL deliver to the pane context of the window whose compose strip hosted the mic (`%N` — no target inference). A window with a non-empty `chatSessionRef` (agent pane) ⇒ `POST /api/windows/{windowId}/send` `{text, mode:"submit", pane:%N}` (the optional validated `pane` field; absent stays byte-identical active-pane behavior). A bare shell window ⇒ `POST /api/windows/{windowId}/operator-request` `{template:"voice-shell-command", text}` (see [operator-actuation](/run-kit/operator-actuation.md)): the operator translates the utterance into exactly ONE command, stages it via `rk mux send %N "<command>" --no-enter` (NO Enter — the user submits), replies via `rk say`, and asks instead of guessing when referents are ambiguous. A busy operator's structured 409 SHALL surface as a HUD card plus a spoken "operator's busy" — no queue, no retry.

### Requirement: Return leg — `rk say` + say event + reply card
`rk say "<text>"` SHALL be a sibling of `rk notify` with the identical fail-silent contract (any failure exits 0, prints nothing), POSTing `{"text", "server"?, "window"?}` to `/api/say` with the caller's tmux server/window derived when inside tmux (the push deep-link hints). With voice enabled and a dashboard connected, `POST /api/say` SHALL broadcast a host-global `say` event (`{"text","server"?,"window"?,"ts"}`, no cached slot, no replay) over the existing `/ws/state` socket — push, not polling (full fan-out contract in [api-and-sockets](/run-kit/api-and-sockets.md)); otherwise it SHALL degrade to Web Push (see [pwa-and-push](/run-kit/pwa-and-push.md)). A `say` event SHALL render a green reply card in the voice HUD (via `session-context.tsx`'s `subscribeSay` seam) and speak the text via browser `speechSynthesis` (on-device TTS, works on plaintext origins), canceling any in-flight utterance first; cards auto-dismiss (`REPLY_DISMISS_MS`) and nothing persists.

### Requirement: Question card + barge-in
When the HUD's window rolls to `agentState === "waiting"`, the HUD SHALL render an amber question card (the pending question text from the chat stream's pending state when subscribed, else the generic needs-an-answer line) and auto-arm the mic — starting capture immediately ONLY when mic permission is already `granted` (browsers forbid a gesture-less first `getUserMedia`), otherwise presenting an armed-mic affordance that starts on tap.

#### Scenario: Barge-in respects the gesture rule
- **GIVEN** the current window transitions to `waiting` with mic permission granted
- **WHEN** the question card renders
- **THEN** capture starts without a tap; **AND GIVEN** permission not yet granted, **THEN** no automatic `getUserMedia` fires and the card's mic affordance starts capture on tap.

## Design Decisions

### Browser-side WAV re-encode before upload
**Decision**: the browser decodes the MediaRecorder opus output and uploads 16kHz mono PCM WAV; the server feeds whisper.cpp directly.
**Why**: whisper.cpp's CLI consumes WAV; a server-side transcode would add an ffmpeg dependency to the daemon box. `decodeAudioData` + PCM encode is ~60 lines of dependency-free browser code.
**Rejected**: uploading opus/webm and transcoding server-side with ffmpeg (new daemon dependency); Web Speech API (inconsistent quality/availability across browsers; Chrome ships audio to Google — wrong for the self-hosted posture).
*Introduced by*: 260902-s4gw-voice-round-trip

### ⌥Space as a bespoke hold listener, not a registry chord
**Decision**: the push-to-talk chord lives in a dedicated keydown/keyup hook outside `lib/keybindings.ts`.
**Why**: Alt is excluded from every keybinding tier by design (macOS character composition), and the dispatcher has no keyup/hold concept anywhere; forcing both into the registry would redesign it for one chord. Component-local chords outside the dispatcher have precedent (sidebar toggle, titlebar strip).
**Rejected**: adding an Alt tier + press/release handler shapes to the registry (redesigns the claimed-keys model for one binding).
*Introduced by*: 260902-s4gw-voice-round-trip

### `voice-shell-command` as a window-scoped acceptsText template with `requiresPaneFacts`
**Decision**: the shell-pane arm rides the existing window-scoped operator route with a new template; a declarative `requiresPaneFacts` flag gates the one extra pane-facts round trip.
**Why**: the template has a subject window (the shell tab), so the window route fits; the flag mirrors `requiresChatRef`'s declared-need posture, so non-declaring templates pay no derivation cost.
**Rejected**: a server-scoped template carrying the window id in text (loses route-level subject validation); always deriving pane facts (an extra subprocess on every window-scoped request).
*Introduced by*: 260902-s4gw-voice-round-trip

### Say with voice disabled degrades to plain notify
**Decision**: `POST /api/say` with `voice_enabled: false` suppresses the socket fan-out and runs the plain Web Push path.
**Why**: degradation keeps the operator's reply audible (as a push) without making `rk say` flag-aware, and reuses the shipped notify path verbatim.
**Rejected**: silent drop (loses the reply entirely); 404 (punishes a legitimately flag-unaware caller).
*Introduced by*: 260902-s4gw-voice-round-trip

### Whisper install lives under the state dir, not `~/.rk`
**Decision**: `internal/stt` roots at `$XDG_STATE_HOME/run-kit/whisper/` (bin + models).
**Why**: Constitution II scopes rk's disk carve-outs to `$XDG_STATE_HOME/run-kit/`; deleting the tree must cost nothing but a re-install.
**Rejected**: `~/.rk/whisper` beside `code-server-bin` (the state-dir commitment scopes whisper to droppable state).
*Introduced by*: 260902-s4gw-voice-round-trip

### Model tag → ggml filename with default quantization
**Decision**: `voice_stt_model` is a bare model tag (`small.en`); the filename mapping appends the default quantization (`q5_1`, `q5_0` for `large-v3-turbo`).
**Why**: keeps the user-facing setting at the model-name granularity while landing on the quantized artifacts (the accuracy/latency sweet spot for short jargon-dense utterances).
**Rejected**: making the setting the full filename (exposes ggml naming noise); unquantized defaults (larger download, slower transcription).
*Introduced by*: 260902-s4gw-voice-round-trip

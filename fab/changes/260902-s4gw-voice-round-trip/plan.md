# Plan: Voice Round-Trip, Phase 1 — Push-to-Talk Dictation + Spoken Replies

**Change**: 260902-s4gw-voice-round-trip
**Intake**: `intake.md`

## Requirements

### Settings: Feature Gating

#### R1: Voice settings registry keys
The `internal/settings` registry SHALL gain `voice_enabled` (bool, default `false`, serialized only when true — the `auto_name` shape) and `voice_stt_model` (string, default `small.en`, serialized only when non-default — the `log_level` shape). Both SHALL round-trip through `POST /api/settings` (partial merge, all-or-nothing validation) and `GET /api/settings`. Neither key SHALL have an env form.

- **GIVEN** a fresh config (no config.yaml keys)
- **WHEN** `settings.Load()` runs
- **THEN** `VoiceEnabled == false` and `VoiceSTTModel == "small.en"`, and the serializer emits neither key
- **AND GIVEN** `POST /api/settings {"voice_enabled": true, "voice_stt_model": "large-v3-turbo"}`, **THEN** both persist, survive a reload, and appear in the GET registry entries.

#### R2: Fail-closed server-side gating
When `voice_enabled` is false: `POST /api/voice/transcribe` SHALL return 404 and no STT subprocess SHALL ever spawn; `POST /api/say` SHALL suppress the `/ws/state` fan-out and degrade to the plain notify (Web Push) path. The gate is server-side; hiding UI is not the gate.

- **GIVEN** `voice_enabled: false`
- **WHEN** `POST /api/voice/transcribe` arrives with a valid audio body
- **THEN** the response is 404 and no whisper process is spawned.
- **AND GIVEN** `POST /api/say {"text":"hi"}` with `voice_enabled: false`, **THEN** no `say` event is broadcast and the request takes the notify push path.

### Backend: Transcription

#### R3: Transcribe endpoint
`POST /api/voice/transcribe` SHALL accept a WAV audio request body (16kHz mono PCM, `Content-Type: audio/wav` or `application/octet-stream`), read it bounded via `http.MaxBytesReader` (oversize ⇒ 413), stage it to a temp file, invoke whisper through `internal/stt` (`exec.CommandContext`, argv slice, 30s timeout), and return `200 {"text": "<transcript>"}` (empty string when whisper transcribes nothing). A missing whisper install SHALL map to 503 with the remediation message `whisper is not installed — run rk voice install`; a whisper failure or timeout SHALL map to 502.

- **GIVEN** voice enabled and whisper installed
- **WHEN** a valid WAV body is POSTed
- **THEN** the response is `200 {"text": ...}` and the whisper invocation used an argv slice under a 30s context.
- **AND GIVEN** whisper is not installed, **THEN** 503 with the remediation message and no subprocess.
- **AND GIVEN** a body over the size cap, **THEN** 413 with no subprocess.

#### R4: Vocabulary priming
The transcribe handler SHALL prime whisper's initial prompt with derived vocabulary: base terms (`tmux`, `fab`, `run-kit`, `worktree`, `pane`) plus — when the optional `?server=` parameter names a server — the server's session, window, and worktree names derived from ONE `FetchSessions` pass at request time (Constitution II). A `FetchSessions` failure degrades to base vocabulary only, never an error. No vocabulary is stored anywhere.

- **GIVEN** a server with session `run-kit` and window `voice-round-trip`
- **WHEN** transcription runs with `?server=<srv>`
- **THEN** the whisper initial prompt contains `run-kit`, `voice-round-trip`, and the base terms.
- **AND GIVEN** no `?server=` or a fetch failure, **THEN** the prompt carries the base terms only.

### Backend: STT Provisioning

#### R5: `internal/stt` resolution + transcription subprocess
A new package `app/backend/internal/stt` SHALL own: the install layout under the state dir (`$XDG_STATE_HOME/run-kit/whisper/` — `bin/whisper-cli`, `models/ggml-<tag>.bin`); the model-tag → ggml filename mapping (default quantization `q5_1`; `large-v3-turbo` maps to `q5_0`); a `Status`-style presence probe (binary present/executable, model present, sizes); and `Transcribe(ctx, ...)` running `whisper-cli` with an argv slice (`-m <model> -f <wav> --no-prints -nt`, initial-prompt flag when vocabulary is provided), returning the trimmed transcript.

- **GIVEN** model tag `small.en`
- **WHEN** the filename mapping runs
- **THEN** it yields `ggml-small.en-q5_1.bin`; `large-v3-turbo` yields `ggml-large-v3-turbo-q5_0.bin`.
- **AND GIVEN** no install, **THEN** the presence probe reports not-installed without erroring.

#### R6: `rk voice install` (explicit-only provisioning)
A new CLI verb `rk voice install` SHALL fetch the pinned whisper.cpp release binary archive and the configured model (`voice_stt_model`) file into the state-dir layout, verify the release archive's SHA256 against a pinned digest (fail closed on missing/mismatch for the archive), and enforce archive containment on extraction (lexical `..`/absolute rejection plus symlink-resolution containment — the code-server lesson). It SHALL never run implicitly (no daemon auto-install, no spawn from the transcribe path).

- **GIVEN** no whisper install
- **WHEN** `rk voice install` completes
- **THEN** `bin/whisper-cli` is executable and `models/ggml-small.en-q5_1.bin` exists under the state dir, and `internal/stt`'s presence probe reports installed.
- **AND GIVEN** an archive containing a `../escape` entry or a symlink escaping the destination, **THEN** extraction fails closed with no writes outside the target dir.

#### R7: Doctor row
`rk doctor` SHALL include a `whisper` row reporting presence, version, and model, mirroring `codeServerCheck`: always OK-shaped with the remediation note `rk voice install` when absent.

- **GIVEN** no install
- **WHEN** `rk doctor` runs
- **THEN** the whisper row reports not-installed with the remediation note, and doctor's overall verdict is unchanged (OK-shaped row).
- **AND GIVEN** an install, **THEN** the row names the binary version and model file.

### Backend: Return Leg (`rk say`)

#### R8: `rk say` CLI
A new CLI verb `rk say "<text>"` SHALL be a sibling of `rk notify` with the identical fail-silent contract: any failure (unreachable daemon, timeout, non-2xx, undecodable context) exits 0 and prints nothing; cobra errors/usage silenced; one positional arg. It SHALL POST `{"text", "server"?, "window"?}` to `resolveOrigin(ctx) + "/api/say"` under a bounded timeout, deriving `server` (the `$TMUX` socket basename, the `muxServer()` pattern) and `window` (the caller's `@N` window id from `$TMUX_PANE` via one `display-message` call) when the CLI runs inside tmux, omitting both otherwise. `rk say` SHALL stay flag-unaware (no `voice_enabled` read — the fail-silent contract covers the disabled case).

- **GIVEN** no daemon reachable
- **WHEN** `rk say "hello"` runs
- **THEN** exit code is 0 and nothing is printed.
- **AND GIVEN** a pane inside a tmux server `rk-test-x`, **THEN** the POST body carries `server` and the caller's window id; outside tmux both are absent.

#### R9: Say endpoint + fan-out + degradation
`POST /api/say` SHALL sanitize `text` (`inject.Sanitize`, then the emptiness check — 400 on empty/undecodable), then: (a) `voice_enabled` false ⇒ suppress fan-out, degrade to `push.Notify` (plain notify, title `RunKit`); (b) enabled with zero connected dashboards (no `/ws/state` connections) ⇒ degrade to `push.Notify` with a deep link to the origin window (`/{server}/{N}`, the `waitingPushURL` shape) when `server`+`window` are present and valid; (c) enabled with dashboards connected ⇒ broadcast a `say` event (`{"text","server"?,"window"?,"ts"}`) over the hub's global fan-out via `preRendered` — no cached slot, no replay (the `status-refresh` shape). Success is `200 {"ok": true}` in all three branches (push failures stay fail-soft, mirroring `handleNotify`).

- **GIVEN** voice enabled and a connected dashboard
- **WHEN** `POST /api/say {"text":"done"}` arrives
- **THEN** exactly one `say` event fan-out carries the text and no push is sent.
- **AND GIVEN** voice enabled and no connected dashboard with `server`+`window`, **THEN** no broadcast occurs and `push.Notify` fires with the `/{server}/{N}` deep link.
- **AND GIVEN** voice disabled, **THEN** no broadcast and the plain notify path runs.

### Backend: Delivery Routing

#### R10: Optional pane targeting on window send
`POST /api/windows/{windowId}/send` SHALL accept an optional `pane` field (`%N`, `tmux.ValidPaneID`). When present, the pane SHALL be validated against the resolved window's pane list (unknown/malformed ⇒ 400) and injection SHALL target that pane for every text-bearing mode. When absent, behavior is byte-identical to today's active-pane resolution.

- **GIVEN** a window with panes `%3` (active) and `%4`
- **WHEN** the body carries `"pane": "%4"` with mode `submit`
- **THEN** every injection subprocess targets `%4`.
- **AND GIVEN** `"pane": "%9"` (not in the window) or a malformed value, **THEN** 400 and no injection; **AND GIVEN** no `pane` field, **THEN** the active pane `%3` is targeted exactly as before.

#### R11: The `voice-shell-command` operator template
The `operatorTemplates` closed registry SHALL gain a window-scoped `voice-shell-command` entry declaring `acceptsText: true` and a new declarative `requiresPaneFacts` flag (mirroring `requiresChatRef`). `operatorFacts` SHALL gain `Text`, `PaneID`, `CWD`, and `GitRoot` fields; `deliverOperatorRequest` SHALL receive the admitted body text and — only for templates declaring `requiresPaneFacts` — derive the subject's pane facts in ONE extra round trip (the resolved pane, active-pane-first; `pane_current_path` via `tmux.PaneFactsCtx`; git root via `config.FindGitRoot`). The render SHALL be self-contained: the `[run-kit request]` framing; the subject window `@N`, pane `%N`, cwd, and git root; the utterance in a dynamic-fence delimited treat-as-data block; instructions to translate the intent into exactly ONE shell command, stage it into the target pane via `rk mux send %N "<command>" --no-enter` (staged — NO Enter; the user submits), reply to the user via `rk say "<one-line reply>"`, and — when referents are ambiguous — end its turn asking the clarifying question (NEVER guess a command), plus the standard no-other-action bounds. The existing busy gate SHALL reject a busy operator with the structured 409 unchanged.

- **GIVEN** a subject shell window `@5` with pane `%12`, cwd `/srv/app`, git root `/srv/app`, and body `{"template":"voice-shell-command","text":"restart the api"}`
- **WHEN** the template renders
- **THEN** the prompt names `@5`, `%12`, `/srv/app` (cwd + git root), the fenced utterance, the exact `rk mux send %12 ... --no-enter` actuation, the `rk say` reply verb, the ask-don't-guess clause, and the bounds.
- **AND GIVEN** a busy operator, **THEN** the structured busy 409 surfaces unchanged; **AND GIVEN** `voice-shell-command` on the server-scoped route, **THEN** 400 naming it window-scoped.

### Frontend: Capture + Triggers

#### R12: Voice capture module
`app/frontend/src/lib/voice-capture.ts` SHALL expose `isMicSupported()` (`window.isSecureContext && "mediaDevices" in navigator` — the `isPushSupported` shape) and a capture controller: `start()` acquires `getUserMedia({audio})` + `MediaRecorder` (opus); `stop()` resolves a WAV `Blob` — the recorded chunks decoded via `AudioContext.decodeAudioData`, resampled to 16kHz mono, PCM16-encoded. All browser APIs SHALL be injectable/stubbable for tests; no new runtime dependencies.

- **GIVEN** a non-secure context (plaintext LAN origin)
- **WHEN** `isMicSupported()` runs
- **THEN** it returns false and no `getUserMedia` call is ever made.
- **AND GIVEN** a stubbed recorder emitting known chunks, **THEN** `stop()` resolves a well-formed 16kHz mono WAV blob.

#### R13: Caller-side voice gating
A voice-enabled reader SHALL fetch the settings registry once per app-shell mount (`GET /api/settings`) and expose `voiceEnabled`. When false, callers SHALL mount NOTHING voice-related — no mic chip, no HUD, no chord listener, no palette entry (gate at the caller; no return-null self-gates). A flag flip applies on reload (no live settings feed exists).

- **GIVEN** `voice_enabled: false`
- **WHEN** the app shell mounts
- **THEN** no voice component, listener, or palette entry exists in the DOM/registry.
- **AND GIVEN** `voice_enabled: true` on a non-secure context, **THEN** the mic affordances are omitted (not disabled) and no error surfaces.

#### R14: Mic chip in the compose strip
The compose strip SHALL render a mic chip as a keyed sibling (the `attachChip` idiom: `rk-glint`, `coarse:min-h-[36px] coarse:min-w-[36px]`, `onMouseDown` prevent-focus-steal) when voice is enabled AND the mic is supported; press-and-hold (pointer down/up) SHALL start/stop capture; the chip SHALL be omitted otherwise.

- **GIVEN** voice enabled + mic supported
- **WHEN** the compose strip renders
- **THEN** the mic chip is present; pointer-down starts capture, pointer-up stops it.
- **AND GIVEN** voice disabled OR mic unsupported, **THEN** the chip is absent.

#### R15: ⌥Space hold-to-talk chord
A bespoke `keydown`/`keyup` listener (outside the keybinding registry — Alt is excluded from every tier by design) SHALL start capture on Alt+Space keydown (`e.code === "Space" && e.altKey && !e.repeat`, skipped in editable elements, `preventDefault` to suppress the macOS non-breaking-space composition) and stop capture on keyup. The listener SHALL mount only when voice is enabled and the mic is supported.

- **GIVEN** voice enabled
- **WHEN** the user holds ⌥Space
- **THEN** capture runs from keydown to keyup; auto-repeated keydowns do not restart it; a ⌥Space inside a text input does not capture.

#### R16: `Voice: hold to talk` palette entry
A palette action `Voice: hold to talk` SHALL toggle capture (palette actions are fire-on-select — select starts capture; selecting again, or the HUD's stop control, ends it), registered in the terminal route's palette list and omitted unless voice is enabled and the mic is supported.

- **GIVEN** voice enabled
- **WHEN** the palette opens
- **THEN** `Voice: hold to talk` is present and starts capture on select.
- **AND GIVEN** voice disabled, **THEN** the entry is absent from the palette.

### Frontend: HUD + Delivery

#### R17: Confirm card with auto-send countdown
The settled transcript SHALL render as a voice HUD confirm card (design-study anatomy: `who` header, transcript body, meta chip row) with a ~3s auto-send countdown chip; tapping the card SHALL pause the countdown and make the transcript editable inline (edit then send, or cancel); a cancel control SHALL discard the utterance. Raw STT text SHALL NEVER reach tmux without passing this gate.

- **GIVEN** a settled transcript `restart the api`
- **WHEN** the confirm card renders
- **THEN** a countdown runs and, after ~3s uninterrupted, the send path fires; a tap within the window pauses for edit; cancel sends nothing.
- **AND** no code path delivers STT output to any send endpoint except through the confirmed card.

#### R18: Delivery routing (agent pane vs shell pane)
On confirm, the transcript SHALL deliver to the pane context of the hosting window: a window with a non-empty `chatSessionRef` (agent pane) ⇒ `POST /api/windows/{windowId}/send` `{text, mode:"submit", pane:%N}`; a bare shell window ⇒ `POST /api/windows/{windowId}/operator-request` `{template:"voice-shell-command", text}` whose structured 409 busy response SHALL surface as a HUD card plus a spoken "operator's busy" (`speechSynthesis`); other API errors SHALL toast the server's message.

- **GIVEN** an agent window target
- **WHEN** the confirm countdown completes
- **THEN** the window send fires with `mode:"submit"` and the hosting pane `%N`.
- **AND GIVEN** a shell window target whose operator is busy, **THEN** the 409 surfaces as a card and "operator's busy" is spoken; no queue, no retry.

#### R19: Reply card + spoken replies
A `say` event on the `/ws/state` socket SHALL render a green reply card in the voice HUD and speak `text` via `speechSynthesis` (canceling any in-flight utterance first). Cards SHALL auto-dismiss and nothing SHALL persist (no transcript store — the pane is the durable record).

- **GIVEN** voice enabled with the HUD mounted
- **WHEN** a `say` event `{text:"deploy finished"}` arrives
- **THEN** a reply card renders the text and `speechSynthesis.speak` fires with it.
- **AND GIVEN** a second `say` arriving mid-speech, **THEN** the first utterance is canceled.

#### R20: Question card + barge-in
When the HUD's window rolls to `agentState === "waiting"`, the HUD SHALL render an amber question card (the pending question text from the chat stream's pending state when available, else a generic needs-an-answer line) and auto-arm the mic — starting capture immediately when mic permission is already granted, otherwise presenting an armed-mic affordance that starts on tap (browsers forbid a first `getUserMedia` without a gesture).

- **GIVEN** the current window transitions to `waiting` with mic permission granted
- **WHEN** the card renders
- **THEN** capture starts without a tap (barge-in) and the question text shows.
- **AND GIVEN** permission not yet granted, **THEN** no automatic `getUserMedia` fires and the card's mic affordance starts capture on tap.

### Docs

#### R21: Design-study artifact
The preserved design study SHALL be committed as `docs/wiki/voice-round-trip-studies.html` (source: `fab/changes/260902-s4gw-voice-round-trip/voice-round-trip.html`) with a row added to the Wiki table in `docs/specs/index.md` in the existing row format.

- **GIVEN** the change folder's `voice-round-trip.html`
- **WHEN** the docs task completes
- **THEN** `docs/wiki/voice-round-trip-studies.html` exists with identical content and `docs/specs/index.md`'s Wiki table has a row linking it.

### Non-Goals

- Tier-2 intent interpretation (utterance → palette-action mapping via LLM) — deferred.
- A realtime conversational voice agent (realtime APIs, always-open mic, barge-in TTS conversation) — rejected.
- Client-side polling of any kind; new state stores; new `RK_*` env vars.
- HTTPS/daemon TLS work — the secure-context escape hatches already exist.
- Per-viewer "speak replies aloud" localStorage preference — later work; `voice_enabled` governs speaking this phase.
- Hosted STT providers — dropped from phase 1.

### Design Decisions

#### Browser-side WAV re-encode before upload
**Decision**: the browser decodes the MediaRecorder opus output and uploads 16kHz mono PCM WAV; the server feeds whisper.cpp directly.
**Why**: whisper.cpp's CLI consumes WAV; a server-side transcode would add an ffmpeg dependency to the daemon box. `decodeAudioData` + PCM encode is ~60 lines of dependency-free browser code.
**Rejected**: uploading opus/webm and transcoding server-side with ffmpeg (new daemon dependency); Web Speech API (rejected at intake).
*Introduced by*: 260902-s4gw-voice-round-trip

#### ⌥Space as a bespoke hold listener, not a registry chord
**Decision**: the push-to-talk chord lives in a dedicated keydown/keyup hook outside `lib/keybindings.ts`.
**Why**: Alt is excluded from every keybinding tier by design (macOS character composition), and the dispatcher has no keyup/hold concept anywhere; forcing both into the registry would redesign it for one chord. Component-local chords outside the dispatcher have precedent (sidebar toggle, titlebar strip).
**Rejected**: adding an Alt tier + press/release handler shapes to the registry (redesigns the claimed-keys model for one binding).
*Introduced by*: 260902-s4gw-voice-round-trip

#### `voice-shell-command` as a window-scoped acceptsText template with `requiresPaneFacts`
**Decision**: the shell-pane arm rides the existing window-scoped operator route with a new template; a declarative `requiresPaneFacts` flag gates the one extra pane-facts round trip.
**Why**: the template has a subject window (the shell tab), so the window route fits; the flag mirrors `requiresChatRef`'s declared-need posture, so non-declaring templates pay no derivation cost.
**Rejected**: a server-scoped template carrying the window id in text (loses route-level subject validation); always deriving pane facts (an extra subprocess on every window-scoped request).
*Introduced by*: 260902-s4gw-voice-round-trip

#### Say with voice disabled degrades to plain notify
**Decision**: `POST /api/say` with `voice_enabled: false` suppresses the socket fan-out and runs the plain Web Push path.
**Why**: the intake permits "suppressed (or degrades to plain notify)"; degradation keeps the operator's reply audible (as a push) without making `rk say` flag-aware, and reuses the shipped notify path verbatim.
**Rejected**: silent drop (loses the reply entirely); 404 (punishes a legitimately flag-unaware caller).
*Introduced by*: 260902-s4gw-voice-round-trip

#### Whisper install lives under the state dir, not `~/.rk`
**Decision**: `internal/stt` roots at `$XDG_STATE_HOME/run-kit/whisper/` (bin + models).
**Why**: the intake commits to "fetched into the state dir", and Constitution II scopes rk's disk carve-outs to `$XDG_STATE_HOME/run-kit/`; deleting it must cost nothing but a re-install.
**Rejected**: `~/.rk/whisper` beside `code-server-bin` (contradicts the intake's state-dir commitment).
*Introduced by*: 260902-s4gw-voice-round-trip

#### Model tag → ggml filename with default quantization
**Decision**: `voice_stt_model` is a bare model tag (`small.en`); the filename mapping appends the default quantization (`q5_1`, `q5_0` for `large-v3-turbo`).
**Why**: keeps the user-facing setting at the model-name granularity the intake specifies while landing on the quantized artifacts the intake recommends.
**Rejected**: making the setting the full filename (exposes ggml naming noise); unquantized defaults (larger download, slower transcription).
*Introduced by*: 260902-s4gw-voice-round-trip

## Tasks

### Phase 1: Setup

- [x] T001 Add `voice_enabled` + `voice_stt_model` to the registry in `app/backend/internal/settings/settings.go` (Settings fields, `Default()`, registry entries, serialize/parse hooks) with tests in `app/backend/internal/settings/settings_test.go` and the API round-trip in `app/backend/api/settings_test.go` <!-- R1 -->

### Phase 2: Backend Core

- [x] T002 Create `app/backend/internal/stt/stt.go` — state-dir layout (`$XDG_STATE_HOME/run-kit/whisper/`), model-tag→ggml filename mapping, presence probe, and `Transcribe(ctx, ...)` whisper-cli invocation (argv slice, timeout); tests in `app/backend/internal/stt/stt_test.go` <!-- R5 -->
- [x] T003 Add `app/backend/api/voice.go` — `handleVoiceTranscribe` (404 gate on `voice_enabled`, `MaxBytesReader` 413, temp WAV staging, `internal/stt` invocation, 503/502 mapping, vocabulary priming via one `FetchSessions` when `?server=` is present); register `POST /api/voice/transcribe` in `app/backend/api/router.go`; tests in `app/backend/api/voice_test.go` <!-- R2, R3, R4 -->
- [x] T004 Add `app/backend/api/say.go` — `handleSay` (sanitize + 400s, `voice_enabled` false ⇒ plain `push.Notify`, no connected dashboards ⇒ `push.Notify` with `/{server}/{N}` deep link, else hub broadcast); add `broadcastSay` + a connected-dashboard probe to the hub in `app/backend/api/sse.go`/`state_ws.go` (the `status-refresh`/`preRendered` shape); register `POST /api/say` in `router.go`; tests in `app/backend/api/say_test.go` <!-- R2, R9 -->
- [x] T005 Add `app/backend/cmd/rk/say.go` — `rk say "<text>"` fail-silent sibling of `notify.go` (silenced cobra, `resolveOrigin`, bounded timeout, server/window derived from `$TMUX`/`$TMUX_PANE` when present); register in `app/backend/cmd/rk/root.go`; tests in `app/backend/cmd/rk/say_test.go` (run with `env -u TMUX -u TMUX_PANE`) <!-- R8 -->
- [x] T006 Extend `app/backend/api/operator.go` — `requiresPaneFacts` registry flag, `operatorFacts` gains `Text`/`PaneID`/`CWD`/`GitRoot`, body text plumbed into `deliverOperatorRequest`, pane-facts derivation (`tmux.PaneFactsCtx` + `config.FindGitRoot`) only for declaring templates, the `voice-shell-command` entry + `renderVoiceShellCommand`; tests in `app/backend/api/operator_test.go` <!-- R11 -->
- [x] T007 Extend `app/backend/api/send.go` — optional `pane` field on the window-send body (`tmux.ValidPaneID`, must belong to the resolved window, 400 otherwise; absent = byte-identical active-pane behavior); tests in `app/backend/api/send_test.go` <!-- R10 -->
- [x] T008 Add the whisper installer to `app/backend/internal/stt/install.go` (pinned release archive + model download, SHA256 verify fail-closed, tar/zip containment with symlink-resolution, atomic promotion) and `app/backend/cmd/rk/voice.go` (`rk voice install`, explicit-only); register in `root.go`; tests in `install_test.go` / `voice_test.go` (run with `env -u TMUX -u TMUX_PANE`) <!-- R6 -->
- [x] T009 Add the `whisper` doctor row in `app/backend/cmd/rk/doctor.go` (presence/version/model, OK-shaped with `rk voice install` remediation note, the `codeServerCheck` shape); tests in `app/backend/cmd/rk/doctor_test.go` <!-- R7 -->

### Phase 3: Frontend Core

- [x] T010 Create `app/frontend/src/lib/voice-capture.ts` (`isMicSupported`, capture controller: getUserMedia + MediaRecorder → decodeAudioData → 16kHz mono PCM16 WAV blob; injectable browser APIs); tests in `app/frontend/src/lib/voice-capture.test.ts` <!-- R12 -->
- [x] T011 Add the caller-side voice gate — `app/frontend/src/lib/voice-enabled.ts` (or a small context) fetching `GET /api/settings` once per app-shell mount and exposing `voiceEnabled`; thread it to the compose strip, HUD mount, chord hook, and palette list; tests <!-- R13 -->
- [x] T012 Add the `say` event seam — `StateEvent` handling for a global `say` type in `app/frontend/src/lib/state-socket.ts` + a `subscribeSay(handler): () => void` subscriber-set seam in `app/frontend/src/contexts/session-context.tsx` (the `status-refresh` pattern, payload-bearing); tests <!-- R19 -->
- [x] T013 Create `app/frontend/src/components/voice-hud.tsx` — the voice HUD: confirm card (transcript body, ~3s countdown chip, tap-to-edit, cancel), green reply card + `speechSynthesis` (cancel in-flight first), amber question card; ephemeral auto-dismiss; study anatomy (`who` header, body, meta chips); reduced-motion safe; tests in `app/frontend/src/components/voice-hud.test.tsx` <!-- R17, R19, R20 -->
- [x] T014 Add the voice delivery module `app/frontend/src/lib/voice-delivery.ts` + `api/client.ts` additions (`transcribeVoice(server, wavBlob)`, optional `text` on `sendOperatorRequest`, optional `pane` on `sendToWindow`): agent (`chatSessionRef`) ⇒ window send `submit`+`pane`; shell ⇒ `voice-shell-command`; busy 409 ⇒ card + spoken "operator's busy"; other errors toast; tests <!-- R18 -->
- [x] T015 Add the mic chip to `app/frontend/src/components/compose-strip.tsx` (keyed sibling, attachChip idiom, press-and-hold start/stop, omitted when gated off); tests in `compose-strip.test.tsx` <!-- R14 -->
- [x] T016 Add `app/frontend/src/hooks/use-hold-to-talk.ts` — the bespoke ⌥Space keydown/keyup listener (`!e.repeat`, editable-element guard, `preventDefault`), mounted only when enabled+supported; tests <!-- R15 -->
- [x] T017 Register the `Voice: hold to talk` palette action in the terminal route's palette list (`app/frontend/src/app.tsx` AppShell action memo — toggle start/stop, omitted unless enabled+supported); tests <!-- R16 -->

### Phase 4: Integration & Polish

- [x] T018 Mount the HUD caller-side in AppShell's terminal route (`app/frontend/src/app.tsx`) — `{voiceEnabled && <VoiceHud …/>}` over the content surface, wired to the say seam, the current window's waiting state + chat pending text, and the confirm→delivery flow (R13, R17–R20 integration); extend `voice-hud.test.tsx` <!-- R13, R17, R18, R19, R20 -->
- [x] T019 Add `app/frontend/tests/e2e/voice.spec.ts` — mic chip visible/hidden gating (real `POST /api/settings` flip with snapshot/restore, the settings-dialog.spec.ts pattern), HUD confirm flow with `page.route`-stubbed `/api/voice/transcribe` and fake media devices (`test.use({ launchOptions: { args: [--use-fake-device-for-media-stream, --use-fake-ui-for-media-stream] } })`); file-header comment + Proves/Steps JSDoc on every `test()` per the constitution <!-- R13, R14, R17, R18 -->
- [x] T020 Copy the design study to `docs/wiki/voice-round-trip-studies.html` and add the Wiki-table row in `docs/specs/index.md` <!-- R21 -->

## Execution Order

- T001 blocks T003/T004 (the gate key) and T011 (the client read).
- T002 blocks T003 (transcribe invocation), T008 (install layout), T009 (presence probe).
- T004's `say` event contract blocks T012; T013 blocks T015–T018 (HUD is the shared surface); T014 blocks T018.
- T006 and T007 are independent of each other and of T002–T005; T005 is independent (posts to a fixed contract).
- T019 runs last (needs the full stack); T020 is independent, any time.

## Acceptance

### Functional Completeness

- [x] A-001 R1: `voice_enabled`/`voice_stt_model` exist in the registry with defaults `false`/`small.en`, no env forms, serialize only when non-default, and round-trip through POST/GET /api/settings (Go tests).
- [x] A-002 R2: With `voice_enabled` false, transcribe 404s with no subprocess spawn and say suppresses fan-out into the plain notify path (Go tests).
- [x] A-003 R3: Transcribe accepts a WAV body and returns `{"text": …}` through an argv-slice, 30s-bounded whisper invocation; oversize ⇒ 413; missing install ⇒ 503 with remediation; whisper failure ⇒ 502 (Go tests).
- [x] A-004 R4: The whisper initial prompt carries base vocabulary plus derived session/window/worktree names when `?server=` is given, degrading to base-only on fetch failure (Go tests).
- [x] A-005 R5: `internal/stt` resolves the state-dir layout, maps `small.en`→`ggml-small.en-q5_1.bin` and `large-v3-turbo`→`ggml-large-v3-turbo-q5_0.bin`, and reports presence without erroring when absent (Go tests).
- [x] A-006 R6: `rk voice install` places a verified binary + model under the state dir, fails closed on digest mismatch and archive-escape entries, and is never triggered implicitly (Go tests).
- [x] A-007 R7: `rk doctor` prints a `whisper` row with presence/version/model and the `rk voice install` remediation note when absent (Go tests).
- [x] A-008 R8: `rk say` exits 0 with no output on unreachable daemon/timeout/non-2xx, and derives server+window from the caller's tmux context when present (Go tests, `env -u TMUX -u TMUX_PANE`).
- [x] A-009 R9: Enabled+connected broadcasts exactly one `say` event with the sanitized text; enabled+no-dashboard pushes with the `/{server}/{N}` deep link; disabled pushes plain; empty/all-control text 400s (Go tests).
- [x] A-010 R10: A valid in-window `pane` retargets injection; an out-of-window or malformed pane 400s; an absent pane is byte-identical to prior behavior (Go tests).
- [x] A-011 R11: The registry admits `voice-shell-command` window-scoped only; its render carries @N/%N/cwd/git root, the fenced utterance, the `--no-enter` actuation, `rk say`, ask-don't-guess, and bounds; busy operator stays the structured 409 (Go tests).
- [x] A-012 R12: `isMicSupported` is false off secure contexts; the capture controller yields a well-formed 16kHz mono WAV from stubbed browser APIs (Vitest).
- [x] A-013 R13: With `voice_enabled` false, no voice component/listener/palette entry mounts anywhere (Vitest + e2e).
- [x] A-014 R14: The mic chip renders only when enabled+supported and press-and-hold drives capture start/stop (Vitest).
- [x] A-015 R15: ⌥Space keydown/keyup starts/stops capture with repeat and editable-element guards (Vitest).
- [x] A-016 R16: `Voice: hold to talk` appears in the palette only when enabled+supported and toggles capture (Vitest).
- [x] A-017 R17: The confirm card auto-sends after ~3s, tap pauses for inline edit, cancel discards; every tmux-bound send passes through the gate (Vitest).
- [x] A-018 R18: Agent windows deliver via window send `submit`+`pane`; shell windows via `voice-shell-command`; a busy 409 speaks "operator's busy" and shows a card (Vitest).
- [x] A-019 R19: A `say` event renders the reply card and speaks the text, canceling any in-flight utterance; nothing persists (Vitest).
- [x] A-020 R20: A `waiting` rollup renders the amber question card; capture auto-starts only with granted mic permission, else tap-to-arm (Vitest).
- [x] A-021 R21: `docs/wiki/voice-round-trip-studies.html` exists (content-identical copy) and `docs/specs/index.md`'s Wiki table links it.

### Behavioral Correctness

- [x] A-022 R10: Existing window-send callers (no `pane` field) behave byte-identically; existing compose-strip send modes unchanged (Go + Vitest regression).
- [x] A-023 R11: Existing operator templates and both operator routes behave unchanged (registry-additive only; existing operator tests stay green).

### Scenario Coverage

- [x] A-024 R13/R14/R17/R18: The e2e spec passes: mic gating by real settings flip, and the stubbed-transcribe confirm→deliver flow (Playwright via `just test-e2e`/`just pw`).
- [x] A-025 R8/R9: The full say round trip is covered: CLI fail-silent, endpoint fan-out, and both degradation branches (Go tests).

### Edge Cases & Error Handling

- [x] A-026 R3: Oversize body 413s before any subprocess; missing install 503s with remediation; whisper timeout maps to 502 and leaves no temp files (Go tests).
- [x] A-027 R12/R13/R14: Plaintext (non-secure) origins hide every mic affordance without errors while the return leg (say cards/TTS/push) still works (Vitest + e2e).
- [x] A-028 R20: Without mic permission, the question card never fires a gesture-less `getUserMedia` (Vitest).
- [x] A-029 R18: An operator 409 produces exactly one card + one spoken line — no queue, no retry, no duplicate speak (Vitest).

### Code Quality

- [x] A-030: Every subprocess call uses `exec.CommandContext` with argv slices and explicit timeouts; no shell strings anywhere (whisper, tmux, downloads).
- [x] A-031: All tmux interaction goes through `internal/tmux/` wrappers; no inline tmux command construction.
- [x] A-032: Frontend uses type narrowing over `as` casts for the new event/payload types.
- [x] A-033: No client polling added — say rides the existing `/ws/state` socket; settings read once at mount.
- [x] A-034: Mutations are POST-only; the only new routes are `/api/voice/transcribe` and `/api/say` (plus the additive `pane`/`text` body fields on existing routes).
- [x] A-035: No god functions; new code reuses the inject engine, operator registry, settings registry, `preRendered` fan-out, and the `rk notify` CLI shape instead of duplicating them.
- [x] A-036: No magic strings/numbers — named constants for event types, template id, size cap, timeouts, model tags.
- [x] A-037: New behavior carries Go `*_test.go`, colocated Vitest, and Playwright e2e with STT stubbed; every e2e `test()` carries Proves/Steps JSDoc and the spec file a header comment.
- [x] A-038 Pattern consistency: New code follows naming and structural patterns of surrounding code.
- [x] A-039 No unnecessary duplication: Existing utilities reused where applicable.
- [x] A-040: No provenance/narration comments (no R#/T###/A-###/change-id references) in source or tests.

### Security

- [x] A-041 R6: Archive extraction rejects `..`/absolute paths and symlink escapes (containment tests with hostile archives).
- [x] A-042 R9/R11: Say text is sanitized server-side; the operator template caps and fence-delimits utterance text; raw STT never reaches tmux without the confirm gate.

## Notes

- Check items as you review: `- [x]`
- All acceptance items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] A-NNN **N/A**: {reason}`

## Deletion Candidates

- None — this change adds new functionality without making existing code redundant. (The one replaced symbol, `resolveWindowActivePane` in `api/send.go`, was already removed in the same diff; the archive-containment duplication flagged in review is a consolidation opportunity for two LIVE implementations, not a dead-code candidate.)

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Registry keys are `voice_enabled`/`voice_stt_model` (snake_case), not the intake's dotted shorthand | Every existing registry key is snake_case (`auto_name`, `log_level`); the registry parser is line-based with no nesting — the config deterministically answers this | S:85 R:90 A:95 D:95 |
| 2 | Confident | Browser re-encodes to 16kHz mono WAV before upload; no server-side transcode | whisper.cpp consumes WAV; avoids an ffmpeg daemon dependency; decodeAudioData covers the MediaRecorder outputs of target browsers | S:70 R:75 A:80 D:75 |
| 3 | Confident | Model tag maps to `ggml-<tag>-q5_1.bin` (q5_0 for `large-v3-turbo`) | The intake commits to quantized `small.en` by default; q5_1 is whisper.cpp's standard quant for non-turbo models, turbo ships q5_0 | S:75 R:70 A:65 D:65 |
| 4 | Confident | Whisper installs under `$XDG_STATE_HOME/run-kit/whisper/` (bin/ + models/), not `~/.rk` | Intake says "the state dir"; Constitution II scopes disk carve-outs there; code-server's `~/.rk` home is the older precedent, not the rule | S:80 R:75 A:70 D:65 |
| 5 | Certain | ⌥Space is a bespoke keydown/keyup hook outside the keybinding registry | Alt is excluded from every tier by deliberate design and no keyup handling exists anywhere; registry changes would redesign two invariants for one chord | S:85 R:70 A:90 D:90 |
| 6 | Certain | The palette entry toggles capture (select = start/stop), it cannot literally hold | Palette actions are fire-on-select closures; hold semantics have no representation in the palette contract; keyboard-first parity is still satisfied | S:85 R:85 A:90 D:85 |
| 7 | Confident | Pane-context delivery adds an optional `pane` field to the existing window-send route rather than a voice-specific route | The route already owns active-pane resolution + all send modes; an optional validated field is additive and byte-identical when absent; a third route duplicates the engine wiring | S:70 R:75 A:80 D:70 |
| 8 | Confident | Agent-vs-shell routing is decided client-side on `chatSessionRef` presence | The frontend already carries that fact per window; it is the same predicate family as the operator affordance gating | S:70 R:75 A:75 D:70 |
| 9 | Confident | `rk say` derives server/window from the caller's `$TMUX`/`$TMUX_PANE` (one `display-message` call) for the push deep link | The intake's degradation opens the PWA on the operator window; the CLI's own tmux context is the only derivation source, and rk already resolves servers this way (`muxServer`) | S:75 R:80 A:70 D:65 |
| 10 | Confident | Voice-disabled `/api/say` degrades to plain notify instead of a silent drop | The intake's parenthetical offers both; degradation keeps replies audible-as-push with zero new surface and keeps `rk say` flag-unaware | S:75 R:85 A:80 D:70 |
| 11 | Confident | Question-card text comes from the chat stream's pending state when subscribed, else a generic line | The `waiting` rollup carries no question text; pending text reaches the frontend only via the chat subscription today — widening the sessions payload is out of scope | S:65 R:75 A:70 D:65 |
| 12 | Certain | Barge-in auto-starts capture only when mic permission is already granted | Browsers forbid a gesture-less first `getUserMedia`; anything else cannot work | S:90 R:85 A:95 D:90 |
| 13 | Confident | Hidden tabs still receive say events (card queued, speak attempted); the push degradation covers no-dashboard only | Server-side "tab hidden" detection does not exist and phase 1 adds no presence channel; the intake's parenthetical is best-effort | S:65 R:80 A:70 D:60 |
| 14 | Certain | Whisper invocation is a per-request subprocess with a 30s timeout | Constitution I/Process Execution: exec.CommandContext with timeouts; 30s matches the build-operations band and short-utterance latency | S:85 R:90 A:90 D:85 |
| 15 | Confident | `voice_enabled` is read once per app-shell mount; flips apply on reload | No live settings feed exists on the frontend; adding one for this flag is disproportionate (the auto_name live seam is backend-only) | S:70 R:80 A:75 D:70 |

15 assumptions (6 certain, 9 confident, 0 tentative).

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useReducer,
  useRef,
  useState,
  type Ref,
} from "react";
import { createVoiceCapture, isMicSupported, type VoiceCapture } from "@/lib/voice-capture";
import { transcribeVoice } from "@/api/client";
import type { SayEvent } from "@/lib/state-socket";
import {
  CONFIRM_COUNTDOWN_SECONDS,
  CONFIRM_TICK_MS,
  DONE_DISMISS_MS,
  ERROR_DISMISS_MS,
  INITIAL_PIPELINE,
  REPLY_DISMISS_MS,
  hudPipelineReducer,
} from "@/lib/voice-hud-state";

/** Spoken + card text for the operator-busy branch (the shell-window 409). */
export const OPERATOR_BUSY_TEXT = "operator's busy — try again in a moment";

/** The question card's fallback body when no pending question text is known. */
const GENERIC_QUESTION_TEXT = "The operator needs an answer";

/** "granted" | "denied" | "prompt", or "unknown" when the Permissions API is
 *  unavailable (older engines) — barge-in auto-start only ever fires on an
 *  explicit "granted", so unknown degrades to the tap-to-arm affordance and
 *  never a gesture-less getUserMedia. */
export type MicPermission = PermissionState | "unknown";

/** The imperative seam the mount site uses to drive the HUD (hold triggers,
 *  say events, the busy card). */
export type VoiceHudHandle = {
  startCapture(): void;
  stopCapture(): void;
  cancelCapture(): void;
  toggleCapture(): void;
  isRecording(): boolean;
  say(event: SayEvent): void;
  announceBusy(): void;
};

export type VoiceHudProps = {
  server: string;
  /** The delivery callback — the confirm card's countdown completion or
   *  edited Send are its ONLY call sites. May return a promise; a rejection
   *  lands the card in the error state (the caller toasts the message). */
  onConfirm: (text: string) => void | Promise<void>;
  /** Capture controller; defaults to a lazily created real one. */
  capture?: VoiceCapture;
  /** Transcription seam; defaults to the transcribe endpoint. */
  transcribe?: (wav: Blob) => Promise<{ text: string }>;
  /** Speech seam; defaults to speechSynthesis (cancel-then-speak is the
   *  caller's contract via `cancelSpeech`). */
  speak?: (text: string) => void;
  cancelSpeech?: () => void;
  queryMicPermission?: () => Promise<MicPermission>;
  /** Whether capture is even possible here (secure context + mediaDevices);
   *  gates the question card's mic affordance and barge-in — on plaintext
   *  origins the card renders without a mic control and never attempts
   *  capture. Defaults to the real support probe. */
  micSupported?: boolean;
  /** Fired when the capture phase changes so callers can mirror the recording
   *  state (the compose strip's mic chip) instead of assuming a start call
   *  succeeded. */
  onRecordingChange?: (recording: boolean) => void;
  /** The hosting window's waiting rollup — drives the question card. */
  waiting?: boolean;
  questionText?: string;
  ref?: Ref<VoiceHudHandle>;
};

function defaultSpeak(text: string): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  }
}

function defaultCancelSpeech(): void {
  if (typeof window !== "undefined" && "speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
}

async function defaultQueryMicPermission(): Promise<MicPermission> {
  if (
    typeof navigator === "undefined" ||
    !("permissions" in navigator) ||
    typeof navigator.permissions?.query !== "function"
  ) {
    return "unknown";
  }
  try {
    const status = await navigator.permissions.query({ name: "microphone" });
    return status.state;
  } catch {
    return "unknown";
  }
}

/** The live-state wave bars from the study's who-header; motion lives in the
 *  rk-voice-wave CSS and is zeroed under prefers-reduced-motion. */
function VoiceWave({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={`rk-voice-wave ${className ?? ""}`}>
      <i />
      <i />
      <i />
      <i />
      <i />
    </span>
  );
}

const CARD_CLASS =
  "pointer-events-auto rounded-md border border-border border-l-[3px] bg-bg-card rk-popup-elev px-3 py-2";
const WHO_CLASS =
  "mb-1 flex items-center gap-2 text-[10px] uppercase tracking-widest text-text-secondary";
const CHIP_CLASS =
  "rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[10px] leading-none text-text-secondary coarse:min-h-[36px] coarse:inline-flex coarse:items-center";
const CHIP_BUTTON_CLASS = `${CHIP_CLASS} rk-glint transition-colors hover:border-text-secondary`;
const META_CLASS = "mt-1.5 flex flex-wrap items-center gap-1.5";

/**
 * The voice HUD: an ephemeral card stack over the terminal content surface.
 * Three card families — the cyan confirm pipeline (your voice, behind the
 * auto-send gate), the green operator reply (a say event, spoken aloud), and
 * the amber question card (the waiting rollup, with mic barge-in). Every card
 * auto-dismisses; nothing is stored — the pane is the durable record.
 */
export function VoiceHud({
  server,
  onConfirm,
  capture,
  transcribe,
  speak,
  cancelSpeech,
  queryMicPermission,
  micSupported,
  onRecordingChange,
  waiting = false,
  questionText,
  ref,
}: VoiceHudProps) {
  const micUsable = micSupported ?? isMicSupported();
  // Injectable deps ride a ref so the imperative callbacks stay stable.
  const depsRef = useRef({
    capture,
    transcribe,
    speak,
    cancelSpeech,
    queryMicPermission,
    onConfirm,
  });
  depsRef.current = { capture, transcribe, speak, cancelSpeech, queryMicPermission, onConfirm };

  const defaultCaptureRef = useRef<VoiceCapture | null>(null);
  const getCapture = useCallback((): VoiceCapture => {
    const injected = depsRef.current.capture;
    if (injected) return injected;
    defaultCaptureRef.current ??= createVoiceCapture();
    return defaultCaptureRef.current;
  }, []);

  const [pipeline, dispatch] = useReducer(hudPipelineReducer, INITIAL_PIPELINE);
  const phaseRef = useRef(pipeline.phase);
  phaseRef.current = pipeline.phase;

  const [reply, setReply] = useState<{ text: string } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(CONFIRM_COUNTDOWN_SECONDS);

  const startCapture = useCallback(() => {
    if (phaseRef.current !== "idle") return;
    dispatch({ type: "capture-started" });
    void getCapture()
      .start()
      .catch(() => dispatch({ type: "capture-start-failed" }));
  }, [getCapture]);

  const stopCapture = useCallback(() => {
    if (phaseRef.current !== "recording") return;
    dispatch({ type: "capture-stopped" });
    const doTranscribe =
      depsRef.current.transcribe ??
      ((wav: Blob) => transcribeVoice(server, wav));
    void (async () => {
      const wav = await getCapture().stop();
      // Stale continuations (a stop resolving after a cancel) are no-ops —
      // the reducer gates these actions to the transcribing phase.
      if (!wav) {
        dispatch({ type: "capture-abandoned" });
        return;
      }
      try {
        const { text } = await doTranscribe(wav);
        const trimmed = text.trim();
        if (!trimmed) {
          dispatch({ type: "capture-abandoned" });
          return;
        }
        dispatch({ type: "transcript-settled", text: trimmed });
      } catch {
        dispatch({ type: "transcribe-failed" });
      }
    })();
  }, [getCapture, server]);

  const cancelCapture = useCallback(() => {
    if (phaseRef.current !== "recording" && phaseRef.current !== "transcribing") return;
    getCapture().cancel();
    dispatch({ type: "capture-abandoned" });
  }, [getCapture]);

  // The confirm gate: fires the delivery callback from the countdown
  // completion or the edited Send — and from NOWHERE else.
  const fireConfirm = useCallback((text: string) => {
    dispatch({ type: "confirm" });
    try {
      const result = depsRef.current.onConfirm(text);
      if (result instanceof Promise) {
        result.then(
          () => dispatch({ type: "confirm-settled" }),
          () => dispatch({ type: "confirm-failed" }),
        );
      } else {
        dispatch({ type: "confirm-settled" });
      }
    } catch {
      dispatch({ type: "confirm-failed" });
    }
  }, []);

  const say = useCallback((event: SayEvent) => {
    // A new reply supersedes an in-flight one — cancel first, then speak.
    (depsRef.current.cancelSpeech ?? defaultCancelSpeech)();
    (depsRef.current.speak ?? defaultSpeak)(event.text);
    setReply({ text: event.text });
  }, []);

  const announceBusy = useCallback(() => {
    say({ text: OPERATOR_BUSY_TEXT, ts: new Date().toISOString() });
  }, [say]);

  useImperativeHandle(
    ref,
    (): VoiceHudHandle => ({
      startCapture,
      stopCapture,
      cancelCapture,
      toggleCapture: () => {
        if (phaseRef.current === "recording") stopCapture();
        else startCapture();
      },
      isRecording: () => phaseRef.current === "recording",
      say,
      announceBusy,
    }),
    [startCapture, stopCapture, cancelCapture, say, announceBusy],
  );

  // The auto-send countdown: ticks while confirming; reaching zero fires the
  // confirm. Tapping into edit mode leaves the confirming phase, which both
  // clears the interval and disarms the fire condition.
  useEffect(() => {
    if (pipeline.phase !== "confirming") return;
    setSecondsLeft(CONFIRM_COUNTDOWN_SECONDS);
    const interval = setInterval(() => setSecondsLeft((s) => s - 1), CONFIRM_TICK_MS);
    return () => clearInterval(interval);
  }, [pipeline.phase]);

  useEffect(() => {
    if (pipeline.phase === "confirming" && secondsLeft <= 0) {
      fireConfirm(pipeline.transcript);
    }
  }, [pipeline.phase, secondsLeft, pipeline.transcript, fireConfirm]);

  // Done/error flash, then back to idle.
  useEffect(() => {
    if (pipeline.phase !== "done" && pipeline.phase !== "error") return;
    const ms = pipeline.phase === "done" ? DONE_DISMISS_MS : ERROR_DISMISS_MS;
    const timeout = setTimeout(() => dispatch({ type: "dismiss" }), ms);
    return () => clearTimeout(timeout);
  }, [pipeline.phase]);

  // Reply cards auto-dismiss.
  useEffect(() => {
    if (!reply) return;
    const timeout = setTimeout(() => setReply(null), REPLY_DISMISS_MS);
    return () => clearTimeout(timeout);
  }, [reply]);

  // Mic barge-in: on the idle→waiting transition, auto-start capture ONLY
  // when the mic permission is already granted; otherwise the card's mic
  // affordance starts capture on tap (a first getUserMedia needs a gesture).
  // Arms once per waiting episode. On a mic-less origin (no secure context)
  // there is nothing to arm — the card renders without a mic affordance.
  const bargeArmedRef = useRef(false);
  useEffect(() => {
    if (!waiting || !micUsable) {
      bargeArmedRef.current = false;
      return;
    }
    if (bargeArmedRef.current) return;
    bargeArmedRef.current = true;
    let live = true;
    const query = depsRef.current.queryMicPermission ?? defaultQueryMicPermission;
    void query().then((state) => {
      if (live && state === "granted") startCapture();
    });
    return () => {
      live = false;
    };
  }, [waiting, micUsable, startCapture]);

  // Mirror the capture phase to the caller (the compose strip's mic chip).
  useEffect(() => {
    onRecordingChange?.(pipeline.phase === "recording");
  }, [pipeline.phase, onRecordingChange]);

  // Unmount tears down speech and any in-flight capture.
  useEffect(() => {
    return () => {
      (depsRef.current.cancelSpeech ?? defaultCancelSpeech)();
      (depsRef.current.capture ?? defaultCaptureRef.current)?.cancel();
    };
  }, []);

  const showQuestion = waiting && pipeline.phase === "idle";

  return (
    <div
      data-testid="voice-hud"
      className="pointer-events-none absolute right-3.5 bottom-3 flex w-[min(340px,86%)] flex-col gap-2 font-mono text-xs text-text-primary"
    >
      {reply && (
        <div data-testid="voice-hud-reply" className={`${CARD_CLASS} border-l-accent-green`}>
          <div className={WHO_CLASS}>
            <span className="text-accent-green">operator</span>
            <span className="flex-1" />
            <VoiceWave className="text-accent-green" />
          </div>
          <div className="leading-relaxed">{reply.text}</div>
          <div className={META_CLASS}>
            <span className={`${CHIP_CLASS} text-accent-green`}>rk say</span>
          </div>
        </div>
      )}

      {showQuestion && (
        <div data-testid="voice-hud-question" className={`${CARD_CLASS} border-l-signal-yellow`}>
          <div className={WHO_CLASS}>
            <span className="text-signal-yellow">operator asks</span>
          </div>
          <div className="leading-relaxed">{questionText ?? GENERIC_QUESTION_TEXT}</div>
          {micUsable && (
            <div className={META_CLASS}>
              <button
                type="button"
                data-testid="voice-hud-question-mic"
                aria-label="Answer by voice"
                onClick={startCapture}
                className={`${CHIP_BUTTON_CLASS} text-signal-yellow`}
              >
                <span aria-hidden="true">🎙</span> answer by voice
              </button>
            </div>
          )}
        </div>
      )}

      {pipeline.phase === "recording" && (
        <div data-testid="voice-hud-recording" className={`${CARD_CLASS} border-l-accent`}>
          <div className={WHO_CLASS}>
            <span className="text-accent">you · voice</span>
            <span className="flex-1" />
            <VoiceWave className="text-accent" />
          </div>
          <div className="leading-relaxed">Listening…</div>
          <div className={META_CLASS}>
            <span className="text-text-secondary">release to send</span>
            <button
              type="button"
              data-testid="voice-hud-cancel"
              aria-label="Cancel recording"
              onClick={cancelCapture}
              className={CHIP_BUTTON_CLASS}
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {pipeline.phase === "transcribing" && (
        <div data-testid="voice-hud-transcribing" className={`${CARD_CLASS} border-l-accent`}>
          <div className={WHO_CLASS}>
            <span className="text-accent">you · voice</span>
          </div>
          <div className="leading-relaxed">Transcribing…</div>
        </div>
      )}

      {pipeline.phase === "confirming" && (
        <div data-testid="voice-hud-confirm" className={`${CARD_CLASS} border-l-accent`}>
          <div className={WHO_CLASS}>
            <span className="text-accent">you · voice</span>
          </div>
          <button
            type="button"
            data-testid="voice-hud-transcript"
            aria-label="Edit transcript"
            onClick={() => dispatch({ type: "edit" })}
            className="block w-full text-left leading-relaxed"
          >
            {pipeline.transcript}
          </button>
          <div className={META_CLASS}>
            <span data-testid="voice-hud-countdown" className={CHIP_CLASS}>
              sending in {secondsLeft} s
            </span>
            <button
              type="button"
              data-testid="voice-hud-cancel"
              aria-label="Discard utterance"
              onClick={() => dispatch({ type: "cancel" })}
              className={CHIP_BUTTON_CLASS}
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {pipeline.phase === "editing" && (
        <div data-testid="voice-hud-editing" className={`${CARD_CLASS} border-l-accent`}>
          <div className={WHO_CLASS}>
            <span className="text-accent">you · voice</span>
          </div>
          <textarea
            data-testid="voice-hud-edit"
            aria-label="Edit transcript"
            autoFocus
            rows={2}
            value={pipeline.editedText}
            onChange={(e) => dispatch({ type: "edit-change", text: e.target.value })}
            className="w-full resize-none rounded border border-border bg-bg-primary px-2 py-1.5 font-mono text-xs text-text-primary outline-none focus:border-accent"
          />
          <div className={META_CLASS}>
            <button
              type="button"
              data-testid="voice-hud-send"
              disabled={pipeline.editedText.trim().length === 0}
              onClick={() => fireConfirm(pipeline.editedText.trim())}
              className={`${CHIP_BUTTON_CLASS} text-accent disabled:opacity-40`}
            >
              send
            </button>
            <button
              type="button"
              data-testid="voice-hud-cancel"
              aria-label="Discard utterance"
              onClick={() => dispatch({ type: "cancel" })}
              className={CHIP_BUTTON_CLASS}
            >
              cancel
            </button>
          </div>
        </div>
      )}

      {pipeline.phase === "sending" && (
        <div data-testid="voice-hud-sending" className={`${CARD_CLASS} border-l-accent`}>
          <div className={WHO_CLASS}>
            <span className="text-accent">you · voice</span>
          </div>
          <div className="leading-relaxed">{pipeline.transcript}</div>
          <div className={META_CLASS}>
            <span className={CHIP_CLASS}>sending…</span>
          </div>
        </div>
      )}

      {pipeline.phase === "done" && (
        <div data-testid="voice-hud-done" className={`${CARD_CLASS} border-l-accent`}>
          <div className={WHO_CLASS}>
            <span className="text-accent">you · voice</span>
          </div>
          <div className="leading-relaxed">{pipeline.transcript}</div>
          <div className={META_CLASS}>
            <span className={`${CHIP_CLASS} text-accent-green`}>sent</span>
          </div>
        </div>
      )}

      {pipeline.phase === "error" && (
        <div data-testid="voice-hud-error" className={`${CARD_CLASS} border-l-signal-red`}>
          <div className={WHO_CLASS}>
            <span className="text-signal-red">you · voice</span>
          </div>
          <div className="leading-relaxed">Voice failed — nothing was sent</div>
        </div>
      )}
    </div>
  );
}

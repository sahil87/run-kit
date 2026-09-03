// The voice HUD's confirm-pipeline state machine, pure for testability.
//
// The load-bearing invariant lives here: the ONLY actions that reach
// "sending" (the phase whose entry fires the delivery callback) are
// `confirm` from "confirming" (countdown completion) and `confirm` from
// "editing" (edited Send). Every other transition is display state. Invalid
// transitions are no-ops, so a stale async continuation (a transcribe that
// resolves after a cancel) can never resurrect the pipeline.

export type HudPhase =
  | "idle"
  | "recording"
  | "transcribing"
  | "confirming"
  | "editing"
  | "sending"
  | "done"
  | "error";

/** The auto-send countdown on the confirm card. */
export const CONFIRM_COUNTDOWN_SECONDS = 3;
export const CONFIRM_TICK_MS = 1000;
/** Reply cards auto-dismiss; nothing persists (the pane is the record). */
export const REPLY_DISMISS_MS = 6000;
/** Done/error cards flash briefly, then the HUD returns to idle. */
export const DONE_DISMISS_MS = 1500;
export const ERROR_DISMISS_MS = 5000;

export type HudPipeline = {
  phase: HudPhase;
  /** The settled transcript under confirmation. */
  transcript: string;
  /** The editable copy the tap-to-edit Send delivers. */
  editedText: string;
};

export const INITIAL_PIPELINE: HudPipeline = {
  phase: "idle",
  transcript: "",
  editedText: "",
};

export type HudAction =
  | { type: "capture-started" }
  | { type: "capture-start-failed" }
  | { type: "capture-stopped" }
  | { type: "capture-abandoned" }
  | { type: "transcript-settled"; text: string }
  | { type: "transcribe-failed" }
  | { type: "edit" }
  | { type: "edit-change"; text: string }
  | { type: "confirm" }
  | { type: "confirm-settled" }
  | { type: "confirm-failed" }
  | { type: "cancel" }
  | { type: "dismiss" };

export function hudPipelineReducer(state: HudPipeline, action: HudAction): HudPipeline {
  switch (action.type) {
    case "capture-started":
      return state.phase === "idle" ? { ...INITIAL_PIPELINE, phase: "recording" } : state;
    case "capture-start-failed":
      return state.phase === "recording" ? { ...state, phase: "error" } : state;
    case "capture-stopped":
      return state.phase === "recording" ? { ...state, phase: "transcribing" } : state;
    case "capture-abandoned":
      return state.phase === "recording" || state.phase === "transcribing"
        ? INITIAL_PIPELINE
        : state;
    case "transcript-settled":
      return state.phase === "transcribing"
        ? { phase: "confirming", transcript: action.text, editedText: action.text }
        : state;
    case "transcribe-failed":
      return state.phase === "transcribing" ? { ...state, phase: "error" } : state;
    case "edit":
      return state.phase === "confirming" ? { ...state, phase: "editing" } : state;
    case "edit-change":
      return state.phase === "editing" ? { ...state, editedText: action.text } : state;
    case "confirm":
      return state.phase === "confirming" || state.phase === "editing"
        ? { ...state, phase: "sending" }
        : state;
    case "confirm-settled":
      return state.phase === "sending" ? { ...state, phase: "done" } : state;
    case "confirm-failed":
      return state.phase === "sending" ? { ...state, phase: "error" } : state;
    case "cancel":
      return state.phase === "confirming" || state.phase === "editing"
        ? INITIAL_PIPELINE
        : state;
    case "dismiss":
      return state.phase === "done" || state.phase === "error" ? INITIAL_PIPELINE : state;
  }
}

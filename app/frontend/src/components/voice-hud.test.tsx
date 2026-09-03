import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import { createRef } from "react";
import { VoiceHud, type VoiceHudHandle, type MicPermission, OPERATOR_BUSY_TEXT } from "./voice-hud";
import {
  CONFIRM_COUNTDOWN_SECONDS,
  CONFIRM_TICK_MS,
  DONE_DISMISS_MS,
  ERROR_DISMISS_MS,
  REPLY_DISMISS_MS,
} from "@/lib/voice-hud-state";
import type { VoiceCapture } from "@/lib/voice-capture";

// The default transcribe seam hits the network; keep the module mocked even
// though every test injects its own transcribe.
vi.mock("@/api/client", async (orig) => {
  const actual = await orig<typeof import("@/api/client")>();
  return {
    ...actual,
    transcribeVoice: vi.fn(async () => ({ text: "" })),
  };
});

function makeDeps(overrides: {
  transcript?: string;
  micPermission?: MicPermission;
  onConfirm?: (text: string) => void | Promise<void>;
} = {}) {
  const capture: VoiceCapture = {
    start: vi.fn(async () => {}),
    stop: vi.fn(async () => new Blob(["wav"], { type: "audio/wav" })),
    cancel: vi.fn(),
    isRecording: vi.fn(() => false),
  };
  return {
    capture,
    transcribe: vi.fn(async () => ({ text: overrides.transcript ?? "restart the api" })),
    onConfirm: vi.fn(overrides.onConfirm ?? (() => {})),
    speak: vi.fn(),
    cancelSpeech: vi.fn(),
    queryMicPermission: vi.fn(async () => overrides.micPermission ?? ("unknown" as MicPermission)),
  };
}

type Deps = ReturnType<typeof makeDeps>;

function renderHud(
  deps: Deps,
  props: { waiting?: boolean; questionText?: string; micSupported?: boolean } = {},
) {
  const ref = createRef<VoiceHudHandle>();
  render(
    <VoiceHud
      ref={ref}
      server="rk"
      capture={deps.capture}
      transcribe={deps.transcribe}
      onConfirm={deps.onConfirm}
      speak={deps.speak}
      cancelSpeech={deps.cancelSpeech}
      queryMicPermission={deps.queryMicPermission}
      micSupported={props.micSupported ?? true}
      waiting={props.waiting ?? false}
      questionText={props.questionText}
    />,
  );
  return ref;
}

/** Start + release capture and let the transcribe microtasks settle. */
async function recordAndSettle(ref: React.RefObject<VoiceHudHandle | null>) {
  await act(async () => {
    ref.current?.startCapture();
  });
  await act(async () => {
    ref.current?.stopCapture();
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("VoiceHud — capture pipeline", () => {
  it("renders an empty stack while idle", () => {
    const deps = makeDeps();
    renderHud(deps);
    expect(screen.getByTestId("voice-hud").children).toHaveLength(0);
  });

  it("start shows the recording card; a second start is a no-op", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await act(async () => {
      ref.current?.startCapture();
    });
    expect(screen.getByTestId("voice-hud-recording")).toBeDefined();
    expect(deps.capture.start).toHaveBeenCalledTimes(1);
    await act(async () => {
      ref.current?.startCapture();
    });
    expect(deps.capture.start).toHaveBeenCalledTimes(1);
  });

  it("release settles the transcript into the confirm card with the countdown chip", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await recordAndSettle(ref);
    expect(screen.getByTestId("voice-hud-confirm")).toBeDefined();
    expect(screen.getByTestId("voice-hud-transcript").textContent).toBe("restart the api");
    expect(screen.getByTestId("voice-hud-countdown").textContent).toBe(
      `sending in ${CONFIRM_COUNTDOWN_SECONDS} s`,
    );
  });

  it("an empty transcript returns to idle with no confirm card", async () => {
    const deps = makeDeps({ transcript: "   " });
    const ref = renderHud(deps);
    await recordAndSettle(ref);
    expect(screen.getByTestId("voice-hud").children).toHaveLength(0);
    expect(deps.onConfirm).not.toHaveBeenCalled();
  });
});

describe("VoiceHud — the confirm gate", () => {
  it("the countdown completion fires onConfirm with the transcript, then auto-dismisses", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await recordAndSettle(ref);
    await advance(CONFIRM_COUNTDOWN_SECONDS * CONFIRM_TICK_MS);
    expect(deps.onConfirm).toHaveBeenCalledTimes(1);
    expect(deps.onConfirm).toHaveBeenCalledWith("restart the api");
    expect(screen.getByTestId("voice-hud-done")).toBeDefined();
    await advance(DONE_DISMISS_MS);
    expect(screen.getByTestId("voice-hud").children).toHaveLength(0);
  });

  it("nothing delivers before the countdown completes", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await recordAndSettle(ref);
    await advance(CONFIRM_COUNTDOWN_SECONDS * CONFIRM_TICK_MS - 1);
    expect(deps.onConfirm).not.toHaveBeenCalled();
  });

  it("tapping the transcript pauses the countdown and switches to editing", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await recordAndSettle(ref);
    fireEvent.click(screen.getByTestId("voice-hud-transcript"));
    expect(screen.getByTestId("voice-hud-editing")).toBeDefined();
    const textarea = screen.getByTestId("voice-hud-edit") as HTMLTextAreaElement;
    expect(textarea.value).toBe("restart the api");
    await advance(10 * CONFIRM_TICK_MS);
    expect(deps.onConfirm).not.toHaveBeenCalled();
  });

  it("the edited Send delivers the edited text", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await recordAndSettle(ref);
    fireEvent.click(screen.getByTestId("voice-hud-transcript"));
    fireEvent.change(screen.getByTestId("voice-hud-edit"), {
      target: { value: "bounce the worker" },
    });
    fireEvent.click(screen.getByTestId("voice-hud-send"));
    expect(deps.onConfirm).toHaveBeenCalledTimes(1);
    expect(deps.onConfirm).toHaveBeenCalledWith("bounce the worker");
  });

  it("cancel discards the utterance — in confirming and in editing", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await recordAndSettle(ref);
    fireEvent.click(screen.getByTestId("voice-hud-cancel"));
    expect(screen.getByTestId("voice-hud").children).toHaveLength(0);

    await recordAndSettle(ref);
    fireEvent.click(screen.getByTestId("voice-hud-transcript"));
    fireEvent.click(screen.getByTestId("voice-hud-cancel"));
    expect(screen.getByTestId("voice-hud").children).toHaveLength(0);

    await advance(30 * CONFIRM_TICK_MS);
    expect(deps.onConfirm).not.toHaveBeenCalled();
  });

  it("a rejecting onConfirm lands in the error card, which auto-dismisses", async () => {
    const deps = makeDeps({ onConfirm: () => Promise.reject(new Error("boom")) });
    const ref = renderHud(deps);
    await recordAndSettle(ref);
    await advance(CONFIRM_COUNTDOWN_SECONDS * CONFIRM_TICK_MS);
    await act(async () => {});
    expect(screen.getByTestId("voice-hud-error")).toBeDefined();
    await advance(ERROR_DISMISS_MS);
    expect(screen.getByTestId("voice-hud").children).toHaveLength(0);
  });

  it("cancel while recording aborts capture without producing audio", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await act(async () => {
      ref.current?.startCapture();
    });
    fireEvent.click(screen.getByTestId("voice-hud-cancel"));
    expect(deps.capture.cancel).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("voice-hud").children).toHaveLength(0);
    await advance(30 * CONFIRM_TICK_MS);
    expect(deps.onConfirm).not.toHaveBeenCalled();
  });
});

describe("VoiceHud — reply card", () => {
  it("a say event renders the green card and speaks, canceling any in-flight utterance first", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await act(async () => {
      ref.current?.say({ text: "deploy finished", ts: "t" });
    });
    expect(screen.getByTestId("voice-hud-reply").textContent).toContain("deploy finished");
    expect(deps.cancelSpeech).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledTimes(1);
    expect(deps.speak).toHaveBeenCalledWith("deploy finished");
    expect(deps.cancelSpeech.mock.invocationCallOrder[0]).toBeLessThan(
      deps.speak.mock.invocationCallOrder[0],
    );
  });

  it("a second say cancels the first and replaces the card", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await act(async () => {
      ref.current?.say({ text: "first", ts: "t" });
    });
    await act(async () => {
      ref.current?.say({ text: "second", ts: "t" });
    });
    expect(deps.cancelSpeech).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("voice-hud-reply").textContent).toContain("second");
    expect(screen.getByTestId("voice-hud-reply").textContent).not.toContain("first");
  });

  it("the reply card auto-dismisses and leaves nothing behind", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await act(async () => {
      ref.current?.say({ text: "hi", ts: "t" });
    });
    await advance(REPLY_DISMISS_MS);
    expect(screen.getByTestId("voice-hud").children).toHaveLength(0);
  });

  it("announceBusy shows a card and speaks the busy line", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await act(async () => {
      ref.current?.announceBusy();
    });
    expect(screen.getByTestId("voice-hud-reply").textContent).toContain(OPERATOR_BUSY_TEXT);
    expect(deps.speak).toHaveBeenCalledWith(OPERATOR_BUSY_TEXT);
  });
});

describe("VoiceHud — question card", () => {
  it("waiting renders the amber card with the question text and an armed mic chip", () => {
    const deps = makeDeps();
    renderHud(deps, { waiting: true, questionText: "Discard the stale result file?" });
    expect(screen.getByTestId("voice-hud-question").textContent).toContain(
      "Discard the stale result file?",
    );
    expect(screen.getByTestId("voice-hud-question-mic")).toBeDefined();
  });

  it("falls back to a generic line without question text", () => {
    const deps = makeDeps();
    renderHud(deps, { waiting: true });
    expect(screen.getByTestId("voice-hud-question").textContent).toContain(
      "The operator needs an answer",
    );
  });

  it("granted mic permission auto-starts capture (barge-in) — no tap needed", async () => {
    const deps = makeDeps({ micPermission: "granted" });
    renderHud(deps, { waiting: true });
    await act(async () => {});
    expect(deps.capture.start).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("voice-hud-recording")).toBeDefined();
  });

  it("without granted permission nothing auto-starts; the mic chip starts on tap", async () => {
    const deps = makeDeps({ micPermission: "prompt" });
    renderHud(deps, { waiting: true });
    await act(async () => {});
    expect(deps.capture.start).not.toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId("voice-hud-question-mic"));
    });
    expect(deps.capture.start).toHaveBeenCalledTimes(1);
  });

  it("auto-arms once per waiting episode, not on re-render", async () => {
    const deps = makeDeps({ micPermission: "granted" });
    renderHud(deps, { waiting: true });
    await act(async () => {});
    expect(deps.capture.start).toHaveBeenCalledTimes(1);
  });

  it("mic-less origins render no mic affordance and never attempt capture", async () => {
    const deps = makeDeps({ micPermission: "granted" });
    renderHud(deps, { waiting: true, micSupported: false });
    await act(async () => {});
    expect(screen.getByTestId("voice-hud-question")).toBeDefined();
    expect(screen.queryByTestId("voice-hud-question-mic")).toBeNull();
    expect(deps.capture.start).not.toHaveBeenCalled();
  });
});

describe("VoiceHud — teardown", () => {
  it("unmount cancels speech and any in-flight capture", async () => {
    const deps = makeDeps();
    const ref = renderHud(deps);
    await act(async () => {
      ref.current?.startCapture();
    });
    cleanup();
    expect(deps.cancelSpeech).toHaveBeenCalledTimes(1);
    expect(deps.capture.cancel).toHaveBeenCalledTimes(1);
  });
});

import { describe, it, expect } from "vitest";
import {
  INITIAL_PIPELINE,
  hudPipelineReducer,
  type HudPipeline,
} from "./voice-hud-state";

function run(actions: Parameters<typeof hudPipelineReducer>[1][], from = INITIAL_PIPELINE) {
  return actions.reduce(hudPipelineReducer, from);
}

const confirming: HudPipeline = { phase: "confirming", transcript: "t", editedText: "t" };

describe("hudPipelineReducer", () => {
  it("walks the happy path idle → recording → transcribing → confirming → sending → done → idle", () => {
    expect(run([{ type: "capture-started" }]).phase).toBe("recording");
    expect(run([{ type: "capture-started" }, { type: "capture-stopped" }]).phase).toBe(
      "transcribing",
    );
    const settled = run([
      { type: "capture-started" },
      { type: "capture-stopped" },
      { type: "transcript-settled", text: "restart the api" },
    ]);
    expect(settled).toEqual({
      phase: "confirming",
      transcript: "restart the api",
      editedText: "restart the api",
    });
    expect(run([{ type: "confirm" }], settled).phase).toBe("sending");
    expect(run([{ type: "confirm" }, { type: "confirm-settled" }], settled).phase).toBe("done");
    expect(
      run([{ type: "confirm" }, { type: "confirm-settled" }, { type: "dismiss" }], settled).phase,
    ).toBe("idle");
  });

  it("reaches sending ONLY via confirm from confirming or editing", () => {
    // Every phase other than confirming/editing must ignore confirm.
    for (const phase of ["idle", "recording", "transcribing", "sending", "done", "error"] as const) {
      const state: HudPipeline = { phase, transcript: "t", editedText: "t" };
      expect(run([{ type: "confirm" }], state).phase).toBe(phase);
    }
    expect(run([{ type: "confirm" }], confirming).phase).toBe("sending");
    expect(run([{ type: "edit" }, { type: "confirm" }], confirming).phase).toBe("sending");
  });

  it("editing carries the edited text; cancel discards to idle from confirming and editing", () => {
    const editing = run(
      [{ type: "edit" }, { type: "edit-change", text: "bounce the worker" }],
      confirming,
    );
    expect(editing).toEqual({
      phase: "editing",
      transcript: "t",
      editedText: "bounce the worker",
    });
    expect(run([{ type: "cancel" }], confirming)).toEqual(INITIAL_PIPELINE);
    expect(run([{ type: "cancel" }], editing)).toEqual(INITIAL_PIPELINE);
  });

  it("stale async continuations are no-ops once the pipeline moved on", () => {
    // A transcript settling after the capture was abandoned (idle) is dropped.
    expect(run([{ type: "transcript-settled", text: "late" }])).toEqual(INITIAL_PIPELINE);
    // Capture start while already recording is ignored.
    const recording = run([{ type: "capture-started" }]);
    expect(run([{ type: "capture-started" }], recording)).toEqual(recording);
    // Abandonment applies to recording and transcribing only.
    expect(run([{ type: "capture-started" }, { type: "capture-abandoned" }])).toEqual(
      INITIAL_PIPELINE,
    );
    expect(run([{ type: "capture-abandoned" }], confirming)).toEqual(confirming);
  });

  it("failures land in error and dismiss back to idle", () => {
    expect(run([{ type: "capture-started" }, { type: "capture-start-failed" }]).phase).toBe(
      "error",
    );
    expect(
      run([
        { type: "capture-started" },
        { type: "capture-stopped" },
        { type: "transcribe-failed" },
      ]).phase,
    ).toBe("error");
    expect(run([{ type: "confirm" }, { type: "confirm-failed" }], confirming).phase).toBe("error");
    expect(
      run([{ type: "confirm" }, { type: "confirm-failed" }, { type: "dismiss" }], confirming),
    ).toEqual(INITIAL_PIPELINE);
  });
});

import { describe, it, expect, vi } from "vitest";
import { buildVoiceActions, VOICE_HOLD_TO_TALK_ID } from "./voice";
import type { VoiceController } from "@/lib/voice-controller";

function fakeController(): VoiceController {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
    isRecording: vi.fn(() => false),
  };
}

describe("buildVoiceActions", () => {
  it("yields no entry without a registered controller", () => {
    expect(buildVoiceActions(null)).toEqual([]);
  });

  it("yields the hold-to-talk entry with the fixed id and label", () => {
    const actions = buildVoiceActions(fakeController());
    expect(actions).toHaveLength(1);
    expect(actions[0].id).toBe(VOICE_HOLD_TO_TALK_ID);
    expect(actions[0].id).toBe("voice-hold-to-talk");
    expect(actions[0].label).toBe("Voice: hold to talk");
  });

  it("onSelect delegates to the controller's toggle", () => {
    const controller = fakeController();
    const [action] = buildVoiceActions(controller);
    action.onSelect();
    expect(controller.toggle).toHaveBeenCalledTimes(1);
  });
});

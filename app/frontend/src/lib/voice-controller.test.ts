import { describe, it, expect, vi } from "vitest";
import {
  registerVoiceController,
  subscribeVoiceController,
  voiceController,
  type VoiceController,
} from "./voice-controller";

function fakeController(): VoiceController {
  return {
    start: vi.fn(),
    stop: vi.fn(),
    toggle: vi.fn(),
    isRecording: vi.fn(() => false),
  };
}

describe("voice-controller registry", () => {
  it("is null when unregistered", () => {
    expect(voiceController()).toBeNull();
  });

  it("register resolves the controller; unregister clears it", () => {
    const impl = fakeController();
    const unregister = registerVoiceController(impl);
    expect(voiceController()).toBe(impl);
    unregister();
    expect(voiceController()).toBeNull();
  });

  it("a stale unregister does not clear a newer registration", () => {
    const first = fakeController();
    const second = fakeController();
    const unregisterFirst = registerVoiceController(first);
    registerVoiceController(second);
    unregisterFirst();
    expect(voiceController()).toBe(second);
  });

  it("notifies subscribers on register/unregister", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeVoiceController(listener);
    const unregister = registerVoiceController(fakeController());
    expect(listener).toHaveBeenCalledTimes(1);
    unregister();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    registerVoiceController(fakeController())();
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

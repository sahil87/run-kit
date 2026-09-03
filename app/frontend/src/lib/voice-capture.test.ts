import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  createVoiceCapture,
  encodeWavPcm16,
  isMicSupported,
  VOICE_SAMPLE_RATE,
  type MediaRecorderLike,
  type AudioContextLike,
} from "./voice-capture";

class FakeRecorder implements MediaRecorderLike {
  static supported: string[] = [];
  static instances: FakeRecorder[] = [];
  static autoFlushStop = true;
  ondataavailable: ((event: BlobEvent) => void) | null = null;
  onstop: ((event: Event) => void) | null = null;
  readonly options?: { mimeType?: string };
  started = false;
  constructor(
    readonly stream: MediaStream,
    options?: { mimeType?: string },
  ) {
    this.options = options;
    FakeRecorder.instances.push(this);
  }
  static isTypeSupported(mimeType: string): boolean {
    return FakeRecorder.supported.includes(mimeType);
  }
  start(): void {
    this.started = true;
  }
  stop(): void {
    if (FakeRecorder.autoFlushStop) this.flushStop();
  }
  flushStop(): void {
    this.onstop?.(new Event("stop"));
  }
  emitData(data: Blob): void {
    this.ondataavailable?.({ data } as BlobEvent);
  }
}

class FakeAudioContext implements AudioContextLike {
  static decoded: ArrayBuffer[] = [];
  static nextBuffer: AudioBuffer | null = null;
  closed = false;
  async decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer> {
    FakeAudioContext.decoded.push(data);
    const buffer = FakeAudioContext.nextBuffer;
    if (!buffer) throw new Error("no stub buffer installed");
    return buffer;
  }
  async close(): Promise<void> {
    this.closed = true;
  }
}

function fakeAudioBuffer(channels: number[][], sampleRate: number): AudioBuffer {
  return {
    numberOfChannels: channels.length,
    sampleRate,
    getChannelData: (channel: number) => new Float32Array(channels[channel] ?? []),
  } as unknown as AudioBuffer;
}

function makeStream() {
  const track = { stop: vi.fn() };
  const stream = { getTracks: () => [track] } as unknown as MediaStream;
  return { stream, track };
}

async function wavView(blob: Blob): Promise<DataView> {
  return new DataView(await blob.arrayBuffer());
}

function ascii(view: DataView, offset: number, length: number): string {
  let out = "";
  for (let i = 0; i < length; i++) out += String.fromCharCode(view.getUint8(offset + i));
  return out;
}

beforeEach(() => {
  FakeRecorder.supported = [];
  FakeRecorder.instances = [];
  FakeRecorder.autoFlushStop = true;
  FakeAudioContext.decoded = [];
  FakeAudioContext.nextBuffer = null;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("isMicSupported", () => {
  it("is false without a secure context even when mediaDevices exists", () => {
    vi.stubGlobal("isSecureContext", false);
    Object.defineProperty(window.navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });
    expect(isMicSupported()).toBe(false);
  });

  it("is false on a secure context without mediaDevices", () => {
    vi.stubGlobal("isSecureContext", true);
    vi.stubGlobal("navigator", {});
    expect(isMicSupported()).toBe(false);
  });

  it("is true on a secure context with mediaDevices", () => {
    vi.stubGlobal("isSecureContext", true);
    Object.defineProperty(window.navigator, "mediaDevices", {
      value: { getUserMedia: vi.fn() },
      configurable: true,
    });
    expect(isMicSupported()).toBe(true);
  });
});

describe("createVoiceCapture", () => {
  function setup() {
    const { stream, track } = makeStream();
    const getUserMedia = vi.fn(async () => stream);
    const capture = createVoiceCapture({
      getUserMedia,
      MediaRecorderCtor: FakeRecorder,
      AudioContextCtor: FakeAudioContext,
    });
    return { capture, getUserMedia, track };
  }

  it("start acquires the mic once and prefers opus over plain webm", async () => {
    FakeRecorder.supported = ["audio/webm;codecs=opus", "audio/webm"];
    const { capture, getUserMedia } = setup();
    await capture.start();
    await capture.start(); // no-op while recording
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    expect(FakeRecorder.instances[0].options).toEqual({ mimeType: "audio/webm;codecs=opus" });
    expect(capture.isRecording()).toBe(true);
  });

  it("falls back through the mime list and then to the browser default", async () => {
    FakeRecorder.supported = ["audio/webm"];
    const { capture } = setup();
    await capture.start();
    expect(FakeRecorder.instances[0].options).toEqual({ mimeType: "audio/webm" });

    FakeRecorder.supported = [];
    const again = setup();
    await again.capture.start();
    expect(FakeRecorder.instances[1].options).toBeUndefined();
  });

  it("stop without start resolves null", async () => {
    const { capture } = setup();
    await expect(capture.stop()).resolves.toBeNull();
  });

  it("concatenates chunks, decodes once, and emits a well-formed 16kHz mono WAV", async () => {
    FakeRecorder.supported = ["audio/webm;codecs=opus"];
    FakeAudioContext.nextBuffer = fakeAudioBuffer([[0, 1, -1, 0.5]], VOICE_SAMPLE_RATE);
    const { capture, track } = setup();
    await capture.start();
    const recorder = FakeRecorder.instances[0];
    recorder.emitData(new Blob(["ab"], { type: "audio/webm" }));
    recorder.emitData(new Blob(["cde"], { type: "audio/webm" }));

    const wav = await capture.stop();
    expect(capture.isRecording()).toBe(false);
    expect(track.stop).toHaveBeenCalledTimes(1);
    if (!wav) throw new Error("expected a WAV blob");
    expect(wav.type).toBe("audio/wav");

    // Both chunks (2 + 3 bytes) were concatenated into ONE decode input.
    expect(FakeAudioContext.decoded).toHaveLength(1);
    expect(FakeAudioContext.decoded[0].byteLength).toBe(5);

    const view = await wavView(wav);
    expect(ascii(view, 0, 4)).toBe("RIFF");
    expect(ascii(view, 8, 4)).toBe("WAVE");
    expect(ascii(view, 12, 4)).toBe("fmt ");
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(VOICE_SAMPLE_RATE);
    expect(view.getUint32(28, true)).toBe(VOICE_SAMPLE_RATE * 2);
    expect(view.getUint16(34, true)).toBe(16);
    expect(ascii(view, 36, 4)).toBe("data");
    expect(view.getUint32(40, true)).toBe(4 * 2);
    expect(view.getUint32(4, true)).toBe(36 + 4 * 2);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(50, true)).toBe(Math.round(0.5 * 0x7fff));
  });

  it("downmixes stereo and resamples to 16kHz", async () => {
    FakeAudioContext.nextBuffer = fakeAudioBuffer(
      [
        [1, 1, 1, 1],
        [-1, -1, -1, -1],
      ],
      VOICE_SAMPLE_RATE * 2,
    );
    const { capture } = setup();
    await capture.start();
    FakeRecorder.instances[0].emitData(new Blob(["x"]));
    const wav = await capture.stop();
    if (!wav) throw new Error("expected a WAV blob");
    const view = await wavView(wav);
    expect(view.getUint32(24, true)).toBe(VOICE_SAMPLE_RATE);
    // 4 stereo frames at 32kHz → 2 mono frames at 16kHz; channels average to 0.
    expect(view.getUint32(40, true)).toBe(2 * 2);
    expect(view.getInt16(44, true)).toBe(0);
    expect(view.getInt16(46, true)).toBe(0);
  });

  it("cancel drops the audio, releases the track, and leaves stop() resolving null", async () => {
    const { capture, track } = setup();
    await capture.start();
    FakeRecorder.instances[0].emitData(new Blob(["abc"]));
    capture.cancel();
    expect(capture.isRecording()).toBe(false);
    expect(track.stop).toHaveBeenCalledTimes(1);
    await expect(capture.stop()).resolves.toBeNull();
  });

  it("a pending stop resolves null when cancelled mid-drain", async () => {
    FakeRecorder.autoFlushStop = false;
    FakeAudioContext.nextBuffer = fakeAudioBuffer([[0.25]], VOICE_SAMPLE_RATE);
    const { capture } = setup();
    await capture.start();
    FakeRecorder.instances[0].emitData(new Blob(["abc"]));
    const pending = capture.stop();
    capture.cancel();
    FakeRecorder.instances[0].flushStop();
    await expect(pending).resolves.toBeNull();
  });

  it("releases the acquired stream when the recorder constructor throws", async () => {
    class ThrowingRecorder extends FakeRecorder {
      constructor(stream: MediaStream, options?: { mimeType?: string }) {
        super(stream, options);
        throw new Error("no encoder");
      }
    }
    const { stream, track } = makeStream();
    const capture = createVoiceCapture({
      getUserMedia: async () => stream,
      MediaRecorderCtor: ThrowingRecorder,
      AudioContextCtor: FakeAudioContext,
    });
    await expect(capture.start()).rejects.toThrow("no encoder");
    expect(track.stop).toHaveBeenCalledTimes(1);
  });
});

describe("encodeWavPcm16", () => {
  it("clamps out-of-range samples", async () => {
    const blob = encodeWavPcm16(new Float32Array([2, -2]), VOICE_SAMPLE_RATE);
    const view = await wavView(blob);
    expect(view.getInt16(44, true)).toBe(32767);
    expect(view.getInt16(46, true)).toBe(-32768);
  });
});

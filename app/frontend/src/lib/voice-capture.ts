// Voice capture: mic acquisition + MediaRecorder → 16kHz mono PCM WAV.
//
// The server-side STT (whisper.cpp) consumes WAV directly, so the browser
// re-encodes: MediaRecorder yields opus/webm chunks, `decodeAudioData`
// decodes them, and the PCM is downmixed/resampled/encoded here — no
// server-side transcode, no runtime dependencies. Every browser API is
// injectable so tests run fully stubbed.

/** Whisper-compatible output: 16kHz mono 16-bit PCM. */
export const VOICE_SAMPLE_RATE = 16000;

const WAV_BYTES_PER_SAMPLE = 2;
const WAV_HEADER_BYTES = 44;

/** Preferred recorder container/codec, in order; falls back to the browser
 *  default when neither is supported. */
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm"] as const;

/**
 * True when mic capture can work at all: `getUserMedia` requires a secure
 * context (HTTPS or localhost), so over plain HTTP on a LAN origin the mic
 * affordances must be omitted rather than failing mid-gesture. Same gating
 * shape as `isPushSupported` in lib/push.ts.
 */
export function isMicSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    window.isSecureContext === true &&
    typeof navigator !== "undefined" &&
    "mediaDevices" in navigator
  );
}

/** The recorder structural type the controller needs (the global
 *  `MediaRecorder` satisfies it; tests pass a stub class). */
export type MediaRecorderLike = {
  ondataavailable: ((event: BlobEvent) => void) | null;
  onstop: ((event: Event) => void) | null;
  start(): void;
  stop(): void;
};

export type MediaRecorderCtorLike = {
  new (stream: MediaStream, options?: { mimeType?: string }): MediaRecorderLike;
  isTypeSupported?(mimeType: string): boolean;
};

export type AudioContextLike = {
  decodeAudioData(data: ArrayBuffer): Promise<AudioBuffer>;
  close(): Promise<void>;
};

export type AudioContextCtorLike = new () => AudioContextLike;

/** Injectable browser seams. Absent values fall back to the globals. */
export type VoiceCaptureDeps = {
  getUserMedia?: (constraints: { audio: true }) => Promise<MediaStream>;
  MediaRecorderCtor?: MediaRecorderCtorLike;
  AudioContextCtor?: AudioContextCtorLike;
};

export interface VoiceCapture {
  /** Acquire the mic and start recording. A second call while recording is a
   *  no-op. Rejects when the mic cannot be acquired (denied/unavailable). */
  start(): Promise<void>;
  /** Stop and resolve the recorded audio as a 16kHz mono WAV blob. Resolves
   *  `null` when nothing was recording or nothing was captured. */
  stop(): Promise<Blob | null>;
  /** Abort the in-flight recording without producing audio. */
  cancel(): void;
  isRecording(): boolean;
}

function pickMimeType(ctor: MediaRecorderCtorLike): string | undefined {
  if (typeof ctor.isTypeSupported !== "function") return undefined;
  for (const mimeType of PREFERRED_MIME_TYPES) {
    if (ctor.isTypeSupported(mimeType)) return mimeType;
  }
  return undefined;
}

function downmixMono(buffer: AudioBuffer): Float32Array {
  const channels = buffer.numberOfChannels;
  const first = buffer.getChannelData(0);
  if (channels <= 1) return first;
  const out = new Float32Array(first.length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < out.length; i++) out[i] += data[i] / channels;
  }
  return out;
}

/** Linear-interpolation resample — adequate for speech at these rates and
 *  dependency-free. */
function resample(input: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate || input.length === 0) return input;
  const ratio = fromRate / toRate;
  const out = new Float32Array(Math.round(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const pos = i * ratio;
    const base = Math.floor(pos);
    const frac = pos - base;
    const a = input[base] ?? 0;
    const b = input[Math.min(base + 1, input.length - 1)] ?? 0;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** Encode mono PCM samples as a well-formed 16-bit WAV blob. */
export function encodeWavPcm16(samples: Float32Array, sampleRate: number): Blob {
  const dataBytes = samples.length * WAV_BYTES_PER_SAMPLE;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, WAV_HEADER_BYTES - 8 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk size
  view.setUint16(20, 1, true); // PCM audio format
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * WAV_BYTES_PER_SAMPLE, true); // byte rate
  view.setUint16(32, WAV_BYTES_PER_SAMPLE, true); // block align
  view.setUint16(34, 8 * WAV_BYTES_PER_SAMPLE, true); // bits per sample
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  let offset = WAV_HEADER_BYTES;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, Math.round(clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff), true);
    offset += WAV_BYTES_PER_SAMPLE;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

export function createVoiceCapture(deps: VoiceCaptureDeps = {}): VoiceCapture {
  const getUserMedia =
    deps.getUserMedia ?? ((constraints: { audio: true }) => navigator.mediaDevices.getUserMedia(constraints));
  const RecorderCtor =
    deps.MediaRecorderCtor ?? (typeof MediaRecorder !== "undefined" ? MediaRecorder : undefined);
  const AudioCtor =
    deps.AudioContextCtor ?? (typeof AudioContext !== "undefined" ? AudioContext : undefined);

  let stream: MediaStream | null = null;
  let recorder: MediaRecorderLike | null = null;
  let recorderMimeType: string | undefined;
  let chunks: Blob[] = [];
  let cancelled = false;
  let stopRequested = false;
  let onRecorderStop: (() => void) | null = null;

  function releaseStream(): void {
    if (!stream) return;
    for (const track of stream.getTracks()) track.stop();
    stream = null;
  }

  return {
    async start() {
      if (recorder) return;
      if (!RecorderCtor) throw new Error("MediaRecorder is not supported");
      const acquired = await getUserMedia({ audio: true });
      recorderMimeType = pickMimeType(RecorderCtor);
      try {
        recorder = new RecorderCtor(
          acquired,
          recorderMimeType ? { mimeType: recorderMimeType } : undefined,
        );
      } catch (err) {
        for (const track of acquired.getTracks()) track.stop();
        throw err;
      }
      stream = acquired;
      chunks = [];
      cancelled = false;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data);
      };
      recorder.onstop = () => {
        recorder = null;
        stopRequested = false;
        releaseStream();
        if (cancelled) chunks = [];
        cancelled = false;
        const notify = onRecorderStop;
        onRecorderStop = null;
        notify?.();
      };
      recorder.start();
    },

    async stop() {
      const active = recorder;
      if (!active) return null;
      if (stopRequested) return null; // a stop/cancel is already draining
      stopRequested = true;
      const stopped = new Promise<void>((resolve) => {
        onRecorderStop = resolve;
      });
      active.stop();
      await stopped;
      const captured = chunks;
      chunks = [];
      if (captured.length === 0) return null;
      if (!AudioCtor) return null;
      const blob = new Blob(captured, recorderMimeType ? { type: recorderMimeType } : undefined);
      const ctx = new AudioCtor();
      try {
        const decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
        const mono = resample(downmixMono(decoded), decoded.sampleRate, VOICE_SAMPLE_RATE);
        return encodeWavPcm16(mono, VOICE_SAMPLE_RATE);
      } finally {
        void ctx.close();
      }
    },

    cancel() {
      cancelled = true;
      // A pending stop() is already draining the recorder — the cleared chunks
      // make it resolve null; a second stop() would throw InvalidStateError.
      if (recorder && !stopRequested) {
        stopRequested = true;
        recorder.stop();
      }
    },

    isRecording() {
      return recorder !== null;
    },
  };
}

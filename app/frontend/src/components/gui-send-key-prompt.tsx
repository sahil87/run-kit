import { useEffect, useRef, useState } from "react";
import { Dialog } from "@/components/dialog";
import { Control, controlClass } from "@/components/control";
import { INPUT_COARSE, INPUT_FOCUS } from "@/components/controls";
import { SUGGESTED_CHORDS, parseKeyChord, type KeyChord } from "@/lib/gui-send-key";

type GuiSendKeyPromptProps = {
  /** Receives the parsed chord (the palette's `GUI: Send key…` flow — the
   *  caller sends it viewer-side, owns any mirror refusal, and closes). */
  onSubmit: (chord: KeyChord) => void;
  onClose: () => void;
};

/**
 * The one-field prompt behind `GUI: Send key…` (the GuiGeometryPrompt shape):
 * a row of the five suggested chords as quick-pick chips (tapping one submits
 * immediately) plus a single chord input with live validation — Enter or the
 * Send button submits the parsed chord; an unparseable non-empty value shows
 * the inline error and blocks submit. Escape/backdrop close via the Dialog
 * shell. Lazy-loaded like GuiGeometryPrompt.
 */
export function GuiSendKeyPrompt({ onSubmit, onClose }: GuiSendKeyPromptProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const parsed = parseKeyChord(value);
  // The error appears once there is input to be wrong; a pristine empty field
  // just keeps the button disabled.
  const showError = parsed === null && value.trim() !== "";

  function handleSubmit() {
    if (!parsed) return;
    onSubmit(parsed);
  }

  return (
    <Dialog title="Send key" onClose={onClose}>
      <div className="flex flex-wrap gap-1 mb-2" aria-label="Suggested chords">
        {SUGGESTED_CHORDS.map((chord) => (
          <Control
            key={chord}
            variant="chip"
            onClick={() => {
              const suggested = parseKeyChord(chord);
              if (suggested) onSubmit(suggested);
            }}
          >
            {chord}
          </Control>
        ))}
      </div>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        aria-label="Key chord"
        aria-invalid={showError}
        placeholder="Ctrl+Alt+F4"
        className={`w-full bg-transparent text-text-primary p-2 border rounded ${showError ? "outline-none focus:border-red-500" : INPUT_FOCUS} ${INPUT_COARSE} placeholder:text-text-secondary ${
          showError ? "border-red-500" : "border-border"
        }`}
      />
      {showError && (
        <p className="text-xs text-signal-red mt-1">
          Not a chord — modifiers are Ctrl, Alt, Shift, Super; the key is a name (Del, F4, Print…) or one character
        </p>
      )}
      <button
        onClick={handleSubmit}
        disabled={!parsed}
        className={`w-full mt-3 ${controlClass({ variant: "wide", disabled: !parsed })}`}
      >
        Send
      </button>
    </Dialog>
  );
}

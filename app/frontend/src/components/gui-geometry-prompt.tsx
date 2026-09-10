import { useRef, useState, useEffect } from "react";
import { Dialog } from "@/components/dialog";
import { controlClass } from "@/components/control";
import { INPUT_COARSE, INPUT_FOCUS } from "@/components/controls";
import { parseGeometryInput } from "@/lib/gui-geometry";

type GuiGeometryPromptProps = {
  /** Receives the normalized `WxH` geometry (the palette's `GUI: Resolution →
   *  Custom…` flow — the caller posts it and owns any toast). */
  onSubmit: (geometry: string) => void;
  onClose: () => void;
};

/**
 * The one-field prompt behind `GUI: Resolution → Custom…` (the
 * SessionNamePrompt shape): a single Width×Height input with live validation
 * — Enter or the Resize button submits the normalized `WxH`; an invalid value
 * shows the inline error and blocks submit. Escape/backdrop close via the
 * Dialog shell. Lazy-loaded like SessionNamePrompt.
 */
export function GuiGeometryPrompt({ onSubmit, onClose }: GuiGeometryPromptProps) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const parsed = parseGeometryInput(value);
  const invalid = typeof parsed === "string";
  // The error appears once there is input to be wrong; a pristine empty field
  // just keeps the button disabled.
  const showError = invalid && value.trim() !== "";

  function handleSubmit() {
    if (typeof parsed === "string") return;
    onSubmit(parsed.geometry);
  }

  return (
    <Dialog title="Desktop size" onClose={onClose}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        aria-label="Width×Height"
        aria-invalid={showError}
        placeholder="1440x900"
        className={`w-full bg-transparent text-text-primary p-2 border rounded ${showError ? "outline-none focus:border-red-500" : INPUT_FOCUS} ${INPUT_COARSE} placeholder:text-text-secondary ${
          showError ? "border-red-500" : "border-border"
        }`}
      />
      {showError && (
        <p className="text-xs text-signal-red mt-1">
          {parsed}
        </p>
      )}
      <button
        onClick={handleSubmit}
        disabled={invalid}
        className={`w-full mt-3 ${controlClass({ variant: "wide", disabled: invalid })}`}
      >
        Resize
      </button>
    </Dialog>
  );
}

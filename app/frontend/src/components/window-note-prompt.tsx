import { useRef, useState, useEffect } from "react";
import { Dialog } from "@/components/dialog";
import { controlClass } from "@/components/control";
import { INPUT_COARSE, INPUT_FOCUS } from "@/components/controls";

type WindowNotePromptProps = {
  /** The window's current note text ("" when unset) — the prefill. */
  defaultNote: string;
  /** Fires with the submitted text; an empty submit clears the note. */
  onSubmit: (note: string) => void;
  onClose: () => void;
};

/**
 * The prompt behind `Window: Set note…` (palette): a single text input
 * prefilled with the window's current `@rk_win_note` text, select-all'd so typing
 * replaces it. An empty submit CLEARS the note (the options endpoint maps ""
 * to unset). Escape/backdrop close via the Dialog shell. Mirrors the
 * SessionNamePrompt shape (the save-as-style prompt idiom).
 */
export function WindowNotePrompt({ defaultNote, onSubmit, onClose }: WindowNotePromptProps) {
  const [note, setNote] = useState(defaultNote);
  // Guards the in-flight submit only — an EMPTY submit is a valid clear, so
  // emptiness never disables (unlike the SessionNamePrompt twin).
  const [submitted, setSubmitted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Select the prefill once on mount (the SessionNamePrompt idiom).
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  function handleSubmit() {
    if (submitted) return;
    setSubmitted(true);
    onSubmit(note.trim());
  }

  return (
    <Dialog title="Set tab note" onClose={onClose}>
      <input
        ref={inputRef}
        type="text"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
        aria-label="Tab note"
        placeholder="e.g. blocked on flaky e2e (empty clears)"
        className={`w-full bg-transparent text-text-primary p-2 border rounded ${INPUT_FOCUS} ${INPUT_COARSE} placeholder:text-text-secondary border-border`}
      />
      <button
        onClick={handleSubmit}
        disabled={submitted}
        className={`w-full mt-3 ${controlClass({ variant: "wide", disabled: submitted })}`}
      >
        {note.trim() === "" ? "Clear note" : "Set note"}
      </button>
    </Dialog>
  );
}

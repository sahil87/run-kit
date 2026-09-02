import { useEffect, useRef, useState } from "react";
import { sendServerOperatorRequest } from "@/api/client";
import { Dialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { operatorRequestToast } from "@/lib/operator-request";

export type OperatorComposeMode = "spawn" | "find";

type OperatorComposeDialogProps = {
  server: string;
  /** Mode pre-selected by the entry point (palette verb or the row icon's
   *  spawn default); the segmented control can switch it. */
  initialMode: OperatorComposeMode;
  onClose: () => void;
};

const MODES: { id: OperatorComposeMode; label: string; placeholder: string }[] = [
  { id: "spawn", label: "Spawn task", placeholder: "Describe the task to spawn…" },
  { id: "find", label: "Find discussion", placeholder: "What are you looking for?" },
];

/**
 * The single operator compose surface (260822-wyn3): one single-line input
 * plus a segmented spawn/find mode control; Enter submits, Escape cancels.
 * Both palette verbs and the pinned-row compose icon mount this dialog — the
 * mode is only pre-selected per entry point.
 */
export function OperatorComposeDialog({ server, initialMode, onClose }: OperatorComposeDialogProps) {
  const [mode, setMode] = useState<OperatorComposeMode>(initialMode);
  const [text, setText] = useState("");
  const [inFlight, setInFlight] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { addToast } = useToast();

  // Pre-focus the single field on open — the focus trap's focus-first-on-mount
  // would otherwise land on the first segmented button.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function handleSubmit() {
    const trimmed = text.trim();
    if (trimmed === "" || inFlight) return;
    // Capture the mode the request is sent with — a segmented-control toggle
    // while the POST is in flight must not relabel the settle toast.
    const submitted = mode;
    setInFlight(true);
    sendServerOperatorRequest(server, submitted === "spawn" ? "spawn-task" : "find-discussion", trimmed)
      .then((result) =>
        addToast(
          operatorRequestToast(
            result,
            submitted === "spawn"
              ? "Sent to operator — it will spawn the agent"
              : "Sent to operator — the answer appears in the operator tab",
          ),
          "info",
        ),
      )
      .catch((err: Error) => addToast(err.message || "Failed to reach the operator", "error"))
      .finally(() => {
        setInFlight(false);
        onClose();
      });
  }

  const active = MODES.find((m) => m.id === mode) ?? MODES[0];

  return (
    <Dialog title="Compose for operator" onClose={onClose}>
      {/* Segmented spawn/find mode control */}
      <div role="group" aria-label="Compose mode" className="flex mb-3 border border-border rounded overflow-hidden">
        {MODES.map((m) => (
          <button
            key={m.id}
            type="button"
            aria-pressed={mode === m.id}
            onClick={() => {
              setMode(m.id);
              inputRef.current?.focus();
            }}
            className={`flex-1 py-1.5 transition-colors ${
              mode === m.id
                ? "bg-bg-card text-text-primary"
                : "text-text-secondary hover:bg-bg-card hover:text-text-primary"
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <input
        ref={inputRef}
        autoFocus
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            handleSubmit();
          }
        }}
        aria-label={active.label}
        placeholder={active.placeholder}
        className="w-full bg-transparent text-text-primary p-2 border border-border rounded outline-none placeholder:text-text-secondary mb-3"
      />

      <button
        onClick={handleSubmit}
        disabled={inFlight || text.trim() === ""}
        className="w-full py-1.5 bg-bg-card border border-border rounded hover:border-text-secondary disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Send to operator
      </button>
    </Dialog>
  );
}

import { useEffect, useRef, useState } from "react";
import { controlClass } from "@/components/control";
import { lineRef, type ReviewSide } from "@/lib/review";

/**
 * ReviewComposer — the line-anchored comment composer
 * (`docs/wiki/review-comment-states.html` § Composer, which is normative).
 *
 * It renders INSIDE the diff, spliced between line N and line N+1, which is why
 * the backend ships per-line rows rather than one HTML blob per file (spec
 * § R6). The anchored line takes an outline for the composer's lifetime — the
 * `.rk-review-row-anchored` class the parent applies — so the reader never
 * loses which line they are commenting on while typing.
 *
 * The footer carries GitHub's OWN two modes as a split button, and they differ
 * for the LISTENER rather than merely for the user: a pending review is
 * invisible to `gh` until submitted, so only *Add single comment* can dispatch
 * on post. The chip states that difference instead of hiding it — `⚡ dispatch
 * on post` in single mode, dimmed to `⊘ on review submit` in review mode.
 *
 * Both modes are SUBMIT actions, so the chip has to describe the mode the user
 * is ABOUT to use rather than one already used: it follows hover and keyboard
 * focus across the two buttons. A chip that only repainted after a post would
 * never be seen, which is the opposite of stating the difference.
 */
export interface ReviewComposerProps {
  side: ReviewSide;
  line: number;
  /** A reply target's rendering: the header names the thread rather than a
   *  fresh anchor, and the mode split button is hidden (a reply always posts
   *  immediately). */
  replying?: boolean;
  /** Pre-filled body — the palette's "comment on the focused line" seeds a
   *  quote of the selection here. */
  initialBody?: string;
  busy?: boolean;
  onSubmit: (body: string, mode: "single" | "review") => void | Promise<void>;
  onCancel: () => void;
}

export function ReviewComposer({
  side,
  line,
  replying = false,
  initialBody = "",
  busy = false,
  onSubmit,
  onCancel,
}: ReviewComposerProps) {
  const [body, setBody] = useState(initialBody);
  // The mode the chip describes and the ⌘/Ctrl+Enter chord submits: whichever
  // submit button the pointer or the keyboard is currently on, `single`
  // otherwise (GitHub's default, and the only mode that can dispatch on post).
  const [mode, setMode] = useState<"single" | "review">("single");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // The composer is opened by a deliberate gesture (a gutter click, a palette
  // entry, a chord), so it always takes focus — there is no case where the user
  // opened one and wanted to keep typing somewhere else.
  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  const submit = (submitMode: "single" | "review") => {
    const trimmed = body.trim();
    if (trimmed === "" || busy) return;
    void onSubmit(trimmed, submitMode);
  };

  return (
    <div
      data-testid="review-composer"
      className="border border-accent-green rounded bg-bg-card m-1 p-2 text-xs font-mono"
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCancel();
          return;
        }
        // ⌘/Ctrl+Enter submits in the current mode — the compose-strip chord,
        // reused so the gesture is the same everywhere in the app.
        if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          submit(mode);
        }
      }}
    >
      <div className="flex items-center justify-between mb-1.5 text-text-secondary">
        <span data-testid="review-composer-ref">
          {replying ? "Reply" : `Comment on ${lineRef(side, line)}`}
        </span>
        <span
          data-testid="review-composer-dispatch-chip"
          className={mode === "single" ? "text-accent-green" : "opacity-50"}
        >
          {mode === "single" ? "⚡ dispatch on post" : "⊘ on review submit"}
        </span>
      </div>

      <textarea
        ref={textareaRef}
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={3}
        aria-label={replying ? "Reply body" : `Comment on ${lineRef(side, line)}`}
        className="w-full bg-bg-inset text-text-primary border border-border rounded p-1.5 resize-y focus-visible:outline-2 focus-visible:outline-accent-green"
      />

      <div className="flex items-center justify-end gap-1.5 mt-1.5">
        <button
          type="button"
          onClick={onCancel}
          className={controlClass({ variant: "chip" })}
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={busy || body.trim() === ""}
          onMouseEnter={() => setMode("single")}
          onFocus={() => setMode("single")}
          onClick={() => submit("single")}
          className={controlClass({ variant: "chip", disabled: busy || undefined })}
        >
          {replying ? "Reply" : "Add single comment"}
        </button>
        {!replying && (
          <button
            type="button"
            disabled={busy || body.trim() === ""}
            onMouseEnter={() => setMode("review")}
            onFocus={() => setMode("review")}
            onClick={() => submit("review")}
            className={controlClass({ variant: "chip", disabled: busy || undefined })}
          >
            Start a review
          </button>
        )}
      </div>
    </div>
  );
}

import { useState } from "react";
import { controlClass } from "@/components/control";
import { ReviewComposer } from "@/components/review-composer";
import {
  isSuggestionOnlyBody,
  suggestionBody,
  threadState,
  type ReviewComment,
  type ReviewThread as Thread,
  type ThreadState,
} from "@/lib/review";

/**
 * ReviewThreadCard — a review thread rendered inline in the diff, directly
 * under the line it anchors to.
 *
 * `docs/wiki/review-comment-states.html` is NORMATIVE for the six states this
 * renders, and two of them exist to be told apart at a glance:
 *
 * - **Resolved** — collapsed one-liner, dimmed, purple pill. Terminal: the
 *   listener never dispatches it again.
 * - **Outdated** — collapsed, amber pill, original hunk on demand. NEVER
 *   dispatched: the agent would be handed a line number that no longer names
 *   the code the comment is about, and would produce a confident edit in the
 *   wrong place — strictly worse than dropping it. Outdated threads surface for
 *   a human to re-anchor or resolve.
 *
 * The `→ dispatched` chip is the 👀 marker made legible, and it stays on once
 * set: the backend predicate is 👀-on-the-first-comment only, so a reply after
 * the mark does NOT re-queue the thread (spec § The loop guard — a
 * reply-triggered requeue would fire on the agent's own reply). Un-reacting 👀
 * is the human re-queue gesture, and the chip must not claim otherwise.
 */
export interface ReviewThreadCardProps {
  thread: Thread;
  busy?: boolean;
  onReply: (thread: Thread, body: string) => void | Promise<void>;
  onResolve: (thread: Thread, resolved: boolean) => void | Promise<void>;
  /** Apply a suggestion block. Applying marks the thread handled, which is why
   *  a suggestion-only thread is never worth an agent turn. The composition is
   *  the surface's (clipboard + resolve); this component only offers the
   *  affordance. */
  onApplySuggestion?: (thread: Thread, comment: ReviewComment, body: string) => void;
}

const STATE_PILL: Partial<Record<ThreadState, { label: string; className: string }>> = {
  resolved: { label: "Resolved", className: "text-signal-purple" },
  outdated: { label: "Outdated", className: "text-marker-ink" },
  dispatched: { label: "→ dispatched", className: "text-accent-green" },
};

export function ReviewThreadCard({
  thread,
  busy = false,
  onReply,
  onResolve,
  onApplySuggestion,
}: ReviewThreadCardProps) {
  const state = threadState(thread);
  const collapsible = state === "resolved" || state === "outdated";
  const [expanded, setExpanded] = useState(!collapsible);
  const [replying, setReplying] = useState(false);
  const pill = STATE_PILL[state];
  const first = thread.comments[0];

  return (
    <div
      data-testid="review-thread"
      data-thread-id={thread.id}
      data-thread-state={state}
      className={`m-1 rounded border border-border bg-bg-card text-xs font-mono ${
        collapsible ? "opacity-70" : ""
      }`}
    >
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border">
        {collapsible && (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? "Collapse thread" : "Expand thread"}
            onClick={() => setExpanded((open) => !open)}
            className={controlClass({ variant: "chip" })}
          >
            {expanded ? "▾" : "▸"}
          </button>
        )}
        <span className="flex-1 truncate text-text-secondary">
          {first ? `@${first.author || "unknown"}: ${firstLine(first.body)}` : "(empty thread)"}
        </span>
        {pill && (
          <span data-testid="review-thread-pill" className={pill.className}>
            {pill.label}
          </span>
        )}
      </div>

      {expanded && (
        <div className="px-2 py-1.5 flex flex-col gap-2">
          {thread.comments.map((comment) => (
            <CommentBody
              key={comment.id}
              comment={comment}
              onApply={
                onApplySuggestion
                  ? (body) => onApplySuggestion(thread, comment, body)
                  : undefined
              }
            />
          ))}

          {replying ? (
            <ReviewComposer
              side={thread.side === "LEFT" ? "L" : "R"}
              line={thread.line}
              replying
              busy={busy}
              onSubmit={async (body) => {
                await onReply(thread, body);
                setReplying(false);
              }}
              onCancel={() => setReplying(false)}
            />
          ) : (
            <div className="flex items-center justify-end gap-1.5">
              <button
                type="button"
                disabled={busy}
                onClick={() => setReplying(true)}
                className={controlClass({ variant: "chip", disabled: busy || undefined })}
              >
                Reply
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => void onResolve(thread, !thread.isResolved)}
                className={controlClass({ variant: "chip", disabled: busy || undefined })}
              >
                {thread.isResolved ? "Unresolve" : "Resolve"}
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** One comment body, with a ```suggestion fence rendered as its own mini-diff
 *  plus an Apply button. */
function CommentBody({
  comment,
  onApply,
}: {
  comment: ReviewComment;
  onApply?: (body: string) => void;
}) {
  const suggestion = suggestionBody(comment.body);
  return (
    <div data-testid="review-comment" data-comment-id={comment.id}>
      <div className="text-text-secondary">
        @{comment.author || "unknown"}
        {comment.eyes && (
          <span aria-label="claimed" title="claimed — 👀 on GitHub" className="ml-1.5">
            👀
          </span>
        )}
      </div>
      {suggestion === undefined ? (
        <pre className="whitespace-pre-wrap text-text-primary">{comment.body}</pre>
      ) : (
        <div data-testid="review-suggestion" className="mt-1">
          {!isSuggestionOnlyBody(comment.body) && (
            <pre className="whitespace-pre-wrap text-text-primary">
              {comment.body.split("```suggestion")[0].trimEnd()}
            </pre>
          )}
          <pre className="rk-review-row rk-review-row-add whitespace-pre-wrap px-1.5 py-1 rounded">
            {suggestion}
          </pre>
          {onApply && (
            <button
              type="button"
              title="Copies the replacement and resolves the thread — GitHub has no API for committing a suggestion"
              onClick={() => onApply(suggestion)}
              className={`${controlClass({ variant: "chip" })} mt-1`}
            >
              Apply suggestion
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function firstLine(body: string): string {
  const [line] = body.split("\n");
  return line ?? "";
}

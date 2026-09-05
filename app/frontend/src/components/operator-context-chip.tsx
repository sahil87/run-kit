import { dismissOperatorChatChip, useOperatorChatChip } from "@/lib/operator-console";

/**
 * The chat-lane context chip — renders the attached chat subject (the route's
 * window) beside whichever compose surface is active: the desktop omnibox and
 * the mobile sheet strip both mount one, reading the ONE chat-subject store in
 * lib/operator-console.ts so the two stay in lockstep. Implicit context the
 * user cannot see erodes trust in what the operator was told, so the chip is
 * always visible while a send would attach the envelope, and its ✕ detaches it
 * (sends then ride the direct lane until the console re-engages or the subject
 * changes — the store owns both resets).
 *
 * `server` is the caller's resolved console server: a subject stamped for a
 * different server renders nothing (window ids are server-scoped, and
 * sendOperatorMessage applies the same guard at send time).
 */
export function OperatorContextChip({
  server,
  compact = false,
}: {
  server: string | null;
  /** Cap the chip's width (the omnibox's slim box); the sheet strip has room. */
  compact?: boolean;
}) {
  const { subject, dismissed } = useOperatorChatChip();
  if (!server || !subject || dismissed || subject.server !== server) return null;
  return (
    <span
      data-testid="operator-console-context"
      className={`inline-flex min-w-0 shrink-0 items-center gap-1 rounded border border-border px-1.5 py-0.5 text-xs text-text-secondary ${
        compact ? "max-w-[14ch]" : ""
      }`}
    >
      <span className="truncate">
        from: {subject.windowId}
        {subject.name ? ` "${subject.name}"` : ""}
      </span>
      <button
        type="button"
        aria-label="Detach window context"
        onClick={dismissOperatorChatChip}
        className="shrink-0 px-0.5 text-text-secondary transition-colors hover:text-text-primary"
      >
        ✕
      </button>
    </span>
  );
}

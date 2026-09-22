/**
 * Pure builder for the command-palette `Review:` actions — the `review`
 * surface's complete verb set (spec `docs/specs/pr-review.md` § R11).
 *
 * Constitution V makes palette reachability MANDATORY for every user-facing
 * action, and it is load-bearing here rather than ceremonial: the surface's own
 * affordances are pointer-first (a gutter `+`, a chevron, a checkbox), so the
 * palette is the only keyboard route to most of them. The one chord the surface
 * claims — ⌘5 / ⇧Ctrl+5 — toggles the TILE, not any of these verbs.
 *
 * Extracted from app.tsx so the ids and labels are unit-testable without
 * mounting the shell, mirroring `lib/palette/view.ts` / `lib/palette/gui.ts`.
 * Every body is a thin wrapper over the surface's own imperative seam, so the
 * palette entry and the pointer affordance run the SAME implementation.
 */

export type ReviewPaletteAction = {
  id: string;
  label: string;
  shortcut: string;
  onSelect: () => void;
};

/** The seams the surface publishes (`ReviewSurfaceCommands`), narrowed to what
 *  the palette needs so this module stays free of the component import graph. */
export interface ReviewPaletteSeams {
  toggleListen: () => void;
  nextFile: () => void;
  previousFile: () => void;
  expandFocusedFile: () => void;
  commentOnFocusedLine: () => void;
  replyToFocusedThread: () => void;
  resolveFocusedThread: () => void;
  markFocusedViewed: () => void;
  refresh: () => void;
}

/**
 * Build the eight `Review:` actions. Returns an empty array when the surface is
 * not mounted (`seams` null) — the tile has to exist for any of these to mean
 * anything, and a palette entry that predictably no-ops is worse than an absent
 * one.
 *
 * `listening` only selects the toggle's LABEL, so the entry names the
 * destination state rather than the current one.
 */
export function buildReviewActions(
  seams: ReviewPaletteSeams | null,
  listening: boolean,
): ReviewPaletteAction[] {
  if (!seams) return [];
  const rows: [string, string, () => void][] = [
    [
      "review-listen",
      listening ? "Review: Stop listening for comments" : "Review: Listen for comments",
      seams.toggleListen,
    ],
    ["review-next-file", "Review: Next file", seams.nextFile],
    ["review-previous-file", "Review: Previous file", seams.previousFile],
    ["review-expand-file", "Review: Expand file", seams.expandFocusedFile],
    ["review-comment", "Review: Comment on focused line", seams.commentOnFocusedLine],
    ["review-reply", "Review: Reply to thread", seams.replyToFocusedThread],
    ["review-resolve", "Review: Resolve thread", seams.resolveFocusedThread],
    ["review-mark-viewed", "Review: Mark file as viewed", seams.markFocusedViewed],
    ["review-refresh", "Review: Refresh", seams.refresh],
  ];
  return rows.map(([id, label, onSelect]) => ({ id, label, shortcut: "", onSelect }));
}

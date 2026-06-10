import { refreshPrStatus } from "@/api/client";
import type { WindowInfo } from "@/types";

/** State glyph: open=●, merged=✓, closed=✗. Falls back to ● for unknown. */
function stateGlyph(state: WindowInfo["prState"]): string {
  switch (state) {
    case "merged":
      return "✓";
    case "closed":
      return "✗";
    default:
      return "●";
  }
}

/** Human-readable checks/review summary, e.g. "checks pass" or "review: changes requested". */
function summaryText(win: WindowInfo): string {
  const parts: string[] = [];
  if (win.prChecks && win.prChecks !== "none") {
    parts.push(`checks ${win.prChecks}`);
  }
  if (win.prReview && win.prReview !== "none") {
    parts.push(`review: ${win.prReview.replace(/_/g, " ")}`);
  }
  return parts.join(" · ");
}

/** Fail-ish states get the red token; everything else uses the secondary token. */
function isFailish(win: WindowInfo): boolean {
  return win.prChecks === "fail" || win.prReview === "changes_requested";
}

/**
 * One-line live PR status for a change-bound window. Renders ONLY when the
 * window is change-bound (`fabChange`) AND has a `prNumber` — returns null
 * otherwise. Shared by the sidebar WindowRow and the dashboard window cards so
 * the gate, glyphs, and color tokens stay identical.
 *
 * Layout: `PR #<n> <glyph> <state> · <checks/review summary>`. `PR #<n>` is an
 * external link (new tab) whose click is stopped from bubbling so it never
 * selects/navigates the window. Clicking the rest of the line triggers a
 * best-effort `refreshPrStatus()` (the refreshed status arrives via SSE).
 */
export function PrStatusLine({ win }: { win: WindowInfo }) {
  if (!win.fabChange || !win.prNumber) return null;

  const failish = isFailish(win);
  const colorClass = failish ? "text-red-400" : "text-text-secondary";
  const summary = summaryText(win);
  const draftSuffix = win.prIsDraft ? " (draft)" : "";

  return (
    <div
      className={`flex items-center gap-1 text-xs ${colorClass} truncate`}
      data-testid="pr-status-line"
      // Clicking the line (but not the link) kicks an on-demand refresh. This
      // is a best-effort progressive enhancement, NOT a semantic control — the
      // PR link below is the real, keyboard-accessible action — so we use a
      // plain onClick with no button role / tabIndex (a non-operable
      // role="button" would be an a11y lie). Errors are ignored (gh may be
      // absent/unauth server-side).
      onClick={(e) => {
        e.stopPropagation();
        void refreshPrStatus().catch(() => {});
      }}
      title="Refresh PR status"
    >
      {win.prUrl ? (
        <a
          href={win.prUrl}
          target="_blank"
          rel="noopener noreferrer"
          // Don't let the link click select the window or trigger the refresh.
          onClick={(e) => e.stopPropagation()}
          className="hover:text-text-primary hover:underline shrink-0 coarse:py-1"
          data-testid="pr-status-link"
        >
          PR #{win.prNumber}
        </a>
      ) : (
        <span className="shrink-0">PR #{win.prNumber}</span>
      )}
      {win.prState && (
        <span className="shrink-0" aria-hidden="true">
          {stateGlyph(win.prState)} {win.prState}
          {draftSuffix}
        </span>
      )}
      {summary && <span className="truncate">{"·"} {summary}</span>}
    </div>
  );
}

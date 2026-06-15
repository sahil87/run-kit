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
export function isFailish(win: WindowInfo): boolean {
  return win.prChecks === "fail" || win.prReview === "changes_requested";
}

/**
 * The five "traffic-light" states for the sidebar PR dot, generalizing the old
 * single red triage dot. GREEN MEANS HEALTH, NOT MERGE-READINESS — a draft with
 * passing checks is `healthy` (green), just not flipped to ready.
 */
export type PrDotState = "merged" | "fail" | "pending" | "healthy" | "neutral";

/**
 * Derive the PR dot state from the live PR fields on a window. First match wins
 * — the precedence order IS the design:
 *   1. `merged` first — a landed PR; historical checks/review are noise (mirrors
 *      status-panel suppressing checks/review once `!open`). `closed` is NOT
 *      here, so it falls through to `neutral`. Transient by design (Constitution
 *      II): an aged-out merge resets to `neutral`, never persisted.
 *   2. `fail` BEFORE `healthy` — an approved PR with a freshly-pushed failing
 *      commit MUST read red, never green. This branch IS `isFailish` (single
 *      source of truth shared with PrStatusLine).
 *   3. `pending` — checks still running.
 *   4. `healthy` — checks pass (draft included; green = health, so no draft
 *      contradiction and deliberately NO `&& approved` requirement).
 *   5. `neutral` — open with no decisive signal yet, closed-unmerged, or an
 *      aged-out merge. Renders as a dim/hollow dot.
 */
export function prDotState(win: WindowInfo): PrDotState {
  if (win.prState === "merged") return "merged";
  if (isFailish(win)) return "fail";
  if (win.prChecks === "pending") return "pending";
  if (win.prChecks === "pass") return "healthy";
  return "neutral";
}

/**
 * Per-state color token for the sidebar PR dot. Reuses the EXACT existing PR
 * color vocabulary from status-panel.tsx (no new hex). `text-accent-green` is
 * the established theme token (themes.ts), not raw `text-green-400`.
 */
export const PR_DOT_COLOR: Record<PrDotState, string> = {
  merged: "text-purple-400",
  fail: "text-red-400",
  pending: "text-yellow-400",
  healthy: "text-accent-green",
  neutral: "text-text-secondary",
};

/**
 * Per-state accessible name for the dot. Color cannot be the only channel
 * (colorblind a11y + Constitution V), and the dot always renders for a
 * change-bound PR window, so even `neutral` carries a label. `healthy` is
 * deliberately "checks passing", NOT "ready to merge" — health, not readiness.
 */
export const PR_DOT_LABEL: Record<PrDotState, string> = {
  merged: "PR merged",
  fail: "PR needs attention — checks failing or changes requested",
  pending: "PR checks running",
  healthy: "PR checks passing",
  neutral: "PR open",
};

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

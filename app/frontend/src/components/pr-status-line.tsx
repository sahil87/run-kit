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

/**
 * Colored checks/review segments for the live PR line, e.g. a green "checks
 * pass" and a red "review: changes requested". Each segment carries its own
 * color token from the shared vocabulary so the dashboard line matches the Pane
 * panel segment-by-segment. Mirrors getPrSegments' rule: checks/review are
 * historical once the PR is no longer open, so they're suppressed for a
 * merged/closed PR (only the terminal state shows). `none`/absent is dropped.
 */
function summarySegments(win: WindowInfo): { text: string; color: string }[] {
  const isOpen = !win.prState || win.prState === "open";
  if (!isOpen) return [];
  const parts: { text: string; color: string }[] = [];
  if (win.prChecks && win.prChecks !== "none") {
    parts.push({ text: `checks ${win.prChecks}`, color: PR_CHECKS_COLORS[win.prChecks] });
  }
  if (win.prReview && win.prReview !== "none") {
    parts.push({ text: `review: ${win.prReview.replace(/_/g, " ")}`, color: PR_REVIEW_COLORS[win.prReview] });
  }
  return parts;
}

/** Fail-ish states get the red token; everything else uses the secondary token. */
export function isFailish(win: WindowInfo): boolean {
  return win.prChecks === "fail" || win.prReview === "changes_requested";
}

/**
 * Per-segment PR color vocabulary, shared by ALL three PR surfaces — the sidebar
 * dot (via prDotState/PR_DOT_COLOR), the dashboard line (PrStatusLine, below),
 * and the Pane panel segments (status-panel.tsx getPrSegments, which imports
 * these). GitHub-style: open=green, merged=purple, closed=red; checks/review
 * pass/approved=green, fail/changes_requested=red, pending/review_required=
 * yellow. No new hex — `text-accent-green` is the theme token (themes.ts); the
 * other four are the established PR Tailwind tokens. This is the single source
 * of truth so a token rename touches one place and every surface stays in step.
 */
export const PR_STATE_COLORS: Record<NonNullable<WindowInfo["prState"]>, string> = {
  open: "text-accent-green",
  merged: "text-purple-400",
  closed: "text-red-400",
};

export const PR_CHECKS_COLORS: Record<string, string> = {
  pass: "text-accent-green",
  fail: "text-red-400",
  pending: "text-yellow-400",
};

export const PR_REVIEW_COLORS: Record<string, string> = {
  approved: "text-accent-green",
  changes_requested: "text-red-400",
  review_required: "text-yellow-400",
};

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
 * The unified status-dot state: PR status wins when the window is change-bound
 * AND has a PR; otherwise the dot falls back to the window's terminal activity.
 * One dot, one meaning at a time — durable PR lifecycle dominates transient
 * activity. The PR gate (`fabChange && prNumber`) is identical to the gate used
 * by `prDotState` callers and the backend attach gate (`sse.go`) — single
 * source of truth.
 */
export type StatusDotState =
  | { kind: "pr"; pr: PrDotState } // merged | fail | pending | healthy | neutral
  | { kind: "activity"; active: boolean }; // active=filled, idle=hollow ring

export function statusDotState(win: WindowInfo): StatusDotState {
  if (win.fabChange && win.prNumber) return { kind: "pr", pr: prDotState(win) };
  return { kind: "activity", active: win.activity === "active" };
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
 *
 * Each segment is colored from the shared PR vocabulary (PR_STATE_COLORS /
 * PR_CHECKS_COLORS / PR_REVIEW_COLORS) — the SAME tokens the sidebar dot and the
 * Pane panel use — so a merged PR reads purple, a passing check green, a failing
 * one red, on every surface. The container itself stays `text-text-secondary`
 * (the default for `PR #<n>`, glyph, and separators); only the state and
 * checks/review words take a state color.
 */
export function PrStatusLine({ win }: { win: WindowInfo }) {
  if (!win.fabChange || !win.prNumber) return null;

  const summary = summarySegments(win);
  const draftSuffix = win.prIsDraft ? " (draft)" : "";

  return (
    <div
      className="flex items-center gap-1 text-xs text-text-secondary min-w-0 truncate"
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
        <span className={`shrink-0 ${PR_STATE_COLORS[win.prState]}`}>
          {/* Glyph is decorative — the state word carries the meaning, so only
              the glyph is hidden from screen readers (the line is the sole PR
              signal on the dashboard, which has no accompanying dot). */}
          <span aria-hidden="true">{stateGlyph(win.prState)}</span> {win.prState}
          {draftSuffix}
        </span>
      )}
      {summary.map((seg) => (
        <span key={seg.text} className={`min-w-0 truncate ${seg.color}`}>
          {"·"} {seg.text}
        </span>
      ))}
    </div>
  );
}

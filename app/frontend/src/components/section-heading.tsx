import type { ReactNode } from "react";
import { TypedLabel } from "@/components/typed-label";

/**
 * Bracket section heading — the BBS-menu-tag idiom that used to live on the
 * two page-like surfaces' PageHeading row (change 260704-pr0p retired
 * PageHeading into this component, moving page identity to the top bar):
 *
 *   [ SESSIONS▊ ]──────────────────── side
 *
 * The bracket group holds the section label, an always-reserved blinking-caret
 * cell (`▊`, transparent at rest), and the `[`/`]` brackets that step outward +
 * turn accent on hover (`rk-bracket-*`, globals.css). The rule (a CSS border,
 * responsive — no literal `─` glyphs to overflow at 375px) fills the middle;
 * optional right-aligned `side` text sits after it.
 *
 * The LABEL keeps its typed-sweep hover (`TypedLabel`) INSIDE the brackets — so
 * the section-label vocabulary (typed sweep) and the page-title vocabulary
 * (brackets + caret) compose on one element. Semantics: an `<h2>` whose
 * accessible name is the label only — brackets, caret, and rule are decorative
 * (`aria-hidden`). Uppercase styling matches the former bare `<h2>` idiom.
 */
export function SectionHeading({
  label,
  side,
  className,
}: {
  label: string;
  side?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 min-w-0 ${className ?? ""}`}>
      {/* div, not span: this wrapper contains the <h2>, and a span may not
          contain flow content like headings (invalid HTML). `rk-bracket-group`
          scopes the hover treatment (brackets+caret = page-title vocabulary) to
          THIS cluster only — the rule and `side` slot below are outside it and
          never trigger it. */}
      <div className="rk-bracket-group flex items-center gap-1.5 min-w-0 shrink-0 max-w-[60%]">
        <span className="rk-bracket rk-bracket-open text-text-secondary select-none" aria-hidden="true">
          {"["}
        </span>
        <h2 className="text-xs uppercase tracking-wide text-text-secondary min-w-0">
          <TypedLabel text={label} />
        </h2>
        {/* Always-reserved blinking-caret cell: fixed 1ch width, transparent at
            rest so the closing bracket never shifts. Sits AFTER the label,
            BEFORE the closing bracket → `[ SESSIONS▊ ]`. */}
        <span className="rk-bracket-caret select-none" aria-hidden="true">
          {"▊"}
        </span>
        <span className="rk-bracket rk-bracket-close text-text-secondary select-none" aria-hidden="true">
          {"]"}
        </span>
      </div>
      <span className="flex-1 min-w-4 border-t border-border" aria-hidden="true" />
      {side != null && (
        <span className="text-sm text-text-secondary truncate shrink-0">{side}</span>
      )}
    </div>
  );
}

import type { ReactNode } from "react";

/**
 * Retro one-line page heading — the bracketed BBS-menu-tag idiom:
 *
 *   [ page · name ]──────────────────── side
 *
 * The bracket group holds the page-type word (`cockpit`, `cabin`) and, when
 * the page is about a specific instance, the instance name after a `·`. The
 * rule fills the middle; optional side-text sits right-aligned at the end.
 * Used by the two page-like surfaces (Cockpit `/` and the Server Cabin
 * `/$server` header row); workspace surfaces (Terminal, Board) deliberately
 * carry no page heading — vertical space there belongs to the terminal.
 *
 * The page word renders de-emphasized (secondary) when an instance name
 * follows — the name is the subject — and primary when it stands alone.
 * Brackets, separator, and rule are decorative (`aria-hidden`); the `<h1>` is
 * the accessible structure and its name excludes them (e.g. "server cabin
 * testServer"). The rule is a CSS border (responsive — no literal `─` glyphs
 * to overflow at 375px). Names are rendered verbatim: server names are
 * case-sensitive identifiers, so no uppercase transform.
 */
export function PageHeading({
  page,
  name,
  side,
  className,
}: {
  page: string;
  name?: string;
  side?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-3 min-w-0 ${className ?? ""}`}>
      <span className="flex items-center gap-1.5 min-w-0 shrink-0 max-w-[60%]">
        <span className="text-text-secondary select-none" aria-hidden="true">
          {"["}
        </span>
        <h1 className="flex items-center gap-1.5 min-w-0 text-sm">
          <span
            className={
              name != null
                ? "text-text-secondary"
                : "text-text-primary font-medium"
            }
          >
            {page}
          </span>
          {/* The literal " " text nodes keep the computed accessible name
              word-separated ("server cabin testServer") — flex drops
              whitespace-only items, so they never render. */}
          {name != null && (
            <>
              {" "}
              <span
                className="text-text-secondary select-none"
                aria-hidden="true"
              >
                {"·"}
              </span>{" "}
              <span className="text-text-primary font-medium truncate">
                {name}
              </span>
            </>
          )}
        </h1>
        <span className="text-text-secondary select-none" aria-hidden="true">
          {"]"}
        </span>
      </span>
      <span className="flex-1 min-w-4 border-t border-border" aria-hidden="true" />
      {side != null && (
        <span className="text-sm text-text-secondary truncate">{side}</span>
      )}
    </div>
  );
}

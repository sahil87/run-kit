import { useState } from "react";
import { controlClass } from "@/components/control";
import { splitPath, statusLabel, type ReviewFile } from "@/lib/review";

/**
 * ReviewFileRow — one row of the PR's file list.
 *
 * Per the reference screenshot: chevron, filename (bold) + dim path, copy-path
 * button, `+N`/`−N` counts, an Added/Modified badge, a **Mark as viewed**
 * checkbox, and an overflow `⋯`.
 *
 * The body is fetched and rendered LAZILY on expand (spec § R7): mounting the
 * tile must not tokenize two hundred files. The row therefore owns no diff data
 * — it reports the expand and the parent supplies the body.
 *
 * `viewed` is PER-VIEWER state (localStorage, keyed on the head sha so a new
 * push resets it — Constitution IV's layering), which is why it is a prop
 * rather than anything the server knows.
 */
export interface ReviewFileRowProps {
  file: ReviewFile;
  expanded: boolean;
  viewed: boolean;
  /** Unhandled threads anchored to this file — the row's own attention signal,
   *  so a collapsed file still says it wants a human. */
  unhandled: number;
  onToggleExpand: () => void;
  onToggleViewed: (viewed: boolean) => void;
  onCopyPath: () => void;
  children?: React.ReactNode;
}

export function ReviewFileRow({
  file,
  expanded,
  viewed,
  unhandled,
  onToggleExpand,
  onToggleViewed,
  onCopyPath,
  children,
}: ReviewFileRowProps) {
  const { dir, name } = splitPath(file.path);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      data-testid="review-file-row"
      data-path={file.path}
      data-expanded={expanded}
      className={`border-b border-border ${viewed && !expanded ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-1.5 px-2 py-1 text-xs font-mono">
        <button
          type="button"
          aria-expanded={expanded}
          aria-label={`${expanded ? "Collapse" : "Expand"} ${file.path}`}
          onClick={onToggleExpand}
          className="shrink-0 w-4 text-text-secondary hover:text-text-primary select-none"
        >
          {expanded ? "▾" : "▸"}
        </button>

        <span className="truncate">
          <span className="text-text-secondary">{dir}</span>
          <span className="font-bold text-text-primary">{name}</span>
        </span>

        <button
          type="button"
          aria-label={`Copy path ${file.path}`}
          onClick={onCopyPath}
          className={controlClass({ variant: "chip" })}
        >
          ⧉
        </button>

        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {unhandled > 0 && (
            <span
              data-testid="review-file-unhandled"
              title={`${unhandled} unhandled thread${unhandled === 1 ? "" : "s"}`}
              className="text-accent-green"
            >
              ●{unhandled}
            </span>
          )}
          <span className="text-accent-green">+{file.additions}</span>
          <span className="text-signal-red">−{file.deletions}</span>
          <span data-testid="review-file-status" className="text-text-secondary">
            {statusLabel(file.status)}
          </span>
          <label className="flex items-center gap-1 text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={viewed}
              aria-label={`Mark ${file.path} as viewed`}
              onChange={(e) => onToggleViewed(e.target.checked)}
            />
            Viewed
          </label>
          <span className="relative">
            <button
              type="button"
              aria-label={`More actions for ${file.path}`}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen((open) => !open)}
              className={controlClass({ variant: "chip", open: menuOpen })}
            >
              ⋯
            </button>
            {menuOpen && (
              <span
                role="menu"
                className="absolute right-0 top-full z-10 mt-1 min-w-[10rem] rounded border border-border bg-bg-card p-1"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onCopyPath();
                    setMenuOpen(false);
                  }}
                  className={controlClass({ variant: "menu-row" })}
                >
                  Copy path
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    onToggleViewed(!viewed);
                    setMenuOpen(false);
                  }}
                  className={controlClass({ variant: "menu-row" })}
                >
                  {viewed ? "Mark as not viewed" : "Mark as viewed"}
                </button>
              </span>
            )}
          </span>
        </span>
      </div>

      {expanded &&
        (children ?? (file.collapsed ? <LoadDiffNotice file={file} onLoad={onToggleExpand} /> : null))}
    </div>
  );
}

/**
 * The body a file shows when the server declined to expand it eagerly.
 *
 * GitHub's wording and shape: say why the diff is not on screen, and put one
 * button next to it. The two reasons differ in whose fault it is — the file is
 * too big on its own, or the PR ran out of budget before reaching it — and a
 * reader deserves to know which, because only the first means "this file will
 * always be slow".
 */
function LoadDiffNotice({ file, onLoad }: { file: ReviewFile; onLoad: () => void }) {
  const reason =
    file.collapsed === "large"
      ? "Large diffs are not rendered by default."
      : "This diff is collapsed because the pull request is large.";
  return (
    <div className="flex items-center gap-3 border-t border-border-soft px-3 py-2 text-xs text-text-secondary">
      <span>{reason}</span>
      <span className="font-mono">{file.rowCount.toLocaleString()} lines</span>
      <button type="button" className={controlClass({ variant: "chip" })} onClick={onLoad}>
        Load diff
      </button>
    </div>
  );
}

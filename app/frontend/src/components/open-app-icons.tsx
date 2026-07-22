import type { ReactElement, ReactNode } from "react";
import type { OpenTarget } from "@/lib/open-in-app";

/**
 * Open-row icon glyphs (260722-fc3b) — the leading icon on the Open
 * split-button menu rows and the overflow `Open:` rows. Monochrome
 * `currentColor` inline SVGs (~14px, no image fetches, no icon dependency):
 * full-color brand marks would clash with the terminal aesthetic, and
 * `currentColor` lets the existing hover treatments (secondary → primary,
 * accent-green flips) apply to the glyph for free. All glyphs are
 * `aria-hidden` decoration — the row's accessible name stays its text label —
 * and carry a `data-icon` attribute naming the resolution (the test seam;
 * monochrome paths are otherwise indistinguishable to queries).
 *
 * Resolution: an id-keyed brand map first (BOTH `vscode` — the deeplink id —
 * and `code` — the wt host registry id — resolve to the VS Code glyph), then
 * a kind-based generic fallback (editor → code-brackets, terminal → `>_`
 * prompt, file-manager → folder; covers `ghostty_macos`, `terminal_app`,
 * `finder`, and any future registry entry), then a neutral open-in-app
 * arrow for anything kindless. Deeplink targets are implicitly `editor`.
 */

/** Shared 14px glyph wrapper. Stroke-drawn by default (the top-bar chip-glyph
 *  convention); `fill` for silhouette marks (the VS Code ribbon). */
function Glyph({
  name,
  fill = false,
  children,
}: {
  name: string;
  fill?: boolean;
  children: ReactNode;
}) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      data-icon={name}
      aria-hidden="true"
      className="shrink-0"
      {...(fill
        ? { fill: "currentColor", stroke: "none" }
        : {
            fill: "none",
            stroke: "currentColor",
            strokeWidth: 1.8,
            strokeLinecap: "round" as const,
            strokeLinejoin: "round" as const,
          })}
    >
      {children}
    </svg>
  );
}

/** VS Code — the single-color ribbon mark (reads fine as a silhouette). */
function VSCodeGlyph() {
  return (
    <Glyph name="vscode" fill>
      <path d="M23.15 2.587 18.21.21a1.494 1.494 0 0 0-1.705.29l-9.46 8.63-4.12-3.128a.999.999 0 0 0-1.276.057L.327 7.261A1 1 0 0 0 .326 8.74L3.899 12 .326 15.26a1 1 0 0 0 .001 1.479L1.65 17.94a.999.999 0 0 0 1.276.057l4.12-3.128 9.46 8.63a1.492 1.492 0 0 0 1.704.29l4.942-2.377A1.5 1.5 0 0 0 24 20.06V3.939a1.5 1.5 0 0 0-.85-1.352zm-5.146 14.861L10.826 12l7.178-5.448v10.896z" />
    </Glyph>
  );
}

/** Cursor — the wireframe cube mark. */
function CursorGlyph() {
  return (
    <Glyph name="cursor">
      <path d="M12 2 21 7v10l-9 5-9-5V7z" />
      <path d="M12 22V12" />
      <path d="M12 12 21 7" />
      <path d="M12 12 3 7" />
    </Glyph>
  );
}

/** Windsurf — the stacked-sails mark. */
function WindsurfGlyph() {
  return (
    <Glyph name="windsurf">
      <path d="M4 6c6 0 12 1 16 4" />
      <path d="M8 11c4 .2 8 1.2 12 3" />
      <path d="M12 16c3 .2 5.5 1 8 2.5" />
    </Glyph>
  );
}

/** Generic editor — code brackets. */
function EditorGlyph() {
  return (
    <Glyph name="editor">
      <polyline points="16 18 22 12 16 6" />
      <polyline points="8 6 2 12 8 18" />
    </Glyph>
  );
}

/** Generic terminal — the `>_` prompt. */
function TerminalGlyph() {
  return (
    <Glyph name="terminal">
      <polyline points="4 17 10 11 4 5" />
      <line x1="12" y1="19" x2="20" y2="19" />
    </Glyph>
  );
}

/** Generic file manager — a folder. */
function FolderGlyph() {
  return (
    <Glyph name="file-manager">
      <path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />
    </Glyph>
  );
}

/** Neutral fallback — open-in-external-app arrow (unknown id AND kind). */
function AppGlyph() {
  return (
    <Glyph name="app">
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </Glyph>
  );
}

/** Brand glyphs by raw app id — deeplink ids (`vscode`) and wt host registry
 *  ids (`code`, snake_case allowed) both key here. */
const BRAND_ICONS: Record<string, () => ReactElement> = {
  vscode: VSCodeGlyph,
  code: VSCodeGlyph,
  cursor: CursorGlyph,
  windsurf: WindsurfGlyph,
};

/** Generic glyphs by wt registry `kind`. */
const KIND_ICONS: Record<string, () => ReactElement> = {
  editor: EditorGlyph,
  terminal: TerminalGlyph,
  "file-manager": FolderGlyph,
};

/**
 * Resolve an open target's row icon: brand glyph by raw id, else generic by
 * kind (deeplink targets are implicitly `editor`), else the neutral fallback.
 */
export function OpenTargetIcon({ target }: { target: OpenTarget }) {
  const appId = target.kind === "deeplink" ? target.id.slice("deeplink:".length) : target.appId;
  const appKind = target.kind === "deeplink" ? "editor" : target.appKind;
  const Icon =
    BRAND_ICONS[appId] ?? (appKind !== undefined ? KIND_ICONS[appKind] : undefined) ?? AppGlyph;
  return <Icon />;
}

import { statusLabel, type ReviewFile } from "@/lib/review";
import type { ReviewTreeNode } from "@/lib/review-tree";

/**
 * ReviewTree — the PR's changed files as a directory tree, beside the diff.
 *
 * A flat list of 77 paths is a wall; the same paths as a tree are a map. The
 * tree is pure navigation: clicking a file scrolls the diff list to it and
 * focuses it, and nothing here fetches, expands a diff, or owns state. Viewed
 * and unhandled are rendered from the same values the file rows use, so the two
 * halves of the tile can never disagree.
 *
 * The **checkbox deliberately does not appear here**, though the reference tree
 * has one: this tile already has a viewed checkbox on every file row, and two
 * controls for one piece of state, both on screen at once, is a worse problem
 * than the redundancy is a feature. Viewed files dim instead.
 */
export interface ReviewTreeProps {
  nodes: ReviewTreeNode[];
  /** Directory paths currently OPEN. Absent = closed, so a new PR opens flat. */
  openDirs: Set<string>;
  selectedPath: string | null;
  viewedPaths: Set<string>;
  /** Unhandled thread count per path — the tree's own attention signal. */
  unhandledByPath: Map<string, number>;
  onToggleDir: (path: string) => void;
  onSelectFile: (path: string) => void;
}

export function ReviewTree({
  nodes,
  openDirs,
  selectedPath,
  viewedPaths,
  unhandledByPath,
  onToggleDir,
  onSelectFile,
}: ReviewTreeProps) {
  return (
    <div
      data-testid="review-tree"
      role="tree"
      aria-label="Changed files"
      className="h-full overflow-auto py-1 text-xs font-mono select-none"
    >
      {nodes.map((node) => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          openDirs={openDirs}
          selectedPath={selectedPath}
          viewedPaths={viewedPaths}
          unhandledByPath={unhandledByPath}
          onToggleDir={onToggleDir}
          onSelectFile={onSelectFile}
        />
      ))}
    </div>
  );
}

interface TreeNodeProps extends Omit<ReviewTreeProps, "nodes"> {
  node: ReviewTreeNode;
  depth: number;
}

function TreeNode({ node, depth, ...rest }: TreeNodeProps) {
  const { openDirs, selectedPath, viewedPaths, unhandledByPath, onToggleDir, onSelectFile } = rest;
  // Indent is padding on the row, not a wrapper, so the row's hover and
  // selection fills still reach the full width of the panel.
  const indent = { paddingLeft: `${depth * 12 + 6}px` };

  if (node.kind === "dir") {
    const open = openDirs.has(node.path);
    return (
      <>
        <button
          type="button"
          role="treeitem"
          aria-expanded={open}
          data-testid="review-tree-dir"
          data-path={node.path}
          onClick={() => onToggleDir(node.path)}
          style={indent}
          className="flex w-full items-center gap-1 py-0.5 pr-2 text-left text-text-secondary hover:bg-bg-chrome-raised hover:text-text-primary"
        >
          <span className="w-3 shrink-0">{open ? "▾" : "▸"}</span>
          <span className="truncate">{node.name}</span>
        </button>
        {open &&
          node.children.map((child) => (
            <TreeNode key={child.path} node={child} depth={depth + 1} {...rest} />
          ))}
      </>
    );
  }

  const viewed = viewedPaths.has(node.path);
  const unhandled = unhandledByPath.get(node.path) ?? 0;
  const selected = selectedPath === node.path;
  return (
    <button
      type="button"
      role="treeitem"
      data-testid="review-tree-file"
      data-path={node.path}
      aria-current={selected || undefined}
      onClick={() => onSelectFile(node.path)}
      style={indent}
      className={`flex w-full items-center gap-1.5 py-0.5 pr-2 text-left hover:bg-bg-chrome-raised ${
        selected ? "bg-bg-inset" : ""
      } ${viewed ? "opacity-50" : ""}`}
    >
      <span className={`truncate ${statusInk(node.file)}`}>{node.name}</span>
      <span className="ml-auto flex shrink-0 items-center gap-1.5">
        {unhandled > 0 && (
          <span data-testid="review-tree-unhandled" className="text-accent-green">
            ●{unhandled}
          </span>
        )}
        <span className="text-text-secondary">{statusLabel(node.file.status)}</span>
      </span>
    </button>
  );
}

/**
 * Status as INK on the filename, the way the reference tree does it — a second
 * channel over the letter on the right, so a scan down the tree separates new
 * files from edits without reading every row's trailing glyph.
 */
function statusInk(file: ReviewFile): string {
  switch (file.status) {
    case "added":
      return "text-accent-green";
    case "removed":
      return "text-signal-red";
    case "renamed":
      return "text-accent";
    default:
      return "text-text-primary";
  }
}

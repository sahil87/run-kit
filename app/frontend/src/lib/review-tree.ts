import type { ReviewFile } from "@/lib/review";

/**
 * The PR's changed files as a directory tree — the shape VS Code's Pull Request
 * view uses, and the one that makes a 77-file diff navigable.
 *
 * The flat list the API returns is the source of truth; this is a VIEW over it,
 * derived on render and never stored. Nothing here fetches, and a node carries
 * no state of its own: selection, viewed and collapse all live with the
 * surface, so the tree cannot disagree with the rows beside it.
 */

export interface ReviewTreeFile {
  kind: "file";
  /** Leaf name — `pr_review.go`. */
  name: string;
  /** Full path, the identity every other surface keys on. */
  path: string;
  file: ReviewFile;
}

export interface ReviewTreeDir {
  kind: "dir";
  /** Segment name, or the joined run when this directory was collapsed. */
  name: string;
  /** Full path from the root, the collapse key. */
  path: string;
  children: ReviewTreeNode[];
}

export type ReviewTreeNode = ReviewTreeDir | ReviewTreeFile;

/**
 * Builds the tree, directories before files and each group alphabetical — the
 * order every file explorer uses, and the one that keeps a path stable on
 * screen as the PR gains files.
 *
 * Single-child directory runs are COLLAPSED into one node (`app/backend/api`
 * rather than three nested rows). A Go repository is mostly such runs, and
 * spending three rows and three indents on a directory that branches nowhere
 * buys nothing but scrolling.
 */
export function buildReviewTree(files: ReviewFile[]): ReviewTreeNode[] {
  const root: ReviewTreeDir = { kind: "dir", name: "", path: "", children: [] };

  for (const file of files) {
    const segments = file.path.split("/").filter(Boolean);
    const name = segments.pop();
    if (!name) continue;

    let node = root;
    let prefix = "";
    for (const segment of segments) {
      prefix = prefix ? `${prefix}/${segment}` : segment;
      const key = prefix;
      let next = node.children.find(
        (child): child is ReviewTreeDir => child.kind === "dir" && child.path === key,
      );
      if (!next) {
        next = { kind: "dir", name: segment, path: key, children: [] };
        node.children.push(next);
      }
      node = next;
    }
    node.children.push({ kind: "file", name, path: file.path, file });
  }

  sortTree(root);
  compressTree(root);
  return root.children;
}

function sortTree(dir: ReviewTreeDir): void {
  dir.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of dir.children) {
    if (child.kind === "dir") sortTree(child);
  }
}

/** Joins `a > b > c` into one `a/b/c` row wherever the chain never branches. */
function compressTree(dir: ReviewTreeDir): void {
  for (let i = 0; i < dir.children.length; i++) {
    const child = dir.children[i];
    if (child.kind !== "dir") continue;
    let node = child;
    while (node.children.length === 1 && node.children[0].kind === "dir") {
      const only = node.children[0];
      node = {
        kind: "dir",
        name: `${node.name}/${only.name}`,
        // The DEEPEST path wins as the identity: it is what a collapse key and
        // a descendant test both need, and the intermediate segments no longer
        // have rows of their own.
        path: only.path,
        children: only.children,
      };
    }
    dir.children[i] = node;
    compressTree(node);
  }
}

/** Every directory path in the tree — what "expand all" needs. */
export function treeDirPaths(nodes: ReviewTreeNode[]): string[] {
  const out: string[] = [];
  const walk = (list: ReviewTreeNode[]) => {
    for (const node of list) {
      if (node.kind !== "dir") continue;
      out.push(node.path);
      walk(node.children);
    }
  };
  walk(nodes);
  return out;
}

/**
 * The ancestor directory paths of a file, outermost first — the set that must
 * be open for the file to be on screen.
 *
 * Compression means a file's ancestors are NOT simply its path prefixes, so
 * this walks the built tree rather than splitting the string.
 */
export function ancestorDirs(nodes: ReviewTreeNode[], path: string): string[] {
  const trail: string[] = [];
  const walk = (list: ReviewTreeNode[], acc: string[]): boolean => {
    for (const node of list) {
      if (node.kind === "file") {
        if (node.path === path) {
          trail.push(...acc);
          return true;
        }
        continue;
      }
      if (walk(node.children, [...acc, node.path])) return true;
    }
    return false;
  };
  walk(nodes, []);
  return trail;
}

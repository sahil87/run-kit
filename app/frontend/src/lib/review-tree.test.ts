import { describe, expect, it } from "vitest";
import { ancestorDirs, buildReviewTree, treeDirPaths, type ReviewTreeDir } from "@/lib/review-tree";
import type { ReviewFile } from "@/lib/review";

const file = (path: string): ReviewFile => ({
  path,
  status: "modified",
  additions: 1,
  deletions: 0,
  hasPatch: true,
  rowCount: 2,
});

describe("buildReviewTree", () => {
  it("nests files under their directories", () => {
    const tree = buildReviewTree([file("app/backend/api/pr_review.go"), file("app/frontend/src/review.ts")]);
    expect(tree).toHaveLength(1);
    const app = tree[0] as ReviewTreeDir;
    expect(app.kind).toBe("dir");
    expect(app.name).toBe("app");
    expect(app.children.map((c) => c.name)).toEqual(["backend/api", "frontend/src"]);
  });

  it("collapses single-child directory runs into one row", () => {
    const tree = buildReviewTree([file("a/b/c/d/leaf.go")]);
    // Five segments, but the chain never branches, so it is ONE row — not four
    // indents spent on directories that branch nowhere.
    expect(tree).toHaveLength(1);
    expect(tree[0].name).toBe("a/b/c/d");
    expect(tree[0].path).toBe("a/b/c/d");
    expect((tree[0] as ReviewTreeDir).children.map((c) => c.name)).toEqual(["leaf.go"]);
  });

  it("stops compressing where the chain branches", () => {
    const tree = buildReviewTree([file("app/backend/api/a.go"), file("app/frontend/b.ts")]);
    const app = tree[0] as ReviewTreeDir;
    // `app` branches, so it keeps its own row; each branch then compresses.
    expect(app.name).toBe("app");
    expect(app.children.map((c) => c.name)).toEqual(["backend/api", "frontend"]);
  });

  it("sorts directories before files, each alphabetically", () => {
    const tree = buildReviewTree([
      file("zeta.md"),
      file("alpha.md"),
      file("src/one.ts"),
      file("lib/two.ts"),
    ]);
    expect(tree.map((n) => n.name)).toEqual(["lib", "src", "alpha.md", "zeta.md"]);
  });

  it("keeps a root-level file at the root", () => {
    const tree = buildReviewTree([file("go.mod")]);
    expect(tree).toHaveLength(1);
    expect(tree[0].kind).toBe("file");
    expect(tree[0].path).toBe("go.mod");
  });

  it("carries the file through so the row can render status without a lookup", () => {
    const entry = { ...file("a/b.go"), additions: 42 };
    const tree = buildReviewTree([entry]);
    const dir = tree[0] as ReviewTreeDir;
    const leaf = dir.children[0];
    expect(leaf.kind).toBe("file");
    if (leaf.kind === "file") expect(leaf.file.additions).toBe(42);
  });
});

describe("ancestorDirs", () => {
  it("returns the ancestors that must be open, outermost first", () => {
    const tree = buildReviewTree([file("app/backend/api/x.go"), file("app/frontend/y.ts")]);
    expect(ancestorDirs(tree, "app/backend/api/x.go")).toEqual(["app", "app/backend/api"]);
  });

  it("returns compressed ancestors, not path prefixes", () => {
    const tree = buildReviewTree([file("a/b/c/leaf.go")]);
    // "a" and "a/b" have no rows of their own after compression, so revealing
    // the leaf means opening "a/b/c" — splitting the path would name two
    // directories that do not exist on screen.
    expect(ancestorDirs(tree, "a/b/c/leaf.go")).toEqual(["a/b/c"]);
  });

  it("is empty for a root file and for an unknown path", () => {
    const tree = buildReviewTree([file("go.mod")]);
    expect(ancestorDirs(tree, "go.mod")).toEqual([]);
    expect(ancestorDirs(tree, "nope.go")).toEqual([]);
  });
});

describe("treeDirPaths", () => {
  it("lists every directory, nested ones included", () => {
    const tree = buildReviewTree([file("app/backend/x.go"), file("app/frontend/z/y.ts")]);
    expect(treeDirPaths(tree).sort()).toEqual(["app", "app/backend", "app/frontend/z"].sort());
  });
});

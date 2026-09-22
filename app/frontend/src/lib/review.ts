/**
 * Pure helpers for the `review` surface — the PR-backed diff review tile
 * (spec `docs/specs/pr-review.md`).
 *
 * Everything here is pure and DOM-free except the thin try/catch-noop
 * localStorage wrappers, mirroring `window-view.ts` / `surface-layout.ts`: the
 * wire types, the actor-blind eligibility predicate, the per-viewer viewed-state
 * store, and the unread-count selector the surface toggle's dot reads. Keeping
 * them here means the renderer, the palette and the unit tests share one source.
 *
 * NO highlighting dependency ships with this surface. Token spans arrive from
 * the backend (Chroma, spec § R5) already split per line, which is what lets the
 * comment layer interleave between rows.
 */

/** Which image a row belongs to — GitHub's own half of a comment address. */
export type ReviewSide = "L" | "R";

/** The four row kinds the unified renderer draws. */
export type ReviewRowKind = "hunk" | "ctx" | "add" | "del";

/** One run of same-class text on a line. `c` is Chroma's short class name and
 *  is absent for plain text — the class repeats once per token on every line
 *  shipped, so its length is payload. */
export interface ReviewSpan {
  c?: string;
  t: string;
}

/**
 * One rendered row. `side` + `l` are GitHub's (side, line) address; `at` is a
 * deleted row's post-image anchor — the line the deletion sat before. Together
 * with the file path they are the anchoring contract (§ R6), rendered as
 * `data-side` / `data-l` / `data-at`.
 */
export interface ReviewRow {
  kind: ReviewRowKind;
  side?: ReviewSide;
  l?: number;
  left?: number;
  right?: number;
  at?: number;
  header?: string;
  spans?: ReviewSpan[];
}

/** One file's rows plus the refinement flag and the bounds the context
 *  expanders need. */
export interface ReviewFileBody {
  path: string;
  rows: ReviewRow[];
  /** True when any row came from a tier-1 lexing window that may have guessed.
   *  The client re-requests the file ONCE to swap the corrected lines in
   *  place; it never polls on it. */
  refine: boolean;
  totalLines: number;
  headSha: string;
  baseSha: string;
  highlighted: boolean;
}

export interface ReviewFile {
  path: string;
  previousPath?: string;
  status: string;
  additions: number;
  deletions: number;
  sha?: string;
  hasPatch: boolean;
}

export interface ReviewComment {
  id: string;
  databaseId?: number;
  author: string;
  body: string;
  createdAt: string;
  url?: string;
  /** The 👀 reaction. Only the FIRST comment's flag is load-bearing — it is the
   *  dedupe marker, and it is read actor-blind. */
  eyes: boolean;
}

export interface ReviewThread {
  id: string;
  isResolved: boolean;
  isOutdated: boolean;
  path: string;
  line: number;
  startLine?: number;
  side: string;
  comments: ReviewComment[];
}

export interface ReviewDocument {
  url: string;
  number: number;
  repo: string;
  title: string;
  state: string;
  headSha: string;
  baseSha: string;
  viewer: string;
  files: ReviewFile[];
  threads: ReviewThread[];
  fetchedAt: string;
  /** The window's `@rk_win_pr_listen` arm — shared across viewers, because
   *  arming is a fact about the work, not a viewing posture. */
  listening: boolean;
}

/**
 * The eligibility predicate:
 *
 *     unhandled(t) ≡ !isResolved ∧ !isOutdated ∧ !hasEyes(firstComment)
 *
 * ACTOR-BLIND by design (§ Dedupe): it performs no identity join. 👀 means
 * "claimed, by whoever put it there" — a human reacting 👀 suppresses dispatch
 * exactly as the listener's own mark does, and un-reacting releases the claim.
 * The frontend mirrors the backend predicate so the toggle's dot and the
 * listener can never disagree about what is outstanding.
 */
export function isUnhandled(thread: ReviewThread): boolean {
  if (thread.isResolved || thread.isOutdated) return false;
  return thread.comments[0]?.eyes !== true;
}

/**
 * The rendering state of a thread that EXISTS on GitHub — four of the six rows
 * of `docs/wiki/review-comment-states.html`. The remaining two are not thread
 * states: "open, new reply after the mark" is `dispatched` (see below), and
 * "pending review" is a local, unsubmitted comment that has no thread at all
 * and renders as its own card.
 */
export type ThreadState = "open" | "dispatched" | "resolved" | "outdated";

/**
 * Which state a thread renders in.
 *
 * A marked thread reads `dispatched` whether or not a reply landed after the
 * mark, because the backend predicate is 👀-on-the-first-comment only and a
 * reply never clears it (spec § The loop guard: a reply-triggered requeue would
 * fire on the AGENT'S OWN reply, which is the feedback loop the marker exists
 * to prevent). Re-queueing is the human gesture of un-reacting 👀, so a
 * "re-queued" rendering would claim a behaviour the listener does not have.
 */
export function threadState(thread: ReviewThread): ThreadState {
  if (thread.isResolved) return "resolved";
  if (thread.isOutdated) return "outdated";
  return thread.comments[0]?.eyes === true ? "dispatched" : "open";
}

/**
 * One comment the viewer batched into a pending review — the sixth comment
 * state. It is LOCAL ONLY: `gh` does not expose an unsubmitted review's
 * comments, so the tile holds them in component memory for the mount and
 * renders them with an amber left edge to say so (Constitution II — nothing is
 * persisted, and a reload correctly forgets them).
 */
export interface PendingReviewComment {
  path: string;
  side: ReviewSide;
  line: number;
  body: string;
}

/** A ```suggestion fence with nothing else in the body. A thread whose every
 *  comment is one of these is a mechanical edit GitHub commits with one button,
 *  so the listener never spends an agent turn on it. */
export function isSuggestionOnlyBody(body: string): boolean {
  let inFence = false;
  let sawSuggestion = false;
  for (const line of body.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (!inFence) {
        if (trimmed.slice(3).toLowerCase() !== "suggestion") return false;
        sawSuggestion = true;
      }
      inFence = !inFence;
      continue;
    }
    if (inFence || trimmed === "") continue;
    return false;
  }
  return sawSuggestion && !inFence;
}

/** The suggestion body of a comment, or undefined. Rendered as a mini-diff with
 *  an Apply button. */
export function suggestionBody(body: string): string | undefined {
  const lines = body.split("\n");
  const open = lines.findIndex((l) => l.trim().toLowerCase() === "```suggestion");
  if (open < 0) return undefined;
  const close = lines.findIndex((l, i) => i > open && l.trim() === "```");
  if (close < 0) return undefined;
  return lines.slice(open + 1, close).join("\n");
}

/**
 * The backtick-quoted fragments in a comment body — the identifiers a reviewer
 * names when they say "rename `reviewMeta` for symmetry". They are what the
 * diff decorates on the thread's anchored row, because a reviewer quoting a
 * symbol is pointing at it.
 *
 * Fenced blocks are skipped: a ` ```suggestion ` body is a replacement, not a
 * reference, and decorating every token in it would light up the whole line.
 */
export function quotedCodeSpans(body: string): string[] {
  const out: string[] = [];
  for (const line of body.split("\n")) {
    if (line.trim().startsWith("```")) break;
    for (const match of line.matchAll(/`([^`\n]{1,80})`/g)) {
      const needle = match[1].trim();
      if (needle !== "" && !out.includes(needle)) out.push(needle);
    }
  }
  return out;
}

/** Threads anchored to a file, in the order gh returned them (oldest first). */
export function threadsForFile(doc: ReviewDocument | null, path: string): ReviewThread[] {
  return (doc?.threads ?? []).filter((t) => t.path === path);
}

/** The unhandled-thread count the surface toggle's dot reads. Counting
 *  UNHANDLED rather than all unresolved threads makes the signal go quiet as
 *  work is claimed, which is what the marker means. */
export function unhandledCount(doc: ReviewDocument | null | undefined): number {
  return (doc?.threads ?? []).filter(isUnhandled).length;
}

// ── per-viewer viewed state (Constitution IV's layering) ────────────────────

/**
 * The Mark-as-viewed key. The HEAD SHA in the key is what resets the state on a
 * new push, matching GitHub: a new sha yields a new key, so nothing has to be
 * cleared.
 */
export function viewedStorageKey(prUrl: string, sha: string, path: string): string {
  return `rk-review-viewed:${prUrl}:${sha}:${path}`;
}

/** Read a file's viewed state. Absent, malformed, or an unavailable
 *  localStorage (SSR/jsdom/quota) all read as not-viewed — the try/catch-noop
 *  pattern, with validate-on-read for the untrusted value. */
export function readViewed(prUrl: string, sha: string, path: string): boolean {
  try {
    return localStorage.getItem(viewedStorageKey(prUrl, sha, path)) === "1";
  } catch {
    return false;
  }
}

/** Persist a file's viewed state; `false` removes the key. Best-effort. */
export function writeViewed(prUrl: string, sha: string, path: string, viewed: boolean): void {
  try {
    const key = viewedStorageKey(prUrl, sha, path);
    if (viewed) localStorage.setItem(key, "1");
    else localStorage.removeItem(key);
  } catch {
    /* noop — best-effort persistence */
  }
}

/** The composer's header reference: `R264` (right/new side line 264) or `L120`
 *  (left/old). */
export function lineRef(side: ReviewSide, line: number): string {
  return `${side}${line}`;
}

/** A file row's short name + dim directory, split once so the row and the
 *  palette label agree. */
export function splitPath(path: string): { dir: string; name: string } {
  const cut = path.lastIndexOf("/");
  if (cut < 0) return { dir: "", name: path };
  return { dir: path.slice(0, cut + 1), name: path.slice(cut + 1) };
}

/** The Added/Modified/Removed/Renamed badge label for a file's gh status. */
export function statusLabel(status: string): string {
  switch (status) {
    case "added":
      return "Added";
    case "removed":
      return "Removed";
    case "renamed":
      return "Renamed";
    default:
      return "Modified";
  }
}

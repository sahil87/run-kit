import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  fetchPRReview,
  fetchPRReviewFile,
  postPRReviewComment,
  postPRReviewListen,
  postPRReviewRefresh,
  postPRReviewThread,
} from "@/api/client";
import { controlClass } from "@/components/control";
import { ReviewDiff } from "@/components/review-diff";
import { ReviewFileRow } from "@/components/review-file-row";
import { mergeContextRows } from "@/lib/review-rows";
import {
  isUnhandled,
  readViewed,
  threadsForFile,
  unhandledCount,
  writeViewed,
  type PendingReviewComment,
  type ReviewComment,
  type ReviewDocument,
  type ReviewFileBody,
  type ReviewSide,
  type ReviewThread,
} from "@/lib/review";

/**
 * ReviewSurface — the `review` tile: the window's pull request rendered the way
 * GitHub's "Files changed" tab does, plus the comment listener's arm switch
 * (spec `docs/specs/pr-review.md`).
 *
 * The surface is **PR-backed only**. Availability is decided upstream by
 * `hasReview` (the window's branch-derived `prUrl`), so this component renders
 * only for a window that HAS a PR; what it selects between are the CONTENT
 * states — loading, unreachable gh, an empty diff, and the live list. That is
 * the same availability-vs-reachability split the `code` surface uses.
 *
 * **The file list is virtualized, the diff body is not** (§ R7): one file's diff
 * is bounded by that file, but the number of files in a PR is not, so only the
 * rows near the viewport are mounted and each file's body is fetched lazily on
 * expand.
 *
 * Refreshes are event-driven, never polled: the tile loads on mount, on a
 * window/PR change, on the SSE tick's unhandled-thread digest changing, and on
 * the explicit refresh verb. There is no `setInterval` anywhere in the surface.
 */
export interface ReviewSurfaceProps {
  server: string;
  windowId: string;
  /** The window's PR URL — present by construction (the tile is unreachable
   *  without one), threaded in so a PR change remounts the content. */
  prUrl: string;
  /** The window's unhandled-thread count from the SSE payload
   *  (`prReviewUnhandled`, joined server-side from the prstatus digest). It is
   *  the tile's REVALIDATION signal: the digest changing means a comment
   *  landed, was claimed or was resolved, so the detail document is stale. The
   *  tile never polls — this is a pushed value. */
  digestUnhandled?: number;
  /** Imperative verb seams the command palette drives (Constitution V). */
  commandsRef?: { current: ReviewSurfaceCommands | null };
  /** Reports the unhandled-thread count up to the toggle's dot. */
  onUnhandledChange?: (count: number) => void;
  /** Reports the listener arm up, so the palette's listen row can name the
   *  destination state rather than the current one. */
  onListeningChange?: (listening: boolean) => void;
}

/** The verbs the palette reaches this surface through. Every one is also a
 *  pointer affordance in the tile; the palette is the complete registry
 *  (Constitution V). */
export interface ReviewSurfaceCommands {
  toggleListen: () => void;
  nextFile: () => void;
  previousFile: () => void;
  expandFocusedFile: () => void;
  markFocusedViewed: () => void;
  refresh: () => void;
  /** Open a composer on the focused file's first commentable line. */
  commentOnFocusedLine: () => void;
  /** Reply on / resolve the focused file's first unhandled thread. */
  replyToFocusedThread: () => void;
  resolveFocusedThread: () => void;
}

/** How many file rows are mounted beyond the visible window. Enough that a
 *  flick-scroll never shows a gap, small enough that a 200-file PR mounts a
 *  couple of dozen rows. */
const FILE_OVERSCAN = 6;
/** The measured row height the virtualizer computes geometry from. Typography
 *  is fixed for this list, so the height is a constant rather than a per-row
 *  measurement — geometry stays algebraic and paint never reads layout. */
const FILE_ROW_HEIGHT = 28;

export function ReviewSurface({
  server,
  windowId,
  prUrl,
  digestUnhandled,
  commandsRef,
  onUnhandledChange,
  onListeningChange,
}: ReviewSurfaceProps) {
  const [doc, setDoc] = useState<ReviewDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [bodies, setBodies] = useState<Record<string, ReviewFileBody>>({});
  // Comments the viewer batched into a pending review — the sixth comment
  // state. `gh` cannot see an unsubmitted review, so this is the only record
  // there is, and it is deliberately component memory: a reload forgetting them
  // is honest, because the tile never knew whether the review was submitted.
  const [pending, setPending] = useState<PendingReviewComment[]>([]);
  // localStorage has no change notification, so a write bumps this tick and the
  // viewed set below re-derives. Deriving from storage rather than holding the
  // set in state is what lets a second tab's write land on the next render.
  const [viewedTick, setViewedTick] = useState(0);
  const [focused, setFocused] = useState(0);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  // The last digest count this tile acted on — see the revalidation effect.
  const seenDigest = useRef<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchPRReview(server, windowId);
      setDoc(next);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load the pull request");
    } finally {
      setLoading(false);
    }
  }, [server, windowId]);

  // Identity changes reset the whole tile. No interval: freshness comes from
  // the digest effect below and from the explicit refresh verb.
  useEffect(() => {
    setDoc(null);
    setBodies({});
    setExpanded(new Set());
    setPending([]);
    seenDigest.current = null;
    void load();
  }, [load, prUrl]);

  // The SSE tick's revalidation seam. The digest is polled server-side on the
  // collector cadence and pushed down the existing `event: sessions` payload,
  // so a CHANGE in the count means the detail document is stale — a PUSH, not a
  // poll (the tile owns no timer). The first observed value is skipped: the
  // effect above already loaded for it, and revalidating a document that was
  // just fetched would double every mount's cost.
  useEffect(() => {
    if (digestUnhandled === undefined) return;
    const previous = seenDigest.current;
    seenDigest.current = digestUnhandled;
    if (previous === null || previous === digestUnhandled) return;
    void load();
  }, [digestUnhandled, load]);

  useEffect(() => {
    onUnhandledChange?.(unhandledCount(doc));
    onListeningChange?.(doc?.listening ?? false);
  }, [doc, onUnhandledChange, onListeningChange]);

  // The virtualizer needs the viewport height; it is read once per resize, not
  // per paint.
  useEffect(() => {
    const element = scrollRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setViewportHeight(element.clientHeight));
    observer.observe(element);
    setViewportHeight(element.clientHeight);
    return () => observer.disconnect();
  }, [doc]);

  const files = doc?.files ?? [];
  const loadFileBody = useCallback(
    async (path: string, range?: { start: number; count: number }) => {
      try {
        const body = await fetchPRReviewFile(server, windowId, path, range);
        setBodies((prev) => {
          const current = prev[path];
          // A RANGE response is a context expansion: it carries only the lines
          // asked for, so it SPLICES into the file's diff. Writing it over the
          // body would replace the unified diff with a flat list of context
          // rows and lose the file's hunks (spec § R6/R7). A rangeless
          // response IS the file's diff (the initial load and the refine swap)
          // and replaces it.
          if (!range || !current) return { ...prev, [path]: body };
          return {
            ...prev,
            [path]: {
              ...current,
              rows: mergeContextRows(current.rows, body.rows),
              totalLines: body.totalLines || current.totalLines,
            },
          };
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to load ${path}`);
      }
    },
    [server, windowId],
  );

  const toggleExpand = useCallback(
    (path: string) => {
      setExpanded((prev) => {
        const next = new Set(prev);
        if (next.has(path)) {
          next.delete(path);
        } else {
          next.add(path);
          if (!bodies[path]) void loadFileBody(path);
        }
        return next;
      });
    },
    [bodies, loadFileBody],
  );

  const mutate = useCallback(
    async (action: () => Promise<unknown>) => {
      setBusy(true);
      try {
        await action();
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : "The write failed");
      } finally {
        setBusy(false);
      }
    },
    [load],
  );

  const setListening = useCallback(
    (listening: boolean) =>
      mutate(() => postPRReviewListen(server, windowId, listening)),
    [mutate, server, windowId],
  );

  const refresh = useCallback(async () => {
    await postPRReviewRefresh(server, windowId).catch(() => undefined);
    await load();
  }, [server, windowId, load]);

  const comment = useCallback(
    (path: string) =>
      async (side: ReviewSide, line: number, body: string, mode: "single" | "review") => {
        await mutate(() =>
          postPRReviewComment(server, {
            window: windowId,
            path,
            line,
            side,
            body,
            mode,
          }),
        );
        // A review-mode comment lands in the viewer's PENDING review, which gh
        // does not expose, so the tile keeps its own record to render the
        // pending-review state. A single-mode comment comes back as a real
        // thread on the reload `mutate` just ran.
        if (mode === "review") {
          setPending((prev) => [...prev, { path, side, line, body }]);
        }
      },
    [mutate, server, windowId],
  );

  const reply = useCallback(
    (thread: ReviewThread, body: string) =>
      mutate(() =>
        postPRReviewComment(server, {
          window: windowId,
          replyTo: thread.comments[0]?.databaseId,
          body,
        }),
      ),
    [mutate, server, windowId],
  );

  const resolve = useCallback(
    (thread: ReviewThread, resolved: boolean) =>
      mutate(() => postPRReviewThread(server, windowId, thread.id, resolved)),
    [mutate, server, windowId],
  );

  /**
   * Apply a suggestion block. GitHub's own Apply is a web-only action — there
   * is no REST or GraphQL verb for it — so this composes the two halves the
   * design authority names (`review-comment-states.html` § 7: "suggestion-only
   * threads are marked handled when the suggestion is applied"): the
   * replacement goes to the clipboard as the mechanical edit, and the thread is
   * RESOLVED, which is what marks it handled and is why the listener never
   * spends an agent turn on one.
   */
  const applySuggestion = useCallback(
    (thread: ReviewThread, _comment: ReviewComment, body: string) => {
      void (async () => {
        await copyText(body);
        await resolve(thread, true);
      })();
    },
    [resolve],
  );

  const toggleViewed = useCallback(
    (path: string, viewed: boolean) => {
      if (!doc) return;
      writeViewed(doc.url, doc.headSha, path, viewed);
      setViewedTick((tick) => tick + 1);
    },
    [doc],
  );

  // Palette seams. Declared after the verbs they call so each is the same
  // function the pointer affordance runs — one implementation, two entry
  // points.
  useEffect(() => {
    if (!commandsRef) return;
    const focusedFile = () => files[Math.min(focused, files.length - 1)];
    commandsRef.current = {
      toggleListen: () => void setListening(!(doc?.listening ?? false)),
      nextFile: () => setFocused((i) => Math.min(i + 1, Math.max(files.length - 1, 0))),
      previousFile: () => setFocused((i) => Math.max(i - 1, 0)),
      expandFocusedFile: () => {
        const file = focusedFile();
        if (file) toggleExpand(file.path);
      },
      markFocusedViewed: () => {
        const file = focusedFile();
        if (!file || !doc) return;
        toggleViewed(file.path, !readViewed(doc.url, doc.headSha, file.path));
      },
      refresh: () => void refresh(),
      commentOnFocusedLine: () => {
        const file = focusedFile();
        if (!file) return;
        if (!expanded.has(file.path)) toggleExpand(file.path);
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-path="${cssEscape(file.path)}"] [data-l]`)
          ?.querySelector("button")
          ?.click();
      },
      replyToFocusedThread: () => {
        const file = focusedFile();
        if (!file) return;
        if (!expanded.has(file.path)) toggleExpand(file.path);
        scrollRef.current
          ?.querySelector<HTMLElement>(`[data-path="${cssEscape(file.path)}"] [data-thread-id]`)
          ?.scrollIntoView({ block: "center" });
      },
      resolveFocusedThread: () => {
        const file = focusedFile();
        if (!file || !doc) return;
        const thread = threadsForFile(doc, file.path).find(isUnhandled);
        if (thread) void resolve(thread, true);
      },
    };
    return () => {
      commandsRef.current = null;
    };
  }, [
    commandsRef,
    doc,
    expanded,
    files,
    focused,
    refresh,
    resolve,
    setListening,
    toggleExpand,
    toggleViewed,
  ]);

  const unhandled = useMemo(() => unhandledCount(doc), [doc]);
  const viewedPaths = useMemo(() => {
    const paths = new Set<string>();
    if (!doc) return paths;
    for (const file of doc.files) {
      if (readViewed(doc.url, doc.headSha, file.path)) paths.add(file.path);
    }
    return paths;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- viewedTick is the
    // localStorage-write signal; it carries no value of its own.
  }, [doc, viewedTick]);

  // Virtualization geometry: a spacer sized totalRows × rowHeight with only the
  // visible band (plus overscan) mounted, translated into place.
  const first = Math.max(0, Math.floor(scrollTop / FILE_ROW_HEIGHT) - FILE_OVERSCAN);
  const visibleCount = Math.ceil(viewportHeight / FILE_ROW_HEIGHT) + FILE_OVERSCAN * 2;
  // An EXPANDED file breaks the fixed-height assumption, so once anything is
  // expanded the list renders in full — a PR with an expanded file is a PR the
  // user is reading, not scrolling past.
  const virtualized = expanded.size === 0 && files.length > visibleCount;
  const slice = virtualized ? files.slice(first, first + visibleCount) : files;

  if (loading && !doc) {
    return <SurfaceMessage testId="review-loading">loading the pull request…</SurfaceMessage>;
  }
  if (!doc) {
    return (
      <SurfaceMessage testId="review-error">
        {error ?? "the pull request is unavailable"}
      </SurfaceMessage>
    );
  }

  return (
    <div className="flex-1 min-h-0 flex flex-col" data-testid="review-surface">
      <div className="flex items-center gap-2 px-2 py-1 border-b border-border text-xs font-mono">
        <a
          href={doc.url}
          target="_blank"
          rel="noreferrer"
          className="text-accent hover:text-accent-bright truncate"
        >
          {doc.repo}#{doc.number}
        </a>
        <span className="truncate text-text-secondary">{doc.title}</span>
        <span className="ml-auto flex items-center gap-1.5 shrink-0">
          {files.length > 0 && (
            <span data-testid="review-viewed-progress" className="text-text-secondary">
              {viewedPaths.size} / {files.length} files viewed
            </span>
          )}
          {unhandled > 0 && (
            <span data-testid="review-unhandled-count" className="text-accent-green">
              {unhandled} unhandled
            </span>
          )}
          <button
            type="button"
            aria-pressed={doc.listening}
            aria-label="Listen for review comments"
            disabled={busy}
            onClick={() => void setListening(!doc.listening)}
            className={controlClass({
              variant: "chip",
              pressed: doc.listening,
              disabled: busy || undefined,
            })}
          >
            {doc.listening ? "👂 listening" : "👂 listen"}
          </button>
          <button
            type="button"
            aria-label="Refresh the pull request"
            disabled={busy}
            onClick={() => void refresh()}
            className={controlClass({ variant: "chip", disabled: busy || undefined })}
          >
            ⟳
          </button>
        </span>
      </div>

      {error && (
        <div data-testid="review-banner" className="px-2 py-1 text-xs font-mono text-signal-red">
          {error}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}
        className="flex-1 min-h-0 overflow-y-auto"
      >
        {files.length === 0 ? (
          <SurfaceMessage testId="review-empty">this pull request changes no files</SurfaceMessage>
        ) : (
          <div style={virtualized ? { height: files.length * FILE_ROW_HEIGHT } : undefined}>
            <div style={virtualized ? { transform: `translateY(${first * FILE_ROW_HEIGHT}px)` } : undefined}>
              {slice.map((file, index) => {
                const absolute = virtualized ? first + index : index;
                const body = bodies[file.path];
                const fileThreads = threadsForFile(doc, file.path);
                return (
                  <div
                    key={file.path}
                    className={absolute === focused ? "outline outline-1 outline-border" : undefined}
                  >
                    <ReviewFileRow
                      file={file}
                      expanded={expanded.has(file.path)}
                      viewed={viewedPaths.has(file.path)}
                      unhandled={fileThreads.filter(isUnhandled).length}
                      onToggleExpand={() => {
                        setFocused(absolute);
                        toggleExpand(file.path);
                      }}
                      onToggleViewed={(next) => toggleViewed(file.path, next)}
                      onCopyPath={() => void copyText(file.path)}
                    >
                      {body ? (
                        <ReviewDiff
                          body={body}
                          threads={fileThreads}
                          pending={pending.filter((entry) => entry.path === file.path)}
                          busy={busy}
                          onLoadRange={(range) => loadFileBody(file.path, range)}
                          onComment={comment(file.path)}
                          onReply={reply}
                          onResolve={resolve}
                          onApplySuggestion={applySuggestion}
                        />
                      ) : (
                        <div className="px-2 py-1 text-xs font-mono text-text-secondary">
                          loading the diff…
                        </div>
                      )}
                    </ReviewFileRow>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

async function copyText(value: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(value);
  } catch {
    /* noop — clipboard access is a permission, not a contract */
  }
}

/** CSS.escape with a manual fallback: jsdom and older engines lack it, and a
 *  path with a dot would otherwise build a class selector. */
function cssEscape(value: string): string {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") return CSS.escape(value);
  return value.replace(/["\\]/g, "\\$&");
}

function SurfaceMessage({ testId, children }: { testId: string; children: React.ReactNode }) {
  return (
    <div
      data-testid={testId}
      className="flex-1 min-h-0 flex items-center justify-center text-text-secondary text-xs font-mono select-none"
    >
      {children}
    </div>
  );
}

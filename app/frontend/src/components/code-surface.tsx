import { useEffect, useRef } from "react";
import type { CodeBridgeResult } from "@/api/client";
import {
  CODE_BOOT_RESCUE_WAIT_MS,
  decideRescue,
  isWorkspaceSrc,
} from "@/lib/code-boot-rescue";

/**
 * CodeSurface — the renderer for the `code` lens AND the panel's CODE surface
 * (change 260811-k3vp-right-panel-code-lens; the daemon-managed stable route
 * 260811-a2bo; spec docs/specs/right-panel.md § The code lens).
 *
 * Deliberately a NEW lean component, NOT `IframeWindow`: the code-server URL is
 * fully DERIVED (`/code/?workspace=<tab-keyed workspace file>`, with
 * `/code/?folder=…` as the degrade form), so the URL bar — `@rk_win_url`
 * substrate state — is meaningless here, and IframeWindow reuse would drag in
 * inapplicable chrome. It is exactly an iframe plus the pending and
 * not-running states.
 *
 * - **Availability vs reachability**: availability (gitRoot derived — the git
 *   toplevel, falling back to the raw cwd outside any repo; the port is always
 *   resolvable by convention since a2bo) is computed upstream — this
 *   component renders only when the lens/surface was resolved. REACHABILITY
 *   selects the content: a reachable code-server renders the iframe once the
 *   workspace src is resolved (the terse pending state until then); an
 *   unreachable one renders the terse monospace empty state instead of a dead
 *   iframe.
 * - **Relative path discipline**: `codeServerSrc` returns the STABLE
 *   root-relative path `/code/?folder=…` and never composes an absolute origin
 *   — the same convention `toProxySrc` (iframe-window.tsx) follows, so the
 *   embed works behind any origin or reverse proxy. The pathname is workspace-
 *   state identity (code-server keys IndexedDB by it); it never carries the
 *   port, so it can never change.
 * - **Chord reclaim (keyboard-capture spike, intake §5)**: same-origin makes an
 *   escape hatch possible — a capture-phase `keydown` listener on the iframe's
 *   `contentDocument` intercepts run-kit's registry chords BEFORE the embedded
 *   app's keybinding service sees them and re-dispatches them to the parent
 *   window. The predicate is INJECTED (`shouldReclaimChord`, built in app.tsx
 *   from the keybinding registry) so this component stays free of the registry
 *   import graph, and only registry chords are reclaimed — the embedded app's
 *   own Ctrl/⌘ bindings keep working. Failure mode is benign: a cross-origin
 *   or pre-load frame simply skips the attach (click-out remains the escape).
 * - **Latched folder (260813-if5d)**: `gitRoot` arrives already LATCHED (app.tsx
 *   substitutes it) — this component's contribution is the two halves the latch
 *   needs at the iframe itself. (a) The `src` is computed once per MOUNT
 *   GENERATION, never reactively from the prop: re-setting `src` on a live frame
 *   re-navigates it even to the URL it is already at, which would destroy the
 *   editor state the latch exists to protect (spec P3 — hide, never unmount).
 *   (b) The same-origin `load` seam reports where the EDITOR navigated itself
 *   (File > Open Folder → a full workbench navigation to `/code/?folder=…`) via
 *   `onFolderNavigated`, so the latch follows the editor. Derivation seeds the
 *   latch exactly once; thereafter only the editor moves it, never the terminal.
 * - **First-boot rescue**: a never-cached `?workspace=` boot can load zero
 *   folders (the bridge extension then never registers a host record). When the
 *   `fetchBridgeStatus` seam is injected, a `?workspace=` mount generation
 *   reads the bridge status once at src adoption (baseline) and once at
 *   `CODE_BOOT_RESCUE_WAIT_MS` after the first `load` (verdict), and a
 *   `decideRescue` "reload" verdict re-navigates the frame via
 *   `contentWindow.location.reload()` — the SECOND sanctioned parent
 *   re-navigation, at most once per mount generation, and never a `src` write.
 *   Not-installed and unavailable statuses fail closed (no reload, one warning
 *   per generation); `?folder=` mounts are never rescued.
 */

/**
 * The relative URL for the window's code-server folder, via the stable /code/
 * route (260811-a2bo — the code-server port is a server-side implementation
 * detail and never appears here). code-server restores per-folder state from
 * the `?folder=` param, and keys browser-side workspace state by the proxy
 * PATHNAME — /code/ is deliberately constant so the state survives restarts.
 */
export function codeServerSrc(gitRoot: string): string {
  return `/code/?folder=${encodeURIComponent(gitRoot)}`;
}

/**
 * The relative URL for the window's tab-keyed workspace file, via the same
 * stable /code/ route and the same relative-path discipline as
 * `codeServerSrc` — never an origin, never a port, and the pathname stays
 * constant (code-server keys browser-side workspace state by it). The
 * `?workspace=` form is the PRIMARY mount src; `?folder=` survives as the
 * degrade path and the editor's own File > Open Folder navigation.
 */
export function codeServerWorkspaceSrc(workspacePath: string): string {
  return `/code/?workspace=${encodeURIComponent(workspacePath)}`;
}

interface CodeSurfaceProps {
  /** The window's LATCHED code folder (absolute path) — the comparison
   *  baseline for the load-seam report below ("the folder we believe the
   *  editor is in"). Not the mount src: the frame's URL arrives via
   *  `workspaceSrc`. */
  gitRoot: string;
  /** The iframe's mount src: the tab-keyed `?workspace=` URL once the
   *  derivation GET has resolved, or the `?folder=` degrade after a failed
   *  one. `null` ⇒ pending — the tile renders the pending state instead of
   *  the iframe. Read at iframe MOUNT only (first non-null value per mount
   *  generation); a later change never re-navigates a live frame — the
   *  `followSrc` seam is the one exception. */
  workspaceSrc: string | null;
  /** Follow-the-editor override (the one sanctioned parent re-navigation):
   *  after the editor navigated ITSELF to a new folder (File > Open Folder),
   *  the parent re-derived the workspace URL and hands it down with a fresh
   *  nonce. A nonce not seen before overrides the mount-generation src ref
   *  exactly once; an already-seen nonce (every ordinary payload tick) never
   *  touches a live frame. Absent ⇒ no override. */
  followSrc?: { src: string; nonce: number } | null;
  /** The host's TTL-cached code-server reachability probe result. */
  reachable: boolean;
  /** Keyboard spike: return true when the event matches a run-kit registry
   *  chord that should be reclaimed from the iframe. Absent ⇒ no reclaim. */
  shouldReclaimChord?: (e: KeyboardEvent) => boolean;
  /** Tile-focus seam (260812-wfic R2): fired when a keydown/pointerdown
   *  arrives inside the same-origin contentDocument — editor interaction
   *  counts as tile focus. No parent-document event fires for in-frame
   *  interaction (clicks stay in the frame's document; focus entering it
   *  fires no focusin in the parent), so this seam is the tile wrapper's
   *  only signal. Absent ⇒ no reporting. */
  onInteract?: () => void;
  /** Steal-guard seam (spec right-panel.md § The code lens): fired when focus
   *  lands anywhere inside the frame's document (a capture-phase `focusin` on
   *  the contentDocument) — the only signal the workbench's script `focus()`
   *  grab produces, since it fires NO parent-side event on the iframe element.
   *  The handler decides: return `true` when it reverted the grab (guard armed
   *  + remembered kind ≠ `code`), `false` when the focus stands (guard
   *  disarmed, or the remembered kind IS `code` — then the grab IS the
   *  restore). Absent ⇒ no reporting. */
  onProgrammaticFocus?: () => boolean;
  /** Follow-the-editor seam (260813-if5d R3): fired with the folder the EDITOR
   *  navigated itself to (File > Open Folder), read from the same-origin frame's
   *  `?folder=` on each `load`. Only fired for a present, non-empty folder that
   *  differs from `gitRoot` — the parent writes it to the window's latch. Absent
   *  ⇒ no reporting. */
  onFolderNavigated?: (folder: string) => void;
  /** First-boot rescue's status read (built in app.tsx, threaded through
   *  SurfaceLayout): one call at a `?workspace=` mount generation's src
   *  adoption (baseline) and one at the rescue wait's expiry (verdict). The
   *  injected fetcher keeps this component free of the API client import
   *  graph. Absent ⇒ no rescue runs (no fetches, no timer). */
  fetchBridgeStatus?: () => Promise<CodeBridgeResult>;
}

export function CodeSurface({
  gitRoot,
  workspaceSrc,
  followSrc,
  reachable,
  shouldReclaimChord,
  onInteract,
  onFolderNavigated,
  onProgrammaticFocus,
  fetchBridgeStatus,
}: CodeSurfaceProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reclaimRef = useRef(shouldReclaimChord);
  reclaimRef.current = shouldReclaimChord;
  const interactRef = useRef(onInteract);
  interactRef.current = onInteract;
  const folderNavigatedRef = useRef(onFolderNavigated);
  folderNavigatedRef.current = onFolderNavigated;
  const programmaticFocusRef = useRef(onProgrammaticFocus);
  programmaticFocusRef.current = onProgrammaticFocus;
  const fetchBridgeRef = useRef(fetchBridgeStatus);
  fetchBridgeRef.current = fetchBridgeStatus;
  // The comparison baseline for the load-event report below, read through a ref
  // because the listener outlives the render that installed it. It tracks the
  // latch, which after seeding tracks the editor — so it is exactly "the folder
  // we believe the editor is in".
  const gitRootRef = useRef(gitRoot);
  gitRootRef.current = gitRoot;

  // P3: one `src` per iframe MOUNT GENERATION. The iframe mounts only while
  // `reachable` AND the workspace src has resolved (non-null) — a reachability
  // false→true flip or a window-switch remount boots at the CURRENT src
  // (fresh workbench, right workspace) while a mounted frame is never
  // parent-navigated: a `src` React re-renders IS a navigation, even to the
  // URL the frame already sits at. Held in a ref, not `useMemo`: a memo
  // cache is a performance hint React may drop, and dropping this one would
  // reload the editor out from under the user. The pending → resolved
  // transition adopts the first non-null src of the generation; any later
  // change is ignored by the live frame.
  const srcRef = useRef<{ mountGen: boolean; src: string | null }>({
    mountGen: reachable,
    src: null,
  });
  if (srcRef.current.mountGen !== reachable) {
    srcRef.current = { mountGen: reachable, src: null };
  }
  if (srcRef.current.src === null && workspaceSrc !== null) {
    srcRef.current.src = workspaceSrc;
  }
  // The follow rule's one sanctioned parent navigation: a fresh nonce
  // overrides the ref exactly once (the editor already moved itself; the
  // parent only lands it on the derived workspace URL). The seen-nonce ref is
  // deliberately NOT reset by a mount-generation flip — a remount adopts the
  // current `workspaceSrc`, which the follow fetch already advanced.
  const followNonceRef = useRef<number | null>(null);
  if (followSrc && followSrc.nonce !== followNonceRef.current) {
    followNonceRef.current = followSrc.nonce;
    srcRef.current.src = followSrc.src;
  }
  const src = srcRef.current.src;

  // Chord-reclaim spike: attach a capture-phase keydown listener to the
  // iframe's same-origin contentDocument after every load (each navigation
  // replaces the document). A matching chord is stopped before the embedded
  // app's keybinding service sees it and re-dispatched on the PARENT document
  // (bubbling reaches both the document-level listeners — the command
  // palette's chord — and the window-level ones — the keybinding
  // dispatcher). Cleanup removes the listener from the document it was
  // attached to. The
  // capture-phase keydown/pointerdown pair ALSO feeds `onInteract`
  // (260812-wfic): any in-editor interaction reports tile focus. The
  // capture-phase `focusin` feeds `onProgrammaticFocus` (the steal guard) —
  // it is attached to the frame's document because a script `focus()` grab
  // fires no parent-side event on the iframe element. Keyed on `reachable`
  // AND `src`: the iframe only MOUNTS once reachable with a resolved src (the
  // pending/empty states render no iframe), so the pending → resolved
  // transition and any reachability flip re-run this effect against the fresh
  // iframe.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (
      !iframe ||
      (!reclaimRef.current &&
        !interactRef.current &&
        !folderNavigatedRef.current &&
        !programmaticFocusRef.current)
    ) {
      return;
    }
    let attachedDoc: Document | null = null;
    const onKey = (e: KeyboardEvent) => {
      interactRef.current?.();
      const reclaim = reclaimRef.current;
      if (!reclaim?.(e)) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      document.dispatchEvent(
        new KeyboardEvent("keydown", {
          key: e.key,
          code: e.code,
          ctrlKey: e.ctrlKey,
          metaKey: e.metaKey,
          shiftKey: e.shiftKey,
          altKey: e.altKey,
          bubbles: true,
        }),
      );
    };
    const onPointer = () => interactRef.current?.();
    // Steal guard: the workbench's load-time grab is an in-frame script
    // `focus()` — in Chromium it re-points the focus chain (the parent's
    // `document.activeElement` becomes the iframe) but fires NO parent-side
    // event on the iframe element, so the ONLY observable is a `focusin` on
    // the frame's own document. The prop decides whether to revert (`true`) —
    // this component only reports; it knows nothing about the focus-memory
    // module. A genuine click-in produces `pointerdown` (→ `onInteract`, which
    // disarms the guard) BEFORE this focusin, so real editor focus reports
    // against an already-disarmed guard and is never reverted.
    const onFrameFocus = () => {
      programmaticFocusRef.current?.();
    };
    const attach = () => {
      try {
        // Cross-origin frames throw on contentDocument access — the /proxy/
        // embed is same-origin by design, so a throw means "nothing to do".
        // A navigation replaces the document; the listener on the discarded
        // one dies with it, and we re-attach to the fresh document.
        const doc = iframe.contentDocument;
        if (doc && doc !== attachedDoc) {
          doc.addEventListener("keydown", onKey, true);
          doc.addEventListener("pointerdown", onPointer, true);
          doc.addEventListener("focusin", onFrameFocus, true);
          attachedDoc = doc;
        }
      } catch {
        /* noop — spike stays silent */
      }
    };
    // Follow rule (if5d R3): a workbench navigation replaces the frame's
    // document, so every load is a chance the EDITOR moved itself to another
    // folder (File > Open Folder). Same try/catch posture as the attach above —
    // a cross-origin or pre-load frame silently reports nothing.
    const reportFolder = () => {
      try {
        const search = iframe.contentWindow?.location.search;
        if (!search) return;
        // `URLSearchParams` decodes, so this compares decoded paths against the
        // decoded prop — `encodeURIComponent` round-trips make raw-string
        // comparison flaky.
        const folder = new URLSearchParams(search).get("folder");
        if (!folder || folder === gitRootRef.current) return;
        folderNavigatedRef.current?.(folder);
      } catch {
        /* noop — cross-origin or pre-load frame */
      }
    };
    const onLoad = () => {
      attach();
      reportFolder();
    };
    attach();
    iframe.addEventListener("load", onLoad);
    return () => {
      iframe.removeEventListener("load", onLoad);
      try {
        attachedDoc?.removeEventListener("keydown", onKey, true);
        attachedDoc?.removeEventListener("pointerdown", onPointer, true);
        attachedDoc?.removeEventListener("focusin", onFrameFocus, true);
      } catch {
        /* noop */
      }
    };
  }, [reachable, src]);

  // First-boot rescue: per mount generation (this effect's [reachable, src]
  // keying re-runs on every generation boundary — the reachable flip, a
  // window-switch remount, or a followSrc nonce adoption), a `?workspace=`
  // mount gets exactly TWO status reads and at most ONE reload. The baseline
  // read fires at src adoption; the first `load` arms the wait timer; its
  // expiry reads again and hands both stamps to decideRescue. A "reload"
  // verdict re-navigates via contentWindow.location.reload() — a reload keeps
  // the `?workspace=` URL and tab identity, so the per-generation src ref
  // stays untouched. `?folder=` mounts never enter here (a folder-opened
  // bridge host writes no tab identity, so the signal can never exist), and
  // without the injected fetcher the generation is inert (no reads, no
  // timer). Cleanup clears a pending timer and discards in-flight reads, so
  // an unmounted or superseded generation can neither reload nor warn.
  useEffect(() => {
    const fetcher = fetchBridgeRef.current;
    const iframe = iframeRef.current;
    if (!fetcher || !iframe || !reachable || src === null || !isWorkspaceSrc(src)) return;
    const gen = {
      baseline: null as string | null,
      settled: false,
      warned: false,
      timer: null as ReturnType<typeof setTimeout> | null,
    };
    let alive = true;
    fetcher()
      .then((res) => {
        // An unavailable baseline stays null: bridgeConfirmed then accepts any
        // non-empty verdict stamp — erring toward NOT reloading is the posture.
        if (alive && res.status === "ok") gen.baseline = res.startedAt;
      })
      .catch(() => {
        /* an injected fetcher may throw; a failed baseline reads as none */
      });
    const arm = () => {
      if (!alive || gen.settled || gen.timer !== null) return;
      gen.timer = setTimeout(() => {
        gen.timer = null;
        const decide = fetchBridgeRef.current;
        if (!decide) return;
        // Settle BEFORE the verdict fetch: `arm`'s guard reads `settled`, and
        // leaving it false until the promise resolves would let a second
        // `load` during a slow GET arm another timer — a second verdict read
        // and a possible double reload. One verdict fetch per generation.
        gen.settled = true;
        decide()
          .then((res) => {
            if (!alive) return;
            const decision = decideRescue({
              baseline: gen.baseline,
              current: res.status === "ok" ? res.startedAt : null,
              installed: res.status === "ok" ? res.installed : null,
              isWorkspaceMount: true,
            });
            if (decision === "reload") {
              try {
                iframe.contentWindow?.location.reload();
              } catch {
                /* cross-origin or pre-load frame — skip */
              }
            } else if (decision === "skip-not-installed" && !gen.warned) {
              gen.warned = true;
              console.warn(
                "code bridge extension not installed — first-boot rescue disabled; run `rk code-server install`",
              );
            }
          })
          .catch(() => {
            /* a throwing injected fetcher fails closed — the generation is
               already settled, so it never retries into a second decision */
          });
      }, CODE_BOOT_RESCUE_WAIT_MS);
    };
    iframe.addEventListener("load", arm);
    return () => {
      alive = false;
      iframe.removeEventListener("load", arm);
      if (gen.timer !== null) clearTimeout(gen.timer);
    };
  }, [reachable, src]);

  if (!reachable) {
    return (
      <div
        data-testid="code-surface-empty"
        className="flex-1 min-h-0 flex items-center justify-center text-text-secondary text-xs font-mono select-none"
      >
        code-server not running — check rk doctor
      </div>
    );
  }

  // Reachable but the workspace path is not resolved yet (derivation GET in
  // flight, or a no-root answer awaiting the next payload change): the terse
  // pending state, same chrome as the empty state. Reachability keeps
  // precedence — an unreachable host never renders pending.
  if (src === null) {
    return (
      <div
        data-testid="code-surface-pending"
        className="flex-1 min-h-0 flex items-center justify-center text-text-secondary text-xs font-mono select-none"
      >
        opening…
      </div>
    );
  }

  return (
    <iframe
      ref={iframeRef}
      src={src}
      className="flex-1 w-full border-0"
      title="Code editor"
      // Same sandbox as IframeWindow, plus allow-downloads (without it VS Code
      // file downloads break) — the k3vp proxy-prerequisite set.
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
    />
  );
}

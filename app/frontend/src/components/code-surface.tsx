import { useEffect, useRef } from "react";

/**
 * CodeSurface — the renderer for the `code` lens AND the panel's CODE surface
 * (change 260811-k3vp-right-panel-code-lens; the daemon-managed stable route
 * 260811-a2bo; spec docs/specs/right-panel.md § The code lens).
 *
 * Deliberately a NEW lean component, NOT `IframeWindow`: the code-server URL is
 * fully DERIVED (`/code/?folder=<git root>`), so the URL bar — `@rk_url`
 * substrate state — is meaningless here, and IframeWindow reuse would drag in
 * inapplicable chrome. It is exactly an iframe plus the not-running empty
 * state.
 *
 * - **Availability vs reachability**: availability (gitRoot derived — the port
 *   is always resolvable by convention since a2bo) is computed upstream — this
 *   component renders only when the lens/surface was resolved. REACHABILITY
 *   selects the content: a reachable code-server renders the iframe; an
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

interface CodeSurfaceProps {
  /** The window's derived git toplevel (absolute path). */
  gitRoot: string;
  /** The host's TTL-cached code-server reachability probe result. */
  reachable: boolean;
  /** Keyboard spike: return true when the event matches a run-kit registry
   *  chord that should be reclaimed from the iframe. Absent ⇒ no reclaim. */
  shouldReclaimChord?: (e: KeyboardEvent) => boolean;
  /** Tile-focus seam (260812-wfic R2): fired when a keydown/pointerdown
   *  arrives inside the same-origin contentDocument — editor interaction
   *  counts as tile focus (the iframe element's own focusin covers the
   *  click-to-focus case; keydowns never reach the parent document). Absent
   *  ⇒ no reporting. */
  onInteract?: () => void;
}

export function CodeSurface({ gitRoot, reachable, shouldReclaimChord, onInteract }: CodeSurfaceProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const reclaimRef = useRef(shouldReclaimChord);
  reclaimRef.current = shouldReclaimChord;
  const interactRef = useRef(onInteract);
  interactRef.current = onInteract;

  // Chord-reclaim spike: attach a capture-phase keydown listener to the
  // iframe's same-origin contentDocument after every load (each navigation
  // replaces the document). A matching chord is stopped before the embedded
  // app's keybinding service sees it and re-dispatched on the PARENT document
  // (bubbling reaches both the document-level listeners — the command
  // palette's chord — and the window-level ones — the keybinding dispatcher,
  // the ⌘. view cycle). Keyed on `reachable`: the iframe only MOUNTS when
  // reachable (the not-running empty state renders otherwise), so a
  // reachability flip re-runs this effect against the fresh iframe. Cleanup
  // removes the listener from the document it was attached to. The
  // capture-phase keydown/pointerdown pair ALSO feeds `onInteract`
  // (260812-wfic): any in-editor interaction reports tile focus.
  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe || (!reclaimRef.current && !interactRef.current)) return;
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
          attachedDoc = doc;
        }
      } catch {
        /* noop — spike stays silent */
      }
    };
    attach();
    iframe.addEventListener("load", attach);
    return () => {
      iframe.removeEventListener("load", attach);
      try {
        attachedDoc?.removeEventListener("keydown", onKey, true);
        attachedDoc?.removeEventListener("pointerdown", onPointer, true);
      } catch {
        /* noop */
      }
    };
  }, [reachable]);

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

  return (
    <iframe
      ref={iframeRef}
      src={codeServerSrc(gitRoot)}
      className="flex-1 w-full border-0"
      title="Code editor"
      // Same sandbox as IframeWindow, plus allow-downloads (without it VS Code
      // file downloads break) — the k3vp proxy-prerequisite set.
      sandbox="allow-same-origin allow-scripts allow-forms allow-popups allow-modals allow-downloads"
    />
  );
}

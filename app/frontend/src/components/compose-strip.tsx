import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useFocusedTerminal, type FocusedTerminal } from "@/contexts/focused-terminal-context";
import { useFileUpload } from "@/hooks/use-file-upload";
import { useWindowStore, entryKey } from "@/store/window-store";
import {
  COMPOSE_STRIP_ATTACH_EVENT,
  drainComposeStripAttachments,
  registerComposeStripFocuser,
} from "@/lib/compose-strip-events";
import {
  getComposeDraft,
  subscribeComposeDraft,
  setComposeText,
  setComposeAttachments,
  clearComposeDraft,
} from "@/lib/compose-draft-store";

/**
 * The docked compose strip — a single global, sticky text-input surface docked
 * at the bottom of the terminal area, immediately above the bottom-bar keys
 * (260718-dhdj). It REPLACES the modal `ComposeBuffer` dialog: no backdrop, no
 * `role="dialog"`/`aria-modal`, no focus trap, no Escape-closes, no
 * close-on-send.
 *
 * A real `<textarea>` gives mobile autocorrect/IME (xterm.js has neither) and is
 * a stable home for pasting large text blocks over a laggy relay.
 *
 * Target model (reverses the modal's frozen-target DD-6): the strip sends to the
 * CURRENTLY-focused pane's `wsRef` from `FocusedTerminalContext`, read live at
 * send time — never a target snapshotted at open. The wrong-pane-send risk is
 * mitigated by the always-visible `→ {window}` target label, not by freezing.
 *
 * Interaction (mirrors `ChatSendForm`): Enter sends `text + "\r"` as raw bytes
 * over the relay stream (same path as BottomBar keystrokes); Shift+Enter inserts
 * a newline; Enter is guarded against IME composition; empty/whitespace-only
 * Enter is a no-op. The strip NEVER steals focus (mount / toggle / after-send);
 * Escape blurs the textarea back to the terminal.
 *
 * Uploads ride `useFileUpload` scoped to the LIVE focused target's worktree
 * (eager upload). When the focused target changes while attachments are pending,
 * the held `File` objects are re-uploaded to the new worktree and the textarea
 * path lines are rewritten (re-homing). Re-home failure keeps the original path
 * lines and surfaces a non-blocking inline `role="alert"` error.
 *
 * Rendered only when the `composeStripEnabled` chrome preference is on; the
 * caller (the shell footer in `app.tsx` / `board-page.tsx`) gates the mount.
 * Because that mount is conditional AND per-route (the two footers are distinct
 * subtrees), the draft text + pending attachments live in a MODULE store
 * (`compose-draft-store.ts`, a `useSyncExternalStore` seam) rather than
 * component-local `useState` — so an unsent draft survives toggle-off/on and
 * terminal↔board route navigation (intake §7 / R2). Blob URLs for previews are
 * derived per-mount from the retained `File` objects, so they are the one piece
 * of state that stays component-local.
 */

/** Max input rows before the textarea scrolls internally (bounded auto-grow) —
 * mirrors ChatSendForm. */
const MAX_TEXTAREA_ROWS = 6;

/** Compose the window-store lookup key from a focused target. */
function focusedKey(f: NonNullable<FocusedTerminal>): string {
  return entryKey(f.server, f.windowId);
}

export function ComposeStrip() {
  const { focused } = useFocusedTerminal();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // Draft text + pending attachments live in the module store so they survive
  // this component's unmount (toggle-off) and the terminal↔board route change
  // (two separate footer mounts). `setText`/`setFiles` write through to the
  // store; `text`/`files` are the live snapshot.
  const { text, attachments: files } = useSyncExternalStore(
    subscribeComposeDraft,
    getComposeDraft,
  );
  const setText = setComposeText;
  const setFiles = setComposeAttachments;
  // Error is transient per-mount UI state, not draft content — it stays local.
  const [error, setError] = useState<string | null>(null);
  const blobUrlsRef = useRef<Map<File, string>>(new Map());

  // Live send target — read at send time, NOT frozen at mount (reverses DD-6).
  // The upload hook is scoped to the currently-focused target's worktree so
  // eager uploads land where the agent can read them.
  const hasTarget = focused !== null;
  const { uploadFiles, uploading } = useFileUpload(
    focused?.session ?? "",
    focused?.windowId ?? "",
    // useFileUpload throws if server resolves empty; only call it meaningfully
    // when a target exists. When `focused === null` we pass a sentinel that is
    // never used (the strip is disabled and cannot upload).
    focused?.server ?? "no-target",
  );

  // Resolve a human-readable window name for the target label. The focused
  // context carries only the windowId, so we look up the name from the window
  // store (keyed by server:windowId). Falls back to the raw windowId.
  const targetName = useWindowStore((s) =>
    focused ? s.entries.get(focusedKey(focused))?.name ?? focused.windowId : null,
  );

  // Auto-grow to content, bounded to MAX_TEXTAREA_ROWS (then internal scroll).
  const resize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    const max = line * MAX_TEXTAREA_ROWS;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
    el.style.overflowY = el.scrollHeight > max ? "auto" : "hidden";
  }, []);

  useLayoutEffect(resize, [text, resize]);

  // Blob-URL lifecycle: this mount's preview URLs are per-mount (the map is a
  // fresh ref each mount), so revoke them on unmount to avoid a leak. The
  // retained `File` objects live on in the module store, so a remount recreates
  // the URLs lazily via `getBlobUrl` — the draft (files + text) is unaffected.
  useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      for (const url of urls.values()) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  function getBlobUrl(file: File): string {
    const existing = blobUrlsRef.current.get(file);
    if (existing) return existing;
    const url = URL.createObjectURL(file);
    blobUrlsRef.current.set(file, url);
    return url;
  }

  // Rewrite a single path line in the textarea (old -> new). Returns the
  // rewritten text. Mirrors the ComposeBuffer path-line splice.
  const rewritePathLine = useCallback((oldPath: string, newPath: string) => {
    setText((current) => {
      const lines = current.split("\n");
      const i = lines.indexOf(oldPath);
      if (i === -1) return current;
      lines[i] = newPath;
      return lines.join("\n");
    });
  }, []);

  // Re-home pending attachments when the focused target changes. Re-uploads the
  // retained File objects to the new worktree and rewrites the textarea path
  // lines. Failure keeps the original lines and surfaces a non-blocking error.
  const lastTargetKeyRef = useRef<string | null>(focused ? focusedKey(focused) : null);
  useEffect(() => {
    const key = focused ? focusedKey(focused) : null;
    const prevKey = lastTargetKeyRef.current;
    lastTargetKeyRef.current = key;
    // Only re-home on an actual target change with pending attachments.
    if (key === prevKey || key === null || files.length === 0) return;

    let cancelled = false;
    (async () => {
      for (const uf of files) {
        try {
          // Re-upload the single held File to the new focused target's worktree.
          const results = await uploadFiles([uf.file]);
          if (cancelled) return;
          const rehomed = results[0];
          if (rehomed && rehomed.path !== uf.path) {
            rewritePathLine(uf.path, rehomed.path);
            setFiles((prev) =>
              prev.map((f) => (f.file === uf.file ? { ...f, path: rehomed.path } : f)),
            );
          } else if (!rehomed) {
            throw new Error("re-home upload returned no path");
          }
        } catch {
          if (cancelled) return;
          // Keep the original path line; surface a non-blocking error. Sending
          // is not blocked.
          setError(`Could not move "${uf.file.name}" to the new target's folder — sending will use the original path.`);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // `files`/`uploadFiles`/`rewritePathLine` are intentionally read for the
    // current attachments; the effect keys on the target identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focused?.server, focused?.windowId]);

  const send = useCallback(() => {
    if (!hasTarget) return;
    const trimmed = text.trim();
    if (trimmed === "") return; // empty / whitespace-only never sends
    const ws = focused?.wsRef.current;
    // Guard-blocked send: the focused stream is not open. Early-return WITHOUT
    // clearing — the draft is preserved so nothing is silently lost against a
    // closed pane. Clearing happens only after a delivered send below.
    if (ws?.readyState !== WebSocket.OPEN) return;
    // Enter submits with a trailing carriage return — same raw-bytes relay
    // path as BottomBar keystrokes. Deliberate behavior change from the
    // dialog's raw-insert (no `\r`) send.
    ws.send(text + "\r");
    // Delivered: clear draft + attachments; the strip stays open and does NOT
    // grab or return focus. The module store is the source of truth for the
    // draft; revoke this mount's preview URLs (their files are gone).
    for (const url of blobUrlsRef.current.values()) URL.revokeObjectURL(url);
    blobUrlsRef.current.clear();
    clearComposeDraft();
    setError(null);
  }, [hasTarget, text, focused]);

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Escape blurs the textarea back to the terminal (never closes the strip).
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      textareaRef.current?.blur();
      return;
    }
    // Enter submits; Shift+Enter inserts a newline (default). Guard against IME
    // composition. Stop propagation so a submitting Enter never bubbles to
    // global chords.
    if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      e.stopPropagation();
      send();
    }
  };

  // File uploads through the strip's own 📎 button.
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const handleUpload = useCallback(
    async (list: FileList | File[]) => {
      const arr = Array.from(list);
      if (!hasTarget || arr.length === 0) return;
      const results = await uploadFiles(arr);
      if (results.length === 0) return;
      setFiles((prev) => [...prev, ...results]);
      setText((current) => {
        const paths = results.map((u) => u.path).join("\n");
        if (current === "") return paths;
        return current.endsWith("\n") ? current + paths : current + "\n" + paths;
      });
    },
    [hasTarget, uploadFiles],
  );

  // Drain files handed off from the terminal's drag-drop / paste gestures
  // (via `dispatchComposeStripAttach`). Drain both on the attach event and on
  // mount (the strip may have just been enabled, mounting after the dispatch).
  useEffect(() => {
    function drain() {
      const files = drainComposeStripAttachments();
      if (files.length > 0) void handleUpload(files);
    }
    drain();
    document.addEventListener(COMPOSE_STRIP_ATTACH_EVENT, drain);
    return () => document.removeEventListener(COMPOSE_STRIP_ATTACH_EVENT, drain);
  }, [handleUpload]);

  // Register the strip's textarea focuser so the touch ⌨ keyboard button can
  // focus this real input (the mobile IME/autocorrect surface) without reaching
  // into the DOM by test id. Reads the textarea's live `disabled` state so the
  // "no target" case declines and the caller falls back to the terminal. Stable
  // (reads a ref), so a single register/unregister at mount suffices.
  useEffect(() => {
    return registerComposeStripFocuser(() => {
      const el = textareaRef.current;
      if (!el || el.disabled) return false;
      el.focus();
      return true;
    });
  }, []);

  const removeFile = useCallback((index: number) => {
    // Read the target from the live store snapshot rather than reaching into a
    // setter's updater — updaters stay pure so StrictMode's double-invoke does
    // not double-fire the blob-URL revoke or the textarea splice.
    const target = getComposeDraft().attachments[index];
    if (!target) return;
    const url = blobUrlsRef.current.get(target.file);
    if (url) {
      URL.revokeObjectURL(url);
      blobUrlsRef.current.delete(target.file);
    }
    // Remove the path line from the textarea.
    setText((current) => {
      const lines = current.split("\n");
      const i = lines.indexOf(target.path);
      if (i === -1) return current;
      lines.splice(i, 1);
      return lines.join("\n");
    });
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  /** Prevent mousedown from stealing focus away from the terminal/textarea. */
  const preventFocusSteal = (e: React.MouseEvent) => e.preventDefault();

  const canSend = hasTarget && text.trim() !== "";

  return (
    <div
      className="border-t border-border bg-bg-primary px-1.5 py-1.5 flex flex-col gap-1"
      data-testid="compose-strip"
    >
      <div className="flex items-center gap-2 text-xs text-text-secondary">
        <span aria-hidden="true">{"→"}</span>
        <span data-testid="compose-strip-target" className={hasTarget ? "text-text-primary" : "italic"}>
          {hasTarget ? targetName : "no target"}
        </span>
        {uploading && (
          <span
            role="status"
            className="ml-auto text-accent"
            data-testid="compose-strip-uploading"
          >
            Uploading…
          </span>
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="rounded border border-red-500/50 bg-red-500/10 px-2 py-1 text-xs text-red-400"
          data-testid="compose-strip-error"
        >
          {error}
        </div>
      )}

      {files.length > 0 && (
        <div className="flex gap-1.5 overflow-x-auto" data-testid="compose-strip-previews">
          {files.map((uf, i) => {
            const isImage = uf.file.type.startsWith("image/");
            return (
              <div key={`${uf.path}-${i}`} className="relative shrink-0 group">
                {isImage ? (
                  <img
                    src={getBlobUrl(uf.file)}
                    alt={uf.file.name}
                    className="h-[40px] w-auto rounded border border-border object-cover"
                  />
                ) : (
                  <div className="h-[40px] px-2 flex items-center rounded border border-border bg-bg-card">
                    <span className="text-[10px] text-text-secondary max-w-[80px] truncate">
                      {uf.file.name}
                    </span>
                  </div>
                )}
                <button
                  type="button"
                  aria-label={`Remove ${uf.file.name}`}
                  onMouseDown={preventFocusSteal}
                  onClick={() => removeFile(i)}
                  className="absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-bg-primary border border-border text-text-secondary text-[10px] leading-none flex items-center justify-center opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-red-500 hover:border-red-500 transition-all"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-end gap-1.5">
        <textarea
          ref={textareaRef}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          disabled={!hasTarget}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-label="Compose text to send to terminal"
          placeholder={hasTarget ? "Compose text…" : "No focused terminal"}
          data-testid="compose-strip-input"
          className="flex-1 min-h-0 resize-none rounded border border-border bg-bg-card px-2 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-secondary outline-none focus:border-accent disabled:opacity-50"
        />
        <input
          ref={uploadInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              void handleUpload(e.target.files);
              e.target.value = "";
            }
          }}
        />
        <button
          type="button"
          aria-label="Upload file"
          disabled={!hasTarget}
          onMouseDown={preventFocusSteal}
          onClick={() => uploadInputRef.current?.click()}
          className="rk-glint shrink-0 rounded border border-border px-2 py-1.5 text-xs text-text-secondary transition-colors hover:border-text-secondary disabled:opacity-50 coarse:min-h-[36px]"
        >
          <span aria-hidden="true">{"📎"}</span>
        </button>
        <button
          type="button"
          aria-label="Send text"
          disabled={!canSend}
          onMouseDown={preventFocusSteal}
          onClick={send}
          data-testid="compose-strip-send"
          className="rk-glint shrink-0 rounded border border-accent bg-accent/20 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed coarse:min-h-[36px]"
        >
          Send
        </button>
      </div>
    </div>
  );
}

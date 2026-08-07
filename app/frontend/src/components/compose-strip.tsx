import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useFocusedTerminal, type FocusedTerminal } from "@/contexts/focused-terminal-context";
import { useChromeDispatch } from "@/contexts/chrome-context";
import { useFileUpload } from "@/hooks/use-file-upload";
import {
  classifyComposeEnter,
  composeSubmitKeycap,
  type ComposeEnterAction,
} from "@/lib/compose-keys";
import { handleReadlineKey } from "@/lib/readline-keys";
import { useWindowStore, entryKey } from "@/store/window-store";
import { Tip, TipGroup } from "@/components/tip";
import {
  COMPOSE_STRIP_ATTACH_EVENT,
  consumeComposeStripFocusOnOpen,
  drainComposeStripAttachments,
  registerComposeStripFocuser,
} from "@/lib/compose-strip-events";
import {
  getComposeDraft,
  getComposeSentHistory,
  pushComposeSentHistory,
  subscribeComposeDraft,
  setComposeText,
  setComposeAttachments,
  clearComposeDraft,
  type ComposeAttachment,
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
 * Interaction (the shared `classifyComposeEnter` classifier with
 * `surface: "strip"` — 260802-lj98, the terminal-faithful Enter matrix): plain
 * Enter = INSERT LINE — `ws.send(text + "\n")` over the relay stream and clear
 * that target's draft, so consecutive Enters stage sentence-per-line in the
 * agent's composer (Claude Code treats a raw `"\n"` as newline-insert),
 * visibly, exactly like typing into the pane itself. The chat send form
 * deliberately diverges (keeps Enter=newline): it cannot show the pane's input
 * box, so Enter-as-insert there would make typed text vanish — the one
 * classifier declares both policies, per surface. Shift+Enter is the ONLY
 * local multi-line compose. Cmd/Ctrl+Enter is the ONLY submit chord, sending
 * `text + "\r"` (same raw-bytes path as BottomBar keystrokes) — and on an
 * EMPTY textarea a bare `"\r"` ("press Enter in the pane"), completing the
 * stage-then-submit loop from the keyboard. Alt+Enter is the chord-only
 * byte-exact raw insert (text WITHOUT any trailing byte — completing a partial
 * line); the Insert button follows Enter (insert line). `enterkeyhint` is
 * `"send"` (Enter transmits — the truthful hint). Enter is guarded against IME
 * composition; an empty plain Enter is a FULL no-op (consumed, no local
 * newline, nothing sent); empty insert/raw-insert are no-ops. The textarea
 * also carries the shared readline editing layer (`handleReadlineKey` —
 * Ctrl+U/Ctrl+W/Alt+B/F/D; natively-bound macOS chords pass through).
 *
 * Focus contract (260801-sm6g, revising 260718-dhdj): the strip focuses its
 * textarea on the OPEN transition only — every open path funnels through
 * `toggleComposeStrip()`, which marks the module-level focus-on-open flag
 * (`compose-strip-events.ts`); the mount effect consumes-and-clears it and
 * focuses, declining in the disabled "no target" state. Everything else keeps
 * the no-steal rule: after-send never grabs focus, Escape blurs the textarea
 * back to the terminal, and a route remount with the strip already enabled
 * (no toggle → no flag) never steals focus.
 *
 * Uploads ride `useFileUpload` scoped to the LIVE focused target's worktree
 * (eager upload). Because the draft — attachments included — is keyed by that
 * same target, an attachment can never face a different worktree than the one
 * it was uploaded to: switching targets switches drafts, so there is no
 * re-homing (no re-upload, no path rewriting) on focus change.
 *
 * Rendered only when the `composeStripEnabled` chrome preference is on; the
 * caller (the shell footer in `app.tsx` / `board-page.tsx`) gates the mount.
 * The header row carries an on-strip × close button firing the SAME
 * `toggleComposeStrip()` as the `>_` chip / palette entry (260722-d5q7) — a
 * pointer convenience only (Escape still blurs, never closes; no confirmation
 * needed because closing is lossless via the module store).
 * Because that mount is conditional AND per-route (the two footers are distinct
 * subtrees), drafts live in a MODULE store (`compose-draft-store.ts`, a
 * `useSyncExternalStore` seam) rather than component-local `useState`. Drafts
 * are PER TARGET — keyed by `entryKey(server, windowId)`, the live focused
 * target (260801-cyth, reversing 260718-dhdj's single traveling draft): each
 * window keeps its own unsent draft, shown whenever that window is focused,
 * surviving toggle-off/on, route changes, board pane-focus cycling, and (text
 * only, via localStorage) page refreshes. Blob URLs for previews are derived
 * per-mount from the retained `File` objects, so they are the one piece of
 * state that stays component-local.
 *
 * Sent-history recall (260806-kadm): sending clears the draft unconditionally
 * and none of the three hops (a queued `ws.send`, the backend's ignored PTY
 * write error, a pane app that swallows the bytes) can confirm acceptance — so
 * every delivered send is recorded per target (`pushComposeSentHistory`,
 * immediately before the clear) and ↑ walks back through it. Recovery over
 * verification: the clear stays unconditional and the send semantics are
 * untouched; the text is simply always one keystroke away. ↑ is intercepted
 * ONLY on an empty textarea (or mid-walk) so a multi-line draft keeps native
 * cursor movement; ↓ walks toward newer and, past the newest entry, restores
 * the stashed pre-recall text and ends the walk. Mid-walk the arrows follow
 * the REPL line-boundary discipline — a recalled entry can be multi-line, so
 * ↑ steps older only from the FIRST line and ↓ steps newer only from the LAST
 * line (collapsed selection required); everywhere else they move the caret
 * natively within the recalled text. Only a BARE, non-composing
 * arrow can recall — an IME-composing arrow navigates the candidate list and a
 * modified one is a native editing motion (Shift=select, Alt/Cmd=paragraph or
 * document jump), the same exact-modifier discipline `classifyReadlineKey`
 * declares. The walk's index + stash live in refs (no render reads them — the
 * recalled text goes through `setComposeText`, so the store-controlled textarea
 * and its auto-grow behave exactly as if typed), and it ends on ANY text
 * mutation that is not a recall step (a keystroke, an upload's path lines, an
 * attachment removal), on any send, and — eagerly, via a `draftKey` effect
 * rather than at the next keydown — on a target switch. Recall restores TEXT
 * ONLY: the `File` objects were revoked at send and are unpersistable, but
 * their path lines ride the recalled text.
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
  // The header-row × fires the exact same toggle as the bottom-bar `>_` chip
  // and the `View: Text Input` palette entry. Consumed here (not threaded as a
  // prop) so both footer mounts (app.tsx / board-page.tsx) inherit the close
  // affordance with zero per-route work. Closing is lossless — the draft lives
  // in the module store — so no confirmation is needed.
  const { toggleComposeStrip } = useChromeDispatch();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  // The draft key is the live focused target — `entryKey(server, windowId)`,
  // resolved each render. Draft text + pending attachments live in the module
  // store under that key, so they survive this component's unmount (toggle-off)
  // and the terminal↔board route change (two separate footer mounts), and each
  // target keeps its own draft (switching focus swaps the visible draft). With
  // no target the key is null: the store yields the stable empty draft and the
  // key-bound setters no-op (the strip is disabled anyway).
  const draftKey = focused ? focusedKey(focused) : null;
  const { text, attachments: files } = useSyncExternalStore(subscribeComposeDraft, () =>
    getComposeDraft(draftKey),
  );
  const setText = useCallback(
    (next: string | ((prev: string) => string)) => {
      if (draftKey !== null) setComposeText(draftKey, next);
    },
    [draftKey],
  );
  const setFiles = useCallback(
    (next: ComposeAttachment[] | ((prev: ComposeAttachment[]) => ComposeAttachment[])) => {
      if (draftKey !== null) setComposeAttachments(draftKey, next);
    },
    [draftKey],
  );
  const blobUrlsRef = useRef<Map<File, string>>(new Map());

  // ── sent-history recall walk (260806-kadm) ────────────────────────────────
  // Control state only — no render reads these, so refs (not state) avoid a
  // re-render per arrow press while the visible text stays store-owned.
  //   recallIndexRef: steps back from live. -1 = no walk in progress; 0 selects
  //     the newest sent entry, 1 the one before it, and so on.
  //   recallStashRef: the textarea text at walk start, restored when ↓ steps
  //     past the newest entry (empty under the empty-textarea intercept gate,
  //     but the walk can also be re-entered mid-recall).
  const recallIndexRef = useRef(-1);
  const recallStashRef = useRef("");

  /** End any in-progress recall walk (edit, send, target switch, past-newest,
   * and any programmatic text mutation that is not a recall step). */
  const endRecall = useCallback(() => {
    recallIndexRef.current = -1;
    recallStashRef.current = "";
  }, []);

  // A target switch ends the walk EAGERLY, the instant `draftKey` changes —
  // not lazily at the next keydown. A lazy check (comparing the live key
  // against one captured at walk start) leaves the walk armed while focus is
  // elsewhere, so an A→B→A round-trip with no arrow pressed on B resumes A's
  // stale index, and an edit on B tears down A's stash. The index and stash
  // are meaningless against a stranger target, so they are discarded the
  // moment the target they belong to stops being focused.
  useEffect(() => {
    endRecall();
  }, [draftKey, endRecall]);

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

  // Resolve a human-readable window name for the target label, layered:
  // window-store name (live — tracks renames) → the name the registrant knew
  // at registration (board entries carry a server-derived windowName; the
  // store only covers servers whose sidebar group has delivered sessions, so
  // board panes from other servers would otherwise miss) → raw windowId.
  const targetName = useWindowStore((s) =>
    focused
      ? s.entries.get(focusedKey(focused))?.name ||
        focused.windowName ||
        focused.windowId
      : null,
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

  // Reclaim URLs for files no longer in the VISIBLE draft: switching targets
  // (or a draft cleared while unfocused) would otherwise strand a departed
  // target's preview URLs in the map for as long as the strip stays mounted.
  // Over-revoking is safe — the files live on in their draft, and `getBlobUrl`
  // recreates a URL lazily when that draft is shown again.
  useEffect(() => {
    const visible = new Set(files.map((uf) => uf.file));
    for (const [file, url] of blobUrlsRef.current) {
      if (!visible.has(file)) {
        URL.revokeObjectURL(url);
        blobUrlsRef.current.delete(file);
      }
    }
  }, [files]);

  function getBlobUrl(file: File): string {
    const existing = blobUrlsRef.current.get(file);
    if (existing) return existing;
    const url = URL.createObjectURL(file);
    blobUrlsRef.current.set(file, url);
    return url;
  }

  const send = useCallback(
    (mode: Exclude<ComposeEnterAction, "default">) => {
      if (draftKey === null) return; // no target — nothing to send or clear
      const empty = text.trim() === ""; // whitespace-only counts as empty
      // Empty policy is per mode: an empty SUBMIT sends a bare `\r` — "press
      // Enter in the pane", completing the stage-then-submit loop (whitespace
      // is discarded, never transmitted); empty insert/insert-line never send.
      if (empty && mode !== "submit") return;
      const ws = focused?.wsRef.current;
      // Guard-blocked send: the focused stream is not open. Early-return WITHOUT
      // clearing — the draft is preserved so nothing is silently lost against a
      // closed pane. Clearing happens only after a delivered send below.
      if (ws?.readyState !== WebSocket.OPEN) return;
      // Payload per mode: submit appends `\r` — the `\r` IS the Enter press
      // (same raw-bytes relay path as BottomBar keystrokes); insert-line
      // appends `\n` — Claude Code treats it as newline-insert, staging the
      // line in the agent's composer; insert sends the text byte-exact (no
      // trailing byte — completing a partial line without any Enter).
      // Caveat (documented, not guarded — terminal-conventional Enter): the
      // transmitted `\n` is raw bytes, so a plain shell pane EXECUTES the line
      // (exactly what Enter does in a terminal), and an embedded `\n` in an
      // insert send executes per line there too; insert-line staging is only
      // visible-as-staged on agent composers (Claude Code), and raw insert is
      // only truly Enter-free for single-line text on non-TUI panes.
      if (mode === "submit") ws.send(empty ? "\r" : text + "\r");
      else if (mode === "insert-line") ws.send(text + "\n");
      else ws.send(text);
      // Delivered: clear THIS target's draft + attachments; the strip stays
      // open and does NOT grab or return focus. (An empty submit's bare `\r`
      // has nothing meaningful to clear — a whitespace-only draft is simply
      // discarded here.) The module store is the source of truth for the
      // draft; revoke only the cleared draft's preview URLs (other targets'
      // previews recreate lazily when their draft is shown).
      for (const uf of files) {
        const url = blobUrlsRef.current.get(uf.file);
        if (url) {
          URL.revokeObjectURL(url);
          blobUrlsRef.current.delete(uf.file);
        }
      }
      // Record the transmitted text BEFORE clearing so ↑ can recover it — the
      // clear stays unconditional (recovery over verification). All three modes
      // push the pre-trailing-byte text; the store's own whitespace guard makes
      // an empty submit's bare `\r` push nothing. A guard-blocked send returned
      // above, so nothing was cleared and nothing is recorded.
      pushComposeSentHistory(draftKey, text);
      clearComposeDraft(draftKey);
      // A send is a walk-ending event: the next ↑ starts fresh from the newest
      // entry (which is the text just sent).
      endRecall();
    },
    [draftKey, text, files, focused, endRecall],
  );

  /**
   * ↑/↓ sent-history recall. Returns `true` when the arrow was consumed (the
   * caller then preventDefaults it), `false` to let native cursor movement
   * proceed.
   *
   * ↑ is intercepted only when it CANNOT mean cursor movement — an empty
   * textarea, or a walk already in progress (where the visible text is
   * recalled, not composed). ↓ is intercepted only during a walk. Stepping
   * back past the oldest entry pins there (no wrap); stepping forward past the
   * newest restores the pre-walk stash and ends the walk.
   *
   * Mid-walk, recalled entries can be MULTI-LINE, so the walk only steps from
   * a line boundary (the REPL discipline): ↑ steps older only with the caret
   * on the FIRST line, ↓ steps newer only with the caret on the LAST line, and
   * both require a collapsed selection (a bare arrow over a selection is the
   * native collapse motion). Everywhere else the arrow moves the caret
   * natively WITHIN the recalled text and the walk stays alive — caret motion
   * is not an edit, so it must not end the session. A recall step lands the
   * caret at the end of the entry (native value-set behavior), so on a
   * single-line entry — first line == last line — repeated ↑ walks straight
   * through, byte-identical to the pre-boundary behavior.
   */
  function handleRecallKey(key: "ArrowUp" | "ArrowDown", el: HTMLTextAreaElement): boolean {
    if (draftKey === null) return false;
    // No stale-target check is needed here: the walk is torn down eagerly by
    // the `draftKey` effect above, so an in-progress walk always belongs to
    // the currently-focused target.
    const walking = recallIndexRef.current !== -1;
    // Line-boundary gate. An empty textarea satisfies both sides trivially
    // (selection 0/0, no newlines), so the session-start path is unaffected.
    const collapsed = el.selectionStart === el.selectionEnd;
    const onFirstLine = collapsed && !el.value.slice(0, el.selectionStart).includes("\n");
    const onLastLine = collapsed && !el.value.includes("\n", el.selectionEnd);

    if (key === "ArrowDown") {
      if (!walking) return false; // outside a walk, ↓ is native cursor movement
      if (!onLastLine) return false; // inside a multi-line recall — move natively
      const next = recallIndexRef.current - 1;
      if (next < 0) {
        // Past the newest entry — restore what the user had before the walk.
        const stash = recallStashRef.current;
        endRecall();
        setComposeText(draftKey, stash);
        return true;
      }
      recallIndexRef.current = next;
      setComposeText(draftKey, getComposeSentHistory(draftKey)[next] ?? "");
      return true;
    }

    // ArrowUp. Outside a walk it means recall ONLY on an empty textarea;
    // otherwise the caret is inside real composition and must move natively.
    if (!walking && text !== "") return false;
    if (!onFirstLine) return false; // inside a multi-line recall — move natively
    const history = getComposeSentHistory(draftKey);
    if (history.length === 0) return false; // nothing to recall — stay native
    // Step back one, pinning at the oldest entry rather than wrapping.
    const next = Math.min(recallIndexRef.current + 1, history.length - 1);
    if (!walking) recallStashRef.current = text;
    recallIndexRef.current = next;
    setComposeText(draftKey, history[next] ?? "");
    return true;
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    // Escape blurs the textarea back to the terminal (never closes the strip).
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      textareaRef.current?.blur();
      return;
    }
    // Shared readline editing layer (handleReadlineKey — the SAME helper
    // ChatSendForm uses): Ctrl+U/Ctrl+W/Alt+B/F/D, consuming the chord so it
    // never reaches global listeners. Everything else falls through.
    if (handleReadlineKey(e.nativeEvent, e.currentTarget)) return;
    // Sent-history recall — sits between the readline layer (which owns no
    // arrow keys, so composition is clean) and the Enter classifier.
    //
    // Only a BARE, non-composing arrow can mean recall, matching the exact-
    // modifier discipline the neighbouring layers already declare:
    //   - IME composing (`isComposing`) — ↑/↓ navigate the candidate list, so
    //     intercepting would break every CJK/IME composition in the strip (the
    //     surface that exists BECAUSE xterm.js has no IME). Both neighbours
    //     (`classifyComposeEnter`, `classifyReadlineKey`) guard on it.
    //   - Any modifier — Shift+↑/↓ extends the selection, Alt/Opt+↑/↓ and
    //     Cmd+↑/↓ are macOS paragraph/document jumps, Ctrl+↑/↓ is bound by
    //     desktop environments. All are native editing motions that recall
    //     must never swallow (`classifyReadlineKey`: "Meta or Shift anywhere →
    //     unhandled").
    const bareArrow =
      (e.key === "ArrowUp" || e.key === "ArrowDown") &&
      !e.nativeEvent.isComposing &&
      !e.shiftKey &&
      !e.altKey &&
      !e.metaKey &&
      !e.ctrlKey;
    if (bareArrow) {
      if (handleRecallKey(e.key as "ArrowUp" | "ArrowDown", e.currentTarget)) {
        e.preventDefault();
        e.stopPropagation();
      }
      // A non-intercepted arrow falls through untouched: native cursor
      // movement in a non-empty draft is never hijacked.
      return;
    }
    // Shared Enter policy (classifyComposeEnter — the SAME classifier
    // ChatSendForm uses, declared per surface; the strip's plain Enter is
    // insert-line while chat's stays newline — a deliberate, visibility-
    // motivated divergence declared inside the one classifier, never forked
    // here). "default" means: do not intercept — the textarea inserts a
    // newline (Shift+Enter, IME composition, non-Enter keys).
    const action = classifyComposeEnter(
      {
        key: e.key,
        shiftKey: e.shiftKey,
        metaKey: e.metaKey,
        ctrlKey: e.ctrlKey,
        altKey: e.altKey,
        isComposing: e.nativeEvent.isComposing,
      },
      "strip",
    );
    if (action === "default") return;
    // Consume every non-default action (preventDefault + stopPropagation so
    // it never bubbles to global chords) and hand it to send() as-is. An
    // insert-line on an EMPTY textarea is therefore a FULL no-op: the keydown
    // is consumed (no local newline appears) and send() sends nothing.
    e.preventDefault();
    e.stopPropagation();
    send(action);
  };

  // File uploads through the strip's own 📎 button.
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const handleUpload = useCallback(
    async (list: FileList | File[]) => {
      const arr = Array.from(list);
      if (!hasTarget || arr.length === 0) return;
      const results = await uploadFiles(arr);
      if (results.length === 0) return;
      // Appending path lines is a text mutation exactly like typing, so it ends
      // any recall walk. Leaving the walk armed would orphan the attachment:
      // the next arrow overwrites the text (dropping the path line) while the
      // `File` and its preview stay mounted, leaving a chip with no path.
      endRecall();
      setFiles((prev) => [...prev, ...results]);
      setText((current) => {
        const paths = results.map((u) => u.path).join("\n");
        if (current === "") return paths;
        return current.endsWith("\n") ? current + paths : current + "\n" + paths;
      });
    },
    [hasTarget, uploadFiles, setFiles, setText, endRecall],
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

  // Focus-on-open (260801-sm6g): consume the flag set by `toggleComposeStrip`'s
  // off→on transition and focus the textarea — the same disabled-state respect
  // as the registered focuser (the "no target" state declines, but the consume
  // still clears the flag so a later remount cannot inherit it). Plain route
  // remounts never set the flag, so they never steal focus.
  useEffect(() => {
    if (!consumeComposeStripFocusOnOpen()) return;
    const el = textareaRef.current;
    if (!el || el.disabled) return;
    el.focus();
  }, []);

  const removeFile = useCallback(
    (index: number) => {
      // Read the target from the live store snapshot rather than reaching into
      // a setter's updater — updaters stay pure so StrictMode's double-invoke
      // does not double-fire the blob-URL revoke or the textarea splice.
      const target = getComposeDraft(draftKey).attachments[index];
      if (!target) return;
      const url = blobUrlsRef.current.get(target.file);
      if (url) {
        URL.revokeObjectURL(url);
        blobUrlsRef.current.delete(target.file);
      }
      // Splicing the path line out is a text mutation like typing, so it ends
      // any recall walk (same orphaning hazard as handleUpload, in reverse).
      endRecall();
      // Remove the path line from the textarea.
      setText((current) => {
        const lines = current.split("\n");
        const i = lines.indexOf(target.path);
        if (i === -1) return current;
        lines.splice(i, 1);
        return lines.join("\n");
      });
      setFiles((prev) => prev.filter((_, i) => i !== index));
    },
    [draftKey, setText, setFiles, endRecall],
  );

  /** Prevent mousedown from stealing focus away from the terminal/textarea. */
  const preventFocusSteal = (e: React.MouseEvent) => e.preventDefault();

  // Per-button enablement (the old shared `canSend` split, 260802-lj98):
  // Insert follows Enter's empty no-op — disabled with no text; Send mirrors
  // its Cmd/Ctrl+Enter chord INCLUDING the empty case (an empty click sends a
  // bare `\r` — "press Enter in the pane"), so it only needs a target. Button
  // and chord diverging on empty would be a lying affordance.
  const canInsert = hasTarget && text.trim() !== "";

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
        {/* Far-right cluster: the conditional uploading status sits immediately
            left of the always-present × close button. Grouping both in a single
            ml-auto container keeps the × right-aligned whether or not the
            uploading status renders. */}
        <div className="ml-auto flex items-center gap-2">
          {uploading && (
            <span role="status" className="text-accent" data-testid="compose-strip-uploading">
              Uploading…
            </span>
          )}
          <button
            type="button"
            aria-label="Close compose strip"
            title="Close compose strip"
            onMouseDown={preventFocusSteal}
            onClick={toggleComposeStrip}
            data-testid="compose-strip-close"
            className="rk-glint shrink-0 rounded border border-border px-1.5 py-0.5 text-xs leading-none text-text-secondary transition-colors hover:border-text-secondary coarse:min-h-[36px] coarse:min-w-[36px]"
          >
            ×
          </button>
        </div>
      </div>

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

      {/* One warm-tip cluster for the strip's buttons (260722-73al);
          placement `top` — the strip sits at the bottom of the screen. */}
      {/* Two-row stack (260724-2bmy): the textarea gets the full row width —
          typing space is the strip's whole purpose — and the buttons drop to
          their own row (📎 left; Insert + Send right). rows={2} is the default
          on desktop too (explicit user direction); the bounded auto-grow's
          `height = "auto"` measurement falls back to the rows attribute, so
          the 2-row floor holds after typing + deleting. */}
      <TipGroup>
      <div className="flex flex-col gap-1.5">
        <textarea
          ref={textareaRef}
          rows={2}
          value={text}
          // A user edit ends any recall walk — the visible text is now
          // composition, not a recalled entry, so ↑ returns to meaning cursor
          // movement. Recall itself writes through `setComposeText` (never
          // this handler), so a recalled entry does not end its own walk.
          onChange={(e) => {
            endRecall();
            setText(e.target.value);
          }}
          onKeyDown={onKeyDown}
          disabled={!hasTarget}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          // Truthful hint: Enter transmits the text to the pane (insert-line)
          // and clears the draft, so the mobile action key says "send".
          enterKeyHint="send"
          aria-label="Compose text to send to terminal"
          placeholder={hasTarget ? "Compose text…" : "No focused terminal"}
          data-testid="compose-strip-input"
          className="w-full min-h-0 resize-none rounded border border-border bg-bg-card px-2 py-1.5 font-mono text-xs text-text-primary placeholder:text-text-secondary outline-none focus:border-accent disabled:opacity-50"
        />
        <div className="flex items-center gap-1.5">
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
          {/* Old parenthesized-shortcut titles become label + keycap chips
              (tier-1 kbd slot). The coarse "Ctrl/⌘+Enter" title branch is gone:
              tips never render on coarse pointers, so only the fine-pointer
              shortcut is ever shown. */}
          <div className="ml-auto flex items-center gap-1.5">
            {/* Insert follows Enter (insert line — text + "\n", clears the
                draft); the byte-exact raw insert is chord-only now, kept
                discoverable in the tip label (Alt+Enter). */}
            <Tip label="Insert line (Alt+Enter: raw insert)" kbd="Enter" placement="top">
              <button
                type="button"
                aria-label="Insert line"
                disabled={!canInsert}
                onMouseDown={preventFocusSteal}
                onClick={() => send("insert-line")}
                data-testid="compose-strip-insert"
                className="rk-glint shrink-0 rounded border border-border px-2 py-1.5 text-xs text-text-secondary transition-colors hover:border-text-secondary disabled:opacity-40 disabled:cursor-not-allowed coarse:min-h-[36px]"
              >
                Insert
              </button>
            </Tip>
            {/* Send mirrors its chord including the empty bare-`\r` case, so
                it is enabled whenever a target exists. */}
            <Tip label="Send" kbd={composeSubmitKeycap()} placement="top">
              <button
                type="button"
                aria-label="Send text"
                disabled={!hasTarget}
                onMouseDown={preventFocusSteal}
                onClick={() => send("submit")}
                data-testid="compose-strip-send"
                className="rk-glint shrink-0 rounded border border-accent bg-accent/20 px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent/30 disabled:opacity-40 disabled:cursor-not-allowed coarse:min-h-[36px]"
              >
                Send
              </button>
            </Tip>
          </div>
        </div>
      </div>
      </TipGroup>
    </div>
  );
}

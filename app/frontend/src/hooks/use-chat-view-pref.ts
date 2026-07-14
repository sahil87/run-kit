import { useCallback, useState } from "react";

/**
 * Per-window last-view preference (260714-r7rq). Clones the key-presence
 * localStorage pattern of `use-board-autofit.ts`: the key's PRESENCE means
 * "chat is this window's default view", its ABSENCE means "terminal default".
 * We store a sentinel so a malformed/other value still reads as off — the same
 * malformed-tolerant discipline as board-autofit / `use-pane-widths.ts`.
 *
 * Accepted property (mirrors board-autofit's per-name keys): tmux recycles
 * window IDs, so a stale key can mis-default a FUTURE window that reuses the id.
 * The keys are tiny and self-correct on the next user toggle.
 */
export const CHAT_VIEW_LOCALSTORAGE_PREFIX = "runkit:chat-view:";

/** The single stored sentinel meaning "chat is the default view". */
const CHAT_ON = "on";

function storageKey(server: string, windowId: string): string {
  return `${CHAT_VIEW_LOCALSTORAGE_PREFIX}${server}:${windowId}`;
}

function readChatPref(server: string, windowId: string): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(storageKey(server, windowId)) === CHAT_ON;
  } catch {
    // localStorage unavailable — default off (terminal).
    return false;
  }
}

/**
 * Non-reactive read of a window's stored chat-view pref (present sentinel =
 * chat default). Exported for render-time reads outside React state — e.g. the
 * window-switch transition needs to know whether a switch TARGET would render
 * chat (ungated capture) without subscribing to its pref. Equivalent to the
 * hook's internal read.
 */
export function readChatViewPrefKey(server: string, windowId: string): boolean {
  return readChatPref(server, windowId);
}

function writeChatPref(server: string, windowId: string, on: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (on) {
      window.localStorage.setItem(storageKey(server, windowId), CHAT_ON);
    } else {
      window.localStorage.removeItem(storageKey(server, windowId));
    }
  } catch {
    // localStorage unavailable / quota exceeded — non-fatal.
  }
}

/**
 * Per-window chat-view preference with localStorage persistence. Returns the
 * current `chatPref` flag (true = chat default) and a `setChatPref(on)` setter
 * that persists the value. Default when no key is stored: false (terminal —
 * current behavior).
 *
 * Identity changes are derived SYNCHRONOUSLY at render time (the project's
 * derive-over-store idiom, via React's adjust-state-during-render pattern),
 * NOT via a post-paint effect: with an effect reload, the first committed
 * frame after a window switch would resolve the PREVIOUS window's pref — the
 * wrong renderer would mount for one frame (TerminalClient WS churn /
 * ChatView EventSource open-close). The render-time adjustment re-runs the
 * render before commit, so the fresh window's pref is what paints.
 *
 * The stored pref is only consulted when the URL carries no `view` param (see
 * `resolveChatView`); the setter is called on every user toggle.
 */
export function useChatViewPref(
  server: string,
  windowId: string,
): {
  chatPref: boolean;
  setChatPref: (on: boolean) => void;
} {
  const [chatPref, setChatPrefState] = useState<boolean>(() =>
    readChatPref(server, windowId),
  );

  // Adjust-state-during-render on identity change: when (server, windowId)
  // differs from the identity the current state belongs to, re-read the pref
  // and update BOTH states during render. React re-runs this component before
  // committing, so no frame ever paints the previous window's pref.
  const identity = `${server}:${windowId}`;
  const [prevIdentity, setPrevIdentity] = useState(identity);
  if (identity !== prevIdentity) {
    setPrevIdentity(identity);
    setChatPrefState(readChatPref(server, windowId));
  }

  const setChatPref = useCallback(
    (on: boolean) => {
      writeChatPref(server, windowId, on);
      setChatPrefState(on);
    },
    [server, windowId],
  );

  return { chatPref, setChatPref };
}

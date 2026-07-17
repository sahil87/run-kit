import { useEffect, useRef, useState } from "react";
import {
  applyChatBackfill,
  appendChatEvents,
  type ChatEvent,
  type ChatPending,
  type Conversation,
} from "@/lib/chat-stream";
import { getWindowChat, HttpError } from "@/api/client";
import { useSessionContext } from "@/contexts/session-context";

// Backoff (ms) for retrying the GET backfill when the transcript is not written
// yet (a 404 right after a /clear rotation, or a chat-reset that raced the file's
// first write). The client waits rather than wedging on an error; a later
// `chat-reset` also re-triggers the composition, so convergence is doubly assured.
const NOT_YET_RETRY_MS = 500;

/**
 * Successor to the retired `use-chat-stream` (260717-vhvz). Chat moved off its
 * dedicated per-view SSE onto the singleton state socket as a `kind:"chat"`
 * subscription. The hook keeps the SAME return shape `{events, pending,
 * connected, error}` consumed unchanged by `app.tsx` / `ChatView`.
 *
 * On chat-lens enter it composes fetch→subscribe (gap-free, duplicate-free):
 * reset view state → register chat frame handlers (context seam, keyed by window
 * id) → GET `/api/windows/{id}/chat` backfill (REPLACE + pending; the response
 * carries the transcript byte `offset`) → `subscribeChat(from: offset)`. Live
 * frames: `chat` → `appendChatEvents` (id-dedup), `chat-state` → set pending
 * (always, incl. `null`), `chat-reset` → re-run the composition (rotation / shrink
 * / dropped-frame recovery — no transcript rode the socket, D5), `chat-error` →
 * inline error. A GET 404 (transcript not written yet) retries on a short backoff
 * rather than wedging.
 *
 * Both the enter path and the socket-reconnect path run through ONE guarded
 * `compose` (shared via a ref) so a reconnect GET in flight across a window switch
 * cannot apply a stale conversation or re-subscribe a torn-down identity.
 *
 * Health mirrors the established 3s disconnect debounce: `connected` is
 * (socket connected) AND (this window's chat subscription acked). Cleanup
 * unsubscribes + unregisters on lens leave / window switch / unmount — no
 * subscription outlives the view (Constitution II analog).
 */
export function useChatSubscription(
  server: string,
  windowId: string,
): {
  events: ChatEvent[];
  pending: ChatPending | null;
  connected: boolean;
  error: string | null;
} {
  const { subscribeChat, unsubscribeChat, registerChatHandlers, socketConnected } =
    useSessionContext();

  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [pending, setPending] = useState<ChatPending | null>(null);
  const [acked, setAcked] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ONE guarded compose, shared by BOTH the main effect and the reconnect effect
  // (MUST-FIX 2): the reconnect must reuse the SAME gen/cancelled guards so a
  // reconnect GET still in flight when the user switches windows / leaves the lens
  // is discarded and never re-subscribes a torn-down (server,windowId). Stored in
  // a ref; the main effect installs it for the current identity and resets it to a
  // no-op on cleanup.
  const composeRef = useRef<() => void>(() => {});

  useEffect(() => {
    // Reset view state for the new identity so a window switch never shows the
    // prior conversation before the first backfill lands.
    setEvents([]);
    setPending(null);
    setAcked(false);
    setError(null);

    if (!server || !windowId) {
      composeRef.current = () => {};
      return;
    }

    // `gen` guards against a stale async backfill (a window switch mid-fetch): a
    // response for an older composition run is discarded. Incremented on every
    // (re)composition so only the latest run's GET result is applied. `cancelled`
    // is set on cleanup so a completion after teardown is a no-op (no stale apply,
    // no subscribe for a torn-down identity).
    let gen = 0;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const clearRetry = () => {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    // The guarded fetch→subscribe composition. Run on enter, on `chat-reset`, and
    // on socket reconnect. It re-fetches the backfill (REPLACE) and re-subscribes
    // from the fresh offset — the no-cursor reset contract. A 404 (transcript not
    // written yet — a lazy /clear) is NOT fatal: it retries on a short backoff
    // (and any later `chat-reset` re-triggers it) until the file appears.
    const compose = () => {
      const myGen = ++gen;
      clearRetry();
      setAcked(false);
      getWindowChat(server, windowId)
        .then((conv: Conversation) => {
          if (cancelled || myGen !== gen) return; // stale run — discard
          setEvents(applyChatBackfill(conv));
          setPending(conv.pending ?? null);
          setError(null);
          subscribeChat({ server, windowId, from: conv.offset });
        })
        .catch((e: unknown) => {
          if (cancelled || myGen !== gen) return; // stale run — discard
          if (e instanceof HttpError && e.status === 404) {
            // Transcript not written yet — wait and retry (never wedge on error).
            // A concurrent `chat-reset` re-runs compose too; both converge.
            retryTimer = setTimeout(() => {
              if (!cancelled && myGen === gen) compose();
            }, NOT_YET_RETRY_MS);
            return;
          }
          setError(e instanceof Error ? e.message : "chat backfill failed");
        });
    };
    composeRef.current = compose;

    const unregister = registerChatHandlers(windowId, {
      onEvent: (type, data) => {
        if (cancelled) return;
        switch (type) {
          case "chat": {
            const incoming = Array.isArray(data) ? (data as ChatEvent[]) : [];
            setEvents((prev) => appendChatEvents(prev, incoming));
            break;
          }
          case "chat-state": {
            const d = (data ?? {}) as { pending?: ChatPending | null };
            // Always apply, incl. null, so a resolved question clears.
            setPending(d.pending ?? null);
            break;
          }
          case "chat-reset":
            // Rotation / shrink / dropped-frame recovery — the transcript did NOT
            // ride the socket (D5). Re-run the guarded composition on the same lens
            // (tolerating a 404 while the rotated-to transcript is still being
            // written).
            compose();
            break;
          case "chat-error": {
            const d = (data ?? {}) as { error?: string };
            setError(d.error || "chat stream error");
            break;
          }
          default:
            break;
        }
      },
      onAck: () => {
        if (cancelled) return;
        setAcked(true);
        setError(null);
      },
    });

    compose();

    return () => {
      cancelled = true;
      gen++; // invalidate any in-flight backfill
      clearRetry();
      composeRef.current = () => {}; // no-op for a torn-down identity
      unregister();
      unsubscribeChat({ server, windowId });
    };
  }, [server, windowId, subscribeChat, unsubscribeChat, registerChatHandlers]);

  // Re-run the composition on socket reconnect (the no-cursor reset contract —
  // the socket does not blindly resubscribe chat with a stale `from`). It reuses
  // the SAME guarded compose (via composeRef) as the main effect, so a reconnect
  // GET in flight across a window switch / lens exit is discarded and never
  // re-subscribes the old identity (MUST-FIX 2). A dedicated effect keyed on
  // `socketConnected` so a reconnect while the lens is open re-composes without
  // tearing the handler registration above.
  const wasConnectedRef = useRef(socketConnected);
  useEffect(() => {
    const wasConnected = wasConnectedRef.current;
    wasConnectedRef.current = socketConnected;
    // Only act on a false→true transition (a genuine reconnect), and only while
    // the lens is active. The mount-time subscribe is owned by the effect above.
    if (socketConnected && !wasConnected && server && windowId) {
      composeRef.current();
    }
  }, [socketConnected, server, windowId]);

  // The chat-lens connection dot: (socket connected) AND (this window's chat
  // subscription acked), with a 3s disconnect debounce so a transient blip does
  // not flicker the dot gray (mirrors the established per-server debounce). The
  // timer lives in a ref (not re-created per render); the effect only ACTS on a
  // genuine live↔not-live transition, and the sole cleanup (unmount) clears the
  // timer — so a re-render while not-live never resets the 3s window.
  const [connected, setConnected] = useState(false);
  const disconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    const live = socketConnected && acked;
    if (live) {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
      setConnected(true);
    } else if (!disconnectTimerRef.current) {
      // Arm the debounce exactly once per not-live episode (a pending timer means
      // one is already counting down — don't restart it).
      disconnectTimerRef.current = setTimeout(() => {
        disconnectTimerRef.current = null;
        setConnected(false);
      }, 3000);
    }
  }, [socketConnected, acked]);
  // Clear the debounce timer on unmount only (a lens leave / window switch tears
  // the whole hook down) — never on a dep change, so the countdown is not reset.
  useEffect(() => {
    return () => {
      if (disconnectTimerRef.current) {
        clearTimeout(disconnectTimerRef.current);
        disconnectTimerRef.current = null;
      }
    };
  }, []);

  return { events, pending, connected, error };
}

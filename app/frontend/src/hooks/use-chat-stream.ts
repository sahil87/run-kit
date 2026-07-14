import { useEffect, useRef, useState } from "react";
import {
  applyChatBackfill,
  appendChatEvents,
  type ChatEvent,
  type ChatPending,
  type Conversation,
} from "@/lib/chat-stream";

/**
 * Dedicated per-view chat stream hook (260714-r7rq). Owns exactly ONE
 * `EventSource` per open chat view (NOT the shared per-server sessions pool) on
 * `GET /api/windows/{windowId}/chat/stream?server={server}` — matching the
 * backend's dedicated per-view SSE endpoint (`docs/memory/run-kit/chat.md`
 * § "Dedicated per-view SSE endpoint"). It consumes the landed four-event
 * contract:
 *   - `chat-backfill` — full `Conversation`; REPLACE the event list every time
 *     (on connect and on any reset/rotation — never append).
 *   - `chat` — array of newly-appended `Event`s; deduped by `id`.
 *   - `chat-state` — `{pending}`; always applied, incl. `null` (clears a
 *     resolved question marker).
 *   - `chat-error` — fatal; surfaced as `error` for an inline error state.
 *
 * Health mirrors the established 3s disconnect debounce
 * (`session-context.tsx` `es.onerror`): a transient error does not immediately
 * flip `connected` false — a first successful `chat-backfill` marks connected,
 * and a sustained error (>3s) marks disconnected. `EventSource` auto-reconnect
 * handles retry; a reconnect delivers a fresh `chat-backfill` (no cursor).
 *
 * The `EventSource` is closed on unmount AND whenever `server`/`windowId`
 * change, so no connection outlives the view (Constitution II analog — the only
 * retained state dies with the component).
 */
export function useChatStream(
  server: string,
  windowId: string,
): {
  events: ChatEvent[];
  pending: ChatPending | null;
  connected: boolean;
  error: string | null;
} {
  const [events, setEvents] = useState<ChatEvent[]>([]);
  const [pending, setPending] = useState<ChatPending | null>(null);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Reset view state for the new identity so a window switch never shows the
    // prior conversation before the first backfill lands.
    setEvents([]);
    setPending(null);
    setConnected(false);
    setError(null);

    if (!server || !windowId) return;

    const url = `/api/windows/${encodeURIComponent(windowId)}/chat/stream?server=${encodeURIComponent(server)}`;
    const es = new EventSource(url);
    let disconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const clearDisconnectTimer = () => {
      if (disconnectTimer) {
        clearTimeout(disconnectTimer);
        disconnectTimer = null;
      }
    };

    es.addEventListener("chat-backfill", (e: MessageEvent) => {
      clearDisconnectTimer();
      try {
        const conv = JSON.parse(e.data) as Conversation;
        setEvents(applyChatBackfill(conv));
        setPending(conv.pending ?? null);
        setConnected(true);
        setError(null);
      } catch {
        // Malformed backfill — ignore this frame; the stream stays open.
      }
    });

    es.addEventListener("chat", (e: MessageEvent) => {
      clearDisconnectTimer();
      try {
        const incoming = JSON.parse(e.data) as ChatEvent[];
        setEvents((prev) => appendChatEvents(prev, incoming));
        setConnected(true);
      } catch {
        // Malformed append — ignore.
      }
    });

    es.addEventListener("chat-state", (e: MessageEvent) => {
      clearDisconnectTimer();
      try {
        const state = JSON.parse(e.data) as { pending: ChatPending | null };
        // Always apply, including null, so a resolved question clears.
        setPending(state.pending ?? null);
        setConnected(true);
      } catch {
        // Malformed state — ignore.
      }
    });

    es.addEventListener("chat-error", (e: MessageEvent) => {
      let message = "chat stream error";
      try {
        const parsed = JSON.parse(e.data) as { error?: string; message?: string };
        message = parsed.error || parsed.message || message;
      } catch {
        if (typeof e.data === "string" && e.data.trim()) message = e.data;
      }
      setError(message);
      // Fatal stream event — drop `connected` so the connection dot reflects the
      // error state (it reads `chatStream.connected`), not a stale "connected".
      // A subsequent successful `chat-backfill` re-marks connected and clears the
      // error, mirroring the normal recovery path.
      clearDisconnectTimer();
      setConnected(false);
    });

    es.onopen = () => {
      // Don't flip connected here — wait for the first data frame (mirrors the
      // sessions pool, which waits for the first `sessions` event) so the
      // connection dot reflects "data flowing", not "socket opened".
      clearDisconnectTimer();
    };

    es.onerror = () => {
      // 3s disconnect debounce (session-context.tsx pattern): a transient blip
      // during EventSource auto-reconnect must not flap the dot.
      if (!disconnectTimer) {
        disconnectTimer = setTimeout(() => setConnected(false), 3000);
      }
    };

    return () => {
      clearDisconnectTimer();
      es.close();
    };
  }, [server, windowId]);

  return { events, pending, connected, error };
}

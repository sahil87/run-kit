import { useEffect, useRef } from "react";

type DesktopClientProps = {
  sessionName: string;
  windowIndex: string;
  server: string;
  onSessionNotFound?: () => void;
  onRfbRef?: (rfb: import("@novnc/novnc/lib/rfb").default | null) => void;
};

export function DesktopClient({
  sessionName,
  windowIndex,
  server,
  onSessionNotFound,
  onRfbRef,
}: DesktopClientProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<import("@novnc/novnc/lib/rfb").default | null>(null);
  // Store callbacks in refs so the effect always has current versions without re-running
  const onSessionNotFoundRef = useRef(onSessionNotFound);
  onSessionNotFoundRef.current = onSessionNotFound;
  const onRfbRefRef = useRef(onRfbRef);
  onRfbRefRef.current = onRfbRef;

  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";

    async function connect() {
      if (cancelled || !containerRef.current) return;

      // Clear container before creating new RFB
      containerRef.current.innerHTML = "";

      try {
        const { default: RFB } = await import("@novnc/novnc/lib/rfb");
        if (cancelled || !containerRef.current) return;

        // Connect through the run-kit relay which hijacks to websockify
        const wsUrl = `${wsProto}//${window.location.host}/relay/${encodeURIComponent(sessionName)}/${windowIndex}?server=${encodeURIComponent(server)}`;

        const rfb = new RFB(containerRef.current, wsUrl);
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.background = "rgb(15, 17, 23)";

        rfbRef.current = rfb;
        onRfbRefRef.current?.(rfb);

        rfb.addEventListener("connect", () => {
          if (cancelled) return;
          reconnectDelay = 1000;
        });

        rfb.addEventListener("disconnect", () => {
          if (cancelled) return;
          rfbRef.current = null;
          onRfbRefRef.current?.(null);

          // After several failed reconnects, treat as session not found
          if (reconnectDelay >= 16000 && onSessionNotFoundRef.current) {
            onSessionNotFoundRef.current();
            return;
          }

          // Reconnect after a delay
          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (!cancelled) connect();
          }, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        });
      } catch (err) {
        if (cancelled) return;
        // Retry on fetch/import errors
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (!cancelled) connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      }
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (rfbRef.current) {
        try { rfbRef.current.disconnect(); } catch { /* already disconnected */ }
        rfbRef.current = null;
      }
    };
  // Note: onSessionNotFound and onRfbRef intentionally excluded from deps —
  // they are callbacks that may change on every parent render (inline arrows).
  // Including them would cause reconnect on every SSE update (~2.5s).
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName, windowIndex, server]);

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={`Desktop: ${sessionName}/${windowIndex}`}
      className="flex-1 min-h-0 overflow-hidden bg-bg-inset"
      style={{ touchAction: "none" }}
    />
  );
}

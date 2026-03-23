import { useEffect, useRef, useCallback } from "react";

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

  const cleanup = useCallback(() => {
    if (rfbRef.current) {
      try {
        rfbRef.current.disconnect();
      } catch {
        // Already disconnected
      }
      rfbRef.current = null;
      onRfbRef?.(null);
    }
  }, [onRfbRef]);

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

      const { default: RFB } = await import("@novnc/novnc/lib/rfb");
      if (cancelled || !containerRef.current) return;

      const wsUrl = `${wsProto}//${window.location.host}/relay/${encodeURIComponent(sessionName)}/${windowIndex}?server=${encodeURIComponent(server)}`;

      const rfb = new RFB(containerRef.current, wsUrl);
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.background = "rgb(15, 17, 23)";

      rfbRef.current = rfb;
      onRfbRef?.(rfb);

      rfb.addEventListener("connect", () => {
        if (cancelled) return;
        reconnectDelay = 1000;
      });

      rfb.addEventListener("disconnect", (e: CustomEvent<{ clean: boolean }>) => {
        if (cancelled) return;
        rfbRef.current = null;
        onRfbRef?.(null);

        // After several failed reconnects, treat as session not found
        if (reconnectDelay >= 16000 && onSessionNotFound) {
          onSessionNotFound();
          return;
        }

        // Reconnect after a delay
        reconnectTimer = setTimeout(() => {
          reconnectTimer = null;
          if (!cancelled) connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 30000);
      });
    }

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      cleanup();
    };
  }, [sessionName, windowIndex, server, cleanup, onRfbRef]);

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

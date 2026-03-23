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
  const outerRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<import("@novnc/novnc/lib/rfb").default | null>(null);
  const onSessionNotFoundRef = useRef(onSessionNotFound);
  onSessionNotFoundRef.current = onSessionNotFound;
  const onRfbRefRef = useRef(onRfbRef);
  onRfbRefRef.current = onRfbRef;

  // Pinch-to-zoom state
  const zoomRef = useRef({ scale: 1, x: 0, y: 0 });
  const pinchRef = useRef<{ startDist: number; startScale: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; origX: number; origY: number } | null>(null);

  // Apply CSS transform to the inner container
  function applyTransform() {
    if (!containerRef.current) return;
    const { scale, x, y } = zoomRef.current;
    containerRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    containerRef.current.style.transformOrigin = "0 0";
  }

  // Touch handlers for pinch-to-zoom and pan
  useEffect(() => {
    const el = outerRef.current;
    if (!el) return;

    function dist(t1: Touch, t2: Touch) {
      return Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    }

    function onTouchStart(e: TouchEvent) {
      if (e.touches.length === 2) {
        // Start pinch
        e.preventDefault();
        pinchRef.current = {
          startDist: dist(e.touches[0], e.touches[1]),
          startScale: zoomRef.current.scale,
        };
      } else if (e.touches.length === 1 && zoomRef.current.scale > 1) {
        // Start pan (only when zoomed in)
        panRef.current = {
          startX: e.touches[0].clientX,
          startY: e.touches[0].clientY,
          origX: zoomRef.current.x,
          origY: zoomRef.current.y,
        };
      }
    }

    function onTouchMove(e: TouchEvent) {
      if (e.touches.length === 2 && pinchRef.current) {
        e.preventDefault();
        const d = dist(e.touches[0], e.touches[1]);
        const newScale = Math.max(1, Math.min(5, pinchRef.current.startScale * (d / pinchRef.current.startDist)));
        zoomRef.current.scale = newScale;

        // Clamp pan so we don't go out of bounds
        clampPan();
        applyTransform();
      } else if (e.touches.length === 1 && panRef.current && zoomRef.current.scale > 1) {
        e.preventDefault();
        const dx = e.touches[0].clientX - panRef.current.startX;
        const dy = e.touches[0].clientY - panRef.current.startY;
        zoomRef.current.x = panRef.current.origX + dx;
        zoomRef.current.y = panRef.current.origY + dy;
        clampPan();
        applyTransform();
      }
    }

    function onTouchEnd(e: TouchEvent) {
      if (e.touches.length < 2) pinchRef.current = null;
      if (e.touches.length < 1) panRef.current = null;

      // Snap back to 1x if close
      if (zoomRef.current.scale < 1.1) {
        zoomRef.current = { scale: 1, x: 0, y: 0 };
        applyTransform();
      }
    }

    function clampPan() {
      if (!outerRef.current || !containerRef.current) return;
      const { scale } = zoomRef.current;
      const rect = outerRef.current.getBoundingClientRect();
      const maxX = 0;
      const minX = rect.width - rect.width * scale;
      const maxY = 0;
      const minY = rect.height - rect.height * scale;
      zoomRef.current.x = Math.max(minX, Math.min(maxX, zoomRef.current.x));
      zoomRef.current.y = Math.max(minY, Math.min(maxY, zoomRef.current.y));
    }

    el.addEventListener("touchstart", onTouchStart, { passive: false });
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd);

    return () => {
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
    };
  }, []);

  // noVNC connection
  useEffect(() => {
    if (!containerRef.current) return;

    let cancelled = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let reconnectDelay = 1000;

    const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";

    async function connect() {
      if (cancelled || !containerRef.current) return;

      containerRef.current.innerHTML = "";

      try {
        const { default: RFB } = await import("@novnc/novnc/lib/rfb");
        if (cancelled || !containerRef.current) return;

        const wsUrl = `${wsProto}//${window.location.host}/relay/${encodeURIComponent(sessionName)}/${windowIndex}?server=${encodeURIComponent(server)}`;

        const rfb = new RFB(containerRef.current, wsUrl);
        rfb.scaleViewport = true;
        rfb.resizeSession = false;
        rfb.clipViewport = false;
        rfb.background = "rgb(15, 17, 23)";

        // Recalculate scale when container resizes
        const observer = new ResizeObserver(() => {
          if (rfbRef.current) rfbRef.current.scaleViewport = true;
        });
        if (outerRef.current) observer.observe(outerRef.current);
        rfb.addEventListener("disconnect", () => observer.disconnect());

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

          if (reconnectDelay >= 16000 && onSessionNotFoundRef.current) {
            onSessionNotFoundRef.current();
            return;
          }

          reconnectTimer = setTimeout(() => {
            reconnectTimer = null;
            if (!cancelled) connect();
          }, reconnectDelay);
          reconnectDelay = Math.min(reconnectDelay * 2, 30000);
        });
      } catch {
        if (cancelled) return;
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionName, windowIndex, server]);

  return (
    <div
      ref={outerRef}
      role="application"
      aria-label={`Desktop: ${sessionName}/${windowIndex}`}
      className="flex-1 min-h-0 overflow-hidden bg-bg-inset"
      style={{ touchAction: "none" }}
    >
      <div
        ref={containerRef}
        className="w-full h-full"
      />
    </div>
  );
}

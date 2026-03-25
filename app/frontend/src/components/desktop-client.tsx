import { useEffect, useRef } from "react";

export type TouchMode = "direct" | "trackpad";

type DesktopClientProps = {
  sessionName: string;
  windowIndex: string;
  server: string;
  touchMode?: TouchMode;
  onSessionNotFound?: () => void;
  onRfbRef?: (rfb: import("@novnc/novnc/lib/rfb").default | null) => void;
};

export function DesktopClient({
  sessionName,
  windowIndex,
  server,
  touchMode = "direct",
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

  // Trackpad mode state
  const touchModeRef = useRef<TouchMode>(touchMode);
  const cursorRef = useRef({ x: 960, y: 540 });
  const trackpadRef = useRef({ startX: 0, startY: 0, moved: false });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep touchModeRef in sync with prop
  useEffect(() => {
    touchModeRef.current = touchMode;
  }, [touchMode]);

  // Sync canvas pointer-events and showDotCursor with touchMode
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const canvas = container.querySelector("canvas");
    if (canvas) {
      canvas.style.pointerEvents = touchMode === "trackpad" ? "none" : "";
    }
    if (rfbRef.current) {
      rfbRef.current.showDotCursor = touchMode === "trackpad";
    }
  }, [touchMode]);

  // Apply CSS transform to the inner container
  function applyTransform() {
    if (!containerRef.current) return;
    const { scale, x, y } = zoomRef.current;
    containerRef.current.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    containerRef.current.style.transformOrigin = "0 0";
  }

  // Send a synthetic mouse event at cursorRef position on the noVNC canvas
  function sendPointerToCanvas(type: "mousemove" | "mousedown" | "mouseup", button = 0) {
    const container = containerRef.current;
    if (!container) return;
    const canvas = container.querySelector("canvas");
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    // cursorRef is in VNC framebuffer coords; convert to screen coords
    const fbWidth = canvas.width;
    const fbHeight = canvas.height;
    const scaleX = rect.width / fbWidth;
    const scaleY = rect.height / fbHeight;

    const screenX = rect.left + cursorRef.current.x * scaleX;
    const screenY = rect.top + cursorRef.current.y * scaleY;

    // Temporarily enable pointer-events so the event reaches noVNC
    const prevPE = canvas.style.pointerEvents;
    canvas.style.pointerEvents = "auto";

    const evt = new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      clientX: screenX,
      clientY: screenY,
      button,
      buttons: type === "mousedown" ? 1 : 0,
    });
    canvas.dispatchEvent(evt);

    canvas.style.pointerEvents = prevPE;
  }

  // Touch handlers for pinch-to-zoom, pan, and trackpad
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
        // Cancel any long press timer on pinch
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
        pinchRef.current = {
          startDist: dist(e.touches[0], e.touches[1]),
          startScale: zoomRef.current.scale,
        };
      } else if (e.touches.length === 1) {
        if (touchModeRef.current === "trackpad") {
          // Trackpad mode: single finger
          e.preventDefault();
          trackpadRef.current = {
            startX: e.touches[0].clientX,
            startY: e.touches[0].clientY,
            moved: false,
          };
          // Start long press timer (500ms) for right-click simulation
          longPressTimerRef.current = setTimeout(() => {
            longPressTimerRef.current = null;
            sendPointerToCanvas("mousedown", 0);
            sendPointerToCanvas("mouseup", 0);
          }, 500);
        } else if (zoomRef.current.scale > 1) {
          // Start pan (only when zoomed in)
          panRef.current = {
            startX: e.touches[0].clientX,
            startY: e.touches[0].clientY,
            origX: zoomRef.current.x,
            origY: zoomRef.current.y,
          };
        }
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
      } else if (e.touches.length === 1 && touchModeRef.current === "trackpad") {
        e.preventDefault();
        const dx = e.touches[0].clientX - trackpadRef.current.startX;
        const dy = e.touches[0].clientY - trackpadRef.current.startY;

        // Cancel long press if finger moved more than 3px
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          if (longPressTimerRef.current) {
            clearTimeout(longPressTimerRef.current);
            longPressTimerRef.current = null;
          }
        }

        // Update cursor position in VNC framebuffer coords
        // Use a sensitivity multiplier for reasonable trackpad feel
        const sensitivity = 1.5;
        cursorRef.current.x = Math.max(0, cursorRef.current.x + dx * sensitivity);
        cursorRef.current.y = Math.max(0, cursorRef.current.y + dy * sensitivity);

        // Clamp to framebuffer bounds
        const container = containerRef.current;
        if (container) {
          const canvas = container.querySelector("canvas");
          if (canvas) {
            cursorRef.current.x = Math.min(cursorRef.current.x, canvas.width);
            cursorRef.current.y = Math.min(cursorRef.current.y, canvas.height);
          }
        }

        // Update start position for frame-to-frame delta
        trackpadRef.current.startX = e.touches[0].clientX;
        trackpadRef.current.startY = e.touches[0].clientY;
        trackpadRef.current.moved = true;

        sendPointerToCanvas("mousemove");
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
      // Always clear long press timer
      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
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

        // Apply trackpad mode settings to new RFB instance
        if (touchModeRef.current === "trackpad") {
          rfb.showDotCursor = true;
          const canvas = containerRef.current.querySelector("canvas");
          if (canvas) canvas.style.pointerEvents = "none";
        }

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

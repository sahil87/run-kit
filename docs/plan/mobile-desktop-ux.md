# Mobile Desktop UX Improvements

## Goal

Make the browser-based desktop streaming experience on mobile competitive with native VNC apps (RealVNC Viewer, Jump Desktop). The current implementation works but has significant usability gaps on touch devices.

## Current State

### What exists
- **noVNC** renders the remote desktop in a `<canvas>` inside `desktop-client.tsx`
- **Pinch-to-zoom** with two fingers, pan when zoomed (CSS transform on container)
- **Bottom bar** (`desktop-bottom-bar.tsx`) with: Paste, Resolution picker, Fullscreen, Keyboard toggle, Cmd+K
- **Keyboard input** via hidden `<textarea>` that triggers the mobile virtual keyboard, sends characters via `sendKey(keysym)`
- **Touch handling** lives in `desktop-client.tsx` useEffect — intercepts touch events on the outer container div

### Key files
- `app/frontend/src/components/desktop-client.tsx` — noVNC connection + touch/zoom handlers
- `app/frontend/src/components/desktop-bottom-bar.tsx` — toolbar with controls
- `app/frontend/src/types/novnc.d.ts` — TypeScript declarations for noVNC RFB class
- noVNC library at `app/frontend/node_modules/@novnc/novnc/lib/rfb.js`

### How noVNC input works
- noVNC creates its own `<canvas>` inside the container div we give it
- The canvas has `tabIndex=-1` and attaches its own mouse/touch/keyboard event listeners
- Mouse events: `handleMouse` converts `clientX/clientY` to VNC framebuffer coordinates using `getBoundingClientRect()` and the scale ratio
- noVNC has a built-in gesture handler (`input/gesturehandler.js`) that converts touch to mouse events
- `rfb.sendKey(keysym, code, down)` sends keyboard events
- The RFB instance has `scaleViewport`, `clipViewport`, `resizeSession`, `showDotCursor`, `focusOnClick` properties

### How our zoom overlay works
- The outer div (`outerRef`) captures touch events for pinch-to-zoom
- The inner div (`containerRef`) holds the noVNC canvas and gets a CSS `transform: translate() scale()`
- At zoom=1, single-touch passes through to noVNC's canvas (our handler ignores it)
- At zoom>1, single-touch is captured for panning (noVNC never sees it)
- Two-finger touch is always captured for pinch (noVNC never sees it)
- This means: noVNC's built-in gesture handling only gets single-touch at zoom=1

---

## Improvement Plan

Each improvement below is independent and can be implemented in any order. They are ranked by user impact.

---

### 1. Trackpad Mode (Indirect Touch)

**Priority: Critical — this is the single biggest mobile UX gap**

**Problem:** Tapping the screen sends a click directly where your finger lands. On a small phone screen viewing a 1920x1080 desktop, UI targets are tiny and your finger covers them. Native VNC apps solve this with "trackpad mode."

**How it should work:**
- A visible cursor is shown on the remote desktop (noVNC's `showDotCursor = true`)
- Single-finger **drag** moves the cursor without clicking (like a laptop trackpad)
- Single-finger **tap** (touch down + up without significant movement) sends a left-click at the cursor's current position
- The cursor position is maintained in local state, not sent as pointer-move on every touch-move — only the final click position matters for the remote side
- A toggle button in the bottom bar switches between "Direct Touch" and "Trackpad" modes

**Implementation approach:**
1. Add a `touchMode` state to `desktop-client.tsx`: `"direct" | "trackpad"`
2. In trackpad mode, intercept single-touch events before they reach noVNC:
   - `touchstart`: record start position
   - `touchmove`: calculate delta, send VNC `pointerEvent` with relative movement (current cursor pos + delta), no button pressed
   - `touchend`: if total movement < threshold (e.g., 10px), send a click (pointerEvent with button 1 down, then up) at current cursor position
3. Track the cursor position in a ref: `cursorRef = useRef({ x: width/2, y: height/2 })`
4. Need to convert screen touch coordinates to VNC framebuffer coordinates, accounting for the CSS scale transform and noVNC's own scaling
5. Use noVNC's `showDotCursor = true` so the user can see where the cursor is
6. Add a toggle button to `desktop-bottom-bar.tsx` — icon: a finger with a cursor, or a trackpad icon

**Coordinate math:**
```
// Screen touch position → VNC framebuffer position
const canvasRect = rfb._canvas.getBoundingClientRect();  // canvas's screen position (includes CSS transform)
const fbWidth = rfb._fbWidth;   // remote framebuffer width
const fbHeight = rfb._fbHeight; // remote framebuffer height
const scaleX = fbWidth / canvasRect.width;
const scaleY = fbHeight / canvasRect.height;

// For trackpad: delta in screen pixels → delta in VNC pixels
const vncDx = touchDeltaX * scaleX;
const vncDy = touchDeltaY * scaleY;
cursorX = clamp(cursorX + vncDx, 0, fbWidth);
cursorY = clamp(cursorY + vncDy, 0, fbHeight);
```

**Note:** Accessing `rfb._canvas`, `rfb._fbWidth`, `rfb._fbHeight` requires reaching into noVNC internals. These are private but stable. Alternatively, the canvas dimensions can be read from the DOM and the framebuffer size inferred from the `desktopname` event or the canvas's native width/height attributes.

**Testing:** On a phone, open a desktop with small UI targets (like a file manager or browser). Verify you can precisely position the cursor and click small buttons without your finger blocking the view.

---

### 2. Right-Click and Scroll Gestures

**Priority: High — many desktop apps are unusable without right-click and scroll**

**Problem:** No way to right-click or scroll on mobile. Two-finger gestures are entirely consumed by pinch-to-zoom.

**How it should work:**
- **Long-press** (hold ~500ms without moving) → right-click at that position
- **Two-finger vertical drag** (slow, parallel movement) → scroll wheel events
- **Two-finger pinch** (diverging/converging movement) → zoom (existing behavior)
- **Two-finger tap** (both fingers down + up quickly) → right-click at midpoint

**Implementation approach:**
1. In the `touchstart` handler, start a long-press timer when a single finger touches:
   ```
   longPressTimer = setTimeout(() => {
     // Send right-click: button mask with bit 2 (right button)
     rfb._mouse._sendButton(cursorX, cursorY, 0x4);  // right down
     rfb._mouse._sendButton(cursorX, cursorY, 0x0);  // right up
     // Optional: vibrate for haptic feedback
     navigator.vibrate?.(50);
   }, 500);
   ```
2. Cancel the long-press timer if the finger moves more than a few pixels, or if a second finger touches
3. For two-finger scroll vs pinch discrimination:
   - Track the angle between finger movement vectors
   - If both fingers move in the same direction (parallel): **scroll**
   - If fingers move apart/together (diverging): **pinch zoom**
   - Threshold: if the distance between fingers changes by more than 20px, it's a pinch; if the midpoint moves by more than 20px with stable distance, it's a scroll
4. For scroll: send VNC scroll events (button mask bits 3/4 for scroll up/down):
   ```
   // Scroll up: button 4 (mask 0x8)
   // Scroll down: button 5 (mask 0x10)
   rfb.sendPointerEvent(cursorX, cursorY, scrollUp ? 0x8 : 0x10);
   rfb.sendPointerEvent(cursorX, cursorY, 0x0); // release
   ```
5. For two-finger tap: detect both fingers down + up within ~300ms with < 20px total movement

**Gesture state machine:**
```
IDLE → single touch → start long-press timer
  → move > threshold → cancel timer, enter DRAG (or PAN if zoomed)
  → timer fires → RIGHT_CLICK
  → touch end < threshold → LEFT_CLICK (or tap in trackpad mode)

IDLE → two touches →
  → fingers diverge → PINCH_ZOOM (existing)
  → fingers move parallel → SCROLL
  → both release quickly → TWO_FINGER_TAP → RIGHT_CLICK
```

**Testing:** Open a desktop with a file manager. Long-press a file → context menu should appear. Two-finger drag up/down on a web page → should scroll.

---

### 3. Modifier Key Bar

**Priority: High — keyboard shortcuts are essential for desktop use**

**Problem:** The bottom bar has no modifier keys. Can't do Ctrl+C, Ctrl+V, Alt+Tab, Cmd+Space, etc. The virtual keyboard only sends printable characters and a few special keys.

**How it should work:**
- A row of **toggle buttons** for modifier keys: Ctrl, Alt/Opt, Shift, Super/Cmd, Esc, Tab
- Modifiers are **sticky**: tap Ctrl → it highlights → next keypress/click includes Ctrl → Ctrl deactivates
- **Double-tap** a modifier to **lock** it (stays active for multiple keypresses)
- Arrow keys (←↑↓→) as a group
- Common combos as presets: Ctrl+C, Ctrl+V, Ctrl+Z, Ctrl+A

**Implementation approach:**
1. Add state to `desktop-bottom-bar.tsx`:
   ```tsx
   const [modifiers, setModifiers] = useState({
     ctrl: false, alt: false, shift: false, meta: false
   });
   const [locked, setLocked] = useState({
     ctrl: false, alt: false, shift: false, meta: false
   });
   ```
2. When a modifier is active, the next `sendKey` call should include it:
   ```tsx
   function sendKeyWithModifiers(keysym: number) {
     if (modifiers.ctrl) rfb.sendKey(0xffe3, null, true);   // Ctrl down
     if (modifiers.alt) rfb.sendKey(0xffe9, null, true);    // Alt down
     if (modifiers.shift) rfb.sendKey(0xffe1, null, true);  // Shift down
     if (modifiers.meta) rfb.sendKey(0xffe7, null, true);   // Meta down

     rfb.sendKey(keysym, null, true);
     rfb.sendKey(keysym, null, false);

     if (modifiers.meta) rfb.sendKey(0xffe7, null, false);
     if (modifiers.shift) rfb.sendKey(0xffe1, null, false);
     if (modifiers.alt) rfb.sendKey(0xffe9, null, false);
     if (modifiers.ctrl) rfb.sendKey(0xffe3, null, false);

     // Deactivate non-locked modifiers after use
     setModifiers(prev => ({
       ctrl: locked.ctrl ? prev.ctrl : false,
       alt: locked.alt ? prev.alt : false,
       shift: locked.shift ? prev.shift : false,
       meta: locked.meta ? prev.meta : false,
     }));
   }
   ```
3. Also apply modifiers to mouse clicks — if Ctrl is active and user clicks, send Ctrl+click
4. Render as a scrollable row of small buttons, only on `coarse` pointer devices (mobile):
   ```tsx
   <div className="flex gap-1 overflow-x-auto coarse:flex hidden">
     <ModKey label="Ctrl" ... />
     <ModKey label="Alt" ... />
     <ModKey label="⇧" ... />
     <ModKey label="⌘" ... />
     <ModKey label="Esc" ... />
     <ModKey label="Tab" ... />
     <div className="flex gap-0.5">
       <ModKey label="←" ... />
       <ModKey label="↑" ... />
       <ModKey label="↓" ... />
       <ModKey label="→" ... />
     </div>
   </div>
   ```
5. Visual states: default (outline), active (filled accent), locked (filled + underline)

**Testing:** Open a terminal in the desktop. Tap Ctrl, then type C → should send Ctrl+C. Double-tap Shift to lock it → type "hello" → should send "HELLO".

---

### 4. Two-Finger Scroll vs Pinch Discrimination

**Priority: Medium — related to #2 but specifically about not breaking zoom**

**Problem:** Currently all two-finger gestures are pinch-to-zoom. This steals scroll from the user.

**Implementation approach:**
Modify the existing `onTouchMove` handler in `desktop-client.tsx`:

```tsx
function onTouchMove(e: TouchEvent) {
  if (e.touches.length === 2 && pinchRef.current) {
    e.preventDefault();
    const d = dist(e.touches[0], e.touches[1]);
    const mid = midpoint(e.touches[0], e.touches[1]);

    const distDelta = Math.abs(d - pinchRef.current.startDist);
    const midDelta = Math.hypot(
      mid.x - pinchRef.current.startMid.x,
      mid.y - pinchRef.current.startMid.y
    );

    // Haven't committed to a gesture yet
    if (!pinchRef.current.gesture) {
      if (distDelta > 30) {
        pinchRef.current.gesture = "zoom";
      } else if (midDelta > 20) {
        pinchRef.current.gesture = "scroll";
      }
      return; // wait for more data
    }

    if (pinchRef.current.gesture === "zoom") {
      // existing pinch-to-zoom code
    } else if (pinchRef.current.gesture === "scroll") {
      // send scroll events to VNC
      const dy = mid.y - pinchRef.current.lastMid.y;
      if (Math.abs(dy) > 5) {
        const scrollButton = dy < 0 ? 0x8 : 0x10; // up : down
        rfb.sendPointerEvent(cursorX, cursorY, scrollButton);
        rfb.sendPointerEvent(cursorX, cursorY, 0);
        pinchRef.current.lastMid = mid;
      }
    }
  }
}
```

**Key insight:** The discrimination happens in the first ~50ms of the gesture. Accumulate movement data before committing to zoom or scroll. Once committed, stay in that mode for the rest of the gesture.

---

### 5. Double-Tap to Zoom

**Priority: Medium — nice-to-have, improves navigation**

**Problem:** Only pinch-to-zoom exists. Native apps let you double-tap a region to zoom into it (2x), double-tap again to zoom out.

**Implementation approach:**
1. Detect double-tap: two taps within 300ms, within 30px of each other
2. On double-tap at position (x, y):
   - If zoomed out (scale=1): zoom to 2x centered on the tap position
   - If zoomed in (scale>1): zoom back to 1x
3. Animate the transition with CSS `transition: transform 200ms ease-out`
4. Calculate the translate offset so the tapped point stays in the same screen position after zoom:
   ```
   // Tap position in container coordinates
   const rect = outerRef.current.getBoundingClientRect();
   const tapX = e.clientX - rect.left;
   const tapY = e.clientY - rect.top;

   // After 2x zoom, this point should stay at the same screen position
   zoomRef.current = {
     scale: 2,
     x: tapX - tapX * 2,  // = -tapX
     y: tapY - tapY * 2,  // = -tapY
   };
   clampPan();
   applyTransform();
   ```

**Testing:** Double-tap on a region of the desktop → should smoothly zoom to 2x with the tapped area centered. Double-tap again → zoom back out.

---

### 6. Click-and-Drag Support

**Priority: Medium — needed for window management, selecting text, slider controls**

**Problem:** On mobile at zoom=1, single-touch passes through to noVNC which handles it as direct touch. But there's no way to distinguish "I want to drag this window" from "I want to pan the zoomed view" when zoomed in.

**How it should work:**
- In **direct mode** at zoom=1: touch-down → mouse-down, touch-move → mouse-move (drag), touch-up → mouse-up. This already works via noVNC's built-in touch handling.
- In **trackpad mode**: touch-down, wait briefly, touch-move → drag from cursor position. The brief wait distinguishes "move cursor" from "drag."
- Specifically in trackpad mode:
  - Quick drag (move immediately after touch) → move cursor
  - Tap-and-hold-then-drag → click-and-drag from cursor position

**Implementation for trackpad mode:**
1. On `touchstart`: start a 150ms timer
2. If `touchmove` happens before timer: this is cursor movement (no button pressed)
3. If timer fires while finger is still down: enter drag mode — send mouse-down, then subsequent moves send mouse-move with button held
4. On `touchend` in drag mode: send mouse-up

---

## Architecture Notes

### Touch Event Flow
Currently the touch event flow is:
```
outer div (touchstart/move/end) → our zoom/pan handler → if not consumed → noVNC canvas listeners
```

For the improvements above, the flow should become:
```
outer div → gesture recognizer (state machine) → routes to:
  ├── pinch-to-zoom (existing)
  ├── scroll (new)
  ├── trackpad cursor move (new)
  ├── trackpad click (new)
  ├── long-press right-click (new)
  ├── double-tap zoom (new)
  ├── drag (new)
  └── pass-through to noVNC (direct mode, zoom=1)
```

Consider extracting the gesture handling into a dedicated `useDesktopGestures` hook to keep `desktop-client.tsx` clean.

### Sending VNC Pointer Events
noVNC's RFB class doesn't expose a clean "send pointer event" API publicly. Options:
1. **Use internal API:** `rfb._mouse._sendButton(x, y, mask)` — works but fragile
2. **Dispatch synthetic mouse events** on the noVNC canvas — noVNC's `handleMouse` will convert them. More stable but coordinate math must match noVNC's expectations.
3. **Patch noVNC types** to expose `sendPointerEvent` — clean but requires maintaining the patch.

Recommendation: option 2 (synthetic events) for stability. Create a helper:
```tsx
function sendPointerToVNC(rfb: RFB, x: number, y: number, buttonMask: number) {
  // x, y are in VNC framebuffer coordinates
  // Convert to canvas screen coordinates for the synthetic event
  const canvas = rfb._canvas ?? containerRef.current?.querySelector('canvas');
  if (!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const screenX = rect.left + (x / fbWidth) * rect.width;
  const screenY = rect.top + (y / fbHeight) * rect.height;

  // Dispatch synthetic mouse event
  canvas.dispatchEvent(new MouseEvent('mousemove', {
    clientX: screenX, clientY: screenY, bubbles: true
  }));
  if (buttonMask) {
    canvas.dispatchEvent(new MouseEvent('mousedown', {
      clientX: screenX, clientY: screenY, button: ..., bubbles: true
    }));
  }
}
```

### State Persistence
- `touchMode` ("direct" | "trackpad") should persist in localStorage so the user's preference survives page reloads
- Modifier key state should reset on disconnect/reconnect

### Mobile Detection
Use CSS `@media (pointer: coarse)` for showing/hiding mobile-specific UI. In JS: `window.matchMedia('(pointer: coarse)').matches`. The existing codebase uses Tailwind's `coarse:` variant.

---

## Implementation Order Recommendation

1. **Modifier Key Bar** (#3) — quickest to implement, immediately useful, no touch handler changes
2. **Trackpad Mode** (#1) — biggest UX win, moderate complexity
3. **Right-Click + Scroll** (#2 + #4) — implement together since they share the gesture recognizer
4. **Double-Tap Zoom** (#5) — small standalone feature
5. **Drag Support** (#6) — builds on trackpad mode

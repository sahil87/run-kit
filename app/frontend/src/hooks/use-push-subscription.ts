import { useCallback, useEffect, useMemo, useState } from "react";
import type { PaletteAction } from "@/components/command-palette";
import { useToast } from "@/components/toast";
import {
  enablePushSubscription,
  getPushState,
  sendTestNotification,
  type PushState,
} from "@/lib/push";

/**
 * Push opt-in + test, surfaced both as command-palette actions (Cmd+K, per
 * Constitution §V Keyboard-First / §IV Minimal Surface Area) and as the
 * top-bar `NotificationControl` button+dropdown. Both surfaces are backed by
 * the same `enable` / `sendTest` handlers and `state` here, so they never drift.
 */
export function usePushSubscription(): {
  state: PushState;
  enable: () => Promise<void>;
  sendTest: () => Promise<void>;
  actions: PaletteAction[];
} {
  const [state, setState] = useState<PushState>("default");
  const { addToast } = useToast();

  // Resolve the initial state once on mount (without prompting the user). The
  // underlying getPushState() is timeout-guarded, so this never hangs.
  useEffect(() => {
    let cancelled = false;
    getPushState().then((s) => {
      if (!cancelled) setState(s);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const enable = useCallback(async () => {
    const next = await enablePushSubscription();
    setState(next);
    switch (next) {
      case "subscribed":
        addToast("Push notifications enabled", "info");
        break;
      case "denied":
        addToast("Notifications blocked — enable them in your browser settings", "error");
        break;
      case "unsupported":
        addToast("Push needs a secure context (HTTPS or localhost)", "error");
        break;
      default:
        // "default": user dismissed the prompt or the flow aborted — stay quiet.
        break;
    }
  }, [addToast]);

  const sendTest = useCallback(async () => {
    const shown = await sendTestNotification();
    if (shown) {
      addToast("Test notification sent — check your desktop", "info");
    } else if (Notification?.permission === "denied") {
      addToast("Notifications blocked — enable them in your browser settings", "error");
    } else {
      addToast("Enable notifications first", "error");
    }
  }, [addToast]);

  const actions = useMemo<PaletteAction[]>(() => {
    const list: PaletteAction[] = [];
    if (state === "subscribed") {
      // Already on — a no-op marker + a test action.
      list.push({
        id: "push-enabled",
        label: "Notifications: Enabled ✓",
        onSelect: () => {},
      });
      list.push({
        id: "push-test",
        label: "Notifications: Send test notification",
        onSelect: () => {
          void sendTest();
        },
      });
    } else {
      list.push({
        id: "push-enable",
        label: "Notifications: Enable push",
        onSelect: () => {
          void enable();
        },
      });
    }
    return list;
  }, [state, enable, sendTest]);

  return { state, enable, sendTest, actions };
}

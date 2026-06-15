import { useCallback, useEffect, useMemo, useState } from "react";
import type { PaletteAction } from "@/components/command-palette";
import { useToast } from "@/components/toast";
import { enablePushSubscription, getPushState, type PushState } from "@/lib/push";

/**
 * Push opt-in, surfaced as command-palette actions (Cmd+K) per Constitution
 * §V Keyboard-First and §IV Minimal Surface Area — no new route/settings page.
 *
 * The visible affordance is terminal-themed (a text label that reflects state),
 * NOT a bell icon (explicit user decision). `pushActions` returns at most one
 * entry: the enable command when not yet subscribed.
 */
export function usePushSubscription(): { state: PushState; actions: PaletteAction[] } {
  const [state, setState] = useState<PushState>("default");
  const { addToast } = useToast();

  // Resolve the initial state once on mount (without prompting the user).
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

  const actions = useMemo<PaletteAction[]>(() => {
    if (state === "subscribed") {
      // Already on — surface a terminal-themed "enabled" marker, no action.
      return [
        {
          id: "push-enabled",
          label: "Notifications: Enabled ✓",
          onSelect: () => {},
        },
      ];
    }
    return [
      {
        id: "push-enable",
        label: "Notifications: Enable push",
        onSelect: () => {
          void enable();
        },
      },
    ];
  }, [state, enable]);

  return { state, actions };
}

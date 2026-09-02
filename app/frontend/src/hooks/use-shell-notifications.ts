import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useSessionContext } from "@/contexts/session-context";
import { showShellNotification } from "@/lib/shell-notifications";

export function useShellNotifications(): void {
  const { subscribeNotify } = useSessionContext();
  const navigate = useNavigate();

  useEffect(
    () =>
      subscribeNotify((payload) => {
        showShellNotification(payload, (path) => {
          void navigate({ href: path });
        });
      }),
    [navigate, subscribeNotify],
  );
}

// Confirmed-utterance delivery routing. The confirm card is the ONLY caller:
// raw STT output never reaches a send endpoint without passing that gate.
//
// Routing is decided client-side on the hosting window's chat rollup (the
// same predicate family as the operator affordance gating): an agent window
// (non-empty chatSessionRef) takes the window send with pane pinning; a bare
// shell window hands the utterance to the server's operator via the
// window-scoped voice template. The operator busy 409 is an expected outcome,
// not an error — it routes to `onBusy` (the HUD shows a card and speaks);
// every other failure rethrows so the caller toasts the server's message.

import { ApiError, sendOperatorRequest, sendToWindow } from "@/api/client";

/** The closed-registry template id for shell-window utterances. */
export const VOICE_SHELL_COMMAND_TEMPLATE = "voice-shell-command";

/** The operator busy gate's status — an expected branch, swallowed here. */
export const OPERATOR_BUSY_STATUS = 409;

/** Agent-pane routing predicate: a non-empty chatSessionRef marks a window
 *  whose active pane runs a chat agent. */
export function routeIsAgentWindow(win: { chatSessionRef?: string | null }): boolean {
  return typeof win.chatSessionRef === "string" && win.chatSessionRef.length > 0;
}

/** The utterance's target pane: the window's active pane, else its first.
 *  Null when the window record carries no pane list (the send falls back to
 *  tmux's active-pane behavior server-side). */
export function resolveTargetPaneId(win: {
  panes?: { paneId: string; isActive: boolean }[];
}): string | null {
  const panes = win.panes ?? [];
  return (panes.find((p) => p.isActive) ?? panes[0])?.paneId ?? null;
}

export async function deliverUtterance(args: {
  server: string;
  windowId: string;
  paneId: string | null;
  text: string;
  isAgentWindow: boolean;
  onBusy: () => void;
}): Promise<void> {
  const { server, windowId, paneId, text, isAgentWindow, onBusy } = args;
  if (isAgentWindow) {
    await sendToWindow(server, windowId, text, "submit", paneId ?? undefined);
    return;
  }
  try {
    await sendOperatorRequest(server, windowId, VOICE_SHELL_COMMAND_TEMPLATE, text);
  } catch (err) {
    if (err instanceof ApiError && err.status === OPERATOR_BUSY_STATUS) {
      onBusy();
      return;
    }
    throw err;
  }
}

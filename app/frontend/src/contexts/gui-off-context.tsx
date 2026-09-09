import { createContext, useContext } from "react";

/**
 * The GUI off-confirm seam (spec docs/specs/gui.md § The switch). Provided at
 * AppLayout, where the ONE GuiOffDialog mounts; `open` shows the dialog in
 * self-posting mode (the palette's `GUI: Turn off`), `request` shows it
 * deferring the POST to the caller and resolves the verdict (`true` on
 * confirm) — the settings seam's `gui.enabled` off interception, which must
 * `updateEntryValue` with the same write. `undefined` outside the provider
 * (unit tests, non-AppLayout mounts) — callers fall back to the direct
 * behavior.
 */
export type GuiOffRequest = {
  open: () => void;
  request: () => Promise<boolean>;
};

const GuiOffRequestContext = createContext<GuiOffRequest | undefined>(undefined);

export const GuiOffRequestProvider = GuiOffRequestContext.Provider;

export function useGuiOffRequest(): GuiOffRequest | undefined {
  return useContext(GuiOffRequestContext);
}

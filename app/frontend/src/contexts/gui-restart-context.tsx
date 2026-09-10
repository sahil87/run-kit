import { createContext, useContext } from "react";

/**
 * The desktop restart-confirm seam (spec docs/specs/gui.md § Switching
 * desktops). Provided at AppLayout, where the ONE GuiRestartDialog mounts;
 * `request` shows the dialog and resolves the verdict (`true` on Restart).
 * Mirrors the GuiOffRequest shape. `undefined` outside the provider (unit
 * tests, non-AppLayout mounts) — callers skip the confirm then; the settings
 * write already stands.
 */
export type GuiRestartRequest = {
  request: () => Promise<boolean>;
};

const GuiRestartRequestContext = createContext<GuiRestartRequest | undefined>(undefined);

export const GuiRestartRequestProvider = GuiRestartRequestContext.Provider;

export function useGuiRestartRequest(): GuiRestartRequest | undefined {
  return useContext(GuiRestartRequestContext);
}

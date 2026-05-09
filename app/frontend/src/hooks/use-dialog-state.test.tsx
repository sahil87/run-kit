import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { useDialogState } from "./use-dialog-state";
import { StandaloneSessionContextProvider } from "@/contexts/session-context";
import { ToastProvider } from "@/components/toast";
import { OptimisticProvider } from "@/contexts/optimistic-context";

vi.mock("@/api/client", () => ({
  renameSession: vi.fn().mockResolvedValue({ ok: true }),
  renameWindow: vi.fn().mockResolvedValue({ ok: true }),
  killSession: vi.fn().mockResolvedValue({ ok: true }),
  killWindow: vi.fn().mockResolvedValue({ ok: true }),
  listServers: vi.fn().mockResolvedValue([]),
}));

import { renameSession } from "@/api/client";

// Bypass SessionProvider's SSE machinery by using StandaloneSessionContextProvider.
// `currentServer` is the value that drives `useSessionContextForCurrentServer()`,
// which is what useDialogState reads. Flipping `currentServer` between renders
// covers the "server-at-handler-time" regression.
function Wrapper({ server, children }: { server: string; children: ReactNode }) {
  return (
    <ToastProvider>
      <StandaloneSessionContextProvider
        value={{
          sessionsByServer: new Map([[server, []]]),
          sessionOrderByServer: new Map([[server, []]]),
          isConnectedByServer: new Map([[server, false]]),
          metricsByServer: new Map(),
          currentServer: server,
          servers: [{ name: server, sessionCount: 0 }],
          refreshServers: vi.fn(),
        }}
      >
        <OptimisticProvider>{children}</OptimisticProvider>
      </StandaloneSessionContextProvider>
    </ToastProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe("useDialogState — server capture at handler time", () => {
  it(
    "regression: rerendering SessionProvider with a changed server between openRenameDialog and handleRenameSession uses the new server",
    async () => {
      // Build a dynamic wrapper whose `server` prop we can flip between renders.
      let currentServer = "server-A";
      const DynamicWrapper = ({ children }: { children: ReactNode }) => (
        <Wrapper server={currentServer}>{children}</Wrapper>
      );

      const { result, rerender } = renderHook(
        () =>
          useDialogState({
            sessionName: "foo",
            windowIndex: 0,
            windowId: "@0",
          }),
        { wrapper: DynamicWrapper },
      );

      // Step 1: open the rename dialog on server-A
      act(() => {
        result.current.openRenameSessionDialog("foo");
      });

      // Step 2: flip the provider's server to server-B, type a new name, submit
      currentServer = "server-B";
      rerender();
      act(() => {
        result.current.setRenameSessionName("bar");
      });
      await act(async () => {
        result.current.handleRenameSession();
        // Flush the microtask from the optimistic action's Promise.resolve()
        await Promise.resolve();
        await Promise.resolve();
      });

      // Step 3: renameSession must have been called with server-B (current at submit time)
      expect(renameSession).toHaveBeenCalledWith("server-B", "foo", "bar");
      // And never with server-A
      const calls = (renameSession as unknown as { mock: { calls: unknown[][] } }).mock.calls;
      for (const call of calls) {
        expect(call[0]).not.toBe("server-A");
      }
    },
  );
});

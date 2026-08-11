import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";
import { useMemo } from "react";
import {
  PaletteActionsProvider,
  usePaletteActions,
  usePaletteActionsApi,
  usePaletteGlobals,
  useRegisterPaletteActions,
} from "./palette-actions-context";
import type { PaletteAction } from "@/components/command-palette";

const GLOBAL_ACTIONS: PaletteAction[] = [
  { id: "settings-open", label: "Settings: Open", onSelect: () => {} },
];

/** Read-side probe — renders the merged list's ids in order. */
function ActionsView() {
  const allActions = usePaletteActions();
  return (
    <span data-testid="actions">
      {allActions.map((a) => a.id).join(",") || "empty"}
    </span>
  );
}

/** A minimal registering route. Publishes a memoized list on mount, clears
 *  on unmount (via the hook's effect cleanup). */
function Registrant({ ids }: { ids: string[] }) {
  const actions = useMemo<PaletteAction[]>(
    () => ids.map((id) => ({ id, label: id, onSelect: () => {} })),
    [ids],
  );
  useRegisterPaletteActions(actions);
  return null;
}

describe("PaletteActionsContext", () => {
  afterEach(cleanup);

  it("exposes the global groups only when no route has registered", () => {
    render(
      <PaletteActionsProvider globalActions={GLOBAL_ACTIONS}>
        <ActionsView />
      </PaletteActionsProvider>,
    );
    expect(screen.getByTestId("actions").textContent).toBe("settings-open");
  });

  it("merges registered route actions before the global groups", () => {
    render(
      <PaletteActionsProvider globalActions={GLOBAL_ACTIONS}>
        <Registrant ids={["kill-window", "split-horizontal"]} />
        <ActionsView />
      </PaletteActionsProvider>,
    );
    expect(screen.getByTestId("actions").textContent).toBe(
      "kill-window,split-horizontal,settings-open",
    );
  });

  it("clears the route actions when the registering route unmounts", () => {
    const { rerender } = render(
      <PaletteActionsProvider globalActions={GLOBAL_ACTIONS}>
        <Registrant ids={["kill-window"]} />
        <ActionsView />
      </PaletteActionsProvider>,
    );
    expect(screen.getByTestId("actions").textContent).toBe("kill-window,settings-open");
    act(() => {
      rerender(
        <PaletteActionsProvider globalActions={GLOBAL_ACTIONS}>
          <ActionsView />
        </PaletteActionsProvider>,
      );
    });
    expect(screen.getByTestId("actions").textContent).toBe("settings-open");
  });

  it("is last-writer-wins — a re-registered list overwrites the prior value", () => {
    const { rerender } = render(
      <PaletteActionsProvider globalActions={GLOBAL_ACTIONS}>
        <Registrant ids={["alpha"]} />
        <ActionsView />
      </PaletteActionsProvider>,
    );
    expect(screen.getByTestId("actions").textContent).toBe("alpha,settings-open");
    act(() => {
      rerender(
        <PaletteActionsProvider globalActions={GLOBAL_ACTIONS}>
          <Registrant ids={["beta"]} />
          <ActionsView />
        </PaletteActionsProvider>,
      );
    });
    expect(screen.getByTestId("actions").textContent).toBe("beta,settings-open");
  });

  it("usePaletteActions throws outside the provider", () => {
    const spy = console.error;
    console.error = () => {};
    const Bad = () => {
      usePaletteActions();
      return null;
    };
    try {
      expect(() => render(<Bad />)).toThrow(/PaletteActionsProvider/);
    } finally {
      console.error = spy;
    }
  });

  it("getAllActions resolves the merged list imperatively without subscribing the route", () => {
    // The API channel's value must be referentially stable across
    // registrations — a route that registers AND resolves through it must
    // not be re-rendered by its own registration (render-loop guard).
    const apiIdentities: unknown[] = [];
    let resolveIds = () => "";
    function ImperativeProbe() {
      const api = usePaletteActionsApi();
      apiIdentities.push(api);
      resolveIds = () => api.getAllActions().map((a) => a.id).join(",");
      return null;
    }
    render(
      <PaletteActionsProvider globalActions={GLOBAL_ACTIONS}>
        <Registrant ids={["kill-window"]} />
        <ImperativeProbe />
      </PaletteActionsProvider>,
    );
    expect(resolveIds()).toBe("kill-window,settings-open");
    expect(new Set(apiIdentities).size).toBe(1);
  });

  it("usePaletteGlobals exposes the global groups only, unaffected by registration", () => {
    function GlobalsView() {
      const globals = usePaletteGlobals();
      return <span data-testid="globals">{globals.map((a) => a.id).join(",")}</span>;
    }
    render(
      <PaletteActionsProvider globalActions={GLOBAL_ACTIONS}>
        <Registrant ids={["kill-window"]} />
        <GlobalsView />
      </PaletteActionsProvider>,
    );
    expect(screen.getByTestId("globals").textContent).toBe("settings-open");
  });
});

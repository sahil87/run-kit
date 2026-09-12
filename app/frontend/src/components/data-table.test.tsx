import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, act } from "@testing-library/react";
import {
  DataTable,
  DATA_TABLE_STORAGE_PREFIX,
  readDataTableViewState,
  writeDataTableViewState,
  resetDataTableViewState,
  useMountedDataTables,
  type DataTableColumn,
} from "./data-table";

type Row = { id: string; name: string; score?: number };

const COLUMNS: DataTableColumn<Row>[] = [
  { id: "name", header: "name", sortValue: (r) => r.name, size: 100, cell: (r) => r.name },
  {
    id: "score",
    header: "score",
    sortValue: (r) => r.score,
    size: 100,
    cell: (r) => r.score ?? "—",
  },
];

const ROWS: Row[] = [
  { id: "1", name: "bravo", score: 20 },
  { id: "2", name: "alpha", score: 10 },
  { id: "3", name: "charlie" },
];

let tableCounter = 0;

function renderTable(
  opts: {
    tableId?: string;
    rows?: Row[];
    columns?: DataTableColumn<Row>[];
    initialSort?: { id: string; desc: boolean } | null;
  } = {},
) {
  // A fresh tableId per render keeps the persisted view state test-local even
  // without a localStorage.clear between cases.
  const tableId = opts.tableId ?? `t${++tableCounter}`;
  return render(
    <DataTable
      tableId={tableId}
      label="Test"
      columns={opts.columns ?? COLUMNS}
      rows={opts.rows ?? ROWS}
      rowKey={(r) => r.id}
      initialSort={opts.initialSort ?? null}
      rowProps={(r) => ({ "data-testid": `row-${r.id}` })}
    />,
  );
}

function rowOrder(): string[] {
  return screen.getAllByTestId(/^row-/).map((el) => el.getAttribute("data-testid") ?? "");
}

function header(label: string): HTMLElement {
  const th = screen.getByText(label).closest("th");
  if (!th) throw new Error(`no th for ${label}`);
  return th;
}

function storedState(tableId: string): unknown {
  const raw = localStorage.getItem(`${DATA_TABLE_STORAGE_PREFIX}${tableId}`);
  return raw === null ? null : JSON.parse(raw);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  localStorage.clear();
});

describe("DataTable sorting", () => {
  it("header click cycles none → ascending → descending → none with aria-sort", () => {
    renderTable();
    expect(header("name")).toHaveAttribute("aria-sort", "none");
    expect(rowOrder()).toEqual(["row-1", "row-2", "row-3"]);

    fireEvent.click(screen.getByLabelText("Sort by name"));
    expect(header("name")).toHaveAttribute("aria-sort", "ascending");
    expect(rowOrder()).toEqual(["row-2", "row-1", "row-3"]);

    fireEvent.click(screen.getByLabelText("Sort by name"));
    expect(header("name")).toHaveAttribute("aria-sort", "descending");
    expect(rowOrder()).toEqual(["row-3", "row-1", "row-2"]);

    fireEvent.click(screen.getByLabelText("Sort by name"));
    expect(header("name")).toHaveAttribute("aria-sort", "none");
    expect(rowOrder()).toEqual(["row-1", "row-2", "row-3"]);
  });

  it("a second header replaces the sort, never stacks", () => {
    renderTable();
    fireEvent.click(screen.getByLabelText("Sort by name"));
    fireEvent.click(screen.getByLabelText("Sort by score"));
    expect(header("name")).toHaveAttribute("aria-sort", "none");
    expect(header("score")).toHaveAttribute("aria-sort", "ascending");
    expect(rowOrder()).toEqual(["row-2", "row-1", "row-3"]);
  });

  it("undefined values sort last in both directions", () => {
    renderTable();
    fireEvent.click(screen.getByLabelText("Sort by score"));
    expect(rowOrder()).toEqual(["row-2", "row-1", "row-3"]);
    fireEvent.click(screen.getByLabelText("Sort by score"));
    expect(rowOrder()).toEqual(["row-1", "row-2", "row-3"]);
    expect(header("score")).toHaveAttribute("aria-sort", "descending");
  });

  it("a cleared sort returns to initialSort, never to raw input order", () => {
    renderTable({ initialSort: { id: "name", desc: false } });
    // At rest the initialSort applies and its header reads ascending.
    expect(header("name")).toHaveAttribute("aria-sort", "ascending");
    expect(rowOrder()).toEqual(["row-2", "row-1", "row-3"]);

    // First click makes the ascending sort explicit (same order), second
    // descends, third clears back to the initial sort.
    fireEvent.click(screen.getByLabelText("Sort by name"));
    expect(rowOrder()).toEqual(["row-2", "row-1", "row-3"]);
    fireEvent.click(screen.getByLabelText("Sort by name"));
    expect(rowOrder()).toEqual(["row-3", "row-1", "row-2"]);
    fireEvent.click(screen.getByLabelText("Sort by name"));
    expect(header("name")).toHaveAttribute("aria-sort", "ascending");
    expect(rowOrder()).toEqual(["row-2", "row-1", "row-3"]);
  });
});

describe("DataTable column resizing", () => {
  it("a drag writes widths once on release and the col var follows", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const tableId = "drag";
    renderTable({ tableId });
    const handle = screen.getAllByTestId("data-table-resize-handle")[0]!;

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseMove(document, { clientX: 140 });
    // No write before release.
    expect(storedState(tableId)).toBeNull();
    fireEvent.mouseUp(document, { clientX: 140 });

    const table = screen.getByTestId("row-1").closest("table")!;
    expect(table.style.getPropertyValue("--rk-col-name")).toBe("140px");
    expect(table.style.getPropertyValue("--rk-col-score")).toBe("100px");
    const writes = setItem.mock.calls.filter(([key]) => key === `${DATA_TABLE_STORAGE_PREFIX}${tableId}`);
    expect(writes).toHaveLength(1);
    expect(storedState(tableId)).toEqual({ sort: null, widths: { name: 140 } });
  });

  it("double-click on the handle resets that column's width", () => {
    const tableId = "dbl";
    renderTable({ tableId });
    const handle = screen.getAllByTestId("data-table-resize-handle")[0]!;

    fireEvent.mouseDown(handle, { clientX: 100 });
    fireEvent.mouseUp(document, { clientX: 180 });
    expect(
      screen.getByTestId("row-1").closest("table")!.style.getPropertyValue("--rk-col-name"),
    ).toBe("180px");

    fireEvent.doubleClick(handle);
    expect(
      screen.getByTestId("row-1").closest("table")!.style.getPropertyValue("--rk-col-name"),
    ).toBe("100px");
    expect(storedState(tableId)).toEqual({ sort: null, widths: {} });
  });

  it("no handles render on a coarse pointer, but header taps still sort", () => {
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockReturnValue({
        matches: true,
        media: "(any-pointer: coarse)",
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      }),
    );
    renderTable();
    expect(screen.queryByTestId("data-table-resize-handle")).toBeNull();
    fireEvent.click(screen.getByLabelText("Sort by name"));
    expect(rowOrder()).toEqual(["row-2", "row-1", "row-3"]);
  });
});

describe("DataTable view-state store", () => {
  it("round-trips sort and widths", () => {
    writeDataTableViewState("rt", { sort: { id: "name", desc: true }, widths: { name: 200 } });
    expect(readDataTableViewState("rt", COLUMNS)).toEqual({
      sort: { id: "name", desc: true },
      widths: { name: 200 },
    });
    resetDataTableViewState("rt");
    expect(readDataTableViewState("rt", COLUMNS)).toEqual({ sort: null, widths: {} });
  });

  it("degrades per field: unknown sort column, non-numeric and out-of-clamp widths, unknown columns", () => {
    localStorage.setItem(
      `${DATA_TABLE_STORAGE_PREFIX}t`,
      '{"sort":{"id":"nope","desc":true},"widths":{"a":"wide","b":10,"zzz":200}}',
    );
    expect(
      readDataTableViewState("t", [
        { id: "a", size: 100 },
        { id: "b", size: 100 },
      ]),
    ).toEqual({ sort: null, widths: { b: 48 } });
  });

  it("non-JSON stored values resolve to defaults", () => {
    localStorage.setItem(`${DATA_TABLE_STORAGE_PREFIX}t`, "not json");
    expect(readDataTableViewState("t", COLUMNS)).toEqual({ sort: null, widths: {} });
  });

  it("a throwing localStorage reads as empty and writes are ignored", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });
    expect(readDataTableViewState("t", COLUMNS)).toEqual({ sort: null, widths: {} });
    expect(() => writeDataTableViewState("t", { sort: null, widths: {} })).not.toThrow();
    expect(() => resetDataTableViewState("t")).not.toThrow();
  });

  it("a mounted table reflects a persisted sort on first render", () => {
    writeDataTableViewState("pre", { sort: { id: "score", desc: false }, widths: {} });
    renderTable({ tableId: "pre" });
    expect(header("score")).toHaveAttribute("aria-sort", "ascending");
    expect(rowOrder()).toEqual(["row-2", "row-1", "row-3"]);
  });
});

describe("DataTable mounted-table registry", () => {
  function MountedProbe() {
    const mounted = useMountedDataTables();
    return <div data-testid="mounted">{mounted.map((m) => `${m.id}:${m.label}`).join(",")}</div>;
  }

  it("registers on mount and unregisters on unmount", () => {
    const { rerender } = render(
      <>
        <DataTable
          tableId="reg-a"
          label="A"
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(r) => r.id}
          initialSort={null}
          rowProps={(r) => ({ "data-testid": `row-${r.id}` })}
        />
        <DataTable
          tableId="reg-b"
          label="B"
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(r) => r.id}
          initialSort={null}
          rowProps={(r) => ({ "data-testid": `row-${r.id}` })}
        />
        <MountedProbe />
      </>,
    );
    expect(screen.getByTestId("mounted")).toHaveTextContent("reg-a:A");
    expect(screen.getByTestId("mounted")).toHaveTextContent("reg-b:B");

    rerender(
      <>
        <DataTable
          tableId="reg-a"
          label="A"
          columns={COLUMNS}
          rows={ROWS}
          rowKey={(r) => r.id}
          initialSort={null}
          rowProps={(r) => ({ "data-testid": `row-${r.id}` })}
        />
        <MountedProbe />
      </>,
    );
    expect(screen.getByTestId("mounted")).toHaveTextContent("reg-a:A");
    expect(screen.getByTestId("mounted")).not.toHaveTextContent("reg-b");
  });

  it("reset restores a persisted sort to the initial order", () => {
    const tableId = "reset-me";
    writeDataTableViewState(tableId, { sort: { id: "score", desc: true }, widths: {} });
    renderTable({ tableId, initialSort: { id: "name", desc: false } });
    expect(rowOrder()).toEqual(["row-1", "row-2", "row-3"]);

    act(() => resetDataTableViewState(tableId));
    expect(header("name")).toHaveAttribute("aria-sort", "ascending");
    expect(rowOrder()).toEqual(["row-2", "row-1", "row-3"]);
  });
});

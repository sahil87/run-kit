import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { HostFormDialog, INVALID_HOST_URL_MESSAGE } from "./host-form-dialog";

// addShellHostDirect reads window.runkitShell at call time — install a bridge
// whose servers group carries the additive addDirect invoker (the new-shell
// shape); the spy drives the resolved result per test.
function bridgeWithAddDirect(addDirect: (name: string, url: string) => Promise<unknown>) {
  const spy = vi.fn(addDirect);
  window.runkitShell = {
    version: "1.2.3",
    platform: "darwin",
    servers: {
      list: () => Promise.resolve({ ok: true, servers: [] }),
      switch: () => Promise.resolve({ ok: true }),
      addDirect: spy,
    },
  };
  return spy;
}

afterEach(() => {
  cleanup();
  delete window.runkitShell;
});

describe("HostFormDialog — edit mode", () => {
  const editProps = {
    mode: "edit" as const,
    title: "Edit host",
    initialName: "lab",
    initialUrl: "http://b:3000",
    urlEnabled: true,
    submitLabel: "Save",
    onSubmit: vi.fn(() => null),
    onCancel: vi.fn(),
  };

  it("renders the prefilled name and URL", () => {
    render(<HostFormDialog {...editProps} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("lab");
    expect(screen.getByRole("textbox", { name: "URL" })).toHaveValue("http://b:3000");
  });

  it("disables the URL field with the newer-app note when the shell lacks setUrl", () => {
    render(<HostFormDialog {...editProps} urlEnabled={false} />);
    expect(screen.getByRole("textbox", { name: "URL" })).toBeDisabled();
    expect(screen.getByText("URL editing needs a newer desktop app.")).toBeInTheDocument();
  });

  it("submit hands the current field values to the caller-owned save", () => {
    const onSubmit = vi.fn(() => null);
    render(<HostFormDialog {...editProps} onSubmit={onSubmit} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "renamed" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(onSubmit).toHaveBeenCalledWith({ name: "renamed", url: "http://b:3000" });
  });

  it("renders the caller-returned error inline and stays open", () => {
    const onSubmit = vi.fn(() => INVALID_HOST_URL_MESSAGE);
    const onCancel = vi.fn();
    render(<HostFormDialog {...editProps} onSubmit={onSubmit} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText(INVALID_HOST_URL_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("Enter in either field submits", () => {
    const onSubmit = vi.fn(() => null);
    render(<HostFormDialog {...editProps} onSubmit={onSubmit} />);
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Name" }), { key: "Enter" });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "URL" }), { key: "Enter" });
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("Cancel calls onCancel", () => {
    const onCancel = vi.fn();
    render(<HostFormDialog {...editProps} onCancel={onCancel} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
  });
});

describe("HostFormDialog — add mode", () => {
  const addProps = {
    mode: "add" as const,
    title: "Add host",
    submitLabel: "Add Host",
    onSuccess: vi.fn(),
    onCancel: vi.fn(),
  };

  it("renders an empty form on the same field contract", () => {
    bridgeWithAddDirect(() => Promise.resolve({ ok: true }));
    render(<HostFormDialog {...addProps} />);
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "URL" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: "URL" })).toBeEnabled();
    expect(screen.queryByText(/newer desktop app/)).not.toBeInTheDocument();
  });

  it("blocks a malformed URL locally — inline error, no invoke, dialog stays open", async () => {
    const addDirect = bridgeWithAddDirect(() => Promise.resolve({ ok: true }));
    const onSuccess = vi.fn();
    render(<HostFormDialog {...addProps} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "not-a-url" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Host" }));
    expect(screen.getByText(INVALID_HOST_URL_MESSAGE)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(addDirect).not.toHaveBeenCalled();
    expect(onSuccess).not.toHaveBeenCalled();
  });

  it("submits the trimmed name and the reduced origin; success closes via onSuccess", async () => {
    const addDirect = bridgeWithAddDirect(() => Promise.resolve({ ok: true }));
    const onSuccess = vi.fn();
    render(<HostFormDialog {...addProps} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "  buildbox  " },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "http://100.101.2.3:3000/some/path" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Host" }));
    await waitFor(() => expect(onSuccess).toHaveBeenCalledTimes(1));
    expect(addDirect).toHaveBeenCalledWith("buildbox", "http://100.101.2.3:3000");
  });

  it("a blank name passes through empty (the main side derives it from the ping hostname)", async () => {
    const addDirect = bridgeWithAddDirect(() => Promise.resolve({ ok: true }));
    render(<HostFormDialog {...addProps} />);
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "http://b:3000" },
    });
    fireEvent.keyDown(screen.getByRole("textbox", { name: "URL" }), { key: "Enter" });
    await waitFor(() => expect(addDirect).toHaveBeenCalledWith("", "http://b:3000"));
  });

  it("renders the main-side ping error inline and keeps the dialog open for correction", async () => {
    bridgeWithAddDirect(() =>
      Promise.resolve({ ok: false, error: "No response from http://b:3000 within 5s" }),
    );
    const onSuccess = vi.fn();
    render(<HostFormDialog {...addProps} onSuccess={onSuccess} />);
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "http://b:3000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Host" }));
    await waitFor(() => {
      expect(
        screen.getByText("No response from http://b:3000 within 5s"),
      ).toBeInTheDocument();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(onSuccess).not.toHaveBeenCalled();
    // The form is re-enabled for correction once the invoke settles.
    expect(screen.getByRole("textbox", { name: "URL" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Add Host" })).toBeEnabled();
  });

  it("is busy while the invoke is in flight — fields and submit disabled", async () => {
    let resolveInvoke: (value: unknown) => void = () => {};
    bridgeWithAddDirect(
      () =>
        new Promise((resolve) => {
          resolveInvoke = resolve;
        }),
    );
    render(<HostFormDialog {...addProps} />);
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "http://b:3000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Host" }));
    await waitFor(() => {
      expect(screen.getByRole("textbox", { name: "Name" })).toBeDisabled();
      expect(screen.getByRole("textbox", { name: "URL" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Add Host" })).toBeDisabled();
    });
    resolveInvoke({ ok: true });
  });

  it("resolves a rejected invoke as a generic inline error (never throws)", async () => {
    bridgeWithAddDirect(() => Promise.reject(new Error("ipc gone")));
    render(<HostFormDialog {...addProps} />);
    fireEvent.change(screen.getByRole("textbox", { name: "URL" }), {
      target: { value: "http://b:3000" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add Host" }));
    await waitFor(() => {
      expect(screen.getByText("The desktop app did not answer")).toBeInTheDocument();
    });
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});

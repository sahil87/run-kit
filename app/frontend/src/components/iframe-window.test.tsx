import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, cleanup, fireEvent, screen } from "@testing-library/react";
import { IframeWindow } from "./iframe-window";

// Mock the API client
vi.mock("@/api/client", () => ({
  updateWindowUrl: vi.fn().mockResolvedValue({ ok: true }),
}));

import { updateWindowUrl } from "@/api/client";

afterEach(cleanup);

describe("IframeWindow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders iframe with proxied URL", () => {
    render(
      <IframeWindow
        sessionName="dev"
        windowIndex={0}
        rkUrl="http://localhost:8080/docs"
      />,
    );

    const iframe = screen.getByTitle("Proxied content") as HTMLIFrameElement;
    expect(iframe).toBeTruthy();
    expect(iframe.src).toContain("/proxy/8080/docs");
  });

  it("displays current URL in the URL bar", () => {
    render(
      <IframeWindow
        sessionName="dev"
        windowIndex={0}
        rkUrl="http://localhost:8080/docs"
      />,
    );

    const input = screen.getByLabelText("URL") as HTMLInputElement;
    expect(input.value).toBe("http://localhost:8080/docs");
  });

  it("calls updateWindowUrl on Enter", () => {
    render(
      <IframeWindow
        sessionName="dev"
        windowIndex={2}
        rkUrl="http://localhost:8080/docs"
      />,
    );

    const input = screen.getByLabelText("URL") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "http://localhost:8080/api" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(updateWindowUrl).toHaveBeenCalledWith("dev", 2, "http://localhost:8080/api");
  });

  it("renders refresh button", () => {
    render(
      <IframeWindow
        sessionName="dev"
        windowIndex={0}
        rkUrl="http://localhost:8080/docs"
      />,
    );

    const refreshBtn = screen.getByLabelText("Refresh");
    expect(refreshBtn).toBeTruthy();
  });

  it("passes through non-localhost URLs unchanged", () => {
    render(
      <IframeWindow
        sessionName="dev"
        windowIndex={0}
        rkUrl="https://example.com/docs"
      />,
    );

    const iframe = screen.getByTitle("Proxied content") as HTMLIFrameElement;
    expect(iframe.src).toContain("https://example.com/docs");
  });
});

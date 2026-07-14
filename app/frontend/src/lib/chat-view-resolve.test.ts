import { describe, it, expect } from "vitest";
import { validateTerminalSearch, resolveChatView } from "./chat-view-resolve";

describe("validateTerminalSearch", () => {
  it("keeps view=chat", () => {
    expect(validateTerminalSearch({ view: "chat" })).toEqual({ view: "chat" });
  });

  it("drops any other view value", () => {
    expect(validateTerminalSearch({ view: "garbage" })).toEqual({});
    expect(validateTerminalSearch({ view: "terminal" })).toEqual({});
    expect(validateTerminalSearch({})).toEqual({});
    expect(validateTerminalSearch({ view: 1 as unknown as string })).toEqual({});
  });
});

describe("resolveChatView", () => {
  it("URL param wins over pref", () => {
    expect(resolveChatView("chat", false)).toBe("chat");
    expect(resolveChatView("chat", true)).toBe("chat");
  });

  it("falls back to the stored pref when the URL carries no view", () => {
    expect(resolveChatView(undefined, true)).toBe("chat");
    expect(resolveChatView(undefined, false)).toBe("terminal");
  });
});

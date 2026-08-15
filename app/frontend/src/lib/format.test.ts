import { describe, it, expect } from "vitest";
import { abbreviateHomePath } from "./format";

describe("abbreviateHomePath", () => {
  const cases: Array<[input: string, expected: string]> = [
    ["/home/sahil/code/sahil87/run-kit", "~/code/sahil87/run-kit"],
    ["/Users/sahil/code/run-kit", "~/code/run-kit"],
    ["/home/u", "~"],
    ["/srv/data", "/srv/data"],
    ["/home", "/home"],
    ["/homeless/dir", "/homeless/dir"],
    ["relative/path", "relative/path"],
    ["", ""],
  ];
  for (const [input, expected] of cases) {
    it(`${JSON.stringify(input)} → ${JSON.stringify(expected)}`, () => {
      expect(abbreviateHomePath(input)).toBe(expected);
    });
  }
});

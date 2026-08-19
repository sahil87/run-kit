import { describe, it, expect } from "vitest";
import {
  classifyAddress,
  displayForm,
  isAllowedUrl,
  normalizeAddressInput,
  proxyPortOf,
  toProxySrc,
} from "./web-url";

describe("classifyAddress (260819-v6y4 R3)", () => {
  it("classifies the intake's examples", () => {
    expect(classifyAddress("/present/@320/tmux-version-floor.html?server=runKit&v=1")).toBe("present");
    expect(classifyAddress("/proxy/3000/board/runKit")).toBe("proxy");
    expect(classifyAddress("http://localhost:8080/docs")).toBe("proxy");
    expect(classifyAddress("http://127.0.0.1:5173")).toBe("proxy");
    expect(classifyAddress("http://[::1]:5173/x")).toBe("proxy");
    expect(classifyAddress("https://shll.ai/rk/skill")).toBe("external");
    expect(classifyAddress("/board/runKit")).toBe("relative");
  });

  it("degrades unrecognized input to relative without throwing", () => {
    expect(classifyAddress("javascript:alert(1)")).toBe("relative");
    expect(classifyAddress("not a url")).toBe("relative");
    expect(classifyAddress("")).toBe("relative");
  });

  it("treats portless loopback absolute URLs as external (no port to proxy)", () => {
    expect(classifyAddress("http://localhost/")).toBe("external");
  });
});

describe("displayForm (260819-v6y4 R3)", () => {
  it("present: the file basename with plumbing params hidden", () => {
    expect(displayForm("/present/@320/tmux-version-floor.html?server=runKit&v=1755600000")).toBe(
      "tmux-version-floor.html",
    );
    expect(displayForm("/present/@320/dir/index.html?server=a")).toBe("index.html");
  });

  it("present: a page's own query params survive plumbing removal", () => {
    expect(displayForm("/present/@320/report.html?server=runKit&v=1&tab=perf")).toBe(
      "report.html?tab=perf",
    );
    expect(displayForm("/present/@320/doc.html?server=a&v=1#section")).toBe("doc.html#section");
  });

  it("proxy: localhost:{port}{path} — the /proxy/ plumbing never shows", () => {
    expect(displayForm("/proxy/3000/board/runKit")).toBe("localhost:3000/board/runKit");
    expect(displayForm("/proxy/3000/")).toBe("localhost:3000/");
    expect(displayForm("/proxy/3000")).toBe("localhost:3000/");
    expect(displayForm("http://localhost:8080/docs?x=1")).toBe("localhost:8080/docs?x=1");
    expect(displayForm("http://127.0.0.1:8080/docs")).toBe("localhost:8080/docs");
  });

  it("external: host + path, scheme omitted", () => {
    expect(displayForm("https://shll.ai/rk/skill")).toBe("shll.ai/rk/skill");
    expect(displayForm("https://github.com/sahil87/run-kit")).toBe("github.com/sahil87/run-kit");
  });

  it("relative: the raw path", () => {
    expect(displayForm("/board/runKit")).toBe("/board/runKit");
  });

  it("never throws on unparseable input — degrades to the raw string", () => {
    expect(displayForm("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(displayForm("not a url")).toBe("not a url");
    expect(displayForm("")).toBe("");
    expect(displayForm("/present/")).toBe("/present/");
  });
});

describe("proxyPortOf", () => {
  it("reads the port from either proxy form", () => {
    expect(proxyPortOf("/proxy/8080/")).toBe(8080);
    expect(proxyPortOf("http://localhost:8080/x")).toBe(8080);
  });

  it("returns null for non-proxy addresses", () => {
    expect(proxyPortOf("/present/@320/f.html")).toBeNull();
    expect(proxyPortOf("https://shll.ai/")).toBeNull();
    expect(proxyPortOf("http://localhost/")).toBeNull();
  });
});

describe("normalizeAddressInput (260819-v6y4 R4)", () => {
  it("maps bare loopback host:port to the proxy path", () => {
    expect(normalizeAddressInput("localhost:5173")).toBe("/proxy/5173/");
    expect(normalizeAddressInput("127.0.0.1:3000")).toBe("/proxy/3000/");
    expect(normalizeAddressInput("localhost:3000/board/runKit")).toBe("/proxy/3000/board/runKit");
    expect(normalizeAddressInput("localhost:3000/board?x=1")).toBe("/proxy/3000/board?x=1");
  });

  it("prefixes a bare domain with https://", () => {
    expect(normalizeAddressInput("example.com")).toBe("https://example.com");
    expect(normalizeAddressInput("shll.ai/rk/skill")).toBe("https://shll.ai/rk/skill");
    expect(normalizeAddressInput("example.com:8080/x")).toBe("https://example.com:8080/x");
  });

  it("passes already-valid values through unchanged", () => {
    expect(normalizeAddressInput("https://example.com/x")).toBe("https://example.com/x");
    expect(normalizeAddressInput("http://localhost:3000/x")).toBe("http://localhost:3000/x");
    expect(normalizeAddressInput("/proxy/3000/")).toBe("/proxy/3000/");
    expect(normalizeAddressInput("/present/@320/f.html?server=a&v=1")).toBe(
      "/present/@320/f.html?server=a&v=1",
    );
  });

  it("passes invalid values through for isAllowedUrl to reject", () => {
    expect(normalizeAddressInput("javascript:alert(1)")).toBe("javascript:alert(1)");
    expect(normalizeAddressInput("localhost")).toBe("localhost");
    expect(normalizeAddressInput("  https://example.com  ")).toBe("https://example.com");
  });
});

describe("isAllowedUrl (frontend mirror of R1)", () => {
  it("accepts absolute http(s) with a host and root-relative paths", () => {
    expect(isAllowedUrl("https://example.com")).toBe(true);
    expect(isAllowedUrl("http://localhost:3000/x")).toBe(true);
    expect(isAllowedUrl("/proxy/3000/")).toBe(true);
    expect(isAllowedUrl("/")).toBe(true);
  });

  it("rejects every other form", () => {
    expect(isAllowedUrl("")).toBe(false);
    expect(isAllowedUrl("   ")).toBe(false);
    expect(isAllowedUrl("javascript:alert(1)")).toBe(false);
    expect(isAllowedUrl("data:text/html,<p>x</p>")).toBe(false);
    expect(isAllowedUrl("file:///etc/passwd")).toBe(false);
    expect(isAllowedUrl("//evil.com/x")).toBe(false);
    expect(isAllowedUrl("ftp://example.com")).toBe(false);
    expect(isAllowedUrl("example.com")).toBe(false);
    expect(isAllowedUrl("https://")).toBe(false);
  });
});

describe("toProxySrc", () => {
  it("maps absolute loopback URLs onto /proxy/{port}", () => {
    expect(toProxySrc("http://localhost:8080/docs")).toBe("/proxy/8080/docs");
    expect(toProxySrc("http://127.0.0.1:8080/docs?a=1")).toBe("/proxy/8080/docs?a=1");
    expect(toProxySrc("http://localhost:8080")).toBe("/proxy/8080/");
  });

  it("passes everything else through unchanged", () => {
    expect(toProxySrc("/proxy/8080/docs")).toBe("/proxy/8080/docs");
    expect(toProxySrc("https://shll.ai/")).toBe("https://shll.ai/");
    expect(toProxySrc("http://localhost/")).toBe("http://localhost/");
  });
});

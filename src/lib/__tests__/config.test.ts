import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";

/**
 * config.ts executes at module load time with readFileSync + process.argv.
 * YAML reading is tested naturally: no run-kit.yaml exists in the test env,
 * so readFileSync throws ENOENT and defaults apply. Mocking node:fs with
 * vi.resetModules is not viable in Vitest 4 due to CJS/ESM interop issues
 * with built-in Node modules. CLI args and port validation are tested via
 * process.argv manipulation + fresh module re-import.
 */

const savedArgv = process.argv;

async function loadConfig() {
  vi.resetModules();
  const mod = await import("@/lib/config");
  return mod.config;
}

afterAll(() => {
  process.argv = savedArgv;
});

describe("config defaults (no run-kit.yaml)", () => {
  beforeEach(() => {
    process.argv = ["node", "script.js"];
  });

  it("uses default port 3000", async () => {
    const config = await loadConfig();
    expect(config.port).toBe(3000);
  });

  it("uses default relay port 3001", async () => {
    const config = await loadConfig();
    expect(config.relayPort).toBe(3001);
  });

  it("uses default host 127.0.0.1", async () => {
    const config = await loadConfig();
    expect(config.host).toBe("127.0.0.1");
  });

  it("uses default tlsCert certs/localhost.pem", async () => {
    const config = await loadConfig();
    expect(config.tlsCert).toBe("certs/localhost.pem");
  });

  it("uses default tlsKey certs/localhost-key.pem", async () => {
    const config = await loadConfig();
    expect(config.tlsKey).toBe("certs/localhost-key.pem");
  });
});

describe("config CLI arg parsing", () => {
  it("--port overrides default", async () => {
    process.argv = ["node", "script.js", "--port", "5000"];
    const config = await loadConfig();
    expect(config.port).toBe(5000);
  });

  it("--relay-port overrides default", async () => {
    process.argv = ["node", "script.js", "--relay-port", "6000"];
    const config = await loadConfig();
    expect(config.relayPort).toBe(6000);
  });

  it("--host overrides default", async () => {
    process.argv = ["node", "script.js", "--host", "0.0.0.0"];
    const config = await loadConfig();
    expect(config.host).toBe("0.0.0.0");
  });

  it("accepts multiple CLI args together", async () => {
    process.argv = ["node", "script.js", "--port", "4000", "--relay-port", "5000", "--host", "192.168.1.1"];
    const config = await loadConfig();
    expect(config.port).toBe(4000);
    expect(config.relayPort).toBe(5000);
    expect(config.host).toBe("192.168.1.1");
  });

  it("accepts port at lower boundary (1)", async () => {
    process.argv = ["node", "script.js", "--port", "1"];
    const config = await loadConfig();
    expect(config.port).toBe(1);
  });

  it("accepts port at upper boundary (65535)", async () => {
    process.argv = ["node", "script.js", "--port", "65535"];
    const config = await loadConfig();
    expect(config.port).toBe(65535);
  });

  it("rejects non-numeric --port (falls back to default)", async () => {
    process.argv = ["node", "script.js", "--port", "notanumber"];
    const config = await loadConfig();
    expect(config.port).toBe(3000);
  });

  it("rejects out-of-range --port (falls back to default)", async () => {
    process.argv = ["node", "script.js", "--port", "99999"];
    const config = await loadConfig();
    expect(config.port).toBe(3000);
  });

  it("rejects zero --port", async () => {
    process.argv = ["node", "script.js", "--port", "0"];
    const config = await loadConfig();
    expect(config.port).toBe(3000);
  });

  it("rejects negative --port", async () => {
    process.argv = ["node", "script.js", "--port", "-1"];
    const config = await loadConfig();
    expect(config.port).toBe(3000);
  });

  it("truncates float --port to integer", async () => {
    process.argv = ["node", "script.js", "--port", "5000.5"];
    const config = await loadConfig();
    expect(config.port).toBe(5000);
  });

  it("ignores --port without a following value", async () => {
    process.argv = ["node", "script.js", "--port"];
    const config = await loadConfig();
    expect(config.port).toBe(3000);
  });

  it("--tls-cert overrides default", async () => {
    process.argv = ["node", "script.js", "--tls-cert", "custom/cert.pem"];
    const config = await loadConfig();
    expect(config.tlsCert).toBe("custom/cert.pem");
  });

  it("--tls-key overrides default", async () => {
    process.argv = ["node", "script.js", "--tls-key", "custom/key.pem"];
    const config = await loadConfig();
    expect(config.tlsKey).toBe("custom/key.pem");
  });

  it("--tls-cert and --tls-key together", async () => {
    process.argv = ["node", "script.js", "--tls-cert", "/etc/ssl/cert.pem", "--tls-key", "/etc/ssl/key.pem"];
    const config = await loadConfig();
    expect(config.tlsCert).toBe("/etc/ssl/cert.pem");
    expect(config.tlsKey).toBe("/etc/ssl/key.pem");
  });
});

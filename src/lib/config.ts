import { readFileSync } from "node:fs";
import { parse } from "yaml";

const DEFAULTS = {
  port: 3000,
  relayPort: 3001,
  host: "127.0.0.1",
  tlsCert: "certs/localhost.pem",
  tlsKey: "certs/localhost-key.pem",
} as const;

type ServerConfig = {
  port: number;
  relayPort: number;
  host: string;
  tlsCert: string;
  tlsKey: string;
};

function validPort(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 65535) return undefined;
  return v;
}

function readYamlConfig(): Partial<ServerConfig> {
  try {
    const raw = readFileSync("run-kit.yaml", "utf8");
    const doc = parse(raw) as { server?: { port?: unknown; relay_port?: unknown; host?: unknown; tls?: { cert?: unknown; key?: unknown } } };
    const s = doc?.server;
    if (!s) return {};
    const port = validPort(s.port);
    const relayPort = validPort(s.relay_port);
    return {
      ...(port != null && { port }),
      ...(relayPort != null && { relayPort }),
      ...(typeof s.host === "string" && s.host.length > 0 && { host: s.host }),
      ...(typeof s.tls?.cert === "string" && s.tls.cert.length > 0 && { tlsCert: s.tls.cert }),
      ...(typeof s.tls?.key === "string" && s.tls.key.length > 0 && { tlsKey: s.tls.key }),
    };
  } catch (err: unknown) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code !== "ENOENT") {
      console.warn("[config] Error reading run-kit.yaml:", err instanceof Error ? err.message : String(err));
    }
    return {};
  }
}

function readCliArgs(): Partial<ServerConfig> {
  const args = process.argv.slice(2);
  const result: Partial<ServerConfig> = {};
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1];
    if (args[i] === "--port" && next) {
      const p = validPort(parseInt(next, 10));
      if (p) result.port = p;
      i++;
    } else if (args[i] === "--relay-port" && next) {
      const p = validPort(parseInt(next, 10));
      if (p) result.relayPort = p;
      i++;
    } else if (args[i] === "--host" && next) {
      result.host = next;
      i++;
    } else if (args[i] === "--tls-cert" && next) {
      result.tlsCert = next;
      i++;
    } else if (args[i] === "--tls-key" && next) {
      result.tlsKey = next;
      i++;
    }
  }
  return result;
}

// Resolution order: CLI args > run-kit.yaml > defaults
const yaml = readYamlConfig();
const cli = readCliArgs();

export const config: ServerConfig = {
  port: cli.port ?? yaml.port ?? DEFAULTS.port,
  relayPort: cli.relayPort ?? yaml.relayPort ?? DEFAULTS.relayPort,
  host: cli.host ?? yaml.host ?? DEFAULTS.host,
  tlsCert: cli.tlsCert ?? yaml.tlsCert ?? DEFAULTS.tlsCert,
  tlsKey: cli.tlsKey ?? yaml.tlsKey ?? DEFAULTS.tlsKey,
};

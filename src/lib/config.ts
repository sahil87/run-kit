import { readFileSync } from "node:fs";
import { parse } from "yaml";

const DEFAULTS = {
  port: 3000,
  relayPort: 3001,
  host: "127.0.0.1",
} as const;

type ServerConfig = {
  port: number;
  relayPort: number;
  host: string;
};

function validPort(v: unknown): number | undefined {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > 65535) return undefined;
  return v;
}

function readYamlConfig(): Partial<ServerConfig> {
  try {
    const raw = readFileSync("run-kit.yaml", "utf8");
    const doc = parse(raw) as { server?: { port?: unknown; relay_port?: unknown; host?: unknown } };
    const s = doc?.server;
    if (!s) return {};
    const port = validPort(s.port);
    const relayPort = validPort(s.relay_port);
    return {
      ...(port != null && { port }),
      ...(relayPort != null && { relayPort }),
      ...(typeof s.host === "string" && s.host.length > 0 && { host: s.host }),
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
};

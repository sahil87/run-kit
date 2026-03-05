import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { existsSync, readFileSync } from "node:fs";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { config } from "../lib/config";
import { validateName } from "../lib/validate";

const PING_INTERVAL = 30_000;

const hasCerts = existsSync(config.tlsCert) && existsSync(config.tlsKey);

const handler = (_req: import("node:http").IncomingMessage, res: import("node:http").ServerResponse) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("run-kit terminal relay");
};

const server = hasCerts
  ? createHttpsServer(
      { cert: readFileSync(config.tlsCert), key: readFileSync(config.tlsKey) },
      handler,
    )
  : createHttpServer(handler);

const wss = new WebSocketServer({ server });

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url ?? "/", `http://localhost:${config.relayPort}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 2) {
    ws.close(4000, "Invalid path: expected /:session/:window");
    return;
  }

  const [session, windowIndex] = parts;

  // Validate inputs before passing to tmux
  const sessionErr = validateName(session, "Session name");
  if (sessionErr) {
    ws.close(4000, sessionErr);
    return;
  }
  if (!/^\d+$/.test(windowIndex)) {
    ws.close(4000, "Window index must be an integer");
    return;
  }

  const target = `${session}:${windowIndex}`;
  let ptyProcess: pty.IPty | null = null;
  let isAlive = true;

  // Attach to the real tmux session/window via pty.
  // This gives the browser the same view as `tmux attach` in a terminal —
  // full scrollback, live output, read-write access. Multiple browser tabs
  // become multiple tmux clients (standard tmux multi-attach behavior).
  try {
    ptyProcess = pty.spawn(
      "tmux",
      ["attach-session", "-t", target],
      {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        env: process.env as Record<string, string>,
      },
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to attach to tmux session";
    ws.close(4001, message);
    return;
  }

  // Relay pty output → WebSocket
  ptyProcess.onData((data) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  });

  // Relay WebSocket input → pty
  ws.on("message", (data) => {
    if (!ptyProcess) return;

    const message = data.toString();

    // Check for resize messages
    try {
      const parsed = JSON.parse(message) as {
        type?: string;
        cols?: number;
        rows?: number;
      };
      if (parsed.type === "resize" && parsed.cols && parsed.rows) {
        ptyProcess.resize(parsed.cols, parsed.rows);
        return;
      }
    } catch {
      // Not JSON — treat as terminal input
    }

    // Send raw input to pty
    ptyProcess.write(message);
  });

  // Handle pty exit
  ptyProcess.onExit(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.close(1000, "Terminal exited");
    }
    ptyProcess = null;
  });

  // Ping/pong for stale connection detection
  ws.on("pong", () => {
    isAlive = true;
  });

  const pingInterval = setInterval(() => {
    if (!isAlive) {
      // No pong received since last ping — terminate
      ws.terminate();
      return;
    }
    isAlive = false;
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, PING_INTERVAL);

  // Cleanup on disconnect
  function cleanup() {
    clearInterval(pingInterval);

    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }
  }

  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

// Default: 127.0.0.1 (localhost only). Set host to 0.0.0.0 to expose to network.
const proto = hasCerts ? "https" : "http";
server.listen(config.relayPort, config.host, () => {
  console.log(`Terminal relay listening on ${proto}://${config.host}:${config.relayPort}`);
});

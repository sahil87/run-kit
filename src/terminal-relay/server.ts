import { createServer } from "node:http";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { RELAY_PORT, TMUX_TIMEOUT } from "../lib/types";

const execFile = promisify(execFileCb);

const PING_INTERVAL = 30_000;

const server = createServer((_req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("run-kit terminal relay");
});

const wss = new WebSocketServer({ server });

wss.on("connection", async (ws, req) => {
  const url = new URL(req.url ?? "/", `http://localhost:${RELAY_PORT}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (parts.length < 2) {
    ws.close(4000, "Invalid path: expected /:session/:window");
    return;
  }

  const [session, windowIndex] = parts;
  const target = `${session}:${windowIndex}`;
  let paneId: string | null = null;
  let ptyProcess: pty.IPty | null = null;

  try {
    // Create an independent pane via split-window
    const { stdout } = await execFile(
      "tmux",
      ["split-window", "-t", target, "-P", "-F", "#{pane_id}", "-d"],
      { timeout: TMUX_TIMEOUT },
    );
    paneId = stdout.trim();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create pane";
    ws.close(4001, message);
    return;
  }

  // Spawn a pty running `tmux attach-session -t <paneId>` for real terminal I/O
  try {
    ptyProcess = pty.spawn("tmux", ["attach-session", "-t", paneId], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to attach to pane";
    // Clean up the split pane
    if (paneId) {
      try {
        await execFile("tmux", ["kill-pane", "-t", paneId], {
          timeout: TMUX_TIMEOUT,
        });
      } catch {
        // Best effort
      }
    }
    ws.close(4002, message);
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
  const pingInterval = setInterval(() => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.ping();
    }
  }, PING_INTERVAL);

  // Cleanup on disconnect
  async function cleanup() {
    clearInterval(pingInterval);

    if (ptyProcess) {
      ptyProcess.kill();
      ptyProcess = null;
    }

    if (paneId) {
      try {
        await execFile("tmux", ["kill-pane", "-t", paneId], {
          timeout: TMUX_TIMEOUT,
        });
      } catch {
        // Pane may already be dead
      }
      paneId = null;
    }
  }

  ws.on("close", cleanup);
  ws.on("error", cleanup);
});

server.listen(RELAY_PORT, () => {
  console.log(`Terminal relay listening on port ${RELAY_PORT}`);
});

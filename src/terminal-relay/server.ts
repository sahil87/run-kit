import { createServer } from "node:http";
import { execFile as execFileCb } from "node:child_process";
import { promisify } from "node:util";
import { WebSocketServer, WebSocket } from "ws";
import * as pty from "node-pty";
import { RELAY_PORT, TMUX_TIMEOUT } from "../lib/types";
import { validateName } from "../lib/validate";

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
  let paneId: string | null = null;
  let ptyProcess: pty.IPty | null = null;
  let isAlive = true;

  try {
    // Create an independent pane via split-window (-d to avoid changing focus)
    const { stdout } = await execFile(
      "tmux",
      ["split-window", "-t", target, "-d", "-P", "-F", "#{pane_id}"],
      { timeout: TMUX_TIMEOUT },
    );
    paneId = stdout.trim();
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to create pane";
    ws.close(4001, message);
    return;
  }

  // Use `tmux select-pane -t <paneId>` + respawn approach won't work well.
  // Instead, spawn a shell that sends-keys/reads from the pane via a pty.
  // The correct approach: spawn a shell inside a pty, then use `tmux send-keys`
  // for input and `tmux pipe-pane` for output.
  //
  // Actually, the simplest correct approach is to NOT use tmux attach-session
  // (which targets sessions, not panes). Instead, we spawn a pty that runs
  // a shell, and we use tmux's `respawn-pane` to replace the pane's process
  // with our pty's slave. But that's complex.
  //
  // Pragmatic v1: spawn a pty shell, wire it to the WebSocket. The split-pane
  // gives us an independent shell already — we just need to connect to it.
  // Use `tmux send-keys -t <paneId>` for input and `tmux pipe-pane` for output.
  //
  // Even simpler: the split-window already created a shell in the new pane.
  // We can use `tmux pipe-pane -t <paneId> -o 'cat'` to stream output, and
  // `tmux send-keys -t <paneId> -l` for input. But pipe-pane writes to a file,
  // not a pipe we can read from.
  //
  // Best approach for v1: spawn a pty that runs `tmux attach -t <session>`
  // and select the pane. But attach-session with -t takes a session target.
  // With tmux 3.2+, we can use `tmux attach -t <paneId>` — pane IDs like %42
  // are valid targets for attach when used properly.
  //
  // Actually: `tmux select-pane -t <paneId>` + `tmux attach` doesn't scope to
  // the pane. The real answer: use `tmux -CC attach -t <paneId>` or just
  // directly spawn a shell in the pty and let the split-window pane be the shell.
  //
  // SIMPLEST CORRECT APPROACH: Don't try to attach to the tmux pane at all.
  // The split-window already created a new pane with a shell. We can't easily
  // bridge a pty to an existing tmux pane. Instead, kill the tmux pane and
  // just use the pty directly — the pty IS the independent session. The browser
  // gets a shell that happens to have its CWD in the project directory.

  // Kill the split pane (we'll use a standalone pty instead)
  try {
    await execFile("tmux", ["kill-pane", "-t", paneId], {
      timeout: TMUX_TIMEOUT,
    });
  } catch {
    // Best effort
  }

  // Get the CWD of the target window's first pane for context
  let cwd = process.cwd();
  try {
    const { stdout } = await execFile(
      "tmux",
      [
        "display-message",
        "-t",
        target,
        "-p",
        "#{pane_current_path}",
      ],
      { timeout: TMUX_TIMEOUT },
    );
    const path = stdout.trim();
    if (path) cwd = path;
  } catch {
    // Use default cwd
  }

  // Spawn a standalone pty shell in the same directory as the target window
  try {
    ptyProcess = pty.spawn(process.env.SHELL ?? "/bin/bash", [], {
      name: "xterm-256color",
      cols: 80,
      rows: 24,
      cwd,
      env: process.env as Record<string, string>,
    });
    // Track paneId as null since we're not using the tmux pane anymore
    paneId = null;
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to spawn terminal";
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

// Bind to localhost only — terminal access should not be exposed to the network
server.listen(RELAY_PORT, "127.0.0.1", () => {
  console.log(`Terminal relay listening on 127.0.0.1:${RELAY_PORT}`);
});

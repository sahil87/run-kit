# Configurable Port/Host Binding — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make Next.js port, relay port, and bind host configurable via CLI args and `run-kit.yaml`, replacing hardcoded constants.

**Architecture:** New `src/lib/config.ts` module reads `run-kit.yaml` (optional), merges CLI args (`--port`, `--relay-port`, `--host`), and exports resolved values. All consumers import from config instead of hardcoded constants. Client-side relay port delivered via `NEXT_PUBLIC_RELAY_PORT` env var.

**Tech Stack:** TypeScript, `yaml` package (already a dependency), Next.js `NEXT_PUBLIC_*` env vars.

---

### Task 1: Create `src/lib/config.ts`

**Files:**
- Create: `src/lib/config.ts`

**Step 1: Write the config module**

```typescript
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

function readYamlConfig(): Partial<ServerConfig> {
  try {
    const raw = readFileSync("run-kit.yaml", "utf8");
    const doc = parse(raw) as { server?: { port?: number; relay_port?: number; host?: string } };
    const s = doc?.server;
    if (!s) return {};
    return {
      ...(s.port != null && { port: s.port }),
      ...(s.relay_port != null && { relayPort: s.relay_port }),
      ...(s.host != null && { host: s.host }),
    };
  } catch {
    return {};
  }
}

function readCliArgs(): Partial<ServerConfig> {
  const args = process.argv.slice(2);
  const result: Partial<ServerConfig> = {};
  for (let i = 0; i < args.length; i++) {
    const next = args[i + 1];
    if (args[i] === "--port" && next) {
      result.port = parseInt(next, 10);
      i++;
    } else if (args[i] === "--relay-port" && next) {
      result.relayPort = parseInt(next, 10);
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
```

**Step 2: Commit**

```bash
git add src/lib/config.ts
git commit -m "feat: add config module for port/host resolution"
```

---

### Task 2: Remove port constants from `src/lib/types.ts`

**Files:**
- Modify: `src/lib/types.ts:30-32`

**Step 1: Remove the `NEXTJS_PORT` and `RELAY_PORT` constants**

Delete these lines from `src/lib/types.ts`:

```typescript
/** Ports. */
export const NEXTJS_PORT = 3000;
export const RELAY_PORT = 3001;
```

Leave everything else (types, timeouts, `SSE_POLL_INTERVAL`) untouched.

**Step 2: Commit**

```bash
git add src/lib/types.ts
git commit -m "refactor: remove hardcoded port constants from types"
```

---

### Task 3: Update terminal relay server to use config

**Files:**
- Modify: `src/terminal-relay/server.ts:6` (import line)
- Modify: `src/terminal-relay/server.ts:21` (URL construction)
- Modify: `src/terminal-relay/server.ts:214-217` (listen call)

**Step 1: Update imports**

Change line 6 from:
```typescript
import { RELAY_PORT, TMUX_TIMEOUT } from "../lib/types";
```
to:
```typescript
import { TMUX_TIMEOUT } from "../lib/types";
import { config } from "../lib/config";
```

**Step 2: Update URL construction**

Change line 21 from:
```typescript
  const url = new URL(req.url ?? "/", `http://localhost:${RELAY_PORT}`);
```
to:
```typescript
  const url = new URL(req.url ?? "/", `http://localhost:${config.relayPort}`);
```

**Step 3: Update listen call**

Change lines 214-217 from:
```typescript
// Bind to localhost only — terminal access should not be exposed to the network
server.listen(RELAY_PORT, "127.0.0.1", () => {
  console.log(`Terminal relay listening on 127.0.0.1:${RELAY_PORT}`);
});
```
to:
```typescript
// Default: 127.0.0.1 (localhost only). Set host to 0.0.0.0 to expose to network.
server.listen(config.relayPort, config.host, () => {
  console.log(`Terminal relay listening on ${config.host}:${config.relayPort}`);
});
```

**Step 4: Commit**

```bash
git add src/terminal-relay/server.ts
git commit -m "feat: relay server reads port/host from config"
```

---

### Task 4: Update terminal client to use env var for relay port

**Files:**
- Modify: `src/app/p/[project]/[window]/terminal-client.tsx:6` (import)
- Modify: `src/app/p/[project]/[window]/terminal-client.tsx:92` (WebSocket URL)

**Step 1: Remove the RELAY_PORT import**

Delete line 6:
```typescript
import { RELAY_PORT } from "@/lib/types";
```

**Step 2: Read relay port from env var with fallback**

Add this constant near the top of the file (after the existing `DOUBLE_ESC_TIMEOUT_MS` constant, around line 13):

```typescript
const RELAY_PORT = process.env.NEXT_PUBLIC_RELAY_PORT ?? "3001";
```

Line 92 already uses `RELAY_PORT` so it requires no change — it now reads from the env var constant instead of the import.

**Step 3: Commit**

```bash
git add src/app/p/[project]/[window]/terminal-client.tsx
git commit -m "feat: terminal client reads relay port from NEXT_PUBLIC_RELAY_PORT"
```

---

### Task 5: Update `package.json` dev script to pass relay port

**Files:**
- Modify: `package.json:7` (dev script)

**Step 1: Update the dev script**

Change line 7 from:
```json
"dev": "concurrently -n next,relay -c blue,green \"next dev\" \"tsx src/terminal-relay/server.ts\"",
```
to:
```json
"dev": "concurrently -n next,relay -c blue,green \"NEXT_PUBLIC_RELAY_PORT=3001 next dev\" \"tsx src/terminal-relay/server.ts\"",
```

Note: The relay server reads its own port from config (yaml/CLI), so it doesn't need the env var. Only the Next.js process needs `NEXT_PUBLIC_RELAY_PORT` because it's baked into the client bundle at build time.

For the production `start` script, the supervisor handles setting the env var (Task 6).

**Step 2: Commit**

```bash
git add package.json
git commit -m "feat: dev script passes NEXT_PUBLIC_RELAY_PORT to Next.js"
```

---

### Task 6: Update `supervisor.sh` to read config

**Files:**
- Modify: `supervisor.sh:8` (HEALTH_URL)
- Modify: `supervisor.sh:19-27` (start_services)

**Step 1: Add config reading at the top**

After line 7 (the comment block), before `HEALTH_URL`, add yaml config parsing:

```bash
# Read port/host config from run-kit.yaml (optional)
RK_PORT=3000
RK_RELAY_PORT=3001
RK_HOST="127.0.0.1"
if [[ -f run-kit.yaml ]]; then
  # Parse simple yaml values — avoids dependency on yq
  _val() { grep "^  $1:" run-kit.yaml 2>/dev/null | head -1 | sed 's/^[^:]*: *//' | tr -d '"'"'" ; }
  _p=$(_val port);        [[ -n "$_p" ]] && RK_PORT="$_p"
  _r=$(_val relay_port);  [[ -n "$_r" ]] && RK_RELAY_PORT="$_r"
  _h=$(_val host);        [[ -n "$_h" ]] && RK_HOST="$_h"
  unset _val _p _r _h
fi
```

**Step 2: Update HEALTH_URL**

Change line 8 from:
```bash
HEALTH_URL="http://localhost:3000/api/health"
```
to:
```bash
HEALTH_URL="http://${RK_HOST}:${RK_PORT}/api/health"
```

**Step 3: Update start_services**

Change `start_services()` to pass config to both processes:

```bash
start_services() {
  echo "[supervisor] Starting Next.js on ${RK_HOST}:${RK_PORT}..."
  NEXT_PUBLIC_RELAY_PORT="$RK_RELAY_PORT" pnpm start --port "$RK_PORT" --hostname "$RK_HOST" &
  nextjs_pid=$!

  echo "[supervisor] Starting terminal relay on ${RK_HOST}:${RK_RELAY_PORT}..."
  pnpm relay --port "$RK_RELAY_PORT" --host "$RK_HOST" &
  relay_pid=$!
}
```

Also update the restart fallback lines (119-123, 124-128) that directly call `pnpm start` and `pnpm relay`:

Line ~121: `pnpm start &` → `NEXT_PUBLIC_RELAY_PORT="$RK_RELAY_PORT" pnpm start --port "$RK_PORT" --hostname "$RK_HOST" &`

Line ~127: `pnpm relay &` → `pnpm relay --port "$RK_RELAY_PORT" --host "$RK_HOST" &`

**Step 4: Commit**

```bash
git add supervisor.sh
git commit -m "feat: supervisor reads port/host from run-kit.yaml"
```

---

### Task 7: Verify build and manual smoke test

**Step 1: Run build**

```bash
pnpm build
```

Expected: Build succeeds with no type errors.

**Step 2: Verify dev mode starts**

```bash
pnpm dev
```

Expected: Next.js starts on :3000, relay starts on :3001. Both print their addresses.

**Step 3: Test with custom config**

Create a temporary `run-kit.yaml`:
```yaml
server:
  port: 4000
  relay_port: 4001
```

Run `pnpm dev` and verify both services bind to the custom ports.

Delete the test `run-kit.yaml` after verification.

**Step 4: Commit all remaining changes (if any)**

```bash
git status
# If clean, nothing to do. If there are uncommitted changes, stage and commit.
```

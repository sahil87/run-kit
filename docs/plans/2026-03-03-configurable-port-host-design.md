# Configurable Port/Host Binding

## Problem

Next.js (port 3000) and the terminal relay WebSocket (port 3001) both have hardcoded ports and bind addresses. Users need to configure these when defaults conflict with other services or when binding to a non-loopback address.

## Resolution Order

CLI args > `run-kit.yaml` > hardcoded defaults

## Config Values

| Key | CLI flag | YAML key | Default |
|-----|----------|----------|---------|
| Next.js port | `--port` | `server.port` | `3000` |
| Relay port | `--relay-port` | `server.relay_port` | `3001` |
| Bind host | `--host` | `server.host` | `127.0.0.1` |

## `run-kit.yaml`

```yaml
server:
  port: 3000
  relay_port: 3001
  host: 127.0.0.1
```

File lives at repo root. Optional — defaults apply when absent.

## Implementation

1. **`src/lib/config.ts`** — new module. Reads `run-kit.yaml` (if exists), merges with CLI args from `process.argv`, exports resolved `port`, `relayPort`, `host`. Used by both Next.js server-side code and the relay server.

2. **`src/lib/types.ts`** — remove `NEXTJS_PORT` and `RELAY_PORT` constants.

3. **`src/terminal-relay/server.ts`** — import from `config.ts` for port/host.

4. **`src/app/p/[project]/[window]/terminal-client.tsx`** — read `NEXT_PUBLIC_RELAY_PORT` env var instead of importing the constant.

5. **`package.json` dev script** — pass `NEXT_PUBLIC_RELAY_PORT` from config.

6. **`supervisor.sh`** — read config to construct health URL and pass correct ports.

## Security Note

Default host `127.0.0.1` restricts terminal relay to localhost. Setting `host: 0.0.0.0` intentionally exposes terminal access to the network — the user's choice.

## Client-Side Relay Port

The terminal client needs the relay port at runtime. Uses `NEXT_PUBLIC_RELAY_PORT` env var (standard Next.js pattern). Set by the dev script and supervisor at startup.

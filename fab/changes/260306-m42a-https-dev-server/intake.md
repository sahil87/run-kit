# Intake: HTTPS Dev Server

**Change**: 260306-m42a-https-dev-server
**Created**: 2026-03-06
**Status**: Draft

## Origin

> "serve the app from a https url instead of http"

One-shot natural language request. No prior conversation context.

## Why

run-kit currently serves all traffic over plain HTTP (Next.js on port 3000) and WS (terminal relay on port 3001). This prevents:

1. **Clipboard API access** — `navigator.clipboard.writeText()` requires a secure context (`https:` or `localhost`). When run-kit binds to `0.0.0.0` and is accessed from another machine on the LAN (e.g., `http://192.168.1.x:3000`), clipboard operations fail silently. This matters for a keyboard-first terminal orchestration tool.
2. **Mixed-content blocking** — browsers block `wss:` connections from `http:` pages in some configurations, but more importantly, future features (service workers, WebAuthn, device APIs) all require secure contexts.
3. **Local dev parity** — many modern web APIs are gated behind HTTPS even in development. Serving HTTPS locally eliminates a class of "works on localhost but not on LAN" bugs.

If we don't fix this, run-kit remains limited to `localhost`-only usage or requires an external reverse proxy for LAN access with full browser API support.

## What Changes

### 1. TLS Certificate Generation (`mkcert`)

Add a setup mechanism to generate locally-trusted TLS certificates using [`mkcert`](https://github.com/FiloSottile/mkcert):

- A `certs/` directory (gitignored) holds `localhost.pem` and `localhost-key.pem`
- Generation via `mkcert -install && mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1`
- Certs are optional — if absent, the app falls back to HTTP/WS (no breaking change)
- A `just certs` recipe in the `justfile` wraps the generation command:

```just
# Generate locally-trusted TLS certs (requires mkcert)
certs:
    mkdir -p certs
    mkcert -install
    mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1
```

### 2. Next.js HTTPS Dev Mode

Next.js 15 supports `--experimental-https` which auto-generates a self-signed cert. However, this uses its own cert store and doesn't share certs with the terminal relay. Instead, use a custom server approach or Next.js's `--experimental-https-cert` and `--experimental-https-key` flags to point at the shared `certs/` directory.

Update `dev.sh`:
```bash
# If certs exist, pass HTTPS flags to next dev
if [[ -f certs/localhost.pem && -f certs/localhost-key.pem ]]; then
  NEXT_HTTPS="--experimental-https --experimental-https-cert certs/localhost.pem --experimental-https-key certs/localhost-key.pem"
else
  NEXT_HTTPS=""
fi

exec pnpm concurrently -n next,relay -c blue,green \
  "next dev --port $RK_PORT --hostname $RK_HOST $NEXT_HTTPS" \
  "tsx src/terminal-relay/server.ts"
```

### 3. Terminal Relay HTTPS/WSS Support

The relay server (`src/terminal-relay/server.ts`) currently uses `createServer` from `node:http`. When TLS certs are available, it should use `createServer` from `node:https` instead:

```typescript
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync, existsSync } from "node:fs";

// Detect certs
const certPath = "certs/localhost.pem";
const keyPath = "certs/localhost-key.pem";
const hasCerts = existsSync(certPath) && existsSync(keyPath);

const server = hasCerts
  ? createHttpsServer({
      cert: readFileSync(certPath),
      key: readFileSync(keyPath),
    })
  : createHttpServer();
```

The WebSocketServer attaches to whichever server is created — no changes needed to the WSS layer (the `ws` library handles TLS transparently when attached to an HTTPS server).

### 4. Supervisor HTTPS Support

`supervisor.sh` hardcodes `HEALTH_URL="http://${RK_HOST}:${RK_PORT}/api/health"`. This needs to detect cert presence and use the correct protocol:

```bash
if [[ -f certs/localhost.pem && -f certs/localhost-key.pem ]]; then
  HEALTH_PROTO="https"
  CURL_FLAGS="-k"  # Accept self-signed certs for health checks
else
  HEALTH_PROTO="http"
  CURL_FLAGS=""
fi
HEALTH_URL="${HEALTH_PROTO}://${RK_HOST}:${RK_PORT}/api/health"
```

### 5. Config Extension

Extend `run-kit.yaml` schema and `src/lib/config.ts` to support optional TLS configuration:

```yaml
server:
  port: 3000
  relay_port: 3001
  host: 127.0.0.1
  tls:
    cert: certs/localhost.pem
    key: certs/localhost-key.pem
```

The `config.ts` module reads TLS paths from config (with `certs/` convention as default) and exposes them. The relay server reads these paths from config rather than hardcoding.

### 6. Client-Side Protocol Detection (Already Done)

`terminal-client.tsx:148` already derives the WebSocket protocol from `window.location.protocol`:
```typescript
const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
```

No client-side changes needed for the WebSocket URL. The app will automatically use `wss:` when served over HTTPS.

### 7. `.gitignore` Update

Add `certs/` to `.gitignore` to prevent committing private keys.

## Affected Memory

- `run-kit/architecture`: (modify) Add TLS/HTTPS section documenting cert generation, config, and protocol detection

## Impact

- **`src/terminal-relay/server.ts`** — conditional HTTPS server creation
- **`src/lib/config.ts`** — TLS cert path config fields
- **`dev.sh`** — HTTPS flags for `next dev`
- **`supervisor.sh`** — HTTPS health check URL + `next start` with HTTPS
- **`run-kit.yaml`** (example) — TLS config section
- **`justfile`** — new `certs` recipe for cert generation
- **`.gitignore`** — `certs/` entry
- **No breaking changes** — HTTP fallback when certs are absent

## Open Questions

- None — the approach is well-defined by Next.js's experimental HTTPS support and standard Node.js TLS APIs.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `mkcert` for local cert generation | Industry standard for local HTTPS; avoids self-signed cert warnings in browsers | S:70 R:85 A:90 D:95 |
| 2 | Certain | Fall back to HTTP when certs are absent | Constitution says minimal surface area; HTTPS is opt-in, not mandatory | S:75 R:95 A:90 D:90 |
| 3 | Certain | Client-side WebSocket protocol detection already works | Code at `terminal-client.tsx:148` already derives `wss:`/`ws:` from `window.location.protocol` | S:95 R:95 A:95 D:95 |
| 4 | Confident | Use Next.js `--experimental-https-cert`/`--experimental-https-key` flags | These flags exist in Next.js 15 and allow sharing certs with the relay; avoids custom server complexity | S:60 R:70 A:70 D:65 |
| 5 | Confident | Store certs in `certs/` directory at repo root | Convention over configuration; simple, discoverable, gitignored | S:60 R:85 A:75 D:70 |
| 6 | Confident | Extend `config.ts` with TLS cert paths | Follows existing config resolution pattern (CLI > YAML > defaults); relay reads paths from config | S:65 R:80 A:80 D:75 |
| 7 | Confident | Supervisor uses `curl -k` for self-signed cert health checks | Health check is local-only; `-k` is safe for localhost self-signed certs | S:55 R:90 A:70 D:75 |

7 assumptions (3 certain, 4 confident, 0 tentative, 0 unresolved).

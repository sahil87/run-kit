# Intake: Configurable Port/Host Binding

**Change**: 260303-q8a9-configurable-port-host
**Created**: 2026-03-03
**Status**: Draft

## Origin

> Make Next.js port, relay WebSocket port, and bind host configurable via CLI args and run-kit.yaml, replacing hardcoded constants.

Conversational mode — preceded by a `/fab-discuss` session. User asked how port/host binding should work. Three options were proposed: (1) environment variables, (2) `run-kit.yaml` config, (3) both. User chose "command line + config file". The resolution order was agreed as CLI args > `run-kit.yaml` > hardcoded defaults. For the client-side relay port, three approaches were proposed: (1) NEXT_PUBLIC env var, (2) API endpoint, (3) same-port upgrade. User chose NEXT_PUBLIC env var.

## Why

Both the Next.js server (port 3000) and the terminal relay WebSocket (port 3001) had hardcoded ports and bind addresses. This causes problems when:

1. **Port conflicts** — another service already occupies 3000 or 3001, requiring users to edit source code to change ports
2. **Network exposure** — the relay binds to `127.0.0.1` by default (correct for security), but users running run-kit on a remote machine need `0.0.0.0` binding, which was impossible without code changes
3. **Multi-instance** — running multiple run-kit instances on the same machine requires different ports

Without this, users must fork or edit source to change any binding configuration — a maintenance burden that contradicts Convention VII (convention over configuration).

## What Changes

### New config module: `src/lib/config.ts`

Central configuration module that reads from two sources with defined precedence:

1. **CLI args** (`--port`, `--relay-port`, `--host`) — highest priority
2. **`run-kit.yaml`** (`server.port`, `server.relay_port`, `server.host`) — middle priority
3. **Hardcoded defaults** (3000, 3001, 127.0.0.1) — lowest priority

The module:
- Uses the existing `yaml` package (already a dependency) for YAML parsing
- Validates ports as integers in range 1-65535 via `validPort()` helper
- Uses `unknown` types for YAML fields with runtime validation (no `as` casts on user input)
- Silently ignores missing `run-kit.yaml` (ENOENT), warns on parse errors
- Exports a `config` object with `port`, `relayPort`, `host`

### Remove hardcoded port constants from `src/lib/types.ts`

Delete `NEXTJS_PORT` (3000) and `RELAY_PORT` (3001) constants. All consumers now import from `config.ts`.

### Update terminal relay server: `src/terminal-relay/server.ts`

- Import `config` from `../lib/config` instead of port constants from `../lib/types`
- Use `config.relayPort` for URL construction in WebSocket handler
- Use `config.relayPort` and `config.host` in `server.listen()` call

### Update terminal client: `src/app/p/[project]/[window]/terminal-client.tsx`

- Remove `RELAY_PORT` import from `@/lib/types`
- Read relay port from `process.env.NEXT_PUBLIC_RELAY_PORT ?? "3001"` — Next.js inlines `NEXT_PUBLIC_*` env vars at build time for client components

### Update dev script: `package.json`

Set `NEXT_PUBLIC_RELAY_PORT=3001` before `next dev` in the concurrently command so the client bundle gets the relay port baked in.

### Update supervisor: `supervisor.sh`

- Add grep-based YAML config reading at startup (no `yq` dependency)
- Port validation via `_valid_port()` helper (1-65535 range check)
- Host validation via regex (`^[a-zA-Z0-9._:-]+$`)
- Pass `--port`, `--hostname`, `--host` flags and `NEXT_PUBLIC_RELAY_PORT` env var to both services
- Update `HEALTH_URL` to use configured host:port
- Update process-died restart fallbacks to match `start_services()`

### Config file and documentation

- `run-kit.yaml` added to `.gitignore` (user-specific config)
- `run-kit.example.yaml` created as copyable template with defaults and comments
- `README.md` updated: removed inaccurate `projects` config section, added Configuration section with YAML example, CLI override examples, and security note
- `fab/project/code-quality.md` updated: added Verification section (tsc --noEmit, pnpm build gates)

## Affected Memory

- `run-kit/architecture`: (modify) Add config module to Data Model section, document resolution order and `run-kit.yaml` schema

## Impact

- **`src/lib/config.ts`** — new file (config loader)
- **`src/lib/types.ts`** — removed `NEXTJS_PORT` and `RELAY_PORT` constants
- **`src/terminal-relay/server.ts`** — imports config instead of port constants
- **`src/app/p/[project]/[window]/terminal-client.tsx`** — reads env var instead of import
- **`package.json`** — dev script passes NEXT_PUBLIC_RELAY_PORT
- **`supervisor.sh`** — reads run-kit.yaml, passes config to services
- **`.gitignore`** — added run-kit.yaml
- **`run-kit.example.yaml`** — new template file
- **`README.md`** — Configuration section rewritten
- **`fab/project/code-quality.md`** — Verification section added
- No API contract changes
- No new dependencies (yaml package already present)

## Open Questions

None — all questions resolved during conversation.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Resolution order: CLI args > run-kit.yaml > hardcoded defaults | Discussed — user explicitly chose "command line + config file" | S:95 R:85 A:90 D:95 |
| 2 | Certain | Client-side relay port via NEXT_PUBLIC_RELAY_PORT env var | Discussed — user chose "Server-injected env var" over API endpoint and same-port upgrade | S:95 R:80 A:85 D:95 |
| 3 | Certain | Default bind host 127.0.0.1 (localhost only) | Security-critical default — terminal relay exposes shell access. User acknowledged 0.0.0.0 is opt-in | S:90 R:70 A:95 D:95 |
| 4 | Certain | run-kit.yaml is optional, not committed to repo | Discussed — user confirmed gitignore + example file pattern | S:95 R:90 A:90 D:95 |
| 5 | Confident | Port validation range 1-65535 with NaN guards | Standard port range. Added during code review — parseInt can return NaN which passes through nullish coalescing | S:75 R:85 A:90 D:85 |
| 6 | Confident | Supervisor uses grep-based YAML parsing (no yq dependency) | Keeps the script dependency-free. Fragile for complex YAML but sufficient for flat key-value server config | S:70 R:90 A:80 D:75 |
| 7 | Confident | YAML parse errors (non-ENOENT) logged as warnings | Silent failure for missing file is correct; other errors (permissions, malformed YAML) should be visible | S:65 R:90 A:85 D:80 |

7 assumptions (4 certain, 3 confident, 0 tentative, 0 unresolved).

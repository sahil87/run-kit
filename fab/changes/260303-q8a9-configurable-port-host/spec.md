# Spec: Configurable Port/Host Binding

**Change**: 260303-q8a9-configurable-port-host
**Created**: 2026-03-03
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Environment variable-based configuration (e.g., `PORT=4000`) — CLI args and YAML chosen instead
- Dynamic config reloading at runtime — config is read once at startup
- WebSocket routing through Next.js on the same port — separate relay port retained

## Configuration: Resolution Order

### Requirement: Three-layer config resolution

The system SHALL resolve `port`, `relayPort`, and `host` using three sources in strict priority order: CLI args (highest) > `run-kit.yaml` (middle) > hardcoded defaults (lowest). Each value SHALL be resolved independently — a CLI arg for port does not affect YAML resolution of host.

#### Scenario: All defaults (no config file, no CLI args)

- **GIVEN** no `run-kit.yaml` exists
- **AND** no CLI args are passed
- **WHEN** the config module initializes
- **THEN** `port` is `3000`, `relayPort` is `3001`, `host` is `"127.0.0.1"`

#### Scenario: YAML overrides defaults

- **GIVEN** `run-kit.yaml` contains `server.port: 4000` and `server.relay_port: 4001`
- **AND** no `server.host` key exists in the file
- **AND** no CLI args are passed
- **WHEN** the config module initializes
- **THEN** `port` is `4000`, `relayPort` is `4001`, `host` is `"127.0.0.1"` (default)

#### Scenario: CLI args override YAML

- **GIVEN** `run-kit.yaml` contains `server.port: 4000`
- **AND** the CLI includes `--port 5000`
- **WHEN** the config module initializes
- **THEN** `port` is `5000` (CLI wins), other values from YAML or defaults

### Requirement: YAML config file is optional

The system SHALL gracefully handle a missing `run-kit.yaml` — no error, no warning. The system SHALL warn (via `console.warn`) when `run-kit.yaml` exists but cannot be parsed (permission error, malformed YAML). ENOENT errors MUST be silently ignored.

#### Scenario: Missing config file

- **GIVEN** no `run-kit.yaml` exists at the repo root
- **WHEN** the config module reads YAML config
- **THEN** an empty config is returned (no warning, no error)

#### Scenario: Malformed YAML

- **GIVEN** `run-kit.yaml` exists but contains invalid YAML syntax
- **WHEN** the config module reads YAML config
- **THEN** a `[config]` warning is logged to stderr
- **AND** an empty config is returned (defaults apply)

### Requirement: Port validation

All port values (from YAML or CLI) MUST be validated as integers in range 1-65535. Invalid ports (NaN, out of range, non-integer, string values) SHALL be silently discarded — the next layer in the resolution chain provides the value.

#### Scenario: Invalid CLI port

- **GIVEN** the CLI includes `--port abc`
- **WHEN** the config module parses CLI args
- **THEN** the port arg is discarded (parseInt returns NaN, fails validation)
- **AND** the port resolves from YAML or default

#### Scenario: Out-of-range YAML port

- **GIVEN** `run-kit.yaml` contains `server.port: 99999`
- **WHEN** the config module reads YAML config
- **THEN** the port value is discarded (> 65535)
- **AND** the port resolves from the default (3000)

## Configuration: CLI Args

### Requirement: Supported CLI flags

The config module SHALL recognize three CLI flags from `process.argv`: `--port <N>`, `--relay-port <N>`, `--host <addr>`. Flags use space-separated values (not `=` syntax).

#### Scenario: All three flags provided

- **GIVEN** `process.argv` includes `--port 4000 --relay-port 4001 --host 0.0.0.0`
- **WHEN** the config module parses CLI args
- **THEN** `port` is `4000`, `relayPort` is `4001`, `host` is `"0.0.0.0"`

## Configuration: YAML Schema

### Requirement: YAML config structure

The system SHALL read `run-kit.yaml` from the repo root. The server config lives under a `server` key with three optional fields: `port` (number), `relay_port` (number), `host` (string).

#### Scenario: Full config file

- **GIVEN** `run-kit.yaml` contains:
  ```yaml
  server:
    port: 4000
    relay_port: 4001
    host: 0.0.0.0
  ```
- **WHEN** the config module reads YAML config
- **THEN** all three values are returned with correct types

## Relay Server: Configurable Binding

### Requirement: Relay server uses config for listen

The terminal relay server SHALL bind to `config.relayPort` and `config.host` instead of hardcoded values. The server SHALL log the actual bind address on startup.

#### Scenario: Default binding

- **GIVEN** no config overrides
- **WHEN** the relay server starts
- **THEN** it listens on `127.0.0.1:3001`
- **AND** logs `Terminal relay listening on 127.0.0.1:3001`

#### Scenario: Custom binding via config

- **GIVEN** `run-kit.yaml` sets `server.relay_port: 4001` and `server.host: 0.0.0.0`
- **WHEN** the relay server starts
- **THEN** it listens on `0.0.0.0:4001`

## Client: Relay Port Discovery

### Requirement: Terminal client reads relay port from env var

The terminal client component SHALL read the relay port from `process.env.NEXT_PUBLIC_RELAY_PORT` with a fallback to `"3001"`. The `RELAY_PORT` import from `@/lib/types` SHALL be removed.

#### Scenario: Env var set

- **GIVEN** `NEXT_PUBLIC_RELAY_PORT=4001` is set at build time
- **WHEN** the terminal client constructs the WebSocket URL
- **THEN** the URL uses port `4001`

#### Scenario: Env var not set

- **GIVEN** `NEXT_PUBLIC_RELAY_PORT` is not set
- **WHEN** the terminal client constructs the WebSocket URL
- **THEN** the URL uses the fallback port `3001`

## Supervisor: Config-Aware Process Management

### Requirement: Supervisor reads run-kit.yaml

The supervisor script SHALL read `run-kit.yaml` at startup using grep-based parsing (no `yq` dependency). Port values SHALL be validated as integers 1-65535. Host values SHALL be validated against `^[a-zA-Z0-9._:-]+$`. Invalid values SHALL be silently ignored (defaults apply).

#### Scenario: Supervisor with config file

- **GIVEN** `run-kit.yaml` contains `server.port: 4000` and `server.relay_port: 4001`
- **WHEN** the supervisor starts
- **THEN** Next.js is started with `--port 4000 --hostname 127.0.0.1`
- **AND** the relay is started with `--port 4001 --host 127.0.0.1`
- **AND** the health check URL uses `http://127.0.0.1:4000/api/health`

### Requirement: Supervisor passes NEXT_PUBLIC_RELAY_PORT

The supervisor SHALL set `NEXT_PUBLIC_RELAY_PORT` as an environment variable when starting the Next.js process, using the resolved relay port value.

#### Scenario: Relay port passed to Next.js

- **GIVEN** relay port resolves to `4001`
- **WHEN** the supervisor starts Next.js
- **THEN** `NEXT_PUBLIC_RELAY_PORT=4001` is set in the process environment

### Requirement: Process restart uses same config

When the supervisor detects a dead process and restarts it, the restart command SHALL use the same port/host configuration as the initial `start_services()` call.

#### Scenario: Next.js process dies

- **GIVEN** Next.js was started with `--port 4000 --hostname 0.0.0.0`
- **WHEN** the supervisor detects the process died
- **THEN** it restarts with identical flags: `NEXT_PUBLIC_RELAY_PORT=4001 pnpm start --port 4000 --hostname 0.0.0.0`

## Deprecated Requirements

### Hardcoded port constants in types.ts

**Reason**: `NEXTJS_PORT` and `RELAY_PORT` constants replaced by `config.ts` module with configurable resolution.
**Migration**: Import `config` from `src/lib/config` instead of port constants from `src/lib/types`.

## Design Decisions

1. **NEXT_PUBLIC env var for client-side relay port**: Use Next.js `NEXT_PUBLIC_RELAY_PORT` env var (baked into client bundle at build time)
   - *Why*: Standard Next.js pattern. Simple, no extra API calls. User chose this over API endpoint and same-port upgrade.
   - *Rejected*: API endpoint (`/api/config`) — adds indirection and a network round-trip. Same-port upgrade (route WS through Next.js) — requires custom server, eliminates independent relay process.

2. **Grep-based YAML parsing in supervisor.sh**: Parse `run-kit.yaml` with grep/sed instead of `yq`
   - *Why*: Zero additional dependencies. The YAML structure is flat (3 keys under `server:`), so grep is sufficient.
   - *Rejected*: `yq` — adds a system dependency that may not be installed. Node.js parser via `tsx` — heavyweight for a startup script.

3. **Silent discard of invalid values**: Invalid ports and hosts are silently discarded rather than erroring
   - *Why*: Fail-open to defaults is safer than fail-closed (refusing to start). The default config works for most users. Malformed YAML still gets a warning.
   - *Rejected*: Hard error on invalid config — too aggressive for an optional config file.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Resolution order: CLI args > run-kit.yaml > defaults | Confirmed from intake #1 — user explicitly chose this | S:95 R:85 A:90 D:95 |
| 2 | Certain | Client-side relay port via NEXT_PUBLIC_RELAY_PORT env var | Confirmed from intake #2 — user chose over API endpoint and same-port upgrade | S:95 R:80 A:85 D:95 |
| 3 | Certain | Default bind host 127.0.0.1 (localhost only) | Confirmed from intake #3 — security-critical default for terminal access | S:90 R:70 A:95 D:95 |
| 4 | Certain | run-kit.yaml is optional, gitignored, with example template | Confirmed from intake #4 — user explicitly requested gitignore + example file | S:95 R:90 A:90 D:95 |
| 5 | Confident | Port validation range 1-65535 with NaN/type guards | Confirmed from intake #5 — standard range, caught during code review | S:75 R:85 A:90 D:85 |
| 6 | Confident | Supervisor grep-based YAML parsing (no yq dependency) | Confirmed from intake #6 — sufficient for flat server config | S:70 R:90 A:80 D:75 |
| 7 | Confident | YAML parse errors (non-ENOENT) logged as warnings, ENOENT silent | Confirmed from intake #7 — distinguish expected absence from real errors | S:65 R:90 A:85 D:80 |
| 8 | Confident | Space-separated CLI args only (no `--port=3000` syntax) | Standard pattern matching process.argv. Equals syntax would require additional parsing. Low risk — easily added later. | S:60 R:95 A:80 D:75 |
| 9 | Confident | Config read once at module load (no dynamic reload) | Module-level evaluation is appropriate — config changes require restart. Consistent with Node.js conventions. | S:70 R:95 A:90 D:85 |

9 assumptions (4 certain, 5 confident, 0 tentative, 0 unresolved).

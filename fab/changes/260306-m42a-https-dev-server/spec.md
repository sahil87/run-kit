# Spec: HTTPS Dev Server

**Change**: 260306-m42a-https-dev-server
**Created**: 2026-03-06
**Affected memory**: `docs/memory/run-kit/architecture.md`

## Non-Goals

- Mandatory HTTPS — HTTP fallback MUST always work when certs are absent
- Custom CA infrastructure — `mkcert` handles local trust; no PKI
- Reverse proxy setup — HTTPS is handled directly by Node.js servers, not by Caddy/nginx

## Certificate Management

### Requirement: Cert Generation via `mkcert`

The project SHALL provide a `just certs` recipe that generates locally-trusted TLS certificates using `mkcert`. Certificates SHALL be stored in `certs/` at the repo root. The `certs/` directory MUST be gitignored.

The recipe SHALL:
1. Create `certs/` directory if absent
2. Run `mkcert -install` to install the local CA
3. Generate `certs/localhost.pem` (cert) and `certs/localhost-key.pem` (key) covering `localhost`, `127.0.0.1`, and `::1`

#### Scenario: First-Time Cert Generation
- **GIVEN** `mkcert` is installed and `certs/` does not exist
- **WHEN** the user runs `just certs`
- **THEN** `certs/localhost.pem` and `certs/localhost-key.pem` are created
- **AND** the local CA is installed in the system trust store

#### Scenario: Regeneration
- **GIVEN** `certs/` already contains cert files
- **WHEN** the user runs `just certs`
- **THEN** the cert files are overwritten with fresh certificates

### Requirement: Certs Gitignored

`.gitignore` MUST include `certs/` to prevent committing private key material.

#### Scenario: Git Status After Cert Generation
- **GIVEN** `certs/` is listed in `.gitignore`
- **WHEN** the user runs `just certs` then `git status`
- **THEN** no files in `certs/` appear as untracked

## Development Server

### Requirement: HTTPS Dev Mode

`dev.sh` SHALL detect the presence of TLS certificates and pass `--experimental-https`, `--experimental-https-cert`, and `--experimental-https-key` flags to `next dev` when certs exist. When certs are absent, `dev.sh` SHALL behave identically to today (plain HTTP).

#### Scenario: Dev With Certs
- **GIVEN** `certs/localhost.pem` and `certs/localhost-key.pem` exist
- **WHEN** the user runs `pnpm dev` (which invokes `dev.sh`)
- **THEN** Next.js starts on `https://127.0.0.1:3000` (or configured host/port)
- **AND** the terminal relay starts with HTTPS/WSS (see Terminal Relay section)

#### Scenario: Dev Without Certs
- **GIVEN** `certs/` directory does not exist or is empty
- **WHEN** the user runs `pnpm dev`
- **THEN** Next.js starts on `http://127.0.0.1:3000` (current behavior, unchanged)
- **AND** the terminal relay starts with HTTP/WS (current behavior, unchanged)

## Terminal Relay

### Requirement: Conditional HTTPS Server

The terminal relay (`src/terminal-relay/server.ts`) SHALL read TLS cert/key paths from `config` and create an HTTPS server when both files exist. When either file is absent, it SHALL fall back to an HTTP server. The `ws` WebSocketServer attaches to whichever server is created — no protocol-specific WebSocket changes needed.

The relay SHALL log the protocol on startup: `"Terminal relay listening on https://{host}:{port}"` or `"Terminal relay listening on http://{host}:{port}"`.

#### Scenario: Relay With Certs
- **GIVEN** TLS cert and key files exist at the configured paths
- **WHEN** the terminal relay starts
- **THEN** it creates an `https.createServer` with the cert/key
- **AND** WebSocket connections upgrade over TLS (WSS)

#### Scenario: Relay Without Certs
- **GIVEN** TLS cert or key file does not exist
- **WHEN** the terminal relay starts
- **THEN** it creates an `http.createServer` (current behavior)
- **AND** WebSocket connections use plain WS

### Requirement: Client Protocol Detection (No Change)

`terminal-client.tsx` already derives the WebSocket protocol from `window.location.protocol`. No changes needed. This requirement documents the existing behavior for completeness.

#### Scenario: Browser Connects Over HTTPS
- **GIVEN** the page is served over `https:`
- **WHEN** `TerminalClient` constructs the WebSocket URL
- **THEN** it uses `wss:` protocol

## Production Server (Supervisor)

### Requirement: Supervisor HTTPS Health Check

`supervisor.sh` SHALL detect cert presence and use `https://` for health check URLs when certs exist. The health check SHALL use `curl -k` (accept self-signed) when using HTTPS, since `mkcert` certs may not be trusted in all curl configurations.

#### Scenario: Health Check With Certs
- **GIVEN** certs exist and the supervisor starts the production server
- **WHEN** the supervisor runs the health check
- **THEN** it sends `GET https://{host}:{port}/api/health` with `-k` flag
- **AND** a 200 response is treated as healthy

#### Scenario: Health Check Without Certs
- **GIVEN** certs do not exist
- **WHEN** the supervisor runs the health check
- **THEN** it sends `GET http://{host}:{port}/api/health` (current behavior)

### Requirement: Supervisor HTTPS Start

When certs exist, `supervisor.sh` SHALL start Next.js via a custom HTTPS server entry point (`src/https-server.ts`) instead of `pnpm start`. When certs are absent, it SHALL use `pnpm start` (current behavior).

The custom server (`src/https-server.ts`) SHALL:
1. Import `next` and create an app with `dev: false`
2. Read TLS cert/key from the configured paths
3. Create an `https.createServer` with the Next.js request handler
4. Listen on the configured host/port

#### Scenario: Supervisor Start With Certs
- **GIVEN** certs exist
- **WHEN** the supervisor starts services
- **THEN** it runs `tsx src/https-server.ts` instead of `pnpm start`
- **AND** the Next.js app is accessible over HTTPS

#### Scenario: Supervisor Start Without Certs
- **GIVEN** certs do not exist
- **WHEN** the supervisor starts services
- **THEN** it runs `pnpm start` (current behavior, unchanged)

## Configuration

### Requirement: TLS Config Extension

`src/lib/config.ts` SHALL expose optional `tlsCert` and `tlsKey` fields in the `ServerConfig` type. The resolution order SHALL match the existing pattern: CLI args (`--tls-cert`, `--tls-key`) > `run-kit.yaml` (`server.tls.cert`, `server.tls.key`) > convention default (`certs/localhost.pem`, `certs/localhost-key.pem`).

The config SHALL NOT validate cert file existence — consumers (relay server, HTTPS server) handle their own existence checks and fallback.

#### Scenario: Config With YAML TLS Paths
- **GIVEN** `run-kit.yaml` contains `server.tls.cert: custom/cert.pem` and `server.tls.key: custom/key.pem`
- **WHEN** `config` is loaded
- **THEN** `config.tlsCert` is `"custom/cert.pem"` and `config.tlsKey` is `"custom/key.pem"`

#### Scenario: Config With Defaults
- **GIVEN** no TLS paths in CLI args or `run-kit.yaml`
- **WHEN** `config` is loaded
- **THEN** `config.tlsCert` is `"certs/localhost.pem"` and `config.tlsKey` is `"certs/localhost-key.pem"`

#### Scenario: Config With CLI Override
- **GIVEN** CLI args include `--tls-cert /path/to/cert.pem --tls-key /path/to/key.pem`
- **WHEN** `config` is loaded
- **THEN** CLI paths take precedence over YAML and defaults

## Design Decisions

1. **Shared certs between Next.js and relay**: Both servers use the same cert/key files from `config.tlsCert`/`config.tlsKey`. This avoids cert management duplication and ensures consistent TLS behavior.
   - *Why*: Single source of truth for certs; `mkcert` generates one pair that covers all local hostnames.
   - *Rejected*: Next.js `--experimental-https` (auto-generates its own cert, doesn't share with relay).

2. **Convention defaults for cert paths**: `certs/localhost.pem` and `certs/localhost-key.pem` are the defaults even without explicit config. Users who run `just certs` get HTTPS with zero additional config.
   - *Why*: Constitution principle VII (Convention Over Configuration).
   - *Rejected*: Requiring explicit YAML config for cert paths — adds friction for the common case.

3. **Custom HTTPS server for production**: A small `src/https-server.ts` wraps Next.js with `node:https` for supervisor mode, since `next start` doesn't support HTTPS natively.
   - *Why*: No external reverse proxy dependency; keeps the deployment self-contained per Constitution III (Wrap, Don't Reinvent — but there's nothing to wrap here).
   - *Rejected*: Reverse proxy (Caddy/nginx) — adds an external dependency for a local dev tool.

## Assumptions

| # | Grade | Decision | Rationale | Scores |
|---|-------|----------|-----------|--------|
| 1 | Certain | Use `mkcert` for local cert generation | Confirmed from intake #1 — industry standard, browser-trusted locally | S:80 R:90 A:95 D:95 |
| 2 | Certain | Fall back to HTTP when certs absent | Confirmed from intake #2 — constitution: minimal surface area, no breaking change | S:80 R:95 A:95 D:95 |
| 3 | Certain | Client WebSocket protocol detection already works | Confirmed from intake #3 — verified in source at terminal-client.tsx:148 | S:95 R:95 A:95 D:95 |
| 4 | Certain | Store certs in `certs/` at repo root | Upgraded from intake #5 Confident — convention over configuration (Constitution VII), justfile recipe targets this path | S:75 R:90 A:85 D:90 |
| 5 | Certain | Config doesn't validate cert existence | Config is read-time only; consumers do existence checks — follows existing config.ts pattern | S:80 R:95 A:90 D:95 |
| 6 | Confident | Shared certs between Next.js dev and relay | Both servers need the same hostnames; one cert pair covers all. Avoids `--experimental-https` auto-gen which can't be shared | S:70 R:75 A:80 D:70 |
| 7 | Confident | Custom HTTPS server entry point for supervisor mode | `next start` doesn't support HTTPS natively; custom server is ~15 lines, no external deps | S:65 R:70 A:75 D:65 |
| 8 | Confident | TLS config follows existing CLI > YAML > defaults pattern | Consistent with existing `config.ts` resolution order for port/relayPort/host | S:70 R:85 A:85 D:80 |
| 9 | Confident | Supervisor uses `curl -k` for HTTPS health checks | Local-only health check; `-k` is safe for mkcert certs which may not be in curl's trust store | S:60 R:90 A:75 D:80 |
| 10 | Confident | `dev.sh` passes cert paths to `next dev` via `--experimental-https-cert`/`--experimental-https-key` | These flags exist in Next.js 15; verified in Next.js CLI docs. Requires `--experimental-https` as well | S:65 R:75 A:70 D:70 |

10 assumptions (5 certain, 5 confident, 0 tentative, 0 unresolved).

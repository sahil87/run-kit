# Quality Checklist: HTTPS Dev Server

**Change**: 260306-m42a-https-dev-server
**Generated**: 2026-03-06
**Spec**: `spec.md`

## Functional Completeness

- [x] CHK-001 Cert generation: `just certs` creates `certs/localhost.pem` and `certs/localhost-key.pem`
- [x] CHK-002 Dev HTTPS: `dev.sh` passes `--experimental-https` flags to `next dev` when certs exist
- [x] CHK-003 Relay HTTPS: terminal relay creates HTTPS server when certs exist
- [x] CHK-004 Supervisor HTTPS: supervisor starts via `src/https-server.ts` when certs exist
- [x] CHK-005 Config TLS: `config.ts` exposes `tlsCert` and `tlsKey` with CLI > YAML > defaults resolution
- [x] CHK-006 Gitignore: `certs/` is in `.gitignore`

## Behavioral Correctness

- [x] CHK-007 HTTP fallback: all servers start in HTTP/WS mode when certs are absent (no behavior change)
- [x] CHK-008 Health check protocol: supervisor uses `https://` + `curl -k` when certs exist, `http://` otherwise
- [x] CHK-009 Relay log message: shows `https://` or `http://` correctly based on cert presence

## Scenario Coverage

- [x] CHK-010 Dev with certs: Next.js starts on HTTPS with correct cert/key flags
- [x] CHK-011 Dev without certs: Next.js starts on HTTP (unchanged behavior)
- [x] CHK-012 Relay with certs: WebSocket connections upgrade over TLS (WSS)
- [x] CHK-013 Relay without certs: WebSocket connections use plain WS
- [x] CHK-014 Config defaults: `tlsCert` defaults to `certs/localhost.pem`, `tlsKey` to `certs/localhost-key.pem`
- [x] CHK-015 Config YAML override: `server.tls.cert`/`server.tls.key` in `run-kit.yaml` override defaults
- [x] CHK-016 Config CLI override: `--tls-cert`/`--tls-key` override YAML and defaults

## Edge Cases & Error Handling

- [x] CHK-017 Partial certs: if only cert or only key exists, relay falls back to HTTP (not crash)
- [x] CHK-018 Invalid cert: relay behavior when cert file exists but is not a valid PEM (should surface clear error or fall back) — Node.js throws a clear `ERR_OSSL_PEM_NO_START_LINE` error; acceptable for a dev tool

## Code Quality

- [x] CHK-019 Pattern consistency: TLS config follows the same resolution pattern as port/relayPort/host
- [x] CHK-020 No unnecessary duplication: cert path detection reuses config values, not hardcoded in each consumer — `dev.sh` and `supervisor.sh` hardcode convention paths (`certs/localhost.pem`); acceptable per Convention Over Configuration (Constitution VII), matches `just certs` output. Custom YAML paths only affect relay/https-server which read from config.ts
- [x] CHK-021 `execFile` with argument arrays: no `exec()` or template-string shell commands introduced
- [x] CHK-022 No inline tmux command construction
- [x] CHK-023 Server Components by default: no unnecessary Client Components added

## Security

- [x] CHK-024 Private key not committed: `certs/` is gitignored, no cert files in tracked tree
- [x] CHK-025 No key material in config: `config.ts` stores paths, not cert contents

## Notes

- Check items as you review: `- [x]`
- All items must pass before `/fab-continue` (hydrate)
- If an item is not applicable, mark checked and prefix with **N/A**: `- [x] CHK-008 **N/A**: {reason}`

# Tasks: HTTPS Dev Server

**Change**: 260306-m42a-https-dev-server
**Spec**: `spec.md`
**Intake**: `intake.md`

## Phase 1: Setup

- [x] T001 [P] Add `certs/` to `.gitignore`
- [x] T002 [P] Add `certs` recipe to `justfile` — `mkdir -p certs && mkcert -install && mkcert -cert-file certs/localhost.pem -key-file certs/localhost-key.pem localhost 127.0.0.1 ::1`

## Phase 2: Core Implementation

- [x] T003 Extend `src/lib/config.ts` — add `tlsCert` and `tlsKey` fields to `ServerConfig`. Read from CLI args (`--tls-cert`, `--tls-key`) > `run-kit.yaml` (`server.tls.cert`, `server.tls.key`) > defaults (`certs/localhost.pem`, `certs/localhost-key.pem`). Update `readYamlConfig`, `readCliArgs`, and the export
- [x] T004 Update `src/terminal-relay/server.ts` — import `node:https` and `node:fs`, read `config.tlsCert`/`config.tlsKey`, conditionally create HTTPS or HTTP server. Update startup log to show `https://` or `http://` protocol
- [x] T005 [P] Create `src/https-server.ts` — custom HTTPS production server entry point. Import `next`, create app with `dev: false`, read TLS cert/key from config, create `https.createServer` with Next.js request handler, listen on `config.host`:`config.port`

## Phase 3: Integration & Edge Cases

- [x] T006 Update `dev.sh` — detect `certs/localhost.pem` and `certs/localhost-key.pem`, conditionally pass `--experimental-https --experimental-https-cert certs/localhost.pem --experimental-https-key certs/localhost-key.pem` to `next dev`
- [x] T007 Update `supervisor.sh` — (a) detect certs and set `HEALTH_PROTO` / `CURL_FLAGS` for health checks, (b) when certs exist, start Next.js via `tsx src/https-server.ts` instead of `pnpm start`, (c) update the process-died restart block similarly
- [x] T008 Update `src/lib/__tests__/config.test.ts` — add test cases for TLS config fields: defaults, YAML override, CLI override

## Phase 4: Polish

- [x] T009 Update `docs/memory/run-kit/architecture.md` — add TLS/HTTPS section documenting cert generation, config resolution, protocol detection, and supervisor HTTPS mode

---

## Execution Order

- T001 and T002 are independent setup tasks (parallel)
- T003 blocks T004 and T005 (they read from config)
- T004 and T005 can run in parallel after T003
- T006 and T007 are independent shell script updates (parallel), no code dependency on T003-T005
- T008 depends on T003 (tests the config changes)

# smoke.spec.ts

Placeholder file kept so the directory is never empty and `playwright test`
never errors about zero specs. The only `test` is `test.skip("smoke", …)`,
which Playwright reports as `skipped` in every run.

## Tests

### `smoke` *(skipped)*

Intentional no-op. Shows up in the run summary (`1 skipped`) and serves as an
anchor if we ever want to add a broad end-to-end smoke test without a real
tmux backend.

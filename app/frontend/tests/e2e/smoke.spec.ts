import { test } from "@playwright/test";

/**
 * Placeholder file kept so the directory is never empty and `playwright
 * test` never errors about zero specs.
 */

/**
 * Proves: nothing — an intentional no-op. Shows up in the run summary
 * (`1 skipped`) and serves as an anchor if we ever want to add a broad
 * end-to-end smoke test without a real tmux backend.
 *
 * Steps:
 * 1. Skip unconditionally via test.skip.
 */
test.skip("smoke", () => {});

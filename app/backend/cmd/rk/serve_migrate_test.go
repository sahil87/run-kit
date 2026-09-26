package main

import (
	"log/slog"
	"testing"
)

// migrateHomesUnlessDev gates the serve-start home migration on a release
// build (version != "dev"), so dev rigs and e2e rigs never freeze a stale
// copy of the developer's real legacy home, and DEFERS it while a pre-rename
// daemon session survives — that daemon still writes the legacy home, which a
// publish would hide.
func TestMigrateHomesUnlessDev(t *testing.T) {
	origMigrate := migrateHomes
	t.Cleanup(func() { migrateHomes = origMigrate })
	origVersion := version
	t.Cleanup(func() { version = origVersion })
	origLegacy := legacyDaemonRunningFn
	t.Cleanup(func() { legacyDaemonRunningFn = origLegacy })

	t.Run("dev build skips the migration", func(t *testing.T) {
		called := false
		migrateHomes = func(*slog.Logger) { called = true }
		version = "dev"
		legacyDaemonRunningFn = func() bool { return false }

		migrateHomesUnlessDev()

		if called {
			t.Error("dev build must not run the home migration")
		}
	})

	t.Run("release build runs the migration", func(t *testing.T) {
		called := false
		migrateHomes = func(*slog.Logger) { called = true }
		version = "v1.2.3"
		legacyDaemonRunningFn = func() bool { return false }

		migrateHomesUnlessDev()

		if !called {
			t.Error("release build must run the home migration at serve start")
		}
	})

	t.Run("release build defers while a pre-rename daemon runs", func(t *testing.T) {
		called := false
		migrateHomes = func(*slog.Logger) { called = true }
		version = "v1.2.3"
		legacyDaemonRunningFn = func() bool { return true }

		migrateHomesUnlessDev()

		if called {
			t.Error("release build must defer the home migration while a legacy daemon session survives")
		}
	})
}

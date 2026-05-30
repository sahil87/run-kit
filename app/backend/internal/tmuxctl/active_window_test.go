package tmuxctl

import (
	"sync"
	"testing"
)

func TestActiveWindowTracker_SetGet(t *testing.T) {
	tr := NewActiveWindowTracker()

	if _, ok := tr.Get("runKit"); ok {
		t.Fatalf("expected no entry for unset group")
	}

	tr.Set("runKit", "@27")
	if wid, ok := tr.Get("runKit"); !ok || wid != "@27" {
		t.Fatalf("Get after Set = (%q,%v), want (@27,true)", wid, ok)
	}
}

func TestActiveWindowTracker_LatestEventWins(t *testing.T) {
	tr := NewActiveWindowTracker()
	tr.Set("runKit", "@27")
	tr.Set("runKit", "@9")
	if wid, _ := tr.Get("runKit"); wid != "@9" {
		t.Fatalf("latest event should win: got %q, want @9", wid)
	}
}

func TestActiveWindowTracker_SetIgnoresEmpty(t *testing.T) {
	tr := NewActiveWindowTracker()
	tr.Set("", "@1")
	tr.Set("runKit", "")
	if _, ok := tr.Get(""); ok {
		t.Fatalf("empty group should not be stored")
	}
	if _, ok := tr.Get("runKit"); ok {
		t.Fatalf("empty wid should not be stored")
	}
}

func TestActiveWindowTracker_ResolveGroup(t *testing.T) {
	tr := NewActiveWindowTracker()
	tr.SetSidGroup("$0", "runKit")

	if group, ok := tr.ResolveGroup("$0"); !ok || group != "runKit" {
		t.Fatalf("ResolveGroup($0) = (%q,%v), want (runKit,true)", group, ok)
	}
	// Miss must be tolerated (no panic, ok=false).
	if _, ok := tr.ResolveGroup("$99"); ok {
		t.Fatalf("ResolveGroup($99) should miss")
	}
}

func TestActiveWindowTracker_ReplaceSidGroups(t *testing.T) {
	tr := NewActiveWindowTracker()
	tr.SetSidGroup("$0", "old")

	src := map[string]string{"$0": "runKit", "$34": "runKit"}
	tr.ReplaceSidGroups(src)

	if group, ok := tr.ResolveGroup("$0"); !ok || group != "runKit" {
		t.Fatalf("after Replace, $0 = (%q,%v), want (runKit,true)", group, ok)
	}
	if group, ok := tr.ResolveGroup("$34"); !ok || group != "runKit" {
		t.Fatalf("after Replace, $34 = (%q,%v), want (runKit,true)", group, ok)
	}

	// Mutating the source map afterward must not affect the tracker (copied).
	src["$0"] = "tampered"
	if group, _ := tr.ResolveGroup("$0"); group != "runKit" {
		t.Fatalf("tracker should hold a copy: got %q after source mutation", group)
	}

	// Replacing with a smaller map drops the prior entries.
	tr.ReplaceSidGroups(map[string]string{"$0": "runKit"})
	if _, ok := tr.ResolveGroup("$34"); ok {
		t.Fatalf("$34 should be dropped after replace with smaller map")
	}
}

func TestActiveWindowTracker_SeedAndSnapshot(t *testing.T) {
	tr := NewActiveWindowTracker()
	tr.SeedGroups(map[string]string{"runKit": "@5", "other": "@2", "skip": ""})

	if wid, _ := tr.Get("runKit"); wid != "@5" {
		t.Fatalf("seed runKit = %q, want @5", wid)
	}
	if _, ok := tr.Get("skip"); ok {
		t.Fatalf("empty wid should be skipped during seed")
	}

	snap := tr.Snapshot()
	if snap["runKit"] != "@5" || snap["other"] != "@2" {
		t.Fatalf("snapshot = %v, want runKit=@5 other=@2", snap)
	}
	// Snapshot is a copy — mutating it does not affect the tracker.
	snap["runKit"] = "@99"
	if wid, _ := tr.Get("runKit"); wid != "@5" {
		t.Fatalf("snapshot mutation leaked into tracker: got %q", wid)
	}

	// Seed replaces wholesale.
	tr.SeedGroups(map[string]string{"runKit": "@8"})
	if _, ok := tr.Get("other"); ok {
		t.Fatalf("prior group should be dropped after re-seed")
	}
}

// TestActiveWindowTracker_ConcurrentReadWrite exercises the tracker under the
// real access shape: the read-loop goroutine writes (Set/SetSidGroup/Replace/
// Seed) while the SSE fetch path reads (Get/ResolveGroup/Snapshot). Run with
// -race (just test-backend enables it) to assert no data race.
func TestActiveWindowTracker_ConcurrentReadWrite(t *testing.T) {
	tr := NewActiveWindowTracker()
	const iterations = 2000

	var wg sync.WaitGroup
	wg.Add(3)

	// Writer 1: active-window events (latest-event-wins).
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			tr.Set("runKit", "@"+string(rune('0'+i%10)))
			tr.SetSidGroup("$0", "runKit")
		}
	}()

	// Writer 2: periodic map refresh + re-seed (sessions-changed / reconnect).
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			tr.ReplaceSidGroups(map[string]string{"$0": "runKit", "$1": "other"})
			tr.SeedGroups(map[string]string{"runKit": "@3"})
		}
	}()

	// Reader: fetch-path reads.
	go func() {
		defer wg.Done()
		for i := 0; i < iterations; i++ {
			_, _ = tr.Get("runKit")
			_, _ = tr.ResolveGroup("$0")
			_ = tr.Snapshot()
		}
	}()

	wg.Wait()
}

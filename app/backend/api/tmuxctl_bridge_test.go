package api

import (
	"context"
	"errors"
	"testing"

	"rk/internal/tmuxctl"
)

// newTestHubSink builds a hubSink bound to a fresh tracker with stubbed,
// non-tmux query seams so tests never spawn a real subprocess.
func newTestHubSink(
	sidGroups func(ctx context.Context, server string) (map[string]string, error),
	activeByGroup func(ctx context.Context, server string) (map[string]string, error),
) (*hubSink, *tmuxctl.ActiveWindowTracker) {
	tr := tmuxctl.NewActiveWindowTracker()
	return &hubSink{
		server:            "default",
		tracker:           tr,
		listSessionGroups: sidGroups,
		listActiveByGroup: activeByGroup,
	}, tr
}

func TestHubSink_OnSessionWindowChanged_RecordsResolvedGroup(t *testing.T) {
	h, tr := newTestHubSink(nil, nil)
	tr.SetSidGroup("$34", "runKit")

	h.OnSessionWindowChanged("$34", "@27")

	if wid, ok := tr.Get("runKit"); !ok || wid != "@27" {
		t.Fatalf("Get(runKit) = (%q,%v), want (@27,true)", wid, ok)
	}
}

func TestHubSink_OnSessionWindowChanged_UnknownSidSkipped(t *testing.T) {
	h, tr := newTestHubSink(nil, nil)
	// No sid→group mapping at all: must not panic, must record nothing.
	h.OnSessionWindowChanged("$99", "@5")
	if len(tr.Snapshot()) != 0 {
		t.Fatalf("unknown sid should record nothing, got %v", tr.Snapshot())
	}
}

func TestHubSink_OnSessionWindowChanged_LatestEventWins(t *testing.T) {
	h, tr := newTestHubSink(nil, nil)
	tr.SetSidGroup("$0", "runKit")
	tr.SetSidGroup("$34", "runKit") // ephemeral grouped to runKit

	h.OnSessionWindowChanged("$0", "@27")
	h.OnSessionWindowChanged("$34", "@9") // a later event via an ephemeral member

	if wid, _ := tr.Get("runKit"); wid != "@9" {
		t.Fatalf("latest event should win: got %q, want @9", wid)
	}
}

func TestHubSink_OnSessionWindowChanged_NilTrackerNoPanic(t *testing.T) {
	h := &hubSink{server: "default"} // tracker nil
	// Must not panic.
	h.OnSessionWindowChanged("$0", "@1")
}

func TestHubSink_refreshSidGroups(t *testing.T) {
	calls := 0
	sidGroups := func(ctx context.Context, server string) (map[string]string, error) {
		calls++
		if server != "default" {
			t.Fatalf("unexpected server %q", server)
		}
		return map[string]string{"$0": "runKit", "$34": "runKit"}, nil
	}
	h, tr := newTestHubSink(sidGroups, nil)

	h.refreshSidGroups()

	if calls != 1 {
		t.Fatalf("expected 1 query, got %d", calls)
	}
	if g, ok := tr.ResolveGroup("$34"); !ok || g != "runKit" {
		t.Fatalf("ResolveGroup($34) = (%q,%v), want (runKit,true)", g, ok)
	}
}

func TestHubSink_refreshSidGroups_ErrorTolerated(t *testing.T) {
	sidGroups := func(ctx context.Context, server string) (map[string]string, error) {
		return nil, errors.New("no server running")
	}
	h, tr := newTestHubSink(sidGroups, nil)
	tr.SetSidGroup("$0", "stale")

	h.refreshSidGroups() // must not panic; stale map retained

	if g, ok := tr.ResolveGroup("$0"); !ok || g != "stale" {
		t.Fatalf("on error the prior map should be retained, got (%q,%v)", g, ok)
	}
}

func TestHubSink_reseed_SeedsTier1AndMap(t *testing.T) {
	sidGroups := func(ctx context.Context, server string) (map[string]string, error) {
		return map[string]string{"$0": "runKit"}, nil
	}
	activeByGroup := func(ctx context.Context, server string) (map[string]string, error) {
		return map[string]string{"runKit": "@3"}, nil
	}
	h, tr := newTestHubSink(sidGroups, activeByGroup)

	h.reseed()

	if wid, ok := tr.Get("runKit"); !ok || wid != "@3" {
		t.Fatalf("re-seed Tier 1: Get(runKit) = (%q,%v), want (@3,true)", wid, ok)
	}
	if g, ok := tr.ResolveGroup("$0"); !ok || g != "runKit" {
		t.Fatalf("re-seed map: ResolveGroup($0) = (%q,%v), want (runKit,true)", g, ok)
	}
}

func TestHubSink_reseed_ActiveQueryErrorTolerated(t *testing.T) {
	sidGroups := func(ctx context.Context, server string) (map[string]string, error) {
		return map[string]string{"$0": "runKit"}, nil
	}
	activeByGroup := func(ctx context.Context, server string) (map[string]string, error) {
		return nil, errors.New("no server running")
	}
	h, tr := newTestHubSink(sidGroups, activeByGroup)

	h.reseed() // must not panic; map still refreshed even if active query fails

	if g, ok := tr.ResolveGroup("$0"); !ok || g != "runKit" {
		t.Fatalf("sid map should still refresh on active-query error, got (%q,%v)", g, ok)
	}
	if len(tr.Snapshot()) != 0 {
		t.Fatalf("no Tier-1 seed expected on active-query error, got %v", tr.Snapshot())
	}
}

// TestHubSinkFactory_DefaultWiring asserts the production factory builds a
// tracker-bound sink (not a no-op) so the Supervisor wires tracking in.
func TestHubSinkFactory_DefaultWiring(t *testing.T) {
	factory := NewHubSinkFactory()
	tr := tmuxctl.NewActiveWindowTracker()
	sink := factory("default", tr)

	hs, ok := sink.(*hubSink)
	if !ok {
		t.Fatalf("factory returned %T, want *hubSink", sink)
	}
	if hs.tracker != tr {
		t.Fatalf("sink not bound to supplied tracker")
	}
	if hs.server != "default" {
		t.Fatalf("sink server = %q, want default", hs.server)
	}
	if hs.listSessionGroups == nil || hs.listActiveByGroup == nil {
		t.Fatalf("factory must wire the real tmux query seams")
	}
}

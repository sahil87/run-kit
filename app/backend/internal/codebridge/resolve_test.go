package codebridge

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"testing"
)

// The R5 scenario set: A holds the repo root, B a worktree under it, C an
// unrelated folder.
var scenarioHosts = []HostRecord{
	{HostID: "aaa", Folder: "/repo"},
	{HostID: "bbb", Folder: "/repo/.worktrees/x"},
	{HostID: "ccc", Folder: "/other"},
}

func resolve(t *testing.T, hosts []HostRecord, sel Selector) (HostRecord, bool, error) {
	t.Helper()
	return Resolve(context.Background(), hosts, sel)
}

func TestResolveExactHostID(t *testing.T) {
	h, fallback, err := resolve(t, scenarioHosts, Selector{HostID: "bbb"})
	if err != nil || h.HostID != "bbb" || fallback {
		t.Errorf("Resolve(--host bbb) = (%v, %v, %v)", h, fallback, err)
	}
}

func TestResolveUnknownHostIDIsNoHost(t *testing.T) {
	// An explicit --host that matches nothing is an error — the single-host
	// fallback must not silently retarget an explicit choice.
	_, _, err := resolve(t, scenarioHosts[:1], Selector{HostID: "nope"})
	var hl *HostListError
	if !errors.Is(err, ErrNoHost) || !errors.As(err, &hl) || len(hl.Hosts) != 1 {
		t.Errorf("Resolve(--host nope) err = %v", err)
	}
}

// cwd /repo/.worktrees/x/sub → git toplevel /repo/.worktrees/x → B exact.
func TestResolveExactFolderBeatsPrefix(t *testing.T) {
	h, fallback, err := resolve(t, scenarioHosts, Selector{Folder: "/repo/.worktrees/x"})
	if err != nil || h.HostID != "bbb" || fallback {
		t.Errorf("Resolve(/repo/.worktrees/x) = (%v, %v, %v)", h, fallback, err)
	}
}

// cwd /repo/pkg → git toplevel /repo → A exact.
func TestResolveExactRepoRoot(t *testing.T) {
	h, _, err := resolve(t, scenarioHosts, Selector{Folder: "/repo"})
	if err != nil || h.HostID != "aaa" {
		t.Errorf("Resolve(/repo) = (%v, %v)", h, err)
	}
}

// Target /repo/deep/x has no exact record → A wins by longest prefix.
func TestResolveLongestPrefix(t *testing.T) {
	h, fallback, err := resolve(t, scenarioHosts, Selector{Folder: "/repo/deep/x"})
	if err != nil || h.HostID != "aaa" || fallback {
		t.Errorf("Resolve(/repo/deep/x) = (%v, %v, %v)", h, fallback, err)
	}
}

// Under the worktree, B's longer prefix beats A's.
func TestResolveLongestPrefixPrefersDeeperRecord(t *testing.T) {
	h, _, err := resolve(t, scenarioHosts, Selector{Folder: "/repo/.worktrees/x/sub/dir"})
	if err != nil || h.HostID != "bbb" {
		t.Errorf("Resolve(/repo/.worktrees/x/sub/dir) = (%v, %v)", h, err)
	}
}

// Component awareness: /rep and /repository share a string prefix with /repo
// but are not contained by it — no folder match, so three live hosts is
// ambiguous.
func TestResolvePrefixIsPathComponentAware(t *testing.T) {
	for _, target := range []string{"/rep", "/repository", "/repository/x"} {
		_, _, err := resolve(t, scenarioHosts, Selector{Folder: target})
		if !errors.Is(err, ErrAmbiguous) {
			t.Errorf("Resolve(%s) err = %v, want ErrAmbiguous (no /repo prefix match)", target, err)
		}
	}
}

// No folder match, exactly one live host → use it, flagged as the fallback.
func TestResolveSingleHostFallback(t *testing.T) {
	h, fallback, err := resolve(t, scenarioHosts[2:], Selector{Folder: "/nowhere"})
	if err != nil || h.HostID != "ccc" || !fallback {
		t.Errorf("Resolve(single host, no match) = (%v, %v, %v)", h, fallback, err)
	}
}

// No folder match, several live hosts → ambiguous, error carries the list.
func TestResolveAmbiguousListsHosts(t *testing.T) {
	_, _, err := resolve(t, scenarioHosts, Selector{Folder: "/nowhere"})
	var hl *HostListError
	if !errors.Is(err, ErrAmbiguous) || !errors.As(err, &hl) || len(hl.Hosts) != 3 {
		t.Errorf("Resolve(no match, 3 hosts) err = %v", err)
	}
}

func TestResolveNoHosts(t *testing.T) {
	_, _, err := resolve(t, nil, Selector{Folder: "/repo"})
	if !errors.Is(err, ErrNoHost) {
		t.Errorf("Resolve(no hosts) err = %v, want ErrNoHost", err)
	}
}

// No selector at all with one host → the fallback still applies.
func TestResolveEmptySelectorSingleHost(t *testing.T) {
	h, fallback, err := resolve(t, scenarioHosts[:1], Selector{})
	if err != nil || h.HostID != "aaa" || !fallback {
		t.Errorf("Resolve(empty selector) = (%v, %v, %v)", h, fallback, err)
	}
}

// Tab-direct beats a folder match on another host: zzz carries the tab
// identity on /wt while aaa matches the selector's folder — without the tab
// step the exact folder match would return aaa.
func TestResolveTabDirectBeatsFolderMatch(t *testing.T) {
	hosts := []HostRecord{
		{HostID: "aaa", Folder: "/repo"},
		{HostID: "zzz", Folder: "/wt", Tab: "@7", Server: "default"},
	}
	h, fallback, err := resolve(t, hosts, Selector{Tab: "@7", Server: "default", Folder: "/repo"})
	if err != nil || h.HostID != "zzz" || fallback {
		t.Errorf("Resolve(tab @7) = (%v, %v, %v), want host zzz tab-direct", h, fallback, err)
	}
}

// No host carries the selector's tab → the tab step misses and the folder
// match still decides.
func TestResolveTabMissFallsBackToFolder(t *testing.T) {
	hosts := []HostRecord{{HostID: "bbb", Folder: "/repo"}}
	h, fallback, err := resolve(t, hosts, Selector{Tab: "@7", Server: "default", Folder: "/repo"})
	if err != nil || h.HostID != "bbb" || fallback {
		t.Errorf("Resolve(tab @7, tab-less host) = (%v, %v, %v), want host bbb via the folder match", h, fallback, err)
	}
}

// The tab-direct step engages only when both halves are set: a Tab-only
// selector falls through to the folder ladder even against a tabbed host.
func TestResolveTabDirectRequiresBothFields(t *testing.T) {
	hosts := []HostRecord{{HostID: "aaa", Folder: "/repo", Tab: "@7", Server: "default"}}
	h, fallback, err := resolve(t, hosts, Selector{Tab: "@7", Folder: "/nope"})
	if err != nil || h.HostID != "aaa" || !fallback {
		t.Errorf("Resolve(Tab only) = (%v, %v, %v), want the single-host fallback, not a tab match", h, fallback, err)
	}
}

// Two hosts on one folder (two tabs on one worktree) with no tab hit are
// ambiguous — picking either arbitrarily would target the wrong tab's editor.
func TestResolveSameFolderHostsAreAmbiguous(t *testing.T) {
	hosts := []HostRecord{
		{HostID: "aaa", Folder: "/wt", Tab: "@3", Server: "default"},
		{HostID: "bbb", Folder: "/wt", Tab: "@5", Server: "default"},
	}
	_, _, err := resolve(t, hosts, Selector{Folder: "/wt"})
	var hl *HostListError
	if !errors.Is(err, ErrAmbiguous) || !errors.As(err, &hl) || len(hl.Hosts) != 2 {
		t.Errorf("Resolve(two hosts on /wt) err = %v, want ErrAmbiguous carrying both", err)
	}
}

func TestReadRecordsRoundTripsTabAndServer(t *testing.T) {
	dir := t.TempDir()
	write := func(rec HostRecord) {
		t.Helper()
		data, err := json.Marshal(rec)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(recordPath(dir, rec.HostID), data, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	write(HostRecord{HostID: "aaa", Folder: "/repo", Tab: "@7", Server: "default"})
	write(HostRecord{HostID: "bbb", Folder: "/other"})

	recs, err := ReadRecords(dir)
	if err != nil {
		t.Fatal(err)
	}
	if len(recs) != 2 {
		t.Fatalf("ReadRecords = %d records, want 2", len(recs))
	}
	if recs[0].Tab != "@7" || recs[0].Server != "default" {
		t.Errorf("tabbed record = %+v, want tab @7 and server default preserved", recs[0])
	}
	if recs[1].Tab != "" || recs[1].Server != "" {
		t.Errorf("tab-less record = %+v, want empty tab/server", recs[1])
	}
}

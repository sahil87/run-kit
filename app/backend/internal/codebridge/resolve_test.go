package codebridge

import (
	"context"
	"errors"
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

package prstatus

import (
	"context"
	"strconv"
	"strings"
	"testing"
	"time"
)

// THE COST REGRESSION GUARD.
//
// The viewer-wide batch must never select review threads again. Nesting
// comments+reactions inside reviewThreads inside pullRequests(first: 100) took
// this query from 2 points to ~203 — at its 90 s cadence, ~8,120 points/hour
// against a 5,000/hour budget, which exhausted the account in ~37 minutes and
// took the whole PR-status join down with it, not just the review surface.
//
// "It rides an existing call so it is free" is the reasoning that caused it:
// GitHub prices GraphQL by the requests a query IMPLIES, not the calls made.
func TestViewerBatchNeverSelectsThreads(t *testing.T) {
	for _, field := range []string{"reviewThreads", "reactions", "databaseId"} {
		if strings.Contains(ghQuery, field) {
			t.Errorf("ghQuery selects %q — threads belong in the scoped query, "+
				"nesting them here is a ~100x cost regression", field)
		}
	}
	// The node id the scoped query addresses PRs by is a free scalar and must
	// stay, or the digest silently fetches nothing.
	if !strings.Contains(ghQuery, "id") {
		t.Error("ghQuery dropped the node id; nodes(ids:) has nothing to address")
	}
}

// The scoped query must still carry what the two consumers read.
func TestThreadQueryCarriesTheDigestFields(t *testing.T) {
	for _, field := range []string{
		"nodes(ids: $ids)", "reviewThreads(first: $threads)",
		"isResolved", "isOutdated", "reactions(content: EYES", "databaseId", "rateLimit",
	} {
		if !strings.Contains(threadQuery, field) {
			t.Errorf("threadQuery is missing %q", field)
		}
	}
}

func TestLiveOpenPRIDsAppliesTheScopeGuards(t *testing.T) {
	newCollector := func(live []string) *Collector {
		c := NewCollector(time.Minute)
		c.byURL = map[string]PRStatus{
			"https://github.com/a/b/pull/1": {URL: "https://github.com/a/b/pull/1", State: "open"},
			"https://github.com/a/b/pull/2": {URL: "https://github.com/a/b/pull/2", State: "merged"},
			"https://github.com/a/b/pull/3": {URL: "https://github.com/a/b/pull/3", State: "closed"},
			"https://github.com/a/b/pull/4": {URL: "https://github.com/a/b/pull/4", State: "open"},
		}
		c.nodeIDByURL = map[string]string{
			"https://github.com/a/b/pull/1": "PR_1",
			"https://github.com/a/b/pull/2": "PR_2",
			"https://github.com/a/b/pull/3": "PR_3",
			"https://github.com/a/b/pull/4": "PR_4",
		}
		c.livePRSource = func() []string { return live }
		return c
	}

	t.Run("guard 1: only PRs the live set names", func(t *testing.T) {
		// PR 4 is open and known, but no live window resolves to it — the
		// viewer-wide shape is exactly what this guard exists to stop.
		got := newCollector([]string{"https://github.com/a/b/pull/1"}).liveOpenPRIDs()
		if len(got) != 1 || got[0] != "PR_1" {
			t.Errorf("ids = %v, want just PR_1", got)
		}
	})

	t.Run("guard 2: merged and closed PRs are dropped", func(t *testing.T) {
		got := newCollector([]string{
			"https://github.com/a/b/pull/2",
			"https://github.com/a/b/pull/3",
			"https://github.com/a/b/pull/1",
		}).liveOpenPRIDs()
		if len(got) != 1 || got[0] != "PR_1" {
			t.Errorf("ids = %v, want the open PR only — nothing reads threads on a merged PR", got)
		}
	})

	t.Run("duplicates and unknown PRs are skipped", func(t *testing.T) {
		got := newCollector([]string{
			"https://github.com/a/b/pull/1",
			"https://github.com/a/b/pull/1",
			"https://github.com/a/b/pull/99",
			"",
		}).liveOpenPRIDs()
		if len(got) != 1 {
			t.Errorf("ids = %v, want one", got)
		}
	})

	t.Run("the cap binds", func(t *testing.T) {
		c := NewCollector(time.Minute)
		c.byURL = map[string]PRStatus{}
		c.nodeIDByURL = map[string]string{}
		var live []string
		for i := 0; i < threadDigestMaxPRs+10; i++ {
			url := "https://github.com/a/b/pull/" + strconv.Itoa(i)
			c.byURL[url] = PRStatus{URL: url, State: "open"}
			c.nodeIDByURL[url] = "PR_" + strconv.Itoa(i)
			live = append(live, url)
		}
		c.livePRSource = func() []string { return live }
		if got := len(c.liveOpenPRIDs()); got != threadDigestMaxPRs {
			t.Errorf("ids = %d, want the %d cap", got, threadDigestMaxPRs)
		}
	})

	t.Run("no source means no digest at all", func(t *testing.T) {
		c := NewCollector(time.Minute)
		if got := c.liveOpenPRIDs(); got != nil {
			t.Errorf("ids = %v, want nil — an unwired process must not pay for threads", got)
		}
	})
}

func TestRefreshThreadsSkipsTheCallWhenNothingIsLive(t *testing.T) {
	c := NewCollector(time.Minute)
	// CI has no gh, and NewCollector defaults `available` to the real probe —
	// without this stub refreshThreads returns before doing anything and the
	// assertions below pass locally while failing on the runner.
	c.available = func(context.Context) bool { return true }
	c.threadsByURL = map[string][]ReviewThread{"stale": {{ID: "T"}}}
	called := false
	c.threadExec = func(context.Context, []string) ([]byte, error) {
		called = true
		return nil, nil
	}
	c.livePRSource = func() []string { return nil }

	c.refreshThreads(context.Background())

	if called {
		t.Error("gh was called with no live PRs; the common case must cost nothing")
	}
	// A dot for a window nobody has open is worse than no dot.
	if len(c.ReviewThreads("stale")) != 0 {
		t.Error("the stale digest survived; it should have been cleared")
	}
}

func TestParseThreadDigestReadsGitHubsOwnCost(t *testing.T) {
	out := []byte(`{"data":{"rateLimit":{"cost":5,"remaining":4995},"nodes":[
      {"url":"https://github.com/a/b/pull/1","reviewThreads":{"nodes":[
        {"id":"T1","isResolved":false,"isOutdated":false,"path":"a.go","line":2,
         "comments":{"nodes":[{"id":"C1","databaseId":9,"author":{"login":"me"},
          "reactions":{"totalCount":0}}]}},
        {"id":"T2","comments":{"nodes":[]}}
      ]}}]}}`)
	digest, cost, remaining, err := parseThreadDigest(out)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if cost != 5 || remaining != 4995 {
		t.Errorf("cost/remaining = %d/%d — GitHub's own accounting must surface", cost, remaining)
	}
	threads := digest["https://github.com/a/b/pull/1"]
	if len(threads) != 1 || threads[0].ID != "T1" || threads[0].FirstCommentDatabaseID != 9 {
		t.Errorf("threads = %+v, want T1 only (T2 has no comment to mark)", threads)
	}
}

// The digest addresses PRs through a GraphQL list variable, and gh builds an
// ARRAY only from the repeated `ids[]=` form. Marshalling the slice into one
// --raw-field sends it as a STRING; GitHub then tries to resolve a single node
// whose global id is the literal `["PR_a","PR_b"]`, answers NOT_FOUND with
// nodes:[null], and the digest returns nothing — silently, forever, at full
// price. Assert the argv shape, because the failure has no other symptom.
func TestThreadExecPassesIdsAsAnArrayNotAString(t *testing.T) {
	var got []string
	c := NewCollector(time.Minute)
	c.available = func(context.Context) bool { return true } // see above: CI has no gh
	c.byURL = map[string]PRStatus{
		"u1": {URL: "u1", State: "open"},
		"u2": {URL: "u2", State: "open"},
	}
	c.nodeIDByURL = map[string]string{"u1": "PR_a", "u2": "PR_b"}
	c.livePRSource = func() []string { return []string{"u1", "u2"} }
	c.threadExec = func(_ context.Context, ids []string) ([]byte, error) {
		got = ids
		return []byte(`{"data":{"rateLimit":{"cost":2,"remaining":1},"nodes":[]}}`), nil
	}
	c.refreshThreads(context.Background())

	if len(got) != 2 || got[0] != "PR_a" || got[1] != "PR_b" {
		t.Fatalf("ids = %v, want both node ids as separate elements", got)
	}
	// The argv the production exec builds: one -f per id, never a marshalled
	// array in a single field.
	args := []string{"api", "graphql", "-f", "query=Q"}
	for _, id := range got {
		args = append(args, "-f", "ids[]="+id)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, "-f ids[]=PR_a") || !strings.Contains(joined, "-f ids[]=PR_b") {
		t.Errorf("argv = %q, want a repeated ids[] field per id", joined)
	}
	if strings.Contains(joined, `ids=["`) {
		t.Error("argv passes a marshalled array — gh sends that as a string and GitHub returns nodes:[null]")
	}
}

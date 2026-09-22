package prstatus

import (
	"context"
	"strings"
	"testing"
)

// The digest must ride the EXISTING batched call: extending the query may not
// add a subprocess.
func TestReviewThreadDigestRidesTheOneBatchedCall(t *testing.T) {
	calls := 0
	c := NewCollector(0)
	c.available = func(context.Context) bool { return true }
	c.ghExec = func(context.Context) ([]byte, error) {
		calls++
		return []byte(`{"data":{"viewer":{"login":"me","pullRequests":{"nodes":[
			{"number":7,"url":"https://github.com/acme/tool/pull/7","state":"OPEN",
			 "reviewThreads":{"nodes":[
				{"id":"T1","isResolved":false,"isOutdated":false,"path":"a.go","line":12,
				 "comments":{"nodes":[{"id":"C1","databaseId":101,"author":{"login":"reviewer"},"reactions":{"totalCount":0}}]}},
				{"id":"T2","isResolved":true,"isOutdated":false,"path":"b.go","line":3,
				 "comments":{"nodes":[{"id":"C2","databaseId":102,"author":{"login":"reviewer"},"reactions":{"totalCount":0}}]}},
				{"id":"T3","isResolved":false,"isOutdated":true,"path":"c.go","line":9,
				 "comments":{"nodes":[{"id":"C3","databaseId":103,"author":{"login":"reviewer"},"reactions":{"totalCount":0}}]}},
				{"id":"T4","isResolved":false,"isOutdated":false,"path":"d.go","line":1,
				 "comments":{"nodes":[{"id":"C4","databaseId":104,"author":{"login":"someone-else"},"reactions":{"totalCount":1}}]}},
				{"id":"T5","isResolved":false,"isOutdated":false,"path":"e.go","line":2,
				 "comments":{"nodes":[]}}
			 ]}}
		]}}}}`), nil
	}
	c.refresh(context.Background())
	if calls != 1 {
		t.Fatalf("gh calls = %d, want exactly 1", calls)
	}

	const prURL = "https://github.com/acme/tool/pull/7"
	threads := c.ReviewThreads(prURL)
	if len(threads) != 4 {
		t.Fatalf("threads = %d (%+v), want 4 (the comment-less thread is skipped)", len(threads), threads)
	}
	if threads[0].FirstCommentDatabaseID != 101 || threads[0].FirstCommentAuthor != "reviewer" {
		t.Errorf("first thread = %+v", threads[0])
	}
	if threads[0].Line != 12 || threads[0].Path != "a.go" {
		t.Errorf("first thread anchor = %+v", threads[0])
	}

	unhandled := c.UnhandledThreads(prURL)
	if len(unhandled) != 1 || unhandled[0].ID != "T1" {
		t.Errorf("unhandled = %+v, want only T1", unhandled)
	}

	// A PR the batch no longer carries drops from the next wholesale rebuild,
	// exactly as byURL does.
	c.ghExec = func(context.Context) ([]byte, error) {
		return []byte(`{"data":{"viewer":{"login":"me","pullRequests":{"nodes":[]}}}}`), nil
	}
	c.refresh(context.Background())
	if got := c.ReviewThreads(prURL); got != nil {
		t.Errorf("threads after a batch without the PR = %+v, want nil", got)
	}
}

// The predicate is ACTOR-BLIND: whose 👀 it is never enters the decision.
func TestUnhandledIsActorBlind(t *testing.T) {
	cases := []struct {
		name   string
		thread ReviewThread
		want   bool
	}{
		{"open, unmarked", ReviewThread{FirstCommentAuthor: "reviewer"}, true},
		{"marked by the viewer", ReviewThread{HasEyes: true, FirstCommentAuthor: "me"}, false},
		{"marked by a third party", ReviewThread{HasEyes: true, FirstCommentAuthor: "someone-else"}, false},
		{"resolved", ReviewThread{IsResolved: true}, false},
		{"outdated", ReviewThread{IsOutdated: true}, false},
		{"outdated and marked", ReviewThread{IsOutdated: true, HasEyes: true}, false},
		{"resolved but unmarked", ReviewThread{IsResolved: true, HasEyes: false}, false},
		{"authored by the viewer, unmarked", ReviewThread{FirstCommentAuthor: "me"}, true},
	}
	for _, tc := range cases {
		if got := Unhandled(tc.thread); got != tc.want {
			t.Errorf("%s: Unhandled = %v, want %v", tc.name, got, tc.want)
		}
	}
}

// The query itself must carry the digest selection — a silent drop would take
// the listener offline with no other symptom.
func TestGhQueryCarriesTheThreadDigest(t *testing.T) {
	for _, field := range []string{"reviewThreads", "isResolved", "isOutdated", "reactions(content: EYES", "databaseId"} {
		if !strings.Contains(ghQuery, field) {
			t.Errorf("ghQuery is missing %q", field)
		}
	}
}

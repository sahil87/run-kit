package prstatus

// The PR-review thread DIGEST.
//
// It rides the collector's existing batched viewer.pullRequests query (see
// ghQuery's reviewThreads selection), so the digest costs no additional gh
// call. It carries only what two consumers need — the comment listener's
// eligibility predicate and the review toggle's unread signal — and
// deliberately not comment bodies: those are internal/prreview's, fetched on
// demand only while a review tile is mounted.

// ReviewThread is one PR review thread, projected down to the digest fields.
type ReviewThread struct {
	ID         string
	IsResolved bool
	IsOutdated bool
	Path       string
	Line       int
	// FirstCommentID / FirstCommentDatabaseID address the thread's opening
	// comment — the node the 👀 marker rides. The database id is what the REST
	// reactions route takes.
	FirstCommentID         string
	FirstCommentDatabaseID int64
	FirstCommentAuthor     string
	// HasEyes is the 👀 reaction presence on the first comment. It is read
	// ACTOR-BLIND: the predicate below performs no identity join, so a human's
	// 👀 and the listener's own mean the same thing — claimed.
	HasEyes bool
}

// Unhandled is the eligibility predicate:
//
//	unhandled(t) ≡ !isResolved ∧ !isOutdated ∧ !hasEyes(firstComment)
//
// No identity join, by design (spec pr-review.md § Dedupe). 👀 means "claimed,
// by whoever put it there": a human reacting 👀 says "I am handling this" and
// suppresses dispatch exactly as the listener's own mark does, and un-reacting
// releases the claim — which IS the manual re-dispatch gesture. This is also
// what makes switch-on backfill free: the backlog is just every thread the
// predicate admits, with no cursor and no seed file.
//
// An outdated thread is never eligible: the agent would be handed a line number
// that no longer names the code the comment is about.
func Unhandled(t ReviewThread) bool {
	return !t.IsResolved && !t.IsOutdated && !t.HasEyes
}

// ReviewThreads returns the digest threads for a PR URL, or nil. The slice is a
// copy — callers read it without holding the lock.
func (c *Collector) ReviewThreads(prURL string) []ReviewThread {
	c.mu.RLock()
	defer c.mu.RUnlock()
	threads := c.threadsByURL[prURL]
	if len(threads) == 0 {
		return nil
	}
	return append([]ReviewThread(nil), threads...)
}

// UnhandledThreads returns the PR's threads the predicate admits, in the order
// gh returned them (oldest first) so the listener dispatches a review in the
// order it was written.
func (c *Collector) UnhandledThreads(prURL string) []ReviewThread {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var out []ReviewThread
	for _, thread := range c.threadsByURL[prURL] {
		if Unhandled(thread) {
			out = append(out, thread)
		}
	}
	return out
}

// reviewThreadsFrom projects the parsed gh nodes onto the digest shape. A
// thread with no comments carries no marker target and is skipped: it can
// neither be claimed nor described to an agent.
func reviewThreadsFrom(prs []ghPR) map[string][]ReviewThread {
	out := make(map[string][]ReviewThread, len(prs))
	for _, pr := range prs {
		if pr.URL == "" || len(pr.ReviewThreads.Nodes) == 0 {
			continue
		}
		threads := make([]ReviewThread, 0, len(pr.ReviewThreads.Nodes))
		for _, node := range pr.ReviewThreads.Nodes {
			if len(node.Comments.Nodes) == 0 {
				continue
			}
			first := node.Comments.Nodes[0]
			author := ""
			if first.Author != nil {
				author = first.Author.Login
			}
			thread := ReviewThread{
				ID:                     node.ID,
				IsResolved:             node.IsResolved,
				IsOutdated:             node.IsOutdated,
				Path:                   node.Path,
				FirstCommentID:         first.ID,
				FirstCommentDatabaseID: first.DatabaseID,
				FirstCommentAuthor:     author,
				HasEyes:                first.Reactions.TotalCount > 0,
			}
			if node.Line != nil {
				thread.Line = *node.Line
			}
			threads = append(threads, thread)
		}
		if len(threads) > 0 {
			out[pr.URL] = threads
		}
	}
	return out
}

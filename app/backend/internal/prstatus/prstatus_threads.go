package prstatus

import (
	"context"
	"encoding/json"
	"log/slog"
	"os/exec"
	"strconv"
	"time"
)

// The PR-review thread DIGEST — a SCOPED query, deliberately not part of the
// viewer-wide batch.
//
// It used to ride that batch, because doing so costs no extra gh subprocess.
// That reasoning was wrong in the way that matters: GitHub prices GraphQL by
// the requests a query implies, not the calls you make. Nesting
// comments+reactions inside reviewThreads inside pullRequests(first: 100) took
// the batch from 2 points to ~203, which at its 90 s cadence is ~8,120
// points/hour against a 5,000/hour budget — the account was exhausted in ~37
// minutes and the whole PR-status join (checks, review decision, draft) went
// down with it, not just the review surface.
//
// Three guards keep this one cheap:
//
//  1. SCOPE. Both consumers — the listener's eligibility predicate and the
//     review toggle's unread dot — are per-WINDOW questions. Threads are
//     therefore fetched only for the PRs live windows actually resolve to
//     (SetLivePRSource), never for the viewer's 100 most recent PRs. That is
//     the 40× win: ~5 points instead of ~203.
//  2. STATE. Only OPEN PRs are asked for. Nothing reads threads on a merged or
//     closed PR, and the old query paid for them every pass.
//  3. CADENCE. Threads poll on their own, slower tick than PR status: a comment
//     landing seconds later is fine, a stale check state is not.
//
// Every pass logs GitHub's own `cost` / `remaining`, so this can never again be
// invisible until an account dies.

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

// --- the scoped query ----------------------------------------------------------

// threadDigestMaxPRs caps one pass. Live windows are the input, so this is a
// backstop against a pathological session, not the normal bound.
const threadDigestMaxPRs = 40

// threadDigestPerPR caps threads per PR. Cost scales with PRs × this, so it is
// the second multiplier. A PR with more open threads than this is already past
// the point where a dot means anything.
const threadDigestPerPR = 25

// threadQuery addresses PRs by GraphQL node id, so the live set rides a single
// VARIABLE — no aliases, no owner/name interpolation, and no way for a repo
// name to reach the query text (Constitution I holds by construction).
const threadQuery = `query($ids: [ID!]!, $threads: Int!) {
  rateLimit { cost remaining resetAt }
  nodes(ids: $ids) {
    ... on PullRequest {
      url
      reviewThreads(first: $threads) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          comments(first: 1) {
            nodes {
              id
              databaseId
              author { login }
              reactions(content: EYES, first: 1) { totalCount }
            }
          }
        }
      }
    }
  }
}`

type ghThreadResponse struct {
	Data struct {
		RateLimit struct {
			Cost      int    `json:"cost"`
			Remaining int    `json:"remaining"`
			ResetAt   string `json:"resetAt"`
		} `json:"rateLimit"`
		Nodes []struct {
			URL           string `json:"url"`
			ReviewThreads struct {
				Nodes []ghReviewThread `json:"nodes"`
			} `json:"reviewThreads"`
		} `json:"nodes"`
	} `json:"data"`
}

// defaultThreadExec runs the scoped digest query. `ids` are GitHub's own node
// ids echoed back, never user input, and they ride a variable rather than the
// query text.
func defaultThreadExec(ctx context.Context, ids []string) ([]byte, error) {
	queryCtx, cancel := context.WithTimeout(ctx, ghTimeout)
	defer cancel()
	vars, err := json.Marshal(ids)
	if err != nil {
		return nil, err
	}
	cmd := exec.CommandContext(queryCtx, "gh", "api", "graphql",
		"-f", "query="+threadQuery,
		"--raw-field", "ids="+string(vars),
		"-F", "threads="+itoa(threadDigestPerPR),
	)
	return cmd.Output()
}

// parseThreadDigest decodes the scoped response and reports GitHub's own cost
// accounting alongside it.
func parseThreadDigest(out []byte) (map[string][]ReviewThread, int, int, error) {
	var resp ghThreadResponse
	if err := json.Unmarshal(out, &resp); err != nil {
		return nil, 0, 0, err
	}
	digest := make(map[string][]ReviewThread, len(resp.Data.Nodes))
	for _, node := range resp.Data.Nodes {
		if node.URL == "" {
			continue
		}
		if threads := projectThreads(node.ReviewThreads.Nodes); len(threads) > 0 {
			digest[node.URL] = threads
		}
	}
	return digest, resp.Data.RateLimit.Cost, resp.Data.RateLimit.Remaining, nil
}

// refreshThreads runs one scoped digest pass. It is a no-op — and costs nothing
// — when no live window resolves to an OPEN PR, which is the common case.
func (c *Collector) refreshThreads(ctx context.Context) {
	c.threadMu.Lock()
	defer c.threadMu.Unlock()

	if c.threadExec == nil {
		return
	}
	if c.available != nil && !c.available(ctx) {
		return
	}

	ids := c.liveOpenPRIDs()
	if len(ids) == 0 {
		// Nothing on screen wants a digest. Clear rather than serve a stale one:
		// a dot for a window nobody has open is worse than no dot.
		c.mu.Lock()
		c.threadsByURL = map[string][]ReviewThread{}
		c.mu.Unlock()
		return
	}

	out, err := c.threadExec(ctx, ids)
	if err != nil {
		// stale-while-revalidate, exactly as the status pass does.
		slog.Debug("pr thread digest: gh failed", "prs", len(ids), "err", err)
		return
	}
	digest, cost, remaining, err := parseThreadDigest(out)
	if err != nil {
		slog.Debug("pr thread digest: parse failed", "err", err)
		return
	}

	// GitHub's OWN accounting, not ours. This is the line that makes a
	// regression like the one this file documents visible on the day it lands.
	slog.Debug("pr thread digest", "prs", len(ids), "cost", cost, "remaining", remaining)
	if remaining > 0 && remaining < graphQLRemainingWarn {
		slog.Warn("GitHub GraphQL budget running low",
			"remaining", remaining, "lastCost", cost, "prs", len(ids))
	}

	c.mu.Lock()
	c.threadsByURL = digest
	c.mu.Unlock()
}

// liveOpenPRIDs is the scope guard: the live set, narrowed to PRs this
// collector knows are OPEN, deduped and capped.
func (c *Collector) liveOpenPRIDs() []string {
	c.mu.RLock()
	source := c.livePRSource
	byURL := c.byURL
	ids := c.nodeIDByURL
	c.mu.RUnlock()
	if source == nil {
		return nil
	}

	seen := make(map[string]bool)
	out := make([]string, 0, threadDigestMaxPRs)
	for _, url := range source() {
		if url == "" || seen[url] {
			continue
		}
		seen[url] = true
		if status, ok := byURL[url]; !ok || status.State != "open" {
			continue // guard 2: threads on a merged/closed PR are read by nobody
		}
		id := ids[url]
		if id == "" {
			continue // not in the last batch; it will be next pass
		}
		out = append(out, id)
		if len(out) >= threadDigestMaxPRs {
			break
		}
	}
	return out
}

// projectThreads maps gh nodes onto the digest shape. A thread with no comments
// carries no marker target and is skipped: it can neither be claimed nor
// described to an agent.
func projectThreads(nodes []ghReviewThread) []ReviewThread {
	threads := make([]ReviewThread, 0, len(nodes))
	for _, node := range nodes {
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
	return threads
}

// DefaultThreadInterval is the digest's own cadence (guard 3) — slower than PR
// status on purpose. A review comment arriving a minute late is invisible to a
// human; a stale checks glyph is not.
const DefaultThreadInterval = 3 * time.Minute

// graphQLRemainingWarn is the budget floor that escalates a debug line to a
// warning. Chosen so a run-away lands in the log with room to act, not after
// the account is already dead.
const graphQLRemainingWarn = 1000

func itoa(v int) string { return strconv.Itoa(v) }

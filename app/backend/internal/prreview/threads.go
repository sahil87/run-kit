package prreview

import (
	"context"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

// threadsQuery is the DETAIL thread read: full comment bodies plus the viewer
// login on the node the query already selects. The digest counterpart lives in
// internal/prstatus and carries only what the listener's predicate needs — see
// this package's doc comment for why the two are separate.
const threadsQuery = `query($owner: String!, $repo: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $number) {
      reviewThreads(first: 100) {
        nodes {
          id
          isResolved
          isOutdated
          path
          line
          startLine
          diffSide
          comments(first: 100) {
            nodes {
              id
              databaseId
              body
              createdAt
              url
              author { login }
              reactions(content: EYES, first: 1) { totalCount }
            }
          }
        }
      }
    }
  }
}`

type ghThreadsResponse struct {
	Data struct {
		Viewer struct {
			Login string `json:"login"`
		} `json:"viewer"`
		Repository struct {
			PullRequest struct {
				ReviewThreads struct {
					Nodes []ghThread `json:"nodes"`
				} `json:"reviewThreads"`
			} `json:"pullRequest"`
		} `json:"repository"`
	} `json:"data"`
}

type ghThread struct {
	ID         string `json:"id"`
	IsResolved bool   `json:"isResolved"`
	IsOutdated bool   `json:"isOutdated"`
	Path       string `json:"path"`
	Line       *int   `json:"line"`
	StartLine  *int   `json:"startLine"`
	DiffSide   string `json:"diffSide"`
	Comments   struct {
		Nodes []ghThreadComment `json:"nodes"`
	} `json:"comments"`
}

type ghThreadComment struct {
	ID         string `json:"id"`
	DatabaseID int64  `json:"databaseId"`
	Body       string `json:"body"`
	CreatedAt  string `json:"createdAt"`
	URL        string `json:"url"`
	Author     *struct {
		Login string `json:"login"`
	} `json:"author"`
	Reactions struct {
		TotalCount int `json:"totalCount"`
	} `json:"reactions"`
}

func (f *Fetcher) fetchThreads(ctx context.Context, ref PRRef) ([]Thread, string, error) {
	args := []string{"api", "graphql"}
	if ref.Host != "" && ref.Host != "github.com" {
		args = append(args, "--hostname", ref.Host)
	}
	args = append(args,
		"-f", "query="+threadsQuery,
		"-F", "owner="+ref.Owner,
		"-F", "repo="+ref.Repo,
		"-F", "number="+strconv.Itoa(ref.Number),
	)
	out, err := f.ghExec(ctx, nil, args...)
	if err != nil {
		return nil, "", err
	}
	var decoded ghThreadsResponse
	if err := json.Unmarshal(out, &decoded); err != nil {
		return nil, "", err
	}
	nodes := decoded.Data.Repository.PullRequest.ReviewThreads.Nodes
	threads := make([]Thread, 0, len(nodes))
	for _, node := range nodes {
		threads = append(threads, projectThread(node))
	}
	return threads, decoded.Data.Viewer.Login, nil
}

func projectThread(node ghThread) Thread {
	thread := Thread{
		ID:         node.ID,
		IsResolved: node.IsResolved,
		IsOutdated: node.IsOutdated,
		Path:       node.Path,
		Side:       node.DiffSide,
	}
	if node.Line != nil {
		thread.Line = *node.Line
	}
	if node.StartLine != nil {
		thread.StartLine = *node.StartLine
	}
	for _, comment := range node.Comments.Nodes {
		author := ""
		if comment.Author != nil {
			author = comment.Author.Login
		}
		thread.Comments = append(thread.Comments, Comment{
			ID:         comment.ID,
			DatabaseID: comment.DatabaseID,
			Author:     author,
			Body:       comment.Body,
			CreatedAt:  parseGhTime(comment.CreatedAt),
			URL:        comment.URL,
			Eyes:       comment.Reactions.TotalCount > 0,
		})
	}
	return thread
}

// FirstComment returns the thread's opening comment, or nil for the malformed
// zero-comment case gh can return mid-deletion.
func (t Thread) FirstComment() *Comment {
	if len(t.Comments) == 0 {
		return nil
	}
	return &t.Comments[0]
}

// SuggestionOnly reports whether EVERY comment in the thread is nothing but a
// ```suggestion fence. Such a thread is a mechanical edit GitHub commits with
// one button, so the listener never spends an agent turn on it. A thread that
// argues a point AND offers a suggestion is not suggestion-only and still
// dispatches.
func (t Thread) SuggestionOnly() bool {
	if len(t.Comments) == 0 {
		return false
	}
	for _, comment := range t.Comments {
		if !isSuggestionOnlyBody(comment.Body) {
			return false
		}
	}
	return true
}

func isSuggestionOnlyBody(body string) bool {
	inFence := false
	sawSuggestion := false
	for _, line := range strings.Split(body, "\n") {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "```") {
			if !inFence {
				if !strings.EqualFold(strings.TrimPrefix(trimmed, "```"), "suggestion") {
					return false
				}
				sawSuggestion = true
			}
			inFence = !inFence
			continue
		}
		if inFence || trimmed == "" {
			continue
		}
		return false
	}
	return sawSuggestion && !inFence
}

// parseGhTime decodes GitHub's RFC3339 stamps. An unparseable value yields the
// zero time rather than an error — a timestamp is display sugar and must never
// fail a whole thread fetch.
func parseGhTime(raw string) time.Time {
	if raw == "" {
		return time.Time{}
	}
	parsed, err := time.Parse(time.RFC3339, raw)
	if err != nil {
		return time.Time{}
	}
	return parsed
}

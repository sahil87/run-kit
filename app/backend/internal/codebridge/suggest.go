package codebridge

import (
	"sort"
	"strings"
)

// Closest ranks the command ids in all by similarity to cmd — prefix match,
// then substring match, then edit distance — and returns the top n. Used for
// the "did you mean:" list after an unknown-command error. Case-insensitive;
// ordering within a rank is shorter distance first, then alphabetical, so the
// output is deterministic.
func Closest(cmd string, all []string, n int) []string {
	if n <= 0 {
		return nil
	}
	lower := strings.ToLower(cmd)
	type cand struct {
		id   string
		rank int // 0 prefix, 1 substring, 2 edit distance
		dist int
	}
	cands := make([]cand, 0, len(all))
	for _, id := range all {
		c := strings.ToLower(id)
		switch {
		case c == lower:
			cands = append(cands, cand{id, 0, 0})
		case strings.HasPrefix(c, lower) || strings.HasPrefix(lower, c):
			cands = append(cands, cand{id, 0, abs(len(c) - len(lower))})
		case strings.Contains(c, lower) || strings.Contains(lower, c):
			cands = append(cands, cand{id, 1, abs(len(c) - len(lower))})
		default:
			cands = append(cands, cand{id, 2, editDistance(lower, c)})
		}
	}
	sort.Slice(cands, func(i, j int) bool {
		a, b := cands[i], cands[j]
		if a.rank != b.rank {
			return a.rank < b.rank
		}
		if a.dist != b.dist {
			return a.dist < b.dist
		}
		return a.id < b.id
	})
	if n > len(cands) {
		n = len(cands)
	}
	out := make([]string, n)
	for i := range out {
		out[i] = cands[i].id
	}
	return out
}

func abs(n int) int {
	if n < 0 {
		return -n
	}
	return n
}

// editDistance is the Levenshtein distance between a and b.
func editDistance(a, b string) int {
	ar, br := []rune(a), []rune(b)
	prev := make([]int, len(br)+1)
	for j := range prev {
		prev[j] = j
	}
	for i := 1; i <= len(ar); i++ {
		cur := make([]int, len(br)+1)
		cur[0] = i
		for j := 1; j <= len(br); j++ {
			cost := 1
			if ar[i-1] == br[j-1] {
				cost = 0
			}
			cur[j] = min(cur[j-1]+1, prev[j]+1, prev[j-1]+cost)
		}
		prev = cur
	}
	return prev[len(br)]
}

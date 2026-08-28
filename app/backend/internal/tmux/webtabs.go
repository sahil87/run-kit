package tmux

// Web-tab family operations over the indexed @rk_win_web_<n> options: one
// tmux call to read the family, one chained SetWindowOptions call to mutate
// it — atomic against the SSE tick (the present.go precedent). The family is
// DENSE on every write path: slots 1..len with no gaps, URL and root moving
// together under shifts.

import (
	"context"
	neturl "net/url"
	"strconv"
	"strings"
	"time"

	"rk/internal/present"
)

// webNowFn is the clock behind WebAdd's ?v= refresh — a seam so tests can pin
// the cache-buster (mirrors cmd/rk's presentNowFn).
var webNowFn = func() int64 { return time.Now().Unix() }

// WebTabFamily is one window's dense web-tab state plus its layout option,
// read in one tmux call.
type WebTabFamily struct {
	Tabs   []string // dense; index 0 is tmux slot 1
	Roots  []string // parallel to Tabs; "" where the slot has no root
	Active int      // 1-based; 0 when no tabs (the clampWebActive degrade rule)
	Layout string   // raw @rk_win_layout value ("" when unset)
}

// webFamilyFormat is the display-message format behind ReadWebTabFamily: the 8
// URL slots, the 8 roots, the active pointer, the layout, and the retired
// @rk_win_url (dual-read web_1 fallback), tab-delimited in one call.
var webFamilyFormat = func() string {
	fields := make([]string, 0, 2*MaxWebTabs+3)
	for n := 1; n <= MaxWebTabs; n++ {
		fields = append(fields, "#{"+WebTabOption(n)+"}")
	}
	for n := 1; n <= MaxWebTabs; n++ {
		fields = append(fields, "#{"+WebTabRootOption(n)+"}")
	}
	return strings.Join(append(fields,
		"#{"+WebActiveOption+"}",
		"#{"+LayoutOption+"}",
		"#{"+legacyWinURLOption+"}",
	), listDelim)
}()

// ReadWebTabFamily reads the window's web-tab family in one tmux call: the
// dense URL slots (walked to the first empty — a hand-written gap degrades to
// the prefix), their parallel roots, and the clamped active pointer. When slot
// 1 is empty the retired @rk_win_url dual-reads as a single-tab fallback (the
// frontend polls it mid-session), so the Web* verbs operate on the same
// effective family ListWindows surfaces.
func ReadWebTabFamily(ctx context.Context, windowID, server string) (WebTabFamily, error) {
	lines, err := tmuxExecServer(ctx, server, "display-message", "-p", "-t", windowID, webFamilyFormat)
	if err != nil {
		return WebTabFamily{}, err
	}
	var f WebTabFamily
	if len(lines) == 0 {
		return f, nil
	}
	parts := strings.Split(lines[0], listDelim)
	end := min(MaxWebTabs, len(parts))
	f.Tabs = denseWebTabs(parts[:end])
	var legacyURL string
	if len(parts) > 2*MaxWebTabs+2 {
		legacyURL = strings.TrimSpace(parts[2*MaxWebTabs+2])
	}
	if len(f.Tabs) == 0 && legacyURL != "" {
		// @rk_win_url is never swept (see the legacyOptions comment); with no
		// web_1 it IS the family's first tab. Roots stay empty — the retired
		// name carried no parallel root on this path.
		f.Tabs = []string{legacyURL}
		f.Roots = []string{""}
	} else {
		f.Roots = make([]string, len(f.Tabs))
		for i := range f.Tabs {
			if len(parts) > MaxWebTabs+i {
				f.Roots[i] = strings.TrimSpace(parts[MaxWebTabs+i])
			}
		}
	}
	var activeRaw string
	if len(parts) > 2*MaxWebTabs {
		activeRaw = parts[2*MaxWebTabs]
	}
	f.Active = clampWebActive(activeRaw, len(f.Tabs))
	if len(parts) > 2*MaxWebTabs+1 {
		f.Layout = strings.TrimSpace(parts[2*MaxWebTabs+1])
	}
	return f, nil
}

// WebAdd appends url to the window's web-tab family and returns its 1-based
// index. Idempotent on an identical stored URL: returns (existing, true) with
// no append. For /present/ URLs identity is the TARGET (window, name, server,
// serve root — the slot index and ?v= cache-buster are incidental), so a
// re-presented target finds its existing slot, and the hit ALSO rewrites the
// slot with a fresh ?v= cache-buster (the re-present-is-refresh contract,
// falling out of the add verb). root, when non-empty, is written to
// WebTabRootOption(n); when empty the slot's root is unset (a port/URL target
// replacing a stale file/dir root). WebActiveOption is set to 1 only when the
// family was empty before — the first tab becomes active; otherwise the
// pointer is untouched ("add" is not "show"). Returns ErrWebTabsFull when the
// family already holds MaxWebTabs tabs and url is new. Every write rides one
// chained SetWindowOptions call.
func WebAdd(ctx context.Context, windowID, server, url, root string) (int, bool, error) {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	f, err := ReadWebTabFamily(ctx, windowID, server)
	if err != nil {
		return 0, false, err
	}
	for i, tab := range f.Tabs {
		if !webTabURLIdentical(tab, url) {
			continue
		}
		n := i + 1
		if strings.HasPrefix(tab, "/present/") {
			// The URL alone under-identifies a /present/ target: a directory
			// URL carries no name, and two files can share a basename — so
			// the serve root is part of the identity. Two roots = two tabs.
			// An empty stored root (the @rk_win_url dual-read path carries
			// none) is a wildcard that adopts the incoming root on the hit.
			stored := ""
			if i < len(f.Roots) {
				stored = f.Roots[i]
			}
			if stored != "" && root != "" && stored != root {
				continue
			}
			var ops []WindowOptionOp
			// The bump rewrites the STORED url — it carries the slot's own
			// index; the incoming url may have been computed for a fresh slot.
			bumped := present.BumpVersion(tab, webNowFn)
			if bumped != tab {
				ops = append(ops, WindowOptionOp{Key: WebTabOption(n), Value: &bumped})
			}
			if stored == "" && root != "" {
				ops = append(ops, WindowOptionOp{Key: WebTabRootOption(n), Value: &root})
			}
			if len(ops) > 0 {
				if err := SetWindowOptions(ctx, windowID, server, ops); err != nil {
					return 0, false, err
				}
			}
		}
		return n, true, nil
	}
	if len(f.Tabs) == MaxWebTabs {
		return 0, false, ErrWebTabsFull
	}
	n := len(f.Tabs) + 1
	ops := []WindowOptionOp{{Key: WebTabOption(n), Value: &url}}
	if root != "" {
		ops = append(ops, WindowOptionOp{Key: WebTabRootOption(n), Value: &root})
	} else {
		ops = append(ops, WindowOptionOp{Key: WebTabRootOption(n), Value: nil})
	}
	if len(f.Tabs) == 0 {
		active := "1"
		ops = append(ops, WindowOptionOp{Key: WebActiveOption, Value: &active})
	}
	if err := SetWindowOptions(ctx, windowID, server, ops); err != nil {
		return 0, false, err
	}
	return n, false, nil
}

// WebRemove unsets slot n and shifts slots n+1..len down by one — URL AND root
// move together — then unsets the former last slot and its root. The active
// pointer repoints per repointActive (an emptied family unsets it). n outside
// 1..len is ErrWebTabRange and writes nothing. Every write rides one chained
// SetWindowOptions call.
func WebRemove(ctx context.Context, windowID, server string, n int) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	f, err := ReadWebTabFamily(ctx, windowID, server)
	if err != nil {
		return err
	}
	if n < 1 || n > len(f.Tabs) {
		return ErrWebTabRange
	}
	tabs, roots := shiftWebTabs(f.Tabs, f.Roots, n)
	ops := make([]WindowOptionOp, 0, 2*len(tabs)+3)
	for i, tab := range tabs {
		v := tab
		ops = append(ops, WindowOptionOp{Key: WebTabOption(i + 1), Value: &v})
		if roots[i] != "" {
			r := roots[i]
			ops = append(ops, WindowOptionOp{Key: WebTabRootOption(i + 1), Value: &r})
		} else {
			ops = append(ops, WindowOptionOp{Key: WebTabRootOption(i + 1), Value: nil})
		}
	}
	// The former last slot (now one past the dense end) and its root go away.
	ops = append(ops,
		WindowOptionOp{Key: WebTabOption(len(tabs) + 1), Value: nil},
		WindowOptionOp{Key: WebTabRootOption(len(tabs) + 1), Value: nil},
	)
	// Removing the last tab also clears the retired @rk_win_url dual-read
	// source — otherwise an emptied family would resurrect it as web_1 on the
	// next read (the live-flip unset path the frontend exercises).
	if len(tabs) == 0 {
		ops = append(ops, WindowOptionOp{Key: legacyWinURLOption, Value: nil})
	}
	switch newActive := repointActive(f.Active, n, len(tabs)); {
	case newActive == 0:
		ops = append(ops, WindowOptionOp{Key: WebActiveOption, Value: nil})
	case newActive != f.Active:
		v := strconv.Itoa(newActive)
		ops = append(ops, WindowOptionOp{Key: WebActiveOption, Value: &v})
	}
	return SetWindowOptions(ctx, windowID, server, ops)
}

// WebSelect sets WebActiveOption=n; n outside 1..len is ErrWebTabRange and
// writes nothing.
func WebSelect(ctx context.Context, windowID, server string, n int) error {
	ctx, cancel := context.WithTimeout(ctx, TmuxTimeout)
	defer cancel()

	f, err := ReadWebTabFamily(ctx, windowID, server)
	if err != nil {
		return err
	}
	if n < 1 || n > len(f.Tabs) {
		return ErrWebTabRange
	}
	v := strconv.Itoa(n)
	return SetWindowOptions(ctx, windowID, server, []WindowOptionOp{{Key: WebActiveOption, Value: &v}})
}

// shiftWebTabs removes slot n (1-based) from the dense family, shifting the
// slots above it down by one — URL and root move together. roots is parallel
// to tabs ("" where a slot has no root) and may be shorter than tabs.
func shiftWebTabs(tabs, roots []string, n int) ([]string, []string) {
	newTabs := make([]string, 0, len(tabs)-1)
	newRoots := make([]string, 0, len(tabs)-1)
	for j, tab := range tabs {
		if j == n-1 {
			continue
		}
		newTabs = append(newTabs, tab)
		root := ""
		if j < len(roots) {
			root = roots[j]
		}
		newRoots = append(newRoots, root)
	}
	return newTabs, newRoots
}

// repointActive computes the active pointer after slot n leaves a family that
// now holds newLen tabs: 0 when the family is empty (the caller unsets the
// option); active == n → min(n, newLen); active > n → active-1; active < n →
// unchanged.
func repointActive(active, n, newLen int) int {
	if newLen == 0 {
		return 0
	}
	switch {
	case active == n:
		return min(n, newLen)
	case active > n:
		return active - 1
	default:
		return active
	}
}

// webTabURLIdentical reports slot identity between a stored and an incoming
// URL: /present/ URLs compare by TARGET identity — window id, file name and
// server — because the slot index and the ?v= cache-buster embedded in the
// path/query legitimately differ between two computes of one target (a
// re-present must find its existing slot, not append a duplicate). The serve
// root completes /present/ identity and is compared by WebAdd, which holds
// both roots. Every other URL kind compares verbatim.
func webTabURLIdentical(stored, incoming string) bool {
	if stored == incoming {
		return true
	}
	sid, ok := presentTargetIdentity(stored)
	if !ok {
		return false
	}
	iid, ok := presentTargetIdentity(incoming)
	return ok && sid == iid
}

// presentTargetIdentity extracts the target identity of a /present/ URL:
// window id + name + query-minus-v. The slot segment (1..8) and the ?v=
// cache-buster are incidental to identity. ok=false for non-/present/ or
// unparseable URLs.
func presentTargetIdentity(raw string) (identity string, ok bool) {
	u, err := neturl.Parse(raw)
	if err != nil || !strings.HasPrefix(u.Path, "/present/") {
		return "", false
	}
	rest := strings.TrimPrefix(u.Path, "/present/")
	windowID, rest, found := strings.Cut(rest, "/")
	if !found {
		return "", false
	}
	segments := strings.Split(rest, "/")
	if len(segments) > 1 && webSlotSegment(segments[0]) {
		segments = segments[1:]
	}
	q := u.Query()
	q.Del("v")
	return windowID + "\n" + strings.Join(segments, "/") + "\n" + q.Encode(), true
}

// webSlotSegment reports whether a path segment is a web-tab slot index
// (mirrors the ^[1-8]$ gate — the /present/ route's sniff rule).
func webSlotSegment(segment string) bool {
	if len(segment) != 1 {
		return false
	}
	return segment[0] >= '1' && segment[0] <= '0'+MaxWebTabs
}

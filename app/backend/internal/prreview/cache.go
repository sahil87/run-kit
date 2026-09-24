package prreview

import (
	"container/list"
	"runtime/debug"
	"strings"
	"sync"
	"time"
)

const (
	// blobBudgetBytes is the token/blob cache ceiling. DAEMON-SIZED: rk is a
	// long-lived process with a ~20 MB-class idle footprint to protect, so the
	// budget is two orders below px0's 512 MB (px0 is a foreground tool you
	// close). 32 MiB holds roughly a 200-file PR's blobs plus their tokens.
	blobBudgetBytes = 32 << 20

	// blobIdleWindow is how long the cache must go untouched before a scavenge
	// drops it. The scavenge is LATCHED: one idle period costs one release, not
	// one per tick.
	blobIdleWindow = 60 * time.Second
)

// blobEntry is one cached source blob and, once the tier-2 background pass has
// run, its fully-lexed token spans.
//
// The key is (blobSha, path). Blob shas are IMMUTABLE, so unlike a
// path+mtime+size key this can never invalidate wrongly — a hit is always the
// exact bytes the sha names.
type blobEntry struct {
	lines []string
	// full is the whole-blob tier-2 result: full[i] are the spans for line
	// i+1. Nil until the background pass completes (or when the blob is over
	// refinePassByteCap and will never be refined).
	full [][]Span
	// refining latches the background pass so N concurrent windows over one
	// blob queue at most one goroutine.
	refining bool
	bytes    int64
}

type blobCache struct {
	mu        sync.Mutex
	budget    int64
	used      int64
	entries   map[string]*list.Element
	order     *list.List // front = least recently used
	lastUse   time.Time
	scavenged bool
}

type blobCacheItem struct {
	key   string
	entry *blobEntry
}

func newBlobCache(budget int64) *blobCache {
	return &blobCache{
		budget:  budget,
		entries: make(map[string]*list.Element),
		order:   list.New(),
	}
}

func blobKey(sha, path string) string { return sha + "\x00" + path }

func (c *blobCache) get(sha, path string) *blobEntry {
	if sha == "" {
		return nil
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lastUse = time.Now()
	c.scavenged = false
	element, ok := c.entries[blobKey(sha, path)]
	if !ok {
		return nil
	}
	c.order.MoveToBack(element)
	return element.Value.(*blobCacheItem).entry
}

func (c *blobCache) put(sha, path string, entry *blobEntry) {
	if sha == "" {
		return
	}
	key := blobKey(sha, path)
	c.mu.Lock()
	defer c.mu.Unlock()
	c.lastUse = time.Now()
	c.scavenged = false
	if element, ok := c.entries[key]; ok {
		item := element.Value.(*blobCacheItem)
		c.used -= item.entry.bytes
		item.entry = entry
		c.used += entry.bytes
		c.order.MoveToBack(element)
		c.evictLocked()
		return
	}
	element := c.order.PushBack(&blobCacheItem{key: key, entry: entry})
	c.entries[key] = element
	c.used += entry.bytes
	c.evictLocked()
}

// note records that an entry's byte footprint grew (the tier-2 pass attaching
// its spans), keeping the budget honest without a second insert path.
//
// The delta lands on the ENTRY as well as the running total: `evictLocked`
// subtracts `entry.bytes` when it drops one, so crediting only `used` would
// ratchet it upward on every refine and evict live entries early. `entry.bytes`
// is mutated under the cache lock, the same lock every other read of it holds.
func (c *blobCache) note(sha, path string, delta int64) {
	if sha == "" || delta == 0 {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	element, ok := c.entries[blobKey(sha, path)]
	if !ok {
		// The entry was evicted or scavenged while the pass ran; its spans go
		// with it, so the budget owes nothing.
		return
	}
	element.Value.(*blobCacheItem).entry.bytes += delta
	c.used += delta
	c.evictLocked()
}

func (c *blobCache) evictLocked() {
	for c.used > c.budget {
		front := c.order.Front()
		if front == nil {
			c.used = 0
			return
		}
		item := front.Value.(*blobCacheItem)
		c.order.Remove(front)
		delete(c.entries, item.key)
		c.used -= item.entry.bytes
	}
}

// scavenge drops the whole cache and returns its memory to the OS once per
// idle period. The latch is what keeps this from running on every tick: a
// touch clears it, so a busy cache never pays.
func (c *blobCache) scavenge(now time.Time) {
	c.mu.Lock()
	idle := !c.lastUse.IsZero() && now.Sub(c.lastUse) > blobIdleWindow
	if c.scavenged || !idle || len(c.entries) == 0 {
		c.mu.Unlock()
		return
	}
	c.entries = make(map[string]*list.Element)
	c.order = list.New()
	c.used = 0
	c.scavenged = true
	c.mu.Unlock()
	debug.FreeOSMemory()
}

// splitLines splits a blob into its lines WITHOUT the trailing newline, the
// shape both the lexer window and the context expander address by 1-based line
// number. A trailing newline does not produce an extra empty line.
func splitLines(content string) []string {
	if content == "" {
		return nil
	}
	trimmed := strings.TrimSuffix(content, "\n")
	return strings.Split(trimmed, "\n")
}

func entryBytes(lines []string) int64 {
	total := int64(0)
	for _, line := range lines {
		total += int64(len(line)) + 1
	}
	return total
}

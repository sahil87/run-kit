package metrics

import (
	"context"
	"fmt"
	"os"
	"sync"
	"syscall"
	"time"
)

const (
	ringSize = 60 // number of CPU samples in the ring buffer
)

// cpuTimes holds aggregate CPU time fields (or synthetic equivalents on non-Linux).
type cpuTimes struct {
	idle  uint64
	total uint64
}

// Collector gathers host-level system metrics in a background goroutine.
type Collector struct {
	mu       sync.RWMutex
	snapshot MetricsSnapshot

	prevCPU  cpuTimes
	ringBuf  []float64
	ringIdx  int
	hostname string
	cores    int

	pollInterval time.Duration
}

// NewCollector creates a metrics collector. Call Start to begin polling.
func NewCollector(pollInterval time.Duration) *Collector {
	hostname, _ := os.Hostname()

	c := &Collector{
		ringBuf:      make([]float64, ringSize),
		hostname:     hostname,
		pollInterval: pollInterval,
	}

	// Initialize CPU core count and baseline reading
	c.cores = readCPUCores()
	c.prevCPU = readCPUTimes()

	// Pre-fill snapshot with zeros so the first Snapshot() call is valid
	c.snapshot = MetricsSnapshot{
		Hostname: hostname,
		CPU: CPUMetrics{
			Samples: make([]float64, ringSize),
			Cores:   c.cores,
		},
		Load: LoadMetrics{
			CPUs: c.cores,
		},
	}

	return c
}

// Start begins the background polling goroutine. It exits when ctx is cancelled.
func (c *Collector) Start(ctx context.Context) {
	go c.poll(ctx)
}

// Snapshot returns a consistent copy of the current metrics.
func (c *Collector) Snapshot() MetricsSnapshot {
	c.mu.RLock()
	defer c.mu.RUnlock()

	// Deep copy the CPU samples slice to avoid data races
	snap := c.snapshot
	snap.CPU.Samples = make([]float64, ringSize)
	copy(snap.CPU.Samples, c.snapshot.CPU.Samples)
	return snap
}

func (c *Collector) poll(ctx context.Context) {
	ticker := time.NewTicker(c.pollInterval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			c.collect()
		}
	}
}

func (c *Collector) collect() {
	cpu := c.collectCPU()
	mem := readMemory()
	load := readLoad()
	disk := readDisk()
	uptime := readUptime()

	c.mu.Lock()
	defer c.mu.Unlock()

	c.snapshot = MetricsSnapshot{
		Hostname: c.hostname,
		CPU: CPUMetrics{
			Samples: c.samplesSnapshot(),
			Current: cpu,
			Cores:   c.cores,
		},
		Memory: mem,
		Load: LoadMetrics{
			Avg1:  load.Avg1,
			Avg5:  load.Avg5,
			Avg15: load.Avg15,
			CPUs:  c.cores,
		},
		Disk:       disk,
		UptimeSecs: uptime,
	}
}

// collectCPU reads CPU times, computes usage delta, and appends to ring buffer.
func (c *Collector) collectCPU() float64 {
	cur := readCPUTimes()
	if cur.total == 0 {
		return 0
	}

	totalDelta := cur.total - c.prevCPU.total
	idleDelta := cur.idle - c.prevCPU.idle
	c.prevCPU = cur

	var pct float64
	if totalDelta > 0 {
		pct = float64(totalDelta-idleDelta) / float64(totalDelta) * 100
		if pct < 0 {
			pct = 0
		}
		if pct > 100 {
			pct = 100
		}
	}

	c.ringBuf[c.ringIdx] = pct
	c.ringIdx = (c.ringIdx + 1) % ringSize

	return pct
}

// samplesSnapshot returns the ring buffer contents in chronological order.
// Must be called under c.mu.Lock.
func (c *Collector) samplesSnapshot() []float64 {
	out := make([]float64, ringSize)
	for i := 0; i < ringSize; i++ {
		out[i] = c.ringBuf[(c.ringIdx+i)%ringSize]
	}
	return out
}

// readDisk uses syscall.Statfs on "/" to get disk usage (cross-platform).
func readDisk() DiskMetrics {
	var stat syscall.Statfs_t
	if err := syscall.Statfs("/", &stat); err != nil {
		return DiskMetrics{}
	}

	total := stat.Blocks * uint64(stat.Bsize)
	free := stat.Bavail * uint64(stat.Bsize)
	var used uint64
	if total > free {
		used = total - free
	}

	return DiskMetrics{
		Used:  used,
		Total: total,
	}
}

// FormatSnapshot formats a MetricsSnapshot as a debug string (for logging).
func FormatSnapshot(s MetricsSnapshot) string {
	return fmt.Sprintf("host=%s cpu=%.1f%% mem=%d/%d load=%.2f/%.2f/%.2f disk=%d/%d up=%.0fs",
		s.Hostname, s.CPU.Current, s.Memory.Used, s.Memory.Total,
		s.Load.Avg1, s.Load.Avg5, s.Load.Avg15,
		s.Disk.Used, s.Disk.Total, s.UptimeSecs)
}

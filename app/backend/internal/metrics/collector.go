package metrics

import (
	"bufio"
	"context"
	"fmt"
	"os"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

const (
	ringSize = 60 // number of CPU samples in the ring buffer
)

// cpuTimes holds aggregate CPU time fields from /proc/stat.
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

// collectCPU reads /proc/stat, computes usage delta, and appends to ring buffer.
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

// --- procfs readers (return zero values on non-Linux) ---

// readCPUTimes parses the aggregate cpu line from /proc/stat.
func readCPUTimes() cpuTimes {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return cpuTimes{}
	}
	defer f.Close()

	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "cpu ") {
			return parseCPULine(line)
		}
	}
	return cpuTimes{}
}

func parseCPULine(line string) cpuTimes {
	fields := strings.Fields(line)
	if len(fields) < 5 {
		return cpuTimes{}
	}

	var total, idle uint64
	for i, f := range fields[1:] {
		v, err := strconv.ParseUint(f, 10, 64)
		if err != nil {
			continue
		}
		total += v
		if i == 3 { // field index 3 = idle
			idle = v
		}
	}
	return cpuTimes{idle: idle, total: total}
}

// readCPUCores counts cpu\d+ lines in /proc/stat.
func readCPUCores() int {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 1 // safe default
	}
	defer f.Close()

	count := 0
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		line := scanner.Text()
		// Lines like "cpu0", "cpu1", ... (not the aggregate "cpu " line)
		if len(line) > 3 && line[0:3] == "cpu" && line[3] >= '0' && line[3] <= '9' {
			count++
		}
	}
	if count == 0 {
		return 1
	}
	return count
}

// readMemory parses /proc/meminfo for MemTotal and MemAvailable.
func readMemory() MemoryMetrics {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return MemoryMetrics{}
	}
	defer f.Close()

	var total, available uint64
	found := 0

	scanner := bufio.NewScanner(f)
	for scanner.Scan() && found < 2 {
		line := scanner.Text()
		if strings.HasPrefix(line, "MemTotal:") {
			total = parseMemInfoKB(line)
			found++
		} else if strings.HasPrefix(line, "MemAvailable:") {
			available = parseMemInfoKB(line)
			found++
		}
	}

	totalBytes := total * 1024
	availBytes := available * 1024
	var used uint64
	if totalBytes > availBytes {
		used = totalBytes - availBytes
	}

	return MemoryMetrics{
		Used:  used,
		Total: totalBytes,
	}
}

func parseMemInfoKB(line string) uint64 {
	fields := strings.Fields(line)
	if len(fields) < 2 {
		return 0
	}
	v, err := strconv.ParseUint(fields[1], 10, 64)
	if err != nil {
		return 0
	}
	return v
}

// readLoad parses /proc/loadavg for 1/5/15 minute averages.
func readLoad() LoadMetrics {
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return LoadMetrics{}
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return LoadMetrics{}
	}

	avg1, _ := strconv.ParseFloat(fields[0], 64)
	avg5, _ := strconv.ParseFloat(fields[1], 64)
	avg15, _ := strconv.ParseFloat(fields[2], 64)

	return LoadMetrics{
		Avg1:  avg1,
		Avg5:  avg5,
		Avg15: avg15,
	}
}

// readDisk uses syscall.Statfs on "/" to get disk usage.
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

// readUptime parses /proc/uptime for system uptime in seconds.
func readUptime() float64 {
	data, err := os.ReadFile("/proc/uptime")
	if err != nil {
		return 0
	}
	fields := strings.Fields(string(data))
	if len(fields) < 1 {
		return 0
	}
	v, err := strconv.ParseFloat(fields[0], 64)
	if err != nil {
		return 0
	}
	return v
}

// FormatSnapshot formats a MetricsSnapshot as a debug string (for logging).
func FormatSnapshot(s MetricsSnapshot) string {
	return fmt.Sprintf("host=%s cpu=%.1f%% mem=%d/%d load=%.2f/%.2f/%.2f disk=%d/%d up=%.0fs",
		s.Hostname, s.CPU.Current, s.Memory.Used, s.Memory.Total,
		s.Load.Avg1, s.Load.Avg5, s.Load.Avg15,
		s.Disk.Used, s.Disk.Total, s.UptimeSecs)
}

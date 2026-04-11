package metrics

// MetricsSnapshot holds a point-in-time snapshot of host-level system metrics.
type MetricsSnapshot struct {
	Hostname   string        `json:"hostname"`
	CPU        CPUMetrics    `json:"cpu"`
	Memory     MemoryMetrics `json:"memory"`
	Load       LoadMetrics   `json:"load"`
	Disk       DiskMetrics   `json:"disk"`
	UptimeSecs float64       `json:"uptime"`
}

// CPUMetrics holds CPU usage data including a ring buffer of recent samples.
type CPUMetrics struct {
	Samples []float64 `json:"samples"` // ring buffer, 60 entries
	Current float64   `json:"current"` // latest percentage 0-100
	Cores   int       `json:"cores"`   // logical CPU count
}

// MemoryMetrics holds memory usage in bytes.
type MemoryMetrics struct {
	Used  uint64 `json:"used"`  // bytes
	Total uint64 `json:"total"` // bytes
}

// LoadMetrics holds system load averages and CPU count for normalization.
type LoadMetrics struct {
	Avg1  float64 `json:"avg1"`
	Avg5  float64 `json:"avg5"`
	Avg15 float64 `json:"avg15"`
	CPUs  int     `json:"cpus"` // same as CPU.Cores, for frontend normalization
}

// DiskMetrics holds root filesystem usage in bytes.
type DiskMetrics struct {
	Used  uint64 `json:"used"`  // bytes
	Total uint64 `json:"total"` // bytes
}

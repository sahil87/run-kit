//go:build linux

package metrics

import (
	"bufio"
	"os"
	"strconv"
	"strings"
)

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

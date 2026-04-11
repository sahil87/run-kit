//go:build darwin

package metrics

import (
	"bufio"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

// Synthetic CPU time counters for the cpuTimes delta computation.
// Only accessed from the single poll goroutine (and once from NewCollector
// before Start), so no synchronization needed.
var (
	darwinSyntheticTotal uint64
	darwinSyntheticIdle  uint64
)

// readCPUCores returns the number of logical CPUs.
func readCPUCores() int {
	return runtime.NumCPU()
}

// readCPUTimes synthesizes cumulative cpuTimes from macOS ps output.
// The delta between consecutive calls produces an accurate CPU usage percentage.
func readCPUTimes() cpuTimes {
	out, err := exec.Command("ps", "-axo", "%cpu").Output()
	if err != nil {
		darwinSyntheticTotal += 1000
		darwinSyntheticIdle += 1000
		return cpuTimes{idle: darwinSyntheticIdle, total: darwinSyntheticTotal}
	}

	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	var totalCPU float64
	for _, line := range lines[1:] { // skip header
		if v, err := strconv.ParseFloat(strings.TrimSpace(line), 64); err == nil {
			totalCPU += v
		}
	}

	cores := float64(runtime.NumCPU())
	if cores < 1 {
		cores = 1
	}
	usedPct := totalCPU / cores
	if usedPct > 100 {
		usedPct = 100
	}
	idlePct := 100 - usedPct

	darwinSyntheticTotal += 1000
	darwinSyntheticIdle += uint64(idlePct * 10)

	return cpuTimes{idle: darwinSyntheticIdle, total: darwinSyntheticTotal}
}

// readMemory gets memory stats from sysctl and vm_stat.
func readMemory() MemoryMetrics {
	totalOut, err := exec.Command("sysctl", "-n", "hw.memsize").Output()
	if err != nil {
		return MemoryMetrics{}
	}
	total, err := strconv.ParseUint(strings.TrimSpace(string(totalOut)), 10, 64)
	if err != nil {
		return MemoryMetrics{}
	}

	vmOut, err := exec.Command("vm_stat").Output()
	if err != nil {
		return MemoryMetrics{Total: total}
	}

	pageSize := uint64(16384) // default macOS ARM page size
	var free, inactive, purgeable uint64

	scanner := bufio.NewScanner(strings.NewReader(string(vmOut)))
	for scanner.Scan() {
		line := scanner.Text()
		if strings.HasPrefix(line, "Mach Virtual Memory Statistics: (page size of ") {
			s := strings.TrimPrefix(line, "Mach Virtual Memory Statistics: (page size of ")
			s = strings.TrimSuffix(s, " bytes)")
			if v, err := strconv.ParseUint(s, 10, 64); err == nil {
				pageSize = v
			}
			continue
		}
		if v, ok := parseVMStatLine(line, "Pages free:"); ok {
			free = v
		} else if v, ok := parseVMStatLine(line, "Pages inactive:"); ok {
			inactive = v
		} else if v, ok := parseVMStatLine(line, "Pages purgeable:"); ok {
			purgeable = v
		}
	}

	available := (free + inactive + purgeable) * pageSize
	var used uint64
	if total > available {
		used = total - available
	}

	return MemoryMetrics{Used: used, Total: total}
}

func parseVMStatLine(line, prefix string) (uint64, bool) {
	if !strings.HasPrefix(line, prefix) {
		return 0, false
	}
	s := strings.TrimPrefix(line, prefix)
	s = strings.TrimSpace(s)
	s = strings.TrimSuffix(s, ".")
	v, err := strconv.ParseUint(s, 10, 64)
	if err != nil {
		return 0, false
	}
	return v, true
}

// readLoad parses load averages from sysctl.
func readLoad() LoadMetrics {
	out, err := exec.Command("sysctl", "-n", "vm.loadavg").Output()
	if err != nil {
		return LoadMetrics{}
	}

	// Output: "{ 2.47 2.00 1.66 }"
	s := strings.TrimSpace(string(out))
	s = strings.Trim(s, "{ }")
	fields := strings.Fields(s)
	if len(fields) < 3 {
		return LoadMetrics{}
	}

	avg1, _ := strconv.ParseFloat(fields[0], 64)
	avg5, _ := strconv.ParseFloat(fields[1], 64)
	avg15, _ := strconv.ParseFloat(fields[2], 64)

	return LoadMetrics{Avg1: avg1, Avg5: avg5, Avg15: avg15}
}

// readUptime computes uptime from boot time via sysctl.
func readUptime() float64 {
	out, err := exec.Command("sysctl", "-n", "kern.boottime").Output()
	if err != nil {
		return 0
	}

	// Output: "{ sec = 1712345678, usec = 123456 } Thu Apr 10 12:34:56 2025"
	s := string(out)
	idx := strings.Index(s, "sec = ")
	if idx < 0 {
		return 0
	}
	s = s[idx+6:]
	endIdx := strings.Index(s, ",")
	if endIdx < 0 {
		return 0
	}

	bootSec, err := strconv.ParseInt(s[:endIdx], 10, 64)
	if err != nil {
		return 0
	}

	return float64(time.Now().Unix() - bootSec)
}

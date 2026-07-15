//go:build darwin

package ports

import (
	"context"
	"sort"
)

// readListeningPorts enumerates listening TCP ports on macOS via lsof. procfs
// (/proc/net/tcp) does not exist on Darwin, so unlike the Linux path this shells
// out — lsof is the sole enumeration source here (lsof is preinstalled on
// macOS), whereas Linux uses lsof only to attribute the procfs-derived port set.
// The run-lsof sequence (bounded ctx → lsofRun → degrade on empty output →
// parseLsof) is shared via lsofAttribution(); any error (lsof missing, timeout,
// no listeners) degrades to an empty map there, mirroring the collector's
// zero-on-error discipline. Here that map IS the enumeration, so we build the
// port-sorted slice directly from it (empty map → empty non-nil slice). Unlike
// Linux, lsof yields process attribution for free, so Service.Process/PID are
// populated.
func readListeningPorts(ctx context.Context) []Service {
	byPort := lsofAttribution(ctx)
	services := make([]Service, 0, len(byPort))
	for _, svc := range byPort {
		services = append(services, svc)
	}
	sort.Slice(services, func(i, j int) bool {
		return services[i].Port < services[j].Port
	})
	return services
}

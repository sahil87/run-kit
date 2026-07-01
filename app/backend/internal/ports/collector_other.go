//go:build !linux

package ports

// readListeningPorts returns an empty slice on non-Linux hosts (graceful zero,
// exactly like metrics/collector_darwin.go's degraded returns). Listening-port
// enumeration is Linux-only in v1; other platforms surface no services rather
// than crashing or erroring.
func readListeningPorts() []Service {
	return []Service{}
}

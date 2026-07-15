//go:build !linux && !darwin

package ports

import "context"

// readListeningPorts returns an empty slice on platforms with no port-discovery
// implementation (Windows, *BSD, etc.). Linux reads procfs (collector_linux.go);
// macOS shells out to lsof (collector_darwin.go). Everywhere else surfaces no
// services rather than crashing or erroring — graceful zero, matching the
// collector's zero-on-error discipline. The ctx is unused here (no subprocess)
// but kept to satisfy the readListeningPortsFn seam signature.
func readListeningPorts(_ context.Context) []Service {
	return []Service{}
}

package remote

import "fmt"

// The reserved local-port range for tunnel origins. Deliberately clear of the
// dev/e2e ports (3000/3020/3333) and small enough to stay out of ephemeral
// ranges. A port is assigned once at add-time and is immutable thereafter.
const (
	// PortRangeStart is the first assignable local tunnel port.
	PortRangeStart = 3100
	// PortRangeEnd is the last assignable local tunnel port (inclusive).
	PortRangeEnd = 3199
)

// AssignPort picks the local port for a new remote. taken is the host's
// current live listener set (ports.ListeningNow at the call boundary);
// explicit is a user-requested port (0 = auto-assign).
//
// Auto-assignment returns the lowest port in [PortRangeStart, PortRangeEnd]
// that no remotes.yaml entry holds and no live listener occupies. An explicit
// port must fall inside the range and pass the same two collision checks —
// the reserved-range guarantee holds for explicit picks too.
func AssignPort(f File, taken []int, explicit int) (int, error) {
	inUse := make(map[int]bool, len(f.Remotes)+len(taken))
	for _, r := range f.Remotes {
		inUse[r.LocalPort] = true
	}
	live := make(map[int]bool, len(taken))
	for _, p := range taken {
		live[p] = true
	}

	if explicit != 0 {
		if explicit < PortRangeStart || explicit > PortRangeEnd {
			return 0, fmt.Errorf("--local-port %d is outside the reserved range %d-%d", explicit, PortRangeStart, PortRangeEnd)
		}
		if inUse[explicit] {
			return 0, fmt.Errorf("--local-port %d is already assigned to another remote", explicit)
		}
		if live[explicit] {
			return 0, fmt.Errorf("--local-port %d is already in use by a listening process", explicit)
		}
		return explicit, nil
	}

	for p := PortRangeStart; p <= PortRangeEnd; p++ {
		if !inUse[p] && !live[p] {
			return p, nil
		}
	}
	return 0, fmt.Errorf("no free local port in the reserved range %d-%d", PortRangeStart, PortRangeEnd)
}

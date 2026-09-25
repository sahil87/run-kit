package main

import (
	"rk/internal/config"
	"rk/internal/portpolicy"
)

// reservedCollisions is the one collision read shared by serve's startup
// warning, the doctor ports row, and `rk ports`, so the three surfaces never
// disagree. Dev builds (version == "dev": just dev/air and the e2e rig's
// un-ldflagged go build) drop ONLY the rig block — worktree dev servers and
// e2e rigs sit on rig-block ports by design, so warning there would fire on
// every dev loop with advice that does not apply. Tunnel and sentinel hits
// warn on every build. Tests flip the root.go `version` var directly.
func reservedCollisions(cfg config.Config) []portpolicy.Block {
	hits := portpolicy.Collisions(cfg.Port, cfg.ResolvedCodeServerPort())
	if version != "dev" {
		return hits
	}
	out := hits[:0]
	for _, b := range hits {
		if b.Name != portpolicy.Rig.Name {
			out = append(out, b)
		}
	}
	return out
}

package codebridge

import (
	"strconv"
	"strings"
)

// OlderThan reports whether version a is older than version b by numeric
// component compare ("3.18.1" < "3.19.0"). Components are parsed as their
// leading digits only, so non-numeric tails ("0.0.0-dev") degrade to the
// numeric prefix instead of failing; missing components count as 0; a
// leading "v" is ignored. Equal versions are not "older".
func OlderThan(a, b string) bool {
	pa, pb := versionParts(a), versionParts(b)
	for i := 0; i < max(len(pa), len(pb)); i++ {
		va, vb := 0, 0
		if i < len(pa) {
			va = pa[i]
		}
		if i < len(pb) {
			vb = pb[i]
		}
		if va != vb {
			return va < vb
		}
	}
	return false
}

func versionParts(v string) []int {
	parts := strings.Split(strings.TrimPrefix(v, "v"), ".")
	out := make([]int, len(parts))
	for i, p := range parts {
		digits := 0
		for digits < len(p) && p[digits] >= '0' && p[digits] <= '9' {
			digits++
		}
		n, _ := strconv.Atoi(p[:digits]) // empty (no leading digits) → 0
		out[i] = n
	}
	return out
}

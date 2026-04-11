//go:build linux

package metrics

import "testing"

func TestParseCPULine(t *testing.T) {
	// Real-world /proc/stat first line
	line := "cpu  10132153 290696 3084719 46828483 16683 0 25195 0 0 0"
	ct := parseCPULine(line)

	if ct.total == 0 {
		t.Error("expected non-zero total")
	}
	if ct.idle == 0 {
		t.Error("expected non-zero idle")
	}
	if ct.idle >= ct.total {
		t.Errorf("idle (%d) should be less than total (%d)", ct.idle, ct.total)
	}
}

func TestParseCPULine_Short(t *testing.T) {
	ct := parseCPULine("cpu ")
	if ct.total != 0 || ct.idle != 0 {
		t.Error("expected zero values for short line")
	}
}

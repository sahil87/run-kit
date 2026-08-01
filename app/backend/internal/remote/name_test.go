package remote

import (
	"strings"
	"testing"
)

func TestDefaultName(t *testing.T) {
	tests := []struct {
		target string
		want   string
	}{
		{"buildbox", "buildbox"},                         // bare alias
		{"sahil@buildbox", "buildbox"},                   // user@host
		{"sahil@build.example.com", "build-example-com"}, // dots → hyphens
		{"a@b@c-host", "c-host"},                         // last '@' wins
		{"10.0.0.7", "10-0-0-7"},                         // bare IP
	}
	for _, tt := range tests {
		got, err := DefaultName(tt.target)
		if err != nil {
			t.Errorf("DefaultName(%q) error = %v", tt.target, err)
			continue
		}
		if got != tt.want {
			t.Errorf("DefaultName(%q) = %q, want %q", tt.target, got, tt.want)
		}
	}
}

func TestDefaultName_UnderivableErrorsWithNameHint(t *testing.T) {
	// A trailing '@' leaves an empty host token — nothing valid to derive.
	_, err := DefaultName("sahil@")
	if err == nil || !strings.Contains(err.Error(), "--name") {
		t.Errorf("DefaultName(\"sahil@\") error = %v, want --name hint", err)
	}
}

func TestAssignPort_AutoLowestFree(t *testing.T) {
	f := File{Version: 1, Remotes: []Remote{
		{Name: "a", Target: "a", LocalPort: 3100},
		{Name: "b", Target: "b", LocalPort: 3101},
	}}
	// 3102 is squatted by a live listener → 3103 is the lowest free.
	got, err := AssignPort(f, []int{3102, 8080}, 0)
	if err != nil {
		t.Fatalf("AssignPort error = %v", err)
	}
	if got != 3103 {
		t.Errorf("AssignPort = %d, want 3103", got)
	}
}

func TestAssignPort_EmptyStoreStartsAtRangeStart(t *testing.T) {
	got, err := AssignPort(emptyFile(), nil, 0)
	if err != nil {
		t.Fatalf("AssignPort error = %v", err)
	}
	if got != PortRangeStart {
		t.Errorf("AssignPort = %d, want %d", got, PortRangeStart)
	}
}

func TestAssignPort_Explicit(t *testing.T) {
	f := File{Version: 1, Remotes: []Remote{{Name: "a", Target: "a", LocalPort: 3100}}}

	if got, err := AssignPort(f, nil, 3150); err != nil || got != 3150 {
		t.Errorf("explicit in-range = (%d, %v), want (3150, nil)", got, err)
	}
	if _, err := AssignPort(f, nil, 3050); err == nil || !strings.Contains(err.Error(), "reserved range") {
		t.Errorf("explicit below range error = %v, want range error", err)
	}
	if _, err := AssignPort(f, nil, 3200); err == nil || !strings.Contains(err.Error(), "reserved range") {
		t.Errorf("explicit above range error = %v, want range error", err)
	}
	if _, err := AssignPort(f, nil, 3100); err == nil || !strings.Contains(err.Error(), "another remote") {
		t.Errorf("explicit store collision error = %v, want assigned-elsewhere error", err)
	}
	if _, err := AssignPort(f, []int{3150}, 3150); err == nil || !strings.Contains(err.Error(), "listening process") {
		t.Errorf("explicit live collision error = %v, want listener error", err)
	}
}

func TestAssignPort_Exhausted(t *testing.T) {
	f := emptyFile()
	for p := PortRangeStart; p <= PortRangeEnd; p++ {
		f.Remotes = append(f.Remotes, Remote{Name: "r", Target: "t", LocalPort: p})
	}
	if _, err := AssignPort(f, nil, 0); err == nil || !strings.Contains(err.Error(), "no free local port") {
		t.Errorf("exhausted error = %v, want no-free-port error", err)
	}
}

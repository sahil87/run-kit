package remote

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLoad_MissingFileIsEmptyV1(t *testing.T) {
	f, err := Load(filepath.Join(t.TempDir(), "remotes.yaml"))
	if err != nil {
		t.Fatalf("Load(missing) error = %v, want nil", err)
	}
	if f.Version != storeVersion {
		t.Errorf("Version = %d, want %d", f.Version, storeVersion)
	}
	if len(f.Remotes) != 0 {
		t.Errorf("Remotes = %v, want empty", f.Remotes)
	}
}

func TestSaveLoad_RoundTripCreatesDir(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".config", "rk", "remotes.yaml")
	in := File{Version: storeVersion, Remotes: []Remote{
		{Name: "buildbox", Target: "sahil@buildbox", LocalPort: 3100},
		{Name: "vm2", Target: "vm2", LocalPort: 3101},
	}}
	if err := Save(path, in); err != nil {
		t.Fatalf("Save() error = %v", err)
	}
	got, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(got.Remotes) != 2 || got.Remotes[0] != in.Remotes[0] || got.Remotes[1] != in.Remotes[1] {
		t.Errorf("round-trip = %+v, want %+v", got.Remotes, in.Remotes)
	}
	// No tmp litter left behind after the atomic rename.
	entries, err := os.ReadDir(filepath.Dir(path))
	if err != nil {
		t.Fatalf("ReadDir: %v", err)
	}
	if len(entries) != 1 || entries[0].Name() != "remotes.yaml" {
		t.Errorf("store dir entries = %v, want only remotes.yaml", entries)
	}
}

func TestLoad_MalformedAndWrongVersionError(t *testing.T) {
	dir := t.TempDir()

	bad := filepath.Join(dir, "bad.yaml")
	if err := os.WriteFile(bad, []byte(":\n\t- not yaml"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := Load(bad); err == nil {
		t.Error("Load(malformed) = nil error, want parse error")
	}

	v2 := filepath.Join(dir, "v2.yaml")
	if err := os.WriteFile(v2, []byte("version: 2\nremotes: []\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	_, err := Load(v2)
	if err == nil || !strings.Contains(err.Error(), "unsupported version") {
		t.Errorf("Load(v2) error = %v, want unsupported-version error", err)
	}
}

func TestLoad_RejectsHostileStoredEntries(t *testing.T) {
	// remotes.yaml is a user-editable input boundary: entries validated at
	// add-time can be replaced by hand with hostile values, so Load — the
	// seam every verb reads through — must re-validate (Constitution I).
	cases := []struct {
		name string
		yaml string
	}{
		{
			"flag-injection target",
			"version: 1\nremotes:\n  - name: buildbox\n    target: \"-oProxyCommand=touch /tmp/pwned\"\n    local_port: 3100\n",
		},
		{
			"whitespace-bearing target",
			"version: 1\nremotes:\n  - name: buildbox\n    target: \"host -oProxyCommand=evil\"\n    local_port: 3100\n",
		},
		{
			"flag-injection name",
			"version: 1\nremotes:\n  - name: \"-evil\"\n    target: sahil@buildbox\n    local_port: 3100\n",
		},
		{
			"tmux-metacharacter name",
			"version: 1\nremotes:\n  - name: \"bad;name\"\n    target: sahil@buildbox\n    local_port: 3100\n",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "remotes.yaml")
			if err := os.WriteFile(path, []byte(tc.yaml), 0o644); err != nil {
				t.Fatal(err)
			}
			_, err := Load(path)
			if err == nil || !strings.Contains(err.Error(), "invalid") {
				t.Errorf("Load error = %v, want invalid-entry rejection", err)
			}
		})
	}
}

func TestLoad_RejectsOutOfRangeLocalPort(t *testing.T) {
	// The reserved range is a write-path rule in AssignPort; the read path
	// enforces it too, so a hand-edited port cannot reach Origin(), a TCP
	// dial, or the ssh -L forward spec.
	cases := []struct {
		name string
		port string
	}{
		{"zero", "0"},
		{"negative", "-1"},
		{"below range", "3099"},
		{"above range", "3200"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "remotes.yaml")
			y := "version: 1\nremotes:\n  - name: buildbox\n    target: sahil@buildbox\n    local_port: " + tc.port + "\n"
			if err := os.WriteFile(path, []byte(y), 0o644); err != nil {
				t.Fatal(err)
			}
			_, err := Load(path)
			if err == nil || !strings.Contains(err.Error(), "outside the reserved range") {
				t.Errorf("Load error = %v, want out-of-range rejection", err)
			}
		})
	}
}

func TestFile_Lookups(t *testing.T) {
	f := File{Version: 1, Remotes: []Remote{
		{Name: "buildbox", Target: "sahil@buildbox", LocalPort: 3100},
		{Name: "vm2", Target: "vm2", LocalPort: 3101},
	}}

	if r := f.FindByName("buildbox"); r == nil || r.LocalPort != 3100 {
		t.Errorf("FindByName(buildbox) = %+v, want the 3100 entry", r)
	}
	if r := f.FindByTarget("vm2"); r == nil || r.Name != "vm2" {
		t.Errorf("FindByTarget(vm2) = %+v, want the vm2 entry", r)
	}
	// Find prefers the name match: "vm2" is both a name and a target here.
	if r := f.Find("vm2"); r == nil || r.Name != "vm2" {
		t.Errorf("Find(vm2) = %+v, want name match", r)
	}
	if r := f.Find("sahil@buildbox"); r == nil || r.Name != "buildbox" {
		t.Errorf("Find(target) = %+v, want target fallback match", r)
	}
	if r := f.Find("nope"); r != nil {
		t.Errorf("Find(nope) = %+v, want nil", r)
	}
}

func TestFile_Remove(t *testing.T) {
	f := File{Version: 1, Remotes: []Remote{
		{Name: "a", Target: "a", LocalPort: 3100},
		{Name: "b", Target: "b", LocalPort: 3101},
	}}
	out, removed := f.Remove("a")
	if !removed || len(out.Remotes) != 1 || out.Remotes[0].Name != "b" {
		t.Errorf("Remove(a) = (%+v, %v), want b-only list", out.Remotes, removed)
	}
	out, removed = f.Remove("missing")
	if removed || len(out.Remotes) != 2 {
		t.Errorf("Remove(missing) = (%+v, %v), want unchanged list", out.Remotes, removed)
	}
}

func TestRemote_Origin(t *testing.T) {
	r := Remote{Name: "x", Target: "x", LocalPort: 3105}
	if got := r.Origin(); got != "http://127.0.0.1:3105" {
		t.Errorf("Origin() = %q", got)
	}
}

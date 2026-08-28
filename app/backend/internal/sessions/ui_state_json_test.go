package sessions

import (
	"encoding/json"
	"strings"
	"testing"

	"rk/internal/tmux"
)

// TestWindowUIStateJSON pins the shared-tab-state JSON shape: layout, the
// web-tab family, and the code root ride one marshal; empty values omit
// everything.
func TestWindowUIStateJSON(t *testing.T) {
	w := tmux.WindowInfo{
		Layout:    "single:web",
		WebTabs:   []string{"/proxy/3000/"},
		WebActive: 1,
		CodeRoot:  "/w",
	}
	out, err := json.Marshal(w)
	if err != nil {
		t.Fatal(err)
	}
	s := string(out)
	for _, want := range []string{
		`"layout":"single:web"`, `"webTabs":["/proxy/3000/"]`, `"webActive":1`,
		`"codeRoot":"/w"`,
	} {
		if !strings.Contains(s, want) {
			t.Errorf("JSON missing %s: %s", want, s)
		}
	}

	empty, err := json.Marshal(tmux.WindowInfo{})
	if err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"layout", "webTabs", "webActive", "codeRoot"} {
		if strings.Contains(string(empty), `"`+key+`"`) {
			t.Errorf("empty window JSON carries %q: %s", key, empty)
		}
	}
}

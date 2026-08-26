package codebridge

import (
	"reflect"
	"testing"
)

var suggestPool = []string{
	"pr.checkout",
	"pr.checkoutByNumber",
	"pr.refreshList",
	"vscode.open",
	"workbench.action.terminal.sendSequence",
}

func TestClosestPrefixRanksFirst(t *testing.T) {
	got := Closest("pr.checkot", suggestPool, 3)
	want := []string{"pr.checkout", "pr.checkoutByNumber", "pr.refreshList"}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("Closest = %v, want %v", got, want)
	}
}

func TestClosestExactMatchFirst(t *testing.T) {
	got := Closest("pr.checkout", suggestPool, 2)
	if len(got) == 0 || got[0] != "pr.checkout" {
		t.Errorf("Closest exact = %v", got)
	}
}

func TestClosestSubstringBeatsEditDistance(t *testing.T) {
	// "refresh" is a substring of pr.refreshList; everything else only has an
	// edit distance to it.
	got := Closest("refresh", suggestPool, 2)
	if len(got) == 0 || got[0] != "pr.refreshList" {
		t.Errorf("Closest substring = %v", got)
	}
}

func TestClosestRespectsN(t *testing.T) {
	if got := Closest("pr", suggestPool, 2); len(got) != 2 {
		t.Errorf("Closest(n=2) returned %d: %v", len(got), got)
	}
	if got := Closest("pr", suggestPool, 100); len(got) != len(suggestPool) {
		t.Errorf("Closest(n>len) returned %d: %v", len(got), got)
	}
	if got := Closest("pr", suggestPool, 0); got != nil {
		t.Errorf("Closest(n=0) = %v, want nil", got)
	}
}

func TestClosestCaseInsensitive(t *testing.T) {
	got := Closest("PR.CHECKOUT", suggestPool, 1)
	if len(got) == 0 || got[0] != "pr.checkout" {
		t.Errorf("Closest case-insensitive = %v", got)
	}
}

func TestClosestEmptyPool(t *testing.T) {
	if got := Closest("x", nil, 5); len(got) != 0 {
		t.Errorf("Closest over empty pool = %v", got)
	}
}

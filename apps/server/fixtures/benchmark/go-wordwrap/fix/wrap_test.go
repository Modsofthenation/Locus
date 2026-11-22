package wordwrap

import (
	"reflect"
	"testing"
)

func TestEmpty(t *testing.T) {
	if got := Wrap("   ", 10); len(got) != 0 {
		t.Fatalf("Wrap(blank) = %q, want no lines", got)
	}
}

func TestIndent(t *testing.T) {
	got := Indent([]string{"a", "b"}, "  ")
	want := []string{"  a", "  b"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Indent = %q, want %q", got, want)
	}
}

func TestKeepsLastLine(t *testing.T) {
	got := Wrap("the quick brown fox", 10)
	want := []string{"the quick", "brown fox"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Wrap = %q, want %q", got, want)
	}
}

func TestExactWidth(t *testing.T) {
	got := Wrap("abcd efghi jk", 10)
	want := []string{"abcd efghi", "jk"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Wrap = %q, want %q", got, want)
	}
}

func TestLongWord(t *testing.T) {
	got := Wrap("a supercalifragilistic word", 8)
	want := []string{"a", "supercalifragilistic", "word"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("Wrap = %q, want %q", got, want)
	}
}

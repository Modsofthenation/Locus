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

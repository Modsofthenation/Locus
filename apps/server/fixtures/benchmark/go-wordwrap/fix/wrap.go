// Package wordwrap breaks text into lines for the terminal help printer.
package wordwrap

import "strings"

// Wrap splits s on whitespace and packs the words into lines of at most width
// characters. A word longer than width gets a line of its own.
func Wrap(s string, width int) []string {
	var lines []string
	line := ""
	for _, word := range strings.Fields(s) {
		if line == "" {
			line = word
			continue
		}
		if len(line)+1+len(word) <= width {
			line += " " + word
			continue
		}
		lines = append(lines, line)
		line = word
	}
	if line != "" {
		lines = append(lines, line)
	}
	return lines
}

// Indent prefixes every line with pad.
func Indent(lines []string, pad string) []string {
	out := make([]string, len(lines))
	for i, l := range lines {
		out[i] = pad + l
	}
	return out
}

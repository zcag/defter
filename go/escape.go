package defterparse

import "strings"

// escapeCell converts a cell's logical text (real characters, as stored in the
// model) into the serialized form that is safe inside a single `|`-delimited,
// one-line table row.
//
// Rules (applied in this order, matching the TS reference escape.ts):
// `\` -> `\\`, `|` -> `\|`, carriage returns are dropped, newline -> `\n`.
func escapeCell(logical string) string {
	s := strings.ReplaceAll(logical, `\`, `\\`)
	s = strings.ReplaceAll(s, "|", `\|`)
	s = strings.ReplaceAll(s, "\r", "")
	s = strings.ReplaceAll(s, "\n", `\n`)
	return s
}

// unescapeCell is the left-to-right inverse of escapeCell:
// `\\`->`\`, `\|`->`|`, `\n`->newline, `\<other>`->`<other>`.
func unescapeCell(serialized string) string {
	rs := []rune(serialized)
	var b strings.Builder
	for i := 0; i < len(rs); i++ {
		if rs[i] == '\\' && i+1 < len(rs) {
			c := rs[i+1]
			if c == 'n' {
				b.WriteByte('\n')
			} else {
				b.WriteRune(c)
			}
			i++
			continue
		}
		b.WriteRune(rs[i])
	}
	return b.String()
}

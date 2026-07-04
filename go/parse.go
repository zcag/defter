package defterparse

import (
	"regexp"
	"strconv"
	"strings"
)

// Lenient parser: text -> Model. Mirrors packages/core/src/parse.ts. Tolerates
// ragged rows, loose whitespace, a missing delimiter row, and content with or
// without `## Sheet:` headings. Normalization (padding rows to a common width)
// happens here; byte-stability is Serialize's job.

var headingRe = regexp.MustCompile(`(?i)^#{1,6}\s*Sheet:\s*(.*)$`)
var fenceRe = regexp.MustCompile("^(`{3,}|~{3,})\\s*(.*)$")
var delimRe = regexp.MustCompile(`^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$`)

// Parse turns arbitrary Defter text into a Model.
func Parse(text string) *Model {
	lines := strings.Split(strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n"), "\n")
	model := &Model{}
	filled := map[*Sheet]bool{}
	usedNames := map[string]bool{}
	var current *Sheet

	autoName := func() string {
		n := 1
		name := "Sheet1"
		for usedNames[name] {
			n++
			name = "Sheet" + strconv.Itoa(n)
		}
		return name
	}
	register := func(s *Sheet) {
		usedNames[s.Name] = true
		model.Sheets = append(model.Sheets, s)
	}

	for i := 0; i < len(lines); i++ {
		line := lines[i]
		trimmed := strings.TrimSpace(line)

		if m := headingRe.FindStringSubmatch(trimmed); m != nil {
			name := strings.TrimSpace(m[1])
			if name == "" {
				name = autoName()
			}
			current = emptySheet(name, true)
			register(current)
			continue
		}

		if fm := fenceRe.FindStringSubmatch(trimmed); fm != nil {
			marker := fm[1]
			info := strings.TrimSpace(fm[2])
			var bodyLines []string
			j := i + 1
			for ; j < len(lines); j++ {
				lt := strings.TrimSpace(lines[j])
				f := fenceRe.FindStringSubmatch(lt)
				if f != nil && strings.HasPrefix(lt, marker[:1]) && strings.TrimSpace(f[2]) == "" {
					break
				}
				bodyLines = append(bodyLines, lines[j])
			}
			if info == "defter-style" {
				target := current
				if target == nil && len(model.Sheets) > 0 {
					target = model.Sheets[len(model.Sheets)-1]
				}
				if target == nil {
					target = emptySheet(autoName(), false)
					register(target)
					current = target
				}
				parsed := parseStyleBlock(strings.Join(bodyLines, "\n"))
				target.Styles = append(target.Styles, parsed.Rules...)
				target.Charts = append(target.Charts, parsed.Charts...)
				target.Conditionals = append(target.Conditionals, parsed.Conditionals...)
				target.Validations = append(target.Validations, parsed.Validations...)
				target.Names = append(target.Names, parsed.Names...)
				if parsed.HasFreeze {
					target.Freeze = parsed.Freeze
				}
			}
			i = j // skip past closing fence
			continue
		}

		if strings.Contains(line, "|") && trimmed != "" {
			tableLines := []string{line}
			j := i + 1
			for ; j < len(lines); j++ {
				l := lines[j]
				lt := strings.TrimSpace(l)
				if !strings.Contains(l, "|") || lt == "" || headingRe.MatchString(lt) {
					break
				}
				if fenceRe.MatchString(lt) {
					break
				}
				tableLines = append(tableLines, l)
			}
			i = j - 1

			sheet := current
			if sheet == nil || filled[sheet] {
				sheet = emptySheet(autoName(), false)
				register(sheet)
				current = sheet
			}
			fillSheetFromTable(sheet, tableLines)
			filled[sheet] = true
			continue
		}
		// Any other line (prose, blank, unrelated markdown) is ignored between sheets.
	}

	if len(model.Sheets) == 0 {
		model.Sheets = append(model.Sheets, emptySheet("Sheet1", false))
	}
	for _, s := range model.Sheets {
		normalizeSheet(s)
	}
	return model
}

// normalizeSheet ensures a sheet has at least a 1-wide header row so
// serialize<->parse is idempotent, and pads ragged rows to the common width.
func normalizeSheet(s *Sheet) {
	if s.Width < 1 || len(s.Grid) == 0 {
		s.Grid = [][]string{{""}}
		s.Width = 1
		s.ColAlign = []Align{AlignNone}
		return
	}
	for i := range s.Grid {
		for len(s.Grid[i]) < s.Width {
			s.Grid[i] = append(s.Grid[i], "")
		}
	}
	for len(s.ColAlign) < s.Width {
		s.ColAlign = append(s.ColAlign, AlignNone)
	}
}

func fillSheetFromTable(sheet *Sheet, tableLines []string) {
	header := SplitRow(tableLines[0])
	dataStart := 1
	var colAlign []Align
	if len(tableLines) > 1 && delimRe.MatchString(tableLines[1]) {
		colAlign = parseAlignRow(tableLines[1])
		dataStart = 2
	}
	var dataRows [][]string
	for k := dataStart; k < len(tableLines); k++ {
		dataRows = append(dataRows, SplitRow(tableLines[k]))
	}

	width := len(header)
	if len(colAlign) > width {
		width = len(colAlign)
	}
	for _, r := range dataRows {
		if len(r) > width {
			width = len(r)
		}
	}

	pad := func(row []string) []string {
		r := make([]string, 0, width)
		for i := 0; i < width && i < len(row); i++ {
			r = append(r, row[i])
		}
		for len(r) < width {
			r = append(r, "")
		}
		return r
	}

	grid := [][]string{pad(header)}
	for _, r := range dataRows {
		grid = append(grid, pad(r))
	}
	sheet.Grid = grid
	sheet.Width = width
	sheet.ColAlign = make([]Align, width)
	for c := 0; c < width; c++ {
		if c < len(colAlign) {
			sheet.ColAlign[c] = colAlign[c]
		} else {
			sheet.ColAlign[c] = AlignNone
		}
	}
}

// SplitRow splits a table row on unescaped `|`, drops the surrounding-pipe
// artifacts, trims, and unescapes each cell.
func SplitRow(line string) []string {
	var cells []string
	var cur strings.Builder
	s := []rune(strings.TrimSpace(line))
	for i := 0; i < len(s); i++ {
		ch := s[i]
		if ch == '\\' && i+1 < len(s) {
			cur.WriteRune(ch)
			cur.WriteRune(s[i+1])
			i++
			continue
		}
		if ch == '|' {
			cells = append(cells, cur.String())
			cur.Reset()
			continue
		}
		cur.WriteRune(ch)
	}
	cells = append(cells, cur.String())
	if len(cells) > 1 && strings.TrimSpace(cells[0]) == "" {
		cells = cells[1:]
	}
	if len(cells) > 1 && strings.TrimSpace(cells[len(cells)-1]) == "" {
		cells = cells[:len(cells)-1]
	}
	out := make([]string, len(cells))
	for i, c := range cells {
		out[i] = unescapeCell(strings.TrimSpace(c))
	}
	return out
}

func parseAlignRow(line string) []Align {
	raw := strings.TrimSpace(line)
	raw = strings.TrimPrefix(raw, "|")
	raw = strings.TrimSuffix(raw, "|")
	parts := strings.Split(raw, "|")
	out := make([]Align, len(parts))
	for i, cell := range parts {
		c := strings.TrimSpace(cell)
		left := strings.HasPrefix(c, ":")
		right := strings.HasSuffix(c, ":")
		switch {
		case left && right:
			out[i] = AlignCenter
		case right:
			out[i] = AlignRight
		case left:
			out[i] = AlignLeft
		default:
			out[i] = AlignNone
		}
	}
	return out
}

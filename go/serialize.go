package defterparse

import "strings"

// Byte-stable serializer: Model -> text. Mirrors packages/core/src/serialize.ts.
// A given model always produces identical bytes. Tables are compact (single-space
// cell padding, never alignment padding) and one row = one line.

// Normalize turns arbitrary Defter text into its canonical byte-stable form.
// Equivalent to Serialize(Parse(text)).
func Normalize(text string) string {
	return Serialize(Parse(text))
}

// Serialize renders a Model to canonical text.
func Serialize(model *Model) string {
	multi := len(model.Sheets) > 1
	blocks := make([]string, len(model.Sheets))
	for i, s := range model.Sheets {
		blocks[i] = serializeSheet(s, multi)
	}
	return strings.Join(blocks, "\n\n") + "\n"
}

func serializeSheet(sheet *Sheet, forceHeading bool) string {
	width := sheet.Width
	if width < 1 {
		width = 1
	}
	var parts []string
	if sheet.Headed || forceHeading {
		parts = append(parts, "## Sheet: "+sheet.Name+"\n")
	}

	row := func(cells []string) string {
		padded := make([]string, width)
		for c := 0; c < width; c++ {
			v := ""
			if c < len(cells) {
				v = cells[c]
			}
			padded[c] = escapeCell(v)
		}
		return "| " + strings.Join(padded, " | ") + " |"
	}

	var header []string
	if len(sheet.Grid) > 0 {
		header = sheet.Grid[0]
	}
	delim := make([]string, width)
	for c := 0; c < width; c++ {
		a := AlignNone
		if c < len(sheet.ColAlign) {
			a = sheet.ColAlign[c]
		}
		delim[c] = alignMarker(a)
	}
	lines := []string{row(header), "| " + strings.Join(delim, " | ") + " |"}
	for r := 1; r < len(sheet.Grid); r++ {
		lines = append(lines, row(sheet.Grid[r]))
	}
	parts = append(parts, strings.Join(lines, "\n"))

	if len(sheet.Styles) > 0 || len(sheet.Charts) > 0 || len(sheet.Conditionals) > 0 ||
		len(sheet.Validations) > 0 || len(sheet.Names) > 0 {
		block := serializeStyleBlock(sheet.Styles, sheet.Charts, sheet.Conditionals, sheet.Validations, sheet.Names)
		parts = append(parts, "\n```defter-style\n"+block+"\n```")
	}
	return strings.Join(parts, "\n")
}

func alignMarker(a Align) string {
	switch a {
	case AlignLeft:
		return ":--"
	case AlignCenter:
		return ":-:"
	case AlignRight:
		return "--:"
	default:
		return "---"
	}
}

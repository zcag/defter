package defterparse

// The in-memory model. This mirrors packages/core/src/model.ts. It is the
// ephemeral projection of the text: Parse produces it, Serialize turns it back
// into byte-stable text. Cell text is stored in its logical form (real `|` and
// newline characters, not the `\|` / `\n` escapes used in the serialized form).

// Model is a whole Defter document.
type Model struct {
	Sheets []*Sheet
}

// Align is a per-column alignment marker. The empty string means "default".
type Align string

const (
	AlignNone   Align = ""
	AlignLeft   Align = "left"
	AlignCenter Align = "center"
	AlignRight  Align = "right"
)

// Sheet is one named grid plus its presentation layer.
type Sheet struct {
	Name string
	// Grid is a row-major grid of raw cell text. Grid[0] is the header (A1 row 1);
	// Grid[r] is A1 row r+1. Formula cells keep their leading `=`. All rows are
	// padded to Width.
	Grid  [][]string
	Width int
	// ColAlign is the per-column alignment from the GFM delimiter row.
	ColAlign []Align
	Styles   []StyleRule
	// Charts declared in the defter-style block, referencing ranges in this sheet.
	Charts []ChartSpec
	// Conditionals are conditional-formatting rules (`when <range> <op> <value> <attrs>`).
	Conditionals []CondRule
	// Validations are data-validation dropdowns (`validate <range> list=A,B,C`).
	Validations []ValidationRule
	// Names are named ranges (`name Revenue = D2:D10`).
	Names []NamedRange
	// Headed reports whether the sheet was introduced by an explicit `## Sheet:` heading.
	Headed bool
}

// NamedRange is a `name <Name> = <range>` definition.
type NamedRange struct {
	Name  string
	Range Range
}

// ValidationRule is a `validate <target> list=A,B,C` dropdown rule.
type ValidationRule struct {
	Target StyleTarget
	List   []string
}

// CondValue is a conditional-rule comparison value: either a number or a string.
type CondValue struct {
	IsNum bool
	Num   float64
	Str   string
}

// CondRule is a `when <target> <op> <value> <attrs>` conditional-formatting rule.
type CondRule struct {
	Target StyleTarget
	Op     string // one of > < >= <= = <>
	Value  CondValue
	Attrs  StyleAttrs
}

// ChartSpec is a `chart type=... x=... y=...` declaration.
type ChartSpec struct {
	Type      string // bar | line | pie | area
	Title     string
	HasTitle  bool
	Labels    Range // category labels (x axis)
	HasLabels bool
	Values    []Range // one or more value series
}

// StyleRule is one `<target> <attrs>` presentation rule.
type StyleRule struct {
	Target StyleTarget
	Attrs  StyleAttrs
}

// StyleTargetKind enumerates the target forms.
type StyleTargetKind string

const (
	TargetRange StyleTargetKind = "range"
	TargetCols  StyleTargetKind = "cols"
	TargetRows  StyleTargetKind = "rows"
)

// StyleTarget is the A1 target of a style/cond/validation rule: a range, a whole
// column span, or a whole row span.
type StyleTarget struct {
	Kind  StyleTargetKind
	Range Range // when Kind == TargetRange
	Start int   // when Kind == TargetCols/TargetRows (0-based col index, or 1-based row)
	End   int
}

// StyleAttrs are the resolved attributes of a rule. String fields use "" for
// absent; Size/Width use nil for absent.
type StyleAttrs struct {
	Bold      bool
	Italic    bool
	Underline bool
	Strike    bool
	Wrap      bool
	Merge     bool
	Fill      string
	Color     string
	Align     string
	Valign    string
	Format    string
	Border    string
	Font      string
	Size      *float64
	Width     *float64
}

// count returns how many attributes are set (used to decide whether a rule is
// meaningful, mirroring `Object.keys(attrs).length` in the TS reference).
func (a StyleAttrs) count() int {
	n := 0
	for _, b := range []bool{a.Bold, a.Italic, a.Underline, a.Strike, a.Wrap, a.Merge} {
		if b {
			n++
		}
	}
	for _, s := range []string{a.Fill, a.Color, a.Align, a.Valign, a.Format, a.Border, a.Font} {
		if s != "" {
			n++
		}
	}
	if a.Size != nil {
		n++
	}
	if a.Width != nil {
		n++
	}
	return n
}

// emptySheet returns a fresh sheet with a single empty header row.
func emptySheet(name string, headed bool) *Sheet {
	return &Sheet{
		Name:     name,
		Grid:     [][]string{{}},
		Width:    0,
		ColAlign: []Align{},
		Headed:   headed,
	}
}

// GetCell reads a cell's logical text by A1 (col 0-based, row 1-based). Returns
// the empty string if out of range.
func GetCell(s *Sheet, col, row int) string {
	if row-1 < 0 || row-1 >= len(s.Grid) {
		return ""
	}
	r := s.Grid[row-1]
	if col < 0 || col >= len(r) {
		return ""
	}
	return r[col]
}

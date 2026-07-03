package defterparse

import "testing"

// Mirrors packages/core/src/coords.test.ts.

func TestColumnLabelBoundaries(t *testing.T) {
	cases := map[int]string{0: "A", 25: "Z", 26: "AA", 701: "ZZ", 702: "AAA"}
	for i, want := range cases {
		got, err := columnLabel(i)
		if err != nil || got != want {
			t.Errorf("columnLabel(%d) = %q, %v; want %q", i, got, err, want)
		}
	}
}

func TestColumnIndexRoundTrip(t *testing.T) {
	for i := 0; i <= 20000; i++ {
		lbl, err := columnLabel(i)
		if err != nil {
			t.Fatalf("columnLabel(%d): %v", i, err)
		}
		got, err := columnIndex(lbl)
		if err != nil || got != i {
			t.Fatalf("columnIndex(%q) = %d, %v; want %d", lbl, got, err, i)
		}
	}
}

func TestParseRef(t *testing.T) {
	r, _ := parseRef("A1")
	if r.Col != 0 || r.Row != 1 || r.ColAbs || r.RowAbs {
		t.Errorf("A1 = %+v", r)
	}
	r, _ = parseRef("$B$2")
	if r.Col != 1 || r.Row != 2 || !r.ColAbs || !r.RowAbs {
		t.Errorf("$B$2 = %+v", r)
	}
	r, _ = parseRef("Sheet2!C3")
	if r.Col != 2 || r.Row != 3 || r.Sheet != "Sheet2" {
		t.Errorf("Sheet2!C3 = %+v", r)
	}
	r, _ = parseRef("'my sheet'!D4")
	if r.Col != 3 || r.Row != 4 || r.Sheet != "my sheet" {
		t.Errorf("'my sheet'!D4 = %+v", r)
	}
	if _, err := parseRef("not a ref"); err == nil {
		t.Error("expected error for bad ref")
	}
}

func TestFormatRefRoundTrip(t *testing.T) {
	for _, s := range []string{"A1", "$A$1", "A$1", "$A1", "Z99", "AA10", "Sheet2!B3"} {
		r, err := parseRef(s)
		if err != nil {
			t.Fatalf("parseRef(%q): %v", s, err)
		}
		if got := formatRef(r); got != s {
			t.Errorf("formatRef(parseRef(%q)) = %q", s, got)
		}
	}
	r, _ := parseRef("'my sheet'!D4")
	if got := formatRef(r); got != "'my sheet'!D4" {
		t.Errorf("quoted sheet round-trip = %q", got)
	}
}

func TestRanges(t *testing.T) {
	r, _ := parseRange("B4:A1")
	if got := formatRange(r); got != "A1:B4" {
		t.Errorf("normalize corners = %q", got)
	}
	r, _ = parseRange("C3")
	if got := formatRange(r); got != "C3" {
		t.Errorf("collapse 1x1 = %q", got)
	}
	for _, s := range []string{"A1:B4", "A1", "Sheet2!A1:C9"} {
		r, _ := parseRange(s)
		if got := formatRange(r); got != s {
			t.Errorf("range round-trip %q = %q", s, got)
		}
	}
}

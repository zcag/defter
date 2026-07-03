package defterparse

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Parity tests: for every committed fixture, assert the Go Tier-1 outputs are
// byte-identical to the expected outputs generated from the TypeScript reference
// (@defterjs/core) by go/testdata/gen.mjs. Also assert the idempotence invariant
// on every fixture.

func readFixtures(t *testing.T) map[string]string {
	t.Helper()
	dir := filepath.Join("testdata", "inputs")
	entries, err := os.ReadDir(dir)
	if err != nil {
		t.Fatalf("read inputs dir: %v", err)
	}
	out := map[string]string{}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".dft") {
			continue
		}
		id := strings.TrimSuffix(e.Name(), ".dft")
		b, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			t.Fatalf("read %s: %v", e.Name(), err)
		}
		out[id] = string(b)
	}
	if len(out) == 0 {
		t.Fatal("no fixtures found; run `node go/testdata/gen.mjs`")
	}
	return out
}

func readExpected(t *testing.T, id, kind string) string {
	t.Helper()
	b, err := os.ReadFile(filepath.Join("testdata", "expected", id+"."+kind))
	if err != nil {
		t.Fatalf("read expected %s.%s: %v", id, kind, err)
	}
	return string(b)
}

func TestNormalizeParity(t *testing.T) {
	for id, text := range readFixtures(t) {
		t.Run(id, func(t *testing.T) {
			got := Normalize(text)
			want := readExpected(t, id, "normalize")
			if got != want {
				t.Errorf("normalize mismatch\n--- got ---\n%q\n--- want ---\n%q", got, want)
			}
		})
	}
}

func TestProjectTextParity(t *testing.T) {
	for id, text := range readFixtures(t) {
		t.Run(id, func(t *testing.T) {
			got := ProjectText(Parse(text))
			want := readExpected(t, id, "project")
			if got != want {
				t.Errorf("projectText mismatch\n--- got ---\n%q\n--- want ---\n%q", got, want)
			}
		})
	}
}

func TestProjectProseParity(t *testing.T) {
	for id, text := range readFixtures(t) {
		t.Run(id, func(t *testing.T) {
			got := ProjectProse(Parse(text))
			want := readExpected(t, id, "prose")
			if got != want {
				t.Errorf("projectProse mismatch\n--- got ---\n%q\n--- want ---\n%q", got, want)
			}
		})
	}
}

// TestIdempotence asserts serialize(parse(t)) == serialize(parse(serialize(parse(t))))
// on every fixture — one normalization pass reaches a fixed point.
func TestIdempotence(t *testing.T) {
	for id, text := range readFixtures(t) {
		t.Run(id, func(t *testing.T) {
			once := Normalize(text)
			twice := Normalize(once)
			if once != twice {
				t.Errorf("not idempotent\n--- once ---\n%q\n--- twice ---\n%q", once, twice)
			}
		})
	}
}

// TestBudgetTier1Divergence documents the one deliberate Tier-1 divergence from
// the TS reference projectText: the Go layer has no number-format engine, so a
// literal number under a `format` rule is emitted verbatim rather than reformatted.
func TestBudgetTier1Divergence(t *testing.T) {
	fixtures := readFixtures(t)
	got := ProjectText(Parse(fixtures["sample-budget"]))
	// The literal "42000" stays verbatim (the reference would render "42,000").
	if !strings.Contains(got, "| 42000 |") {
		t.Errorf("expected literal 42000 to be emitted verbatim in Tier-1 projection; got:\n%s", got)
	}
	if strings.Contains(got, "42,000") {
		t.Errorf("Tier-1 projection must NOT number-format literals; got:\n%s", got)
	}
}

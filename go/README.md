# defterparse — Tier-1 pure-text Go layer for Defter

`github.com/zcag/defter/go` is a native, **dependency-free (stdlib only)** Go port
of Defter's Tier-1 pure-text layer, built for byte-for-byte parity with the
TypeScript reference in [`packages/core`](../packages/core). It exists so a Go
host — the [tela](https://telawiki.com) wiki embeds Defter as a spreadsheet
doc-type — can, server-side and in-process:

- **normalize** an agent/synced body to canonical form before storing it, and
- **structurally lint** an agent-authored body to reject broken sheets.

The reference remains the TypeScript `@defterjs/core`. This module is a faithful
subset of it, validated against committed fixtures generated from the real TS.

## Scope — Tier-1 only (no formula engine)

The heavy formula engine is **out of scope by design**. There is:

- **no formula evaluation** — a formula cell (`=B2*C2`) is preserved and
  projected as its **source text**;
- **no number-format engine** — literal cells are emitted **verbatim** (a literal
  number under a `format=` rule is *not* reformatted).

Computed values are materialized downstream by a separate Node CLI. This is the
one deliberate divergence from the reference `projectText` (see below).

## Module path & consumption

```
go get github.com/zcag/defter/go
```

```go
import defter "github.com/zcag/defter/go"
```

tela consumes it via `require github.com/zcag/defter/go`. A versioned tag
(`go/vX.Y.Z`, since this is a nested module in a JS-first monorepo) will be cut
later; until then, consume it by commit pseudo-version.

## Exported API

```go
// Parse / serialize / normalize
func Parse(text string) *Model
func Serialize(model *Model) string
func Normalize(text string) string            // == Serialize(Parse(text))

// Reading projections (Tier-1: no compute — see boundary above)
func ProjectText(model *Model) string          // canonical table, style rules stripped, formulas verbatim
func ProjectProse(model *Model) string          // one "Sheet — Header: value, ..." line per data row

// Structural lint
func Lint(model *Model) []Issue                 // model-visible checks
func LintText(text string) []Issue              // Lint + text-layer malformed-line checks (with line numbers)

// Cell access
func GetCell(s *Sheet, col, row int) string     // col 0-based, row 1-based (row 1 = header)
```

Core types: `Model{ Sheets []*Sheet }`, `Sheet` (grid, width, per-column
`ColAlign`, plus the parsed `Styles`, `Charts`, `Conditionals`, `Validations`,
`Names`), `StyleRule`, `StyleTarget`, `StyleAttrs`, `ChartSpec`, `CondRule`,
`ValidationRule`, `NamedRange`, `Range`, `Ref`, and `Issue{ Sheet, Cell string; Line int; Message string }`.

### What `Lint` / `LintText` catch

`Lint(model)` (model-visible): duplicate sheet names, empty sheets (no data
rows), and A1 ranges — in style rules, charts, conditionals, validations, named
ranges — whose start corner is outside the target sheet's grid or that name an
unknown sheet.

`LintText(text)` = `Lint(Parse(text))` **plus** text-layer checks the lossy model
can't express: malformed `defter-style` lines (unknown attribute keys, bad target
syntax, unparseable `name`/`when`/`validate`/`chart` rules), each reported with a
1-based line number. (The lenient parser silently drops these, matching the TS
reference; `LintText` surfaces them.)

## Parity validation

`go/testdata/` holds representative fixtures and their expected outputs generated
from the **actual** TypeScript reference by [`gen.mjs`](testdata/gen.mjs):

```bash
pnpm --filter @defterjs/core build   # build the TS reference to dist/
node go/testdata/gen.mjs             # regenerate testdata/{inputs,expected}
cd go && go test ./...               # assert Go outputs match, byte-for-byte
```

For every fixture the Go tests assert byte-equality of `Normalize`,
`ProjectText`, and `ProjectProse` against the TS-generated expectations, plus the
idempotence invariant `Normalize(Normalize(t)) == Normalize(t)`.

Fixtures cover: the demo samples (invoice, budget, roadmap, multi-sheet), the
`packages/core` test inputs (charts single + multi-series, conditional
formatting, data validation, escaped pipes, column alignment, worked example),
the `docs/FORMAT.md` example, and edge cases — empty/whitespace, ragged rows,
missing delimiter, prose around a table, a style block before any table, merges,
named ranges, absolute + cross-sheet refs, column widths, unicode, and multi-line
(`\n`) / backslash escaping.

### Deliberate divergence

Only `sample-budget` diverges from the reference `projectText`, and only because
it puts `format=#,##0` over the literal-number columns `Planned`/`Actual`: the TS
reference renders `42000` as `42,000`, while the Tier-1 Go layer (no number-format
engine) keeps `42000` verbatim. The `*.project` expectations reflect this Tier-1
behavior; `TestBudgetTier1Divergence` pins it. Every other fixture matches the
reference `projectText` exactly.

## Build

```bash
cd go && go build ./... && go vet ./... && go test ./...
```

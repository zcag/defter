// Package defterparse is a native, dependency-free Go implementation of Defter's
// Tier-1 pure-text layer, ported for byte-for-byte parity with the TypeScript
// reference in packages/core (parse.ts, serialize.ts, style.ts, coords.ts,
// escape.ts, project.ts).
//
// Defter is a text-canonical collaborative spreadsheet whose source of truth is
// plain markdown (compact GFM tables plus an optional fenced ```defter-style
// block). This package lets a Go host (the tela wiki embeds Defter as a
// spreadsheet doc-type) do, server-side and in-process:
//
//   - Parse   — lenient text -> Model
//   - Serialize / Normalize — Model -> byte-stable canonical text
//   - ProjectText / ProjectProse — style-stripped reading projections
//   - Lint / LintText — structural validation of an authored body
//
// SCOPE — Tier-1 only. The heavy formula engine is deliberately OUT OF SCOPE:
// there is no formula evaluation and no number-format engine here. Formula cells
// are preserved and projected as their **source text**; literal cells are emitted
// verbatim. Computed values are materialized downstream by a separate Node CLI.
// See ProjectText's doc comment for the exact Tier-1 boundary.
//
// The canonical invariant holds: Serialize(Parse(t)) is idempotent, i.e.
// Normalize(Normalize(t)) == Normalize(t).
package defterparse

<div align="center">

# Defter

**A text-canonical, collaborative, agent-friendly spreadsheet.**

The plain-text markdown document *is* the source of truth. The grid is a live, editable
projection of it — so collaboration, versioning, full-text search, and AI agents all
operate on ordinary text instead of a hidden binary/JSON model.

[![CI](https://github.com/zcag/defter/actions/workflows/ci.yml/badge.svg)](https://github.com/zcag/defter/actions/workflows/ci.yml)

[Live demo → defter.cagdas.io](https://defter.cagdas.io) · [Storybook](https://defter.cagdas.io/storybook/) · [Format spec](docs/FORMAT.md)

</div>

---

## The idea

```
Traditional:  JSON model (truth)  ──serialize──▶  text (export, lossy)
Defter:       markdown text (truth)  ──parse──▶  grid model (ephemeral, for rendering/editing)
```

Nothing persists in a hidden structured document. A cell's content, formulas, and — via a
co-canonical `defter-style` layer — its fills, formats, merges, and charts all live in one
line-oriented text document that git, a text CRDT, file-sync, and full-text search handle
natively. Computed formula values are derived at read time, never stored.

Read [`docs/FORMAT.md`](docs/FORMAT.md) for the normative format, and
[`docs/RATIONALE.md`](docs/RATIONALE.md) for the design decisions and their trade-offs.
Embedding Defter in your own app (install, collaboration, theming) is documented in
[`docs/INTEGRATION.md`](docs/INTEGRATION.md); theming the grid with your own colours (statically or
live at runtime) in [`docs/THEMING.md`](docs/THEMING.md).

## Packages

| Package | What it is |
|---|---|
| [`@defter/core`](packages/core) | Headless, framework-agnostic TypeScript. Parse/serialize, A1 coordinates, values/formatting, structured edits, reference rewriting, minimal-splice diff, projection, lint. No React, no DOM. |
| [`@defter/formula`](packages/formula) | The default formula engine — a compact, dependency-free Excel-style evaluator (~75 functions, cross-sheet, cycle-safe). Implements core's pluggable `FormulaEngine`. |
| [`@defter/ironcalc`](packages/ironcalc) | Alternative engine adapter over [IronCalc](https://ironcalc.com) (Rust/Wasm, 300+ functions). Same `FormulaEngine` interface — proves the seam. Swap it in live in the demo. |
| [`@defter/react`](packages/react) | The grid renderer — a thin, themeable (CSS-variable) projection of the text. Selection, formula bar, copy/paste, merges, sheet tabs, undo/redo, 3 themes. |
| [`@defter/yjs`](packages/yjs) | Collaboration binding: hand it a `Y.Text` and it keeps the canonical text in sync via minimal splices. Ships no network provider — inject the shared type. |

**For agents:** [`docs/AGENTS.md`](docs/AGENTS.md) is the complete contract for authoring and editing Defter sheets.

## What works

- **Text-canonical format** — compact one-row-one-line GFM tables (content) + a co-canonical
  `defter-style` layer (fills, number formats, merges, borders, alignment, column widths,
  conditional formatting, data-validation dropdowns, charts). Lenient parse, byte-stable
  serialize, idempotent round-trip.
- **Formula engine** ([`@defter/formula`](packages/formula)) — ~55 functions incl. `SUM`/`AVERAGE`,
  `VLOOKUP`/`HLOOKUP`/`INDEX`/`MATCH`, `SUMIF`/`COUNTIF` (wildcards), `IF`/`IFS`/`SWITCH`, text and
  date functions. Cross-sheet, cycle-safe, memoized. Compute-on-read — values are never stored.
- **Premium editing** — range selection, formula bar, formatting toolbar, copy/paste (TSV),
  undo/redo, fill down/right (relative-ref adjusting), column resize, insert/delete row/col (with
  automatic reference rewriting), merges, freeze header/column, multi-sheet tabs, keyboard shortcuts.
- **Scale** — opt-in row virtualization renders only the visible window.
- **Collaboration** ([`@defter/yjs`](packages/yjs)) — bind a `Y.Text`; concurrent edits to different
  cells auto-merge (tested for convergence). No bundled provider.
- **Charts** (bar/line/area/pie, dependency-free SVG), **import/export** CSV + XLSX
  ([`@defter/xlsx`](packages/xlsx)), **3 themes**, **ARIA grid**, **Storybook**, **CI**.
- **Agent-ready** — the [authoring contract](docs/AGENTS.md) + a values-materialized projection for
  search/RAG.

Two adversarial review passes; 58 tests. See the [live demo](https://defter.cagdas.io).

## Develop

A `Makefile` wraps every task — run `make` to list them:

```bash
make install     # install dependencies
make test        # vitest
make build       # build all packages
make demo        # run the demo site
make storybook   # component stories for every state
make deploy      # build + deploy demo & storybook to defter.cagdas.io
```

## Release

Packages are published to npm under the `@defter` scope. `workspace:*` deps are rewritten to the
real version on publish, and only `dist/` ships (sources are inlined into the sourcemaps).

```bash
npm login              # once, as a member of the @defter npm org
make publish-dry       # preview exactly what would be pushed
make publish           # build + publish all packages to npm

make pack              # OR: tarballs in ./dist-tarballs/ to install without npm
                       #     (elsewhere: pnpm add /abs/path/to/defter-react-0.1.0.tgz)
```

Bump the `version` in each `packages/*/package.json` before publishing a new release.
See [`docs/INTEGRATION.md`](docs/INTEGRATION.md) for how a host app consumes the packages.

## License

MIT © Cagdas Salur

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

## Packages

| Package | What it is |
|---|---|
| [`@defter/core`](packages/core) | Headless, framework-agnostic TypeScript. Parse/serialize, A1 coordinates, values/formatting, structured edits, reference rewriting, minimal-splice diff, projection, lint. No React, no DOM. |
| [`@defter/formula`](packages/formula) | The default formula engine — a compact, dependency-free Excel-style evaluator (~30 functions, cross-sheet, cycle-safe). Implements core's pluggable `FormulaEngine`. |
| [`@defter/react`](packages/react) | The grid renderer — a thin, themeable (CSS-variable) projection of the text. Selection, formula bar, copy/paste, merges, sheet tabs, undo/redo, 3 themes. |
| [`@defter/yjs`](packages/yjs) | Collaboration binding: hand it a `Y.Text` and it keeps the canonical text in sync via minimal splices. Ships no network provider — inject the shared type. |

**For agents:** [`docs/AGENTS.md`](docs/AGENTS.md) is the complete contract for authoring and editing Defter sheets.

## Status

Early and moving fast. See the [live demo](https://defter.cagdas.io) for what currently works.

## Develop

```bash
pnpm install
pnpm test              # vitest (43 tests)
pnpm build             # build all packages
pnpm demo              # run the demo site
pnpm storybook         # component stories for every state
bash scripts/deploy.sh # build + deploy demo & storybook to defter.cagdas.io
```

## License

MIT © Cagdas Salur

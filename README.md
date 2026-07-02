<div align="center">

# Defter

**A text-canonical, collaborative, agent-friendly spreadsheet.**

The plain-text markdown document *is* the source of truth. The grid is a live, editable
projection of it — so collaboration, versioning, full-text search, and AI agents all
operate on ordinary text instead of a hidden binary/JSON model.

[Live demo → defter.cagdas.io](https://defter.cagdas.io) · [Format spec](docs/FORMAT.md)

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
| [`@defter/core`](packages/core) | Headless, framework-agnostic TypeScript. Parse/serialize, A1 coordinates, minimal-splice edits, reference rewriting, projection. No React, no DOM. |
| `@defter/react` | The grid renderer — a thin, themeable (CSS-variable) projection of the text model. Bring your own `Y.Text` for collaboration; no bundled network provider. |

## Status

Early and moving fast. See the [live demo](https://defter.cagdas.io) for what currently works.

## Develop

```bash
pnpm install
pnpm test          # vitest
pnpm build         # build all packages
pnpm demo          # run the demo site
```

## License

MIT © Cagdas Salur

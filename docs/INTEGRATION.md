# Embedding Defter in an app

Defter ships as small ESM packages. The renderer bundles **no UI kit and no network/collab
provider** — you inject the formula engine and (optionally) a Yjs `Y.Text`. This is the recipe a
React 19 + Vite host (like tela) follows.

## Packages

| Package | Role | Needs |
|---|---|---|
| `@defter/core` | headless parse/serialize/edit, framework-agnostic | — |
| `@defter/react` | the grid renderer | `react`/`react-dom` (peer, ≥18) |
| `@defter/formula` | default formula engine (dependency-free) | — |
| `@defter/yjs` | bind the canonical text to a `Y.Text` (no provider) | `yjs` (peer) |
| `@defter/xlsx` | XLSX import/export | `exceljs` |
| `@defter/ironcalc` | optional IronCalc/Wasm engine (300+ fns) | — |

```bash
pnpm add @defter/react @defter/core @defter/formula   # core embed
pnpm add @defter/yjs yjs                               # + collaboration
pnpm add @defter/xlsx                                  # + xlsx io
```

Import the stylesheet once (it is all CSS variables — see [THEMING.md](./THEMING.md)):

```ts
import '@defter/react/styles.css'
```

## Minimal read/write grid

The grid is a **projection of text**. You own the text; `onChange` hands you the new canonical text
on every edit. Omit `onChange` (or pass `readOnly`) for a read-only grid.

```tsx
import { useState, useMemo } from 'react'
import { DefterGrid } from '@defter/react'
import { createEngine, FUNCTION_NAMES } from '@defter/formula'
import '@defter/react/styles.css'

const engine = createEngine()

export function Sheet({ initial }: { initial: string }) {
  const [text, setText] = useState(initial)
  return (
    <DefterGrid
      text={text}
      onChange={setText}
      engine={engine}
      functions={FUNCTION_NAMES}   // formula autocomplete
      toolbar
      formulaBar
      statusBar
      sheetTabs
    />
  )
}
```

`text` is ordinary GFM markdown (`## Sheet:` headings + compact tables + an optional
` ```defter-style ` block for presentation). It survives an unaware markdown pipeline unchanged, so
full-text search and RAG index the cell text as normal prose with zero backend work.

## Collaboration — inject a `Y.Text`, don't own the socket

Defter ships no provider. Give it a `Y.Text` from **your** Yjs document/transport and it binds via
minimal-splice edits (concurrent edits to different cells are disjoint character spans, so the CRDT
auto-merges). Persistence, transport, and awareness stay entirely yours.

```tsx
import { useYText } from '@defter/yjs'
import { DefterGrid } from '@defter/react'

// `ytext` comes from your own Y.Doc, synced by your own provider (e.g. tela's TelaProvider).
export function CollabSheet({ ytext, engine }: { ytext: Y.Text; engine: FormulaEngine }) {
  const [text, setText] = useYText(ytext)   // mirrors the Y.Text ⇄ canonical text
  return <DefterGrid text={text} onChange={setText} engine={engine} toolbar formulaBar />
}
```

That is the whole contract. In tela: wire `TelaProvider`'s `Y.Doc` → a `Y.Text` field → `useYText` →
`<DefterGrid>`, and collaboration, snapshots, and awareness come from tela's existing stack.

## Theming

Map your design tokens onto Defter's `--defter-*` variables, or drive them live via the `style`
prop. Full contract in **[THEMING.md](./THEMING.md)**. For a token-system host (Tailwind v4 semantic
tokens on `[data-theme]`), the one-time mapping is:

```css
.defter-shell {
  --defter-bg: var(--color-surface);
  --defter-fg: var(--color-text);
  --defter-accent: var(--color-primary);
  --defter-grid-line: var(--color-border);
  /* … */
}
```

Leave the `theme` prop unset when you drive colours this way (a built-in `[data-defter-theme]` preset
has higher specificity and would override your `.defter-shell` mapping).

## Agents & doc-types

The canonical text is LLM-authorable by design — the complete authoring contract is in
**[AGENTS.md](./AGENTS.md)**. To register Defter as a host doc-type (tela flags special bodies with a
page prop, e.g. `props.sheet = true`), store the body verbatim as markdown and add the authoring
contract to your agent/slash-menu manifest. Nothing else changes: the body never leaves markdown.

## Import/export

```ts
import { modelToCsv, modelToCsvSheets, csvToModel, parse, serialize } from '@defter/core'
const csv = modelToCsv(parse(text), { computed: engine.compute(parse(text)) }) // active sheet
const perSheet = modelToCsvSheets(parse(text))                                 // [{ name, csv }] — one per sheet
// XLSX (whole workbook, lazy-loaded):
const { exportXlsx, importXlsx } = await import('@defter/xlsx')
```

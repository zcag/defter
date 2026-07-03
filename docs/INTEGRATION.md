# Embedding Defter in an app

Defter ships as small ESM packages. The renderer bundles **no UI kit and no network/collab
provider** — you inject the formula engine and (optionally) a Yjs `Y.Text`. This is the recipe a
React 19 + Vite host (like tela) follows.

## Packages

| Package | Role | Needs |
|---|---|---|
| `@defterjs/core` | headless parse/serialize/edit, framework-agnostic | — |
| `@defterjs/react` | the grid renderer | `react`/`react-dom` (peer, ≥18) |
| `@defterjs/formula` | default formula engine (dependency-free) | — |
| `@defterjs/yjs` | bind the canonical text to a `Y.Text` (no provider) | `yjs` (peer) |
| `@defterjs/xlsx` | XLSX import/export | `exceljs` |
| `@defterjs/ironcalc` | optional IronCalc/Wasm engine (300+ fns) | — |

```bash
pnpm add @defterjs/react @defterjs/core @defterjs/formula   # core embed
pnpm add @defterjs/yjs yjs                               # + collaboration
pnpm add @defterjs/xlsx                                  # + xlsx io
```

Import the stylesheet once (it is all CSS variables — see [THEMING.md](./THEMING.md)):

```ts
import '@defterjs/react/styles.css'
```

## Minimal read/write grid

The grid is a **projection of text**. You own the text; `onChange` hands you the new canonical text
on every edit. Omit `onChange` (or pass `readOnly`) for a read-only grid.

```tsx
import { useState, useMemo } from 'react'
import { DefterGrid } from '@defterjs/react'
import { createEngine, FUNCTION_NAMES } from '@defterjs/formula'
import '@defterjs/react/styles.css'

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
import { useYText } from '@defterjs/yjs'
import { DefterGrid } from '@defterjs/react'

// `ytext` comes from your own Y.Doc, synced by your own provider (e.g. tela's TelaProvider).
export function CollabSheet({ ytext, engine }: { ytext: Y.Text; engine: FormulaEngine }) {
  const [text, setText] = useYText(ytext)   // mirrors the Y.Text ⇄ canonical text
  return <DefterGrid text={text} onChange={setText} engine={engine} toolbar formulaBar />
}
```

That is the whole contract. In tela: wire `TelaProvider`'s `Y.Doc` → a `Y.Text` field → `useYText` →
`<DefterGrid>`, and collaboration, snapshots, and awareness come from tela's existing stack.

### Live presence — remote cursors + selections

The grid renders remote peers Google-Sheets style (a coloured outline + name flag over each peer's
cells) from a `collaborators` prop, and reports the local selection through `onSelectionChange` so
you can broadcast it. Both are pure UI — Defter never touches your transport. Map your **awareness**
channel to the prop, and feed `onSelectionChange` back into awareness:

```tsx
import type { Collaborator, SelectionState } from '@defterjs/react'

// Derive `collaborators` from your awareness states (one entry per remote peer).
const collaborators: Collaborator[] = [...awareness.getStates()]
  .filter(([clientId]) => clientId !== awareness.clientID)     // drop self
  .map(([, s]) => s.presence)                                  // { id, name, color, sheetIndex, selection }
  .filter(Boolean)

<DefterGrid
  text={text}
  onChange={setText}
  engine={engine}
  collaborators={collaborators}
  onSelectionChange={(sel: SelectionState) =>                  // { sheetIndex, selection: "A1" | "A1:B4" }
    awareness.setLocalStateField('presence', { id: me.id, name: me.name, color: me.color, ...sel })
  }
/>
```

- **`collaborators: Collaborator[]`** — `{ id, name, color, sheetIndex, selection }`. `selection` is
  A1 (`B3`) or an A1 range (`A1:B4`); `color` is the peer's presence colour (the *only* colour not
  driven by a `--defter-*` token). A peer's cursor shows only while `sheetIndex` matches the viewed
  sheet. Malformed/off-screen selections just don't render.
- **`onSelectionChange: (sel: SelectionState) => void`** — fired (throttled ~60 ms) with
  `{ sheetIndex, selection }` whenever the local selection changes.

The flag's text colour is themeable via `--defter-collab-flag-fg` (see [THEMING.md](./THEMING.md)).

### CRDT-aware undo/redo

Under a shared `Y.Text`, plain text-history undo would stomp a remote peer's concurrent edit. Use
`useYUndo` from `@defterjs/yjs` — it wraps a `Y.UndoManager` scoped to the **local** origin (the
`'local'` origin `useYText` writes with) so undo reverts only *your* edits — and hand its four
fields to the grid. The grid then drives them for Ctrl/Cmd+Z, Shift+Z, and the toolbar buttons:

```tsx
import { useYText, useYUndo } from '@defterjs/yjs'
import { DefterGrid } from '@defterjs/react'

export function CollabSheet({ ytext, engine }: { ytext: Y.Text; engine: FormulaEngine }) {
  const [text, setText] = useYText(ytext)
  const { undo, redo, canUndo, canRedo } = useYUndo(ytext)   // scoped to the local origin
  return (
    <DefterGrid
      text={text}
      onChange={setText}
      engine={engine}
      undo={undo}
      redo={redo}
      canUndo={canUndo}
      canRedo={canRedo}
      toolbar
    />
  )
}
```

Omit the `undo`/`redo` props (non-collaborative embed) and the grid keeps its built-in local
text-history undo — no behaviour change. `useYUndo(ytext, { captureTimeout, trackedOrigins })` tunes
edit grouping and which origins count as "local".

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
import { modelToCsv, modelToCsvSheets, csvToModel, parse, serialize } from '@defterjs/core'
const csv = modelToCsv(parse(text), { computed: engine.compute(parse(text)) }) // active sheet
const perSheet = modelToCsvSheets(parse(text))                                 // [{ name, csv }] — one per sheet
// XLSX (whole workbook, lazy-loaded):
const { exportXlsx, importXlsx } = await import('@defterjs/xlsx')
```

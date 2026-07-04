# Expose Defter sheet editing over MCP

Any host embedding Defter can let agents make **structured, minimal-diff** sheet edits — instead of
rewriting the whole document body — with almost no code. `@defterjs/core` ships the reusable pieces:

- **`SheetOp`** — a discriminated-union edit (discriminant `kind`), JSON-serializable.
- **`applyOp(text, op)`** — the single dispatcher: canonical markdown + one op → new canonical
  markdown. All reference rewriting (formulas *and* style targets on insert/delete) flows through.
- **`applyOps(text, ops)`** — apply a list left-to-right (each op sees the prior result); a throwing
  op aborts the whole batch, so a host can reject the edit atomically.
- **`SHEET_OP_SCHEMA`** — a runtime JSON Schema (`oneOf` over the `kind` variants) you drop straight
  into your MCP tool's parameter schema, so the agent gets the op shape + descriptions.

This is host-agnostic library code — no MCP-protocol code lives in `@defterjs/core`. It works in any
host that can run the JS, in-process (a Node/TS backend) or as a small sidecar (see below).

## The recipe: ONE `edit_sheet` tool

Define a single tool whose parameter schema wraps `SHEET_OP_SCHEMA`. On call: load the page's
canonical text, `applyOp` the op, and persist the result **through your host's normal save path** so
revisions / collaboration / search-reindex all fire exactly as a human edit would.

```ts
import { applyOp, SHEET_OP_SCHEMA } from '@defterjs/core'

// Register with your MCP server (shape depends on your SDK):
server.tool('edit_sheet', {
  description: 'Apply a structured edit to a Defter sheet (minimal diff, no whole-body rewrite).',
  inputSchema: {
    type: 'object',
    properties: {
      page_id: { type: 'string', description: 'the sheet/page to edit' },
      op: SHEET_OP_SCHEMA, // ← the op shape + per-field descriptions, for free
    },
    required: ['page_id', 'op'],
  },
  handler: async ({ page_id, op }) => {
    const current = await host.loadBody(page_id)      // canonical Defter markdown
    let next: string
    try {
      next = applyOp(current, op)                     // parse → dispatch → serialize
    } catch (e) {
      return { isError: true, content: [{ type: 'text', text: (e as Error).message }] }
    }
    await host.saveBody(page_id, next)                // normal save path: revisions/collab/reindex
    return { content: [{ type: 'text', text: 'ok' }] }
  },
})
```

`applyOp` throws a clear, host-surfaceable `Error` on bad input (bad A1 ref, unknown sheet,
out-of-range index, malformed op) — relay `err.message` back to the agent as the tool error.

To accept a batch in one call, take `op` as `{ oneOf: [SHEET_OP_SCHEMA, { type: 'array', items: SHEET_OP_SCHEMA }] }` and branch to `applyOps` for the array case.

## The op contract

Every op takes an optional `sheet` (0-based index **or** sheet name, case-insensitive; defaults to
the first sheet). `count` defaults to 1. Column addresses (`at` on insert/delete cols) accept a
letter `"C"` or a 0-based index.

| `kind` | Fields | Does |
|---|---|---|
| `setCells` | `cells: { ref, text }[]` | Batch-set cells. `ref` is A1 (`"B2"`); `text` is a literal or `=formula`. |
| `insertRows` | `at` (1-based row), `count?` | Insert blank rows; references shift down. |
| `deleteRows` | `at` (≥2), `count?` | Delete rows (row 1 is the header); references shift up. |
| `insertCols` | `at` (letter/index), `count?` | Insert blank columns; references shift right. |
| `deleteCols` | `at` (letter/index), `count?` | Delete columns; references shift left. |
| `setStyle` | `target`, `attrs` | Style a cell/range (`"A1"`, `"A1:D9"`), column (`"C:C"`), or rows (`"2:9"`). A column width is a `width` attr on a single-column target. |
| `setFreeze` | `rows?`, `cols?` | Freeze first N rows / M columns; both 0/omitted removes it. |
| `addSheet` | `name`, `after?` | Append a sheet, optionally right after `after`. |
| `renameSheet` | `sheet`, `name` | Rename a sheet. |
| `deleteSheet` | `sheet` | Delete a sheet (no-op if it's the only one). |

`attrs` (all optional): flags `bold italic underline strike wrap merge`; keys `fill color`
(theme token like `surface-3`/`accent-soft`, or `#hex`), `align` (`left|center|right`), `valign`
(`top|middle|bottom`), `format` (number format, e.g. `$#,##0.00`), `border` (`all|top|right|bottom|left`),
`font`, `size` (px), `width` (px, single-column target). See [`AGENTS.md`](AGENTS.md) §5 for the full
styling vocabulary.

Each op maps 1:1 to a `@defterjs/core` edit function (`setCell`, `insertRows`, `setStyle`,
`setFreeze`, …); `applyOp` is the single dispatcher over them, so a host never wires them one by one.

### Examples

```jsonc
{ "kind": "setCells", "cells": [{ "ref": "B2", "text": "10" }, { "ref": "D2", "text": "=B2*C2" }] }
{ "kind": "insertRows", "at": 2, "count": 1 }
{ "kind": "setStyle", "target": "A1:D1", "attrs": { "bold": true, "align": "center", "fill": "surface-3" } }
{ "kind": "setStyle", "target": "C:C", "attrs": { "width": 120 } }
{ "kind": "setFreeze", "rows": 1, "cols": 1 }
{ "kind": "addSheet", "name": "Q3", "after": 0 }
```

## Reading a sheet

For read tools (search / RAG / "what does it say"), hand the agent a **projection**, not the raw
body — it materializes computed formula values and strips styling:

- `projectText(model, { computed })` — the same clean table, values instead of formulas.
- `projectProse(model, { computed })` — one self-describing `header: value` line per row (ideal RAG
  chunks).
- `projectValuesModel(model, { computed })` — the projected model, if you need structure.

```ts
import { parse, projectText } from '@defterjs/core'
const text = projectText(parse(await host.loadBody(page_id)))
```

## Running it out-of-process (a sidecar)

A non-JS host (e.g. a Go backend) can run `@defterjs/core` as a tiny Node sidecar behind an HTTP
endpoint and call it from the MCP tool handler:

```ts
// sidecar.mjs — POST /apply { text, op } → { text } | 400 { error }
import { createServer } from 'node:http'
import { applyOp } from '@defterjs/core'

createServer((req, res) => {
  let buf = ''
  req.on('data', (c) => (buf += c))
  req.on('end', () => {
    try {
      const { text, op } = JSON.parse(buf)
      const out = applyOp(text, op)
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: out }))
    } catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' }).end(JSON.stringify({ error: String(e.message ?? e) }))
    }
  })
}).listen(7391)
```

The host's `edit_sheet` handler POSTs the current body + op to `/apply`, then persists the returned
`text` through its normal save path — identical flow to the in-process version, just over a socket.

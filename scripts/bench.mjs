// Defter performance harness. Generates synthetic sheets at several sizes and times the operations
// that matter for interactive editing: parse, serialize, a realistic single-cell edit cycle, the
// minimal CRDT splice, a full recompute (values are lazy, so we read every cell), a structural edit
// with reference rewriting, and the RAG projection. Run: `node scripts/bench.mjs` (build first).
//
// Reads the WORST honest case: the React grid reparses the whole document on every committed edit
// (`useMemo(() => parse(text), [text])`) and the engine has no incremental recompute, so the
// "edit cycle" and "recompute" rows are what an interactive session actually pays per keystroke.

import { parse, serialize, setCell, insertRows, diffSplice, projectText } from '../packages/core/dist/index.js'
import { createEngine } from '../packages/formula/dist/index.js'

const engine = createEngine()

const colLetter = (c) => {
  let s = ''
  for (let n = c; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s
  return s
}

// Build canonical Defter text: header + `rows` data rows × `cols` columns. `formulaFrac` of the
// numeric columns become formulas — row-local products plus one deep running-total chain (length
// `rows`) to stress the dependency graph, not just cell count.
function genSheet(rows, cols, formulaFrac) {
  const nFormula = Math.round(formulaFrac * (cols - 1))
  const header = ['Item', ...Array.from({ length: cols - 1 }, (_, i) => `C${i + 1}`)]
  const lines = [`| ${header.join(' | ')} |`, `|${'---|'.repeat(cols)}`]
  for (let r = 0; r < rows; r++) {
    const a1 = r + 2 // header is row 1
    const cells = [`Item${r}`]
    for (let c = 1; c < cols; c++) {
      const isFormula = c > cols - 1 - nFormula
      if (!isFormula) {
        cells.push(String(((r * 7 + c * 13) % 100) + 1))
      } else if (c === cols - 1 && nFormula > 0) {
        // running total: deep chain of length `rows`
        cells.push(r === 0 ? `=B${a1}` : `=${colLetter(cols - 1)}${a1 - 1}+B${a1}`)
      } else {
        cells.push(`=B${a1}*C${a1}`) // row-local product (B*C)
      }
    }
    lines.push(`| ${cells.join(' | ')} |`)
  }
  return lines.join('\n') + '\n'
}

function bench(fn, runs = 7) {
  for (let i = 0; i < 2; i++) fn() // warm up
  const t = []
  for (let i = 0; i < runs; i++) {
    const s = performance.now()
    fn()
    t.push(performance.now() - s)
  }
  t.sort((a, b) => a - b)
  return t[Math.floor(t.length / 2)] // median
}

const readAll = (model, g) => {
  let acc = 0
  for (const s of model.sheets)
    for (let r = 1; r <= s.grid.length; r++)
      for (let c = 0; c < s.width; c++) {
        const v = g.get(s.name, c, r)
        if (typeof v === 'number') acc += v
      }
  return acc
}

const ms = (n) => (n < 1 ? n.toFixed(2) : n < 100 ? n.toFixed(1) : Math.round(n).toString())
const pad = (s, w) => String(s).padStart(w)

// rows × cols → cells. Tall shapes (10 cols) are the common real case.
const SIZES = [
  [100, 10],
  [1_000, 10],
  [5_000, 10],
  [10_000, 10],
  [25_000, 10],
]

console.log(`\nDefter perf — node ${process.version}, engine=@defterjs/formula, ~30% formula cols (1 deep chain)\n`)
const cols = ['cells', 'text', 'parse', 'serialize', 'edit-cycle', 'diffSplice', 'recompute', 'insertRow', 'project']
const widths = [9, 8, 8, 10, 11, 11, 10, 10, 8]
console.log(cols.map((c, i) => pad(c, widths[i])).join('  '))
console.log(widths.map((w) => '-'.repeat(w)).join('  '))

for (const [rows, ncols] of SIZES) {
  const text = genSheet(rows, ncols, 0.3)
  const model = parse(text)
  const cells = rows * ncols
  const midRow = Math.floor(rows / 2) + 2
  const newText = serialize(setCell(model, 0, 1, midRow, '999'))

  const row = {
    cells,
    text: `${Math.round(text.length / 1024)}KB`,
    parse: bench(() => parse(text)),
    serialize: bench(() => serialize(model)),
    // realistic committed edit: mutate a cell → serialize → reparse (what the grid does per commit)
    'edit-cycle': bench(() => parse(serialize(setCell(model, 0, 1, midRow, '999')))),
    diffSplice: bench(() => diffSplice(text, newText)),
    recompute: bench(() => readAll(model, engine.compute(model))),
    insertRow: bench(() => insertRows(model, 0, midRow, 1)),
    project: bench(() => projectText(model, { computed: engine.compute(model) })),
  }
  const out = [
    pad(row.cells, widths[0]),
    pad(row.text, widths[1]),
    pad(ms(row.parse), widths[2]),
    pad(ms(row.serialize), widths[3]),
    pad(ms(row['edit-cycle']), widths[4]),
    pad(ms(row.diffSplice), widths[5]),
    pad(ms(row.recompute), widths[6]),
    pad(ms(row.insertRow), widths[7]),
    pad(ms(row.project), widths[8]),
  ]
  console.log(out.join('  '))
}
console.log('\nAll times are median ms over 7 runs (2 warmup). Lower is better.\n')

// Parity fixture generator.
//
// Reads representative Defter inputs (below) and, using the REAL TypeScript
// reference implementation (@defterjs/core, built to packages/core/dist),
// writes each input and its expected Tier-1 outputs under go/testdata/. The Go
// tests then assert byte-equality against these committed files.
//
// Run from the repo root after `pnpm --filter @defterjs/core build`:
//   node go/testdata/gen.mjs
//
// Expected outputs per fixture <id>:
//   inputs/<id>.dft         the raw input text
//   expected/<id>.normalize serialize(parse(text))                     — canonical form
//   expected/<id>.project   serialize(clearStyleRules(parse(text)))    — Tier-1 projectText
//   expected/<id>.prose     projectProse(parse(text))                  — no compute
//
// TIER-1 NOTE: expected/*.project is computed as "strip static style rules, then
// serialize" — exactly what the Go ProjectText does. This equals the reference
// projectText (no ComputedGrid) for every fixture EXCEPT where a `format` rule
// covers a literal-number cell: the reference reformats the number, the Tier-1
// Go layer (no number-format engine) leaves it verbatim. This script logs those
// divergences so the boundary is explicit.

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parse, serialize, projectProse, projectText } from '../../packages/core/dist/index.js'

const here = dirname(fileURLToPath(import.meta.url))
const inputsDir = resolve(here, 'inputs')
const expectedDir = resolve(here, 'expected')
mkdirSync(inputsDir, { recursive: true })
mkdirSync(expectedDir, { recursive: true })

const F = String.raw // helper so backticks/backslashes in fixtures survive

// --- Fixtures ---------------------------------------------------------------
const fixtures = {}
const add = (id, text) => {
  fixtures[id] = text
}

// From apps/demo/src/samples.ts
add(
  'sample-invoice',
  `## Sheet: Invoice

| Item | Qty | Unit | Total |
| --- | ---: | ---: | ---: |
| Design system audit | 12 | 140 | =B2*C2 |
| Component build | 34 | 120 | =B3*C3 |
| Motion & polish | 8 | 160 | =B4*C4 |
| Subtotal |  |  | =SUM(D2:D4) |
| Tax (20%) |  |  | =D5*0.2 |
| **Total due** |  |  | =D5+D6 |

\`\`\`defter-style
A1:D1  bold fill=surface-3 align=center
D2:D7  format=$#,##0.00
A5:A7  bold
D5:D7  bold border=top
A7:D7  fill=accent-soft
\`\`\`
`,
)

add(
  'sample-budget',
  `## Sheet: Q3 Budget

| Team | Planned | Actual | Variance | Status |
| --- | ---: | ---: | ---: | :-: |
| Engineering | 42000 | 39120 | =B2-C2 | =IF(D2>=0,"under","over") |
| Design | 18000 | 19850 | =B3-C3 | =IF(D3>=0,"under","over") |
| Marketing | 27000 | 24300 | =B4-C4 | =IF(D4>=0,"under","over") |
| Ops | 15500 | 15500 | =B5-C5 | =IF(D5>=0,"under","over") |
| **All teams** | =SUM(B2:B5) | =SUM(C2:C5) | =B6-C6 | =IF(D6>=0,"under","over") |

\`\`\`defter-style
A1:E1  bold fill=surface-3
B2:D6  format=#,##0
A6:E6  bold border=top
when D2:D6 >= 0  color=success
when D2:D6 < 0  color=danger bold
chart type=bar title="Planned vs Actual" x=A2:A5 y=B2:B5,C2:C5
chart type=pie title="Budget share" x=A2:A5 y=B2:B5
\`\`\`
`,
)

add(
  'sample-planner',
  `## Sheet: Roadmap

| Feature | Effort | Impact | Score | Priority | Status |
| --- | ---: | ---: | ---: | :-: | :-: |
| Minimal-splice CRDT | 8 | 10 | =C2/B2 | =IF(D2>=1,"P0","P1") | Done |
| Charts in style layer | 5 | 7 | =C3/B3 | =IF(D3>=1,"P0","P1") | Done |
| xlsx import | 3 | 6 | =C4/B4 | =IF(D4>=1,"P0","P1") | Doing |
| Multi-cursor awareness | 6 | 5 | =C5/B5 | =IF(D5>=1,"P0","P1") | Todo |

\`\`\`defter-style
A1:F1  bold fill=accent-soft align=center
D2:D5  format=0.00
E2:E5  bold
validate F2:F5 list=Todo,Doing,Done
when D2:D5 >= 1  fill=success-soft
\`\`\`
`,
)

add(
  'sample-multi',
  `## Sheet: Sales

| Month | Units | Price | Revenue |
| --- | ---: | ---: | ---: |
| Jan | 120 | 29 | =B2*C2 |
| Feb | 145 | 29 | =B3*C3 |
| Mar | 190 | 32 | =B4*C4 |

\`\`\`defter-style
A1:D1  bold fill=surface-3
D2:D4  format=$#,##0
name Revenue = D2:D4
\`\`\`

## Sheet: Summary

| Metric | Value |
| --- | ---: |
| Total units | =SUM(Sales!B2:B4) |
| Total revenue | =SUM(Revenue) |
| Avg price | =Summary!B3/Summary!B2 |
| Best month | =Sales!A4 |

\`\`\`defter-style
A1:B1  bold fill=accent-soft
B2  format=#,##0
B3:B4  format=$#,##0.00
\`\`\`
`,
)

// From packages/core test files
add(
  'roundtrip-worked',
  `## Sheet: Budget

| Item | Qty | Unit | Total |
| --- | --- | --- | --- |
| Widget | 3 | 4.00 | =B2*C2 |
| Gadget | 5 | 2.50 | =B3*C3 |
| **Total** |  |  | =SUM(D2:D3) |

\`\`\`defter-style
A1:D1  bold fill=surface-2 align=center
C2:D4  format=#,##0.00
\`\`\`
`,
)

add('bare-table', `| a | b |\n| --- | --- |\n| 1 | 2 |\n`)
add('escaped-pipes', `| a | b |\n| :-- | --: |\n| x \\| y | 2 |\n`)
add(
  'multi-sheet-min',
  `## Sheet: One\n\n| a |\n| --- |\n| 1 |\n\n## Sheet: Two\n\n| b |\n| --- |\n| 2 |\n`,
)

add(
  'charts-single',
  `## Sheet: S

| Month | Sales |
| --- | ---: |
| Jan | 10 |
| Feb | 20 |
| Mar | 30 |

\`\`\`defter-style
A1:B1  bold
chart type=bar title="Monthly sales" x=A2:A4 y=B2:B4
\`\`\`
`,
)

add(
  'charts-multiseries',
  '## Sheet: S\n\n| m | a | b |\n|---|---:|---:|\n| Jan | 1 | 4 |\n| Feb | 2 | 5 |\n\n```defter-style\nchart type=bar x=A2:A3 y=B2:B3,C2:C3\n```\n',
)

add(
  'conditional',
  `## Sheet: S

| Team | Var |
| --- | ---: |
| A | 5 |
| B | -3 |
| C | 0 |

\`\`\`defter-style
A1:B1  bold
when B2:B4 < 0  color=danger bold
when B2:B4 >= 0  color=success
\`\`\`
`,
)

add(
  'validation',
  `## Sheet: S

| Task | Status |
| --- | :-: |
| A | Todo |
| B | Done |

\`\`\`defter-style
validate B2:B3 list=Todo,Doing,Done
\`\`\`
`,
)

// Edge cases exercising the lenient parser + escaping + merges + prose.
add('empty', ``)
add('whitespace-only', `   \n\t\n  `)
add(
  'prose-around-table',
  `Some intro prose that should be ignored.

| Name | Age |
| --- | ---: |
| Alice | 30 |
| Bob | 25 |

A trailing paragraph, also ignored.
`,
)
add('ragged-rows', `| a | b | c |\n| --- | --- | --- |\n| 1 |\n| 4 | 5 | 6 | 7 |\n`)
add('no-delimiter', `| Name | Score |\n| Alice | 10 |\n| Bob | 20 |\n`)
add(
  'merge',
  `## Sheet: Merged

| Q1 | Q2 | Q3 | Q4 |
| --- | --- | --- | --- |
| 1 | 2 | 3 | 4 |

\`\`\`defter-style
A1:D1  merge bold align=center fill=surface-2
\`\`\`
`,
)
add(
  'duplicate-sheet-names',
  `## Sheet: Data\n\n| a |\n| --- |\n| 1 |\n\n## Sheet: Data\n\n| b |\n| --- |\n| 2 |\n`,
)
add(
  'style-before-table',
  '```defter-style\nA1:B1  bold\n```\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n',
)
add('multiline-and-backslash', `| note | val |\n| --- | --- |\n| line1\\nline2 | a\\\\b |\n`)
add('unicode', `| Ürün | Fiyat |\n| --- | ---: |\n| Çay | 15 |\n| Kahve | 25 |\n`)
add('col-widths', `| a | b |\n| --- | --- |\n| 1 | 2 |\n\n\`\`\`defter-style\nA:A  width=120\nB:B  width=80.5\n\`\`\`\n`)
add(
  'absolute-and-crosssheet',
  `## Sheet: Ref

| x | y |
| --- | --- |
| 1 | =$A$2+Other!B2 |

\`\`\`defter-style
name Fixed = $A$2:$B$5
\`\`\`
`,
)
add(
  'size-and-align',
  `| h |\n| :-: |\n| v |\n\n\`\`\`defter-style\nA1  bold italic underline strike size=14 valign=middle font=mono\nA:A  align=right\n1:1  bold\n\`\`\`\n`,
)

// From docs/FORMAT.md worked example (loose delimiter `|---|`)
add(
  'format-doc-example',
  `## Sheet: Budget

| Item | Qty | Unit | Total |
|---|---|---|---|
| Widget | 3 | 4.00 | =B2*C2 |
| Gadget | 5 | 2.50 | =B3*C3 |
| **Total** |  |  | =SUM(D2:D3) |

\`\`\`defter-style
A1:D1  bold fill=surface-2 align=center
C2:D4  format=#,##0.00
D5  bold
\`\`\`
`,
)

// --- Emit -------------------------------------------------------------------
const clearStyleRules = (text) => {
  const m = parse(text)
  for (const s of m.sheets) s.styles = []
  return serialize(m)
}

const divergences = []
for (const [id, text] of Object.entries(fixtures)) {
  writeFileSync(resolve(inputsDir, `${id}.dft`), text)
  const normalized = serialize(parse(text))
  writeFileSync(resolve(expectedDir, `${id}.normalize`), normalized)
  const tier1Project = clearStyleRules(text)
  writeFileSync(resolve(expectedDir, `${id}.project`), tier1Project)
  writeFileSync(resolve(expectedDir, `${id}.prose`), projectProse(parse(text)))

  // Idempotence invariant (must hold for every fixture).
  const twice = serialize(parse(normalized))
  if (twice !== normalized) throw new Error(`idempotence FAILED for ${id}`)

  // Document where Tier-1 projectText differs from the reference (no compute).
  const refProject = projectText(parse(text))
  if (refProject !== tier1Project) divergences.push(id)
}

console.log(`wrote ${Object.keys(fixtures).length} fixtures to go/testdata/{inputs,expected}`)
console.log(
  divergences.length
    ? `Tier-1 projectText diverges from reference (literal number-format) for: ${divergences.join(', ')}`
    : 'Tier-1 projectText matches reference for all fixtures',
)
void F

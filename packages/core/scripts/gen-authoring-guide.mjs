// Assemble the agent authoring guide into the @defterjs/core package from the
// single source of truth: repo-root docs/AGENTS.md. Runs before `tsc -b`.
//
// Emits two artifacts, both derived from that one file (kept DRY — never edit
// them by hand):
//   1. src/authoring-guide.ts  → the `AUTHORING_GUIDE` string export (compiled by tsc)
//   2. <package>/AGENTS.md      → a verbatim copy shipped in the tarball, so a host
//      can read it at node_modules/@defterjs/core/AGENTS.md
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = resolve(here, '..')
const source = resolve(pkgDir, '../../docs/AGENTS.md')

const text = readFileSync(source, 'utf8')

// 1. TS export — JSON.stringify yields a safe double-quoted string literal.
const ts = `// GENERATED — do not edit. Source: docs/AGENTS.md
// Regenerate with: pnpm --filter @defterjs/core build
/** The Defter sheet authoring contract for LLM agents (verbatim docs/AGENTS.md). */
export const AUTHORING_GUIDE: string = ${JSON.stringify(text)}
`
writeFileSync(resolve(pkgDir, 'src/authoring-guide.ts'), ts)

// 2. Verbatim copy shipped at the package root.
copyFileSync(source, resolve(pkgDir, 'AGENTS.md'))

console.log('gen-authoring-guide: wrote src/authoring-guide.ts + AGENTS.md from docs/AGENTS.md')

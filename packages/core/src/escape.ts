/**
 * Cell-text escaping between the logical form (real characters, stored in the model) and the
 * serialized form (safe inside a single `|`-delimited, one-line table row).
 *
 * Rules: `\` → `\\`, `|` → `\|`, newline → `\n`. Carriage returns are dropped. Unescaping is
 * the left-to-right inverse: `\\`→`\`, `\|`→`|`, `\n`→newline, `\<other>`→`<other>`.
 */

export function escapeCell(logical: string): string {
  return logical
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\r/g, '')
    .replace(/\n/g, '\\n')
}

export function unescapeCell(serialized: string): string {
  return serialized.replace(/\\(.)/g, (_, c: string) => (c === 'n' ? '\n' : c))
}

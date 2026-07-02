/** Tiny inline-markdown renderer for cell display: **bold**, *italic*, `code`, [text](url). */

import type { ReactNode } from 'react'

const TOKEN = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g

export function renderInline(text: string): ReactNode {
  if (!text || !/[*`[]/.test(text)) return text
  const parts: ReactNode[] = []
  let last = 0
  let key = 0
  for (const m of text.matchAll(TOKEN)) {
    const idx = m.index ?? 0
    if (idx > last) parts.push(text.slice(last, idx))
    const tok = m[0]
    if (tok.startsWith('**')) parts.push(<strong key={key++}>{tok.slice(2, -2)}</strong>)
    else if (tok.startsWith('`')) parts.push(<code key={key++}>{tok.slice(1, -1)}</code>)
    else if (tok.startsWith('*')) parts.push(<em key={key++}>{tok.slice(1, -1)}</em>)
    else if (tok.startsWith('[')) {
      const mm = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(tok)
      if (mm)
        parts.push(
          <a key={key++} href={mm[2]} target="_blank" rel="noreferrer">
            {mm[1]}
          </a>,
        )
    }
    last = idx + tok.length
  }
  if (last < text.length) parts.push(text.slice(last))
  return parts
}

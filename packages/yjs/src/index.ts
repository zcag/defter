/**
 * Yjs binding for Defter. The contract is exactly the one the design seed calls for: *give me a
 * `Y.Text` and I'll keep it in sync with the canonical text*. The transport, persistence, and
 * awareness are the host's concern — this package ships no provider.
 *
 * A local edit is applied to the `Y.Text` as a **minimal splice** (shared prefix/suffix diff), so
 * concurrent edits to different cells occupy disjoint character spans and the CRDT auto-merges.
 */

import { diffSplice } from '@defter/core'
import { useCallback, useEffect, useState } from 'react'
import type * as Y from 'yjs'

/** Apply new canonical text to a `Y.Text` as one minimal splice, inside a transaction. */
export function applyTextToYText(ytext: Y.Text, next: string, origin?: unknown): void {
  const current = ytext.toString()
  if (current === next) return
  const { index, remove, insert } = diffSplice(current, next)
  const run = () => {
    if (remove > 0) ytext.delete(index, remove)
    if (insert.length > 0) ytext.insert(index, insert)
  }
  if (ytext.doc) ytext.doc.transact(run, origin)
  else run()
}

/**
 * React hook: mirror a `Y.Text` into state and return an updater that writes back as a minimal
 * splice. Pass the pair straight to `<DefterGrid text=... onChange=... />`.
 */
export function useYText(ytext: Y.Text): [string, (next: string) => void] {
  const [text, setText] = useState(() => ytext.toString())

  useEffect(() => {
    const sync = () => setText(ytext.toString())
    sync()
    ytext.observe(sync)
    return () => ytext.unobserve(sync)
  }, [ytext])

  const update = useCallback((next: string) => applyTextToYText(ytext, next, 'local'), [ytext])
  return [text, update]
}

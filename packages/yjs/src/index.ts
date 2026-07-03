/**
 * Yjs binding for Defter. The contract is exactly the one the design seed calls for: *give me a
 * `Y.Text` and I'll keep it in sync with the canonical text*. The transport, persistence, and
 * awareness are the host's concern — this package ships no provider.
 *
 * A local edit is applied to the `Y.Text` as a **minimal splice** (shared prefix/suffix diff), so
 * concurrent edits to different cells occupy disjoint character spans and the CRDT auto-merges.
 */

import { diffSplice } from '@defterjs/core'
import { useCallback, useEffect, useRef, useState } from 'react'
import * as Y from 'yjs'

/** The Yjs transaction origin used by {@link useYText}/{@link applyTextToYText} for local edits. */
export const LOCAL_ORIGIN = 'local'

/** Apply new canonical text to a `Y.Text` as one minimal splice, inside a transaction. */
export function applyTextToYText(ytext: Y.Text, next: string, origin: unknown = LOCAL_ORIGIN): void {
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

  const update = useCallback((next: string) => applyTextToYText(ytext, next, LOCAL_ORIGIN), [ytext])
  return [text, update]
}

/** Local-only undo/redo, the shape `<DefterGrid undo redo canUndo canRedo />` expects. */
export interface YUndo {
  undo: () => void
  redo: () => void
  canUndo: boolean
  canRedo: boolean
}

export interface YUndoOptions {
  /**
   * Origins whose changes this undo tracks. Defaults to `[LOCAL_ORIGIN]` — i.e. only *this* user's
   * edits, so undo never reverts a remote peer's concurrent change. Widen it only if you tag local
   * edits with a different origin.
   */
  trackedOrigins?: unknown[]
  /** Group edits made within this many ms into one undo step (Yjs default 500). */
  captureTimeout?: number
}

/**
 * Build a `Y.UndoManager` scoped to the local origin and expose it as `{ undo, redo, canUndo,
 * canRedo }`. This is the CRDT-correct undo for a shared `Y.Text`: it reverts only the changes made
 * under `trackedOrigins` (the local user), never a remote peer's concurrent edit. Pass the result
 * straight into `<DefterGrid undo=... redo=... canUndo=... canRedo=... />`.
 */
export function useYUndo(ytext: Y.Text, options?: YUndoOptions): YUndo {
  const [state, setState] = useState({ canUndo: false, canRedo: false })
  const managerRef = useRef<Y.UndoManager | null>(null)
  const captureTimeout = options?.captureTimeout
  const tracked = options?.trackedOrigins

  // biome-ignore lint/correctness/useExhaustiveDependencies: trackedOrigins is spread into a Set, not compared by identity.
  useEffect(() => {
    const um = new Y.UndoManager(ytext, {
      trackedOrigins: new Set(tracked ?? [LOCAL_ORIGIN]),
      captureTimeout: captureTimeout ?? 500,
    })
    managerRef.current = um
    const update = () => setState({ canUndo: um.canUndo(), canRedo: um.canRedo() })
    um.on('stack-item-added', update)
    um.on('stack-item-popped', update)
    um.on('stack-cleared', update)
    update()
    return () => {
      um.off('stack-item-added', update)
      um.off('stack-item-popped', update)
      um.off('stack-cleared', update)
      um.destroy()
      managerRef.current = null
    }
  }, [ytext, captureTimeout])

  const undo = useCallback(() => managerRef.current?.undo(), [])
  const redo = useCallback(() => managerRef.current?.redo(), [])
  return { undo, redo, canUndo: state.canUndo, canRedo: state.canRedo }
}

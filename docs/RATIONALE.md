# Design rationale & honest trade-offs

Defter makes some non-obvious choices. This is why, and what each one costs.

## Text is canonical for *content*; presentation is a co-canonical layer

The pure slogan "the plain markdown table is the single source of truth" is incompatible with
rich functionality (colors, merges, formats, charts) — you cannot express those in a GFM table.
So Defter splits the document into two co-canonical regions, both serialized as text:

- **Content** — the markdown table (labels, values, formulas). Clean prose, what RAG/full-text
  search index, what an unaware markdown pipeline renders, the degrade-to target.
- **Presentation** — a `defter-style` block keyed by A1 range (fills, formats, merges, borders,
  conditional formatting, charts). Ignored by unaware tools; the plain table still stands.

Neither is "the" truth; the document is the pair. Both are diffable text. What we give up is the
purity slogan and human-readable diffs *of styling* — a color diff is structured data, and that's
fine because nobody reads color diffs.

## Compact, never padded

Pretty aligned columns would make one cell's width change re-pad the whole column — rewriting
every row of that column on every edit. That is the opposite of a minimal splice and a conflict
magnet under a text CRDT. So the canonical form is compact (single constant space around cells,
no alignment padding). Alignment is a **render-time** concern. This is the one place we diverge
from org-mode / GitHub's always-realign tables — deliberately, because their mechanism fights
collaboration.

## One row = one line

A row is exactly one line. Structural row insert/delete is then a whole-line operation, which a
line/char CRDT merges far more cleanly than a mid-line splice, and row edits never touch
neighbouring rows.

## Collaboration: inject the shared type, don't own the socket

`@defterjs/react` accepts a `Y.Text` (content) and a `Y.Map` (style layer) from the host and binds
to them. It ships **no** network/persistence/awareness provider. The transport is entirely the
host's concern — which is what lets a host (e.g. tela) reuse its existing Yjs collab wholesale.

### The honest limit: convergence ≠ validity

A character CRDT guarantees everyone converges on the same bytes, **not** that those bytes form a
valid table (concurrent structural edits can interleave into mismatched pipe counts or torn rows).
Two mitigations, both required:

1. **Cell-content edits** ride on `Y.Text` cleanly (disjoint spans → clean auto-merge).
2. **Structural edits** (insert/delete row/col, which rewrite references throughout) do **not**
   merge safely as raw text. Defter provides a deterministic normalization/repair pass on read so
   all clients heal to the same valid grid, and treats concurrent structural edits as best-effort
   rather than pretending they auto-merge. We do not oversell this.

**Normalize before binding.** The canonical text must be run through `normalize()` (=
`serialize(parse(text))`) *once* before it is bound to a `Y.Text`. Otherwise the first edit's
serialize also applies one-time normalization (e.g. collapsing `---:` alignment padding), which
makes that edit's splice non-minimal — and a non-minimal splice can overlap a concurrent edit and
interleave into invalid text. Our convergence test proves the disjoint-cell merge holds *given*
this pass; it's a real precondition, not a footnote.

## Search / RAG see labels and formulas, not computed values

Formula cells store `=SUM(...)`, never the computed number. So a raw index sees formulas, not
answers. The **projection** (a derived, values-materialized, style-stripped view) exists exactly
to give search/RAG the numbers. It is never canonical, always regenerated, and one-way. A host
persists it as a disposable sidecar if it wants searchable values.

## Agents author via ops, and generate from scratch

An agent can generate a whole sheet as text from a small documented contract, **and** edit an
existing collaborative sheet — but editing goes through the same structured op / minimal-splice
API humans use, never a full-body rewrite (which would clobber concurrent edits). "LLMs can't
author structure" is false — they emit JSON all day — so the style layer being structured costs
nothing on agent-authoring.

## The ceiling we *don't* pretend away

Merged cells are modelled as presentation metadata over a still-rectangular content grid (the
covered cells stay in the table, empty), so they don't break one-row-one-line. Charts are objects
in the style layer referencing ranges, invisible to text/RAG (the projection emits a text
description). Genuinely pixel-precise, cell-by-cell-freeform layouts are out of scope — that is a
different, structured product.

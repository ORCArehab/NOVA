import type { HighlightedRow } from './types'

// Keeps each request well under the server's 2 MB JSON limit (and
// Vercel's 4.5 MB body cap) — full-width row crops measured ~15-30 KB each.
const MAX_BATCH_ROWS = 10
const MAX_BATCH_CHARS = 1_400_000

export function batchRows(rows: HighlightedRow[]): HighlightedRow[][] {
  const batches: HighlightedRow[][] = []
  let current: HighlightedRow[] = []
  let size = 0
  for (const row of rows) {
    const rowSize = row.cropDataUrl.length
    if (current.length > 0 && (current.length >= MAX_BATCH_ROWS || size + rowSize > MAX_BATCH_CHARS)) {
      batches.push(current)
      current = []
      size = 0
    }
    current.push(row)
    size += rowSize
  }
  if (current.length > 0) batches.push(current)
  return batches
}

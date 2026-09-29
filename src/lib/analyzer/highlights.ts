import type { HighlightBand, HighlightColor, PageScan, PixelBuffer } from './types'

// Deterministic highlighter detection on a rendered page — no AI involved.
// Highlighter ink is light AND saturated: a bright color that's clearly
// not white paper, not black/blue pen, and not a dark saturated ink like
// red pen. Thresholds are tuned for ~150 DPI renders of scanned sheets.
const MIN_MAX_CHANNEL = 170 // bright
const MIN_MIN_CHANNEL = 70 // light — excludes red/blue pen ink
const MIN_CHROMA = 45 // colored — excludes white/gray paper and black text

export function isHighlighterPixel(r: number, g: number, b: number): boolean {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  return max >= MIN_MAX_CHANNEL && min >= MIN_MIN_CHANNEL && max - min >= MIN_CHROMA
}

export function classifyColor(r: number, g: number, b: number): HighlightColor {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const chroma = max - min
  if (chroma === 0) return 'other'
  let hue: number
  if (max === r) hue = ((g - b) / chroma) % 6
  else if (max === g) hue = (b - r) / chroma + 2
  else hue = (r - g) / chroma + 4
  hue = (hue * 60 + 360) % 360

  if (hue < 20 || hue >= 290) return 'pink'
  if (hue < 45) return 'orange'
  if (hue < 75) return 'yellow'
  if (hue < 170) return 'green'
  if (hue < 250) return 'blue'
  return 'other'
}

export interface DetectOptions {
  // A pixel row counts as highlighted when at least this fraction of the
  // page width is highlighter-colored — a short name is still ~5% of an
  // 8.5" page, while pen marks and speckle are far less.
  minRowFraction?: number
  // Highlighted rows separated by a gap this small (px) merge into one
  // band — text strokes over the marker punch small holes in it.
  maxGap?: number
  // Bands shorter than this fraction of the page height are noise.
  minBandFraction?: number
  // A page with more than this fraction of all pixels highlighter-colored
  // is tinted paper or a color cast, not highlights.
  maxPageFraction?: number
}

const DEFAULTS: Required<DetectOptions> = {
  minRowFraction: 0.03,
  maxGap: 4,
  minBandFraction: 0.004,
  maxPageFraction: 0.25,
}

export function detectHighlightBands(pixels: PixelBuffer, page: number, options: DetectOptions = {}): PageScan {
  const { minRowFraction, maxGap, minBandFraction, maxPageFraction } = { ...DEFAULTS, ...options }
  const { width, height, data } = pixels

  const rowCounts = new Uint32Array(height)
  const rowMinX = new Int32Array(height).fill(width)
  const rowMaxX = new Int32Array(height).fill(-1)
  // Summed color of highlighter pixels per row, to pick each band's hue.
  const rowR = new Float64Array(height)
  const rowG = new Float64Array(height)
  const rowB = new Float64Array(height)
  let total = 0

  for (let y = 0; y < height; y++) {
    let offset = y * width * 4
    for (let x = 0; x < width; x++, offset += 4) {
      const r = data[offset]
      const g = data[offset + 1]
      const b = data[offset + 2]
      if (!isHighlighterPixel(r, g, b)) continue
      rowCounts[y]++
      rowR[y] += r
      rowG[y] += g
      rowB[y] += b
      if (x < rowMinX[y]) rowMinX[y] = x
      if (x > rowMaxX[y]) rowMaxX[y] = x
    }
    total += rowCounts[y]
  }

  if (total / (width * height) > maxPageFraction) {
    return { page, bands: [], unreliable: true }
  }

  const rowThreshold = Math.max(1, Math.round(width * minRowFraction))
  const minBandHeight = Math.max(2, Math.round(height * minBandFraction))
  const bands: HighlightBand[] = []

  let start = -1
  let lastHit = -1
  const flush = () => {
    if (start === -1) return
    const top = start
    const bottom = lastHit
    if (bottom - top + 1 >= minBandHeight) bands.push(summarizeBand(top, bottom))
    start = -1
  }

  const summarizeBand = (top: number, bottom: number): HighlightBand => {
    let left = width
    let right = -1
    let count = 0
    let r = 0
    let g = 0
    let b = 0
    for (let y = top; y <= bottom; y++) {
      if (rowCounts[y] === 0) continue
      left = Math.min(left, rowMinX[y])
      right = Math.max(right, rowMaxX[y])
      count += rowCounts[y]
      r += rowR[y]
      g += rowG[y]
      b += rowB[y]
    }
    const area = Math.max(1, (right - left + 1) * (bottom - top + 1))
    return {
      top,
      bottom,
      left,
      right,
      color: classifyColor(r / count, g / count, b / count),
      density: count / area,
    }
  }

  for (let y = 0; y < height; y++) {
    if (rowCounts[y] >= rowThreshold) {
      if (start === -1) start = y
      lastHit = y
    } else if (start !== -1 && y - lastHit > maxGap) {
      flush()
    }
  }
  flush()

  return { page, bands, unreliable: false }
}

// The rectangle to crop for one band: the full page width (a marker often
// covers only the name, but the rest of the row gives the AI context and
// the reviewer a readable source), padded vertically just enough that text
// riding the edge of the stroke isn't clipped. Kept small on purpose: the
// more of the neighboring rows a crop shows, the more likely the AI reads
// an unhighlighted patient out of it.
export function cropRectForBand(band: HighlightBand, pageWidth: number, pageHeight: number) {
  const bandHeight = band.bottom - band.top + 1
  const pad = Math.max(4, Math.round(bandHeight * 0.2))
  const top = Math.max(0, band.top - pad)
  const bottom = Math.min(pageHeight - 1, band.bottom + pad)
  return { x: 0, y: top, width: pageWidth, height: bottom - top + 1 }
}

export function median(values: number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

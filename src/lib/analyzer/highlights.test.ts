import { describe, expect, it } from 'vitest'
import { classifyColor, cropRectForBand, detectHighlightBands, isHighlighterPixel, median } from './highlights'
import type { PixelBuffer } from './types'

type RGB = [number, number, number]

// A synthetic "scanned page": off-white paper, with rectangles painted on.
function page(width: number, height: number, paper: RGB = [248, 247, 244]): PixelBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = paper[0]
    data[i + 1] = paper[1]
    data[i + 2] = paper[2]
    data[i + 3] = 255
  }
  return { width, height, data }
}

function paint(buf: PixelBuffer, x0: number, y0: number, x1: number, y1: number, [r, g, b]: RGB) {
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const i = (y * buf.width + x) * 4
      buf.data[i] = r
      buf.data[i + 1] = g
      buf.data[i + 2] = b
    }
  }
}

const YELLOW: RGB = [250, 238, 110]
const PINK: RGB = [248, 150, 200]
const GREEN: RGB = [150, 238, 150]
const BLUE_HL: RGB = [140, 200, 245]
const BLACK: RGB = [20, 20, 20]
const RED_PEN: RGB = [200, 30, 30]
const BLUE_PEN: RGB = [30, 40, 140]

describe('isHighlighterPixel', () => {
  it('accepts common highlighter colors', () => {
    for (const c of [YELLOW, PINK, GREEN, BLUE_HL]) expect(isHighlighterPixel(...c)).toBe(true)
  })

  it('rejects paper, text, and pen ink', () => {
    for (const c of [[248, 247, 244], [200, 200, 200], BLACK, RED_PEN, BLUE_PEN] as RGB[]) {
      expect(isHighlighterPixel(...c)).toBe(false)
    }
  })
})

describe('classifyColor', () => {
  it('buckets highlighter hues', () => {
    expect(classifyColor(...YELLOW)).toBe('yellow')
    expect(classifyColor(...PINK)).toBe('pink')
    expect(classifyColor(...GREEN)).toBe('green')
    expect(classifyColor(...BLUE_HL)).toBe('blue')
    expect(classifyColor(255, 180, 80)).toBe('orange')
  })
})

describe('detectHighlightBands', () => {
  it('finds each highlighted row as its own band', () => {
    const buf = page(600, 800)
    paint(buf, 40, 100, 320, 120, YELLOW)
    paint(buf, 40, 200, 280, 221, YELLOW)

    const scan = detectHighlightBands(buf, 1)

    expect(scan.unreliable).toBe(false)
    expect(scan.bands).toHaveLength(2)
    expect(scan.bands[0]).toMatchObject({ top: 100, bottom: 120, left: 40, right: 320, color: 'yellow' })
    expect(scan.bands[1]).toMatchObject({ top: 200, bottom: 221 })
  })

  it('keeps a band whole when dark text punches holes through the marker', () => {
    const buf = page(600, 800)
    paint(buf, 40, 100, 320, 124, YELLOW)
    // Two lines of glyph strokes spanning the full highlight width.
    paint(buf, 40, 108, 320, 110, BLACK)
    paint(buf, 40, 114, 320, 115, BLACK)

    const scan = detectHighlightBands(buf, 1)

    expect(scan.bands).toHaveLength(1)
    expect(scan.bands[0]).toMatchObject({ top: 100, bottom: 124 })
  })

  it('ignores pen marks, specks, and plain text', () => {
    const buf = page(600, 800)
    paint(buf, 40, 300, 400, 302, RED_PEN) // a red pen underline
    paint(buf, 50, 400, 250, 414, BLACK) // a line of text
    paint(buf, 500, 500, 505, 505, YELLOW) // a stray speck

    expect(detectHighlightBands(buf, 1).bands).toEqual([])
  })

  it('reports each band’s color when a sheet mixes highlighters', () => {
    const buf = page(600, 800)
    paint(buf, 40, 100, 320, 120, YELLOW)
    paint(buf, 40, 300, 320, 320, PINK)

    expect(detectHighlightBands(buf, 1).bands.map((b) => b.color)).toEqual(['yellow', 'pink'])
  })

  it('flags tinted pages instead of reporting the whole page as highlighted', () => {
    const buf = page(600, 800, [245, 235, 150]) // yellow paper / heavy color cast

    expect(detectHighlightBands(buf, 3)).toEqual({ page: 3, bands: [], unreliable: true })
  })
})

describe('cropRectForBand', () => {
  it('spans the full page width with vertical padding, clamped to the page', () => {
    const band = { top: 2, bottom: 21, left: 40, right: 300, color: 'yellow' as const, density: 1 }
    expect(cropRectForBand(band, 600, 800)).toEqual({ x: 0, y: 0, width: 600, height: 26 })
  })
})

describe('median', () => {
  it('handles odd, even, and empty lists', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 2, 3])).toBe(2.5)
    expect(median([])).toBe(0)
  })
})

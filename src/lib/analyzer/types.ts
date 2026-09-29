// Types for the Document Analyzer — a billing/census sheet PDF in, a
// reviewed list of patients to import out. The pipeline is split so that
// deterministic image processing decides WHICH rows are highlighted
// (highlights.ts), and AI only interprets WHAT those rows say
// (server/routes/analyzeDocument.js). See AnalyzerScreen.tsx for how the
// stages are chained.

export type DocumentType = 'billing_sheet' | 'census_sheet' | 'unknown'

// Coarse hue bucket of a highlighter stroke — surfaced so a sheet marked
// up in more than one color is visible in review rather than silently
// merged.
export type HighlightColor = 'yellow' | 'orange' | 'pink' | 'green' | 'blue' | 'other'

// A rendered page's pixels — structurally the same as the browser's
// ImageData, so detection runs on real canvases and on synthetic test
// fixtures alike.
export interface PixelBuffer {
  width: number
  height: number
  data: Uint8ClampedArray
}

// One horizontal highlighted region on a page, in rendered-pixel
// coordinates.
export interface HighlightBand {
  top: number
  bottom: number
  left: number
  right: number
  color: HighlightColor
  // Fraction of the band's own bounding box that's highlighter-colored —
  // a solid marker stroke is dense, stray color specks are not.
  density: number
}

export interface PageScan {
  page: number
  bands: HighlightBand[]
  // Set when the page as a whole looks tinted (colored paper, a heavy
  // color cast from the scanner) — highlight detection on it is
  // unreliable, so its bands are dropped and the user is told why.
  unreliable: boolean
}

// A highlighted row cropped out of a page, ready to be read by the AI.
// cropDataUrl lives only in browser memory — it's shown in review so a
// questionable detection can be checked against the source, and it's
// never persisted.
export interface HighlightedRow {
  id: string
  page: number
  band: HighlightBand
  // Band height relative to the median band on the sheet — ~1 for a
  // normal single row, much larger when one stroke spans several rows.
  relativeHeight: number
  cropDataUrl: string
}

export type Legibility = 'clear' | 'partial' | 'unclear'

// What the server's AI interpretation returns for one cropped row. A crop
// can hold zero patients (a highlighted column header, a blank line) or
// several (one marker stroke across adjacent rows).
export interface RowReading {
  id: string
  notAPatientRow: boolean
  patients: { name: string | null; legibility: Legibility }[]
}

// What the server read off page 1's header (see server/analyzerSchema.js).
export interface HeaderReading {
  documentType: DocumentType
  facility: string | null
  // YYYY-MM-DD, or null when the sheet has no clearly printed date.
  date: string | null
  // True only when the sheet explicitly labels that date as the census /
  // service date — the difference between "this sheet is for Sep 28" and
  // "Sep 28 appears somewhere on it".
  dateLabeled: boolean
}

// Tiers rather than a percentage — the underlying signals (highlight
// shape, AI-reported legibility, name plausibility) don't support more
// precision than this.
export type Confidence = 'high' | 'medium' | 'low'

export interface DetectedPatient {
  id: string
  name: string
  page: number
  sourceRowId: string
  color: HighlightColor
  confidence: Confidence
  // Human-readable reasons behind a medium/low confidence.
  issues: string[]
}

export interface AnalysisResult {
  documentType: DocumentType
  facility: string | null
  // The date printed on the sheet — validation only. Where patients are
  // imported is the user's target rounding date (AnalyzerScreen), never
  // this; the two are compared in documentDate.ts.
  detectedDocumentDate: string | null
  detectedDateLabeled: boolean
  pageCount: number
  patients: DetectedPatient[]
  // Crops by row id, for "view source" in review.
  sources: Record<string, HighlightedRow>
  // Document-level notices (tinted pages, multiple colors, rows the AI
  // couldn't read) — shown above the review list.
  warnings: string[]
}

export type ReviewStatus = 'ready' | 'alreadyExists' | 'needsReview'

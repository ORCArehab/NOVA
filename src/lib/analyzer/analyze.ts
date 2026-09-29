import { ApiError, readDocumentHeader, readDocumentRows } from '../apiClient'
import { batchRows } from './batching'
import { findRepeatedNames } from './duplicates'
import { AnalyzerError, openPdf, scanDocument } from './ingest'
import type { AnalysisResult, HeaderReading, HighlightedRow, RowReading } from './types'
import { buildDetectedPatients } from './validate'

// The Document Analyzer pipeline, stage by stage:
//
//   openPdf         validate + load (browser)                   ingest.ts
//   scanDocument    render → detect highlights → crop rows      ingest.ts, highlights.ts
//   read*           AI reads header + cropped rows only         server/routes/analyzeDocument.js
//   buildDetected…  confidence from observable signals          validate.ts
//
// Duplicate status and the import itself happen later, on the review
// screen, against the facility the user confirms and the rounding date
// they chose before uploading.

export type AnalyzerProgress =
  | { step: 'opening' }
  | { step: 'scanning'; page: number; total: number }
  | { step: 'reading'; done: number; total: number }

const UNREADABLE = (id: string): RowReading => ({ id, notAPatientRow: false, patients: [{ name: null, legibility: 'unclear' }] })

// Two requests in flight at a time — faster than one, without tripping
// OpenAI rate limits on a long sheet.
const CONCURRENCY = 2

async function readAllRows(rows: HighlightedRow[], onProgress: (p: AnalyzerProgress) => void) {
  const batches = batchRows(rows)
  const readings: RowReading[][] = new Array(batches.length)
  let failedBatches = 0
  // The server's own message (written for users — see
  // server/routes/analyzeDocument.js) from the most recent failure.
  let lastError: string | null = null
  let done = 0
  let next = 0

  onProgress({ step: 'reading', done, total: rows.length })
  const worker = async () => {
    while (next < batches.length) {
      const index = next++
      const batch = batches[index]
      try {
        readings[index] = await readDocumentRows(batch.map((r) => ({ id: r.id, image: r.cropDataUrl })))
      } catch (err) {
        if (err instanceof ApiError) lastError = err.message
        // A failed batch doesn't sink the whole document — its rows come
        // back as unreadable, for the user to fill in from the source crop.
        failedBatches++
        readings[index] = batch.map((r) => UNREADABLE(r.id))
      }
      done += batch.length
      onProgress({ step: 'reading', done, total: rows.length })
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batches.length) }, worker))

  return { readings: readings.flat(), failedBatches, totalBatches: batches.length, lastError }
}

const COLOR_LABEL = { yellow: 'yellow', orange: 'orange', pink: 'pink', green: 'green', blue: 'blue', other: 'other' }

export async function analyzeDocument(file: File, onProgress: (p: AnalyzerProgress) => void): Promise<AnalysisResult> {
  onProgress({ step: 'opening' })
  const pdf = await openPdf(file)
  const scanned = await scanDocument(pdf, (page, total) => onProgress({ step: 'scanning', page, total }))
  const warnings: string[] = []

  const unreliablePages = scanned.pageScans.filter((s) => s.unreliable).map((s) => s.page)
  if (unreliablePages.length === scanned.pageCount) {
    throw new AnalyzerError(
      'NOVA couldn’t tell highlights apart from the page background — the scan looks tinted or colored throughout. Try rescanning in black-and-white-on-white with color enabled.',
    )
  }
  if (unreliablePages.length > 0) {
    warnings.push(`Page${unreliablePages.length > 1 ? 's' : ''} ${unreliablePages.join(', ')} looked tinted, so highlights there couldn’t be detected. Add any patients from ${unreliablePages.length > 1 ? 'those pages' : 'that page'} manually.`)
  }
  if (scanned.rows.length === 0) {
    throw new AnalyzerError('No highlighted patients were detected. Make sure the sheet was scanned in color so the highlighter shows up.')
  }

  const colors = new Set(scanned.rows.map((r) => r.band.color))
  if (colors.size > 1) {
    warnings.push(`This sheet uses more than one highlight color (${[...colors].map((c) => COLOR_LABEL[c]).join(', ')}). All of them were included — deselect any that shouldn’t be imported.`)
  }

  // Header and rows are independent — read them side by side. A header
  // failure isn't fatal: the facility just starts blank for the user.
  const headerPromise: Promise<HeaderReading | null> = readDocumentHeader(scanned.headerDataUrl).catch(() => null)
  const { readings, failedBatches, totalBatches, lastError } = await readAllRows(scanned.rows, onProgress)
  const header = await headerPromise

  if (failedBatches === totalBatches) {
    throw new AnalyzerError(`NOVA found ${scanned.rows.length} highlighted row${scanned.rows.length === 1 ? '' : 's'} but couldn’t read them. ${lastError ?? 'Please try again in a moment.'}`)
  }
  if (failedBatches > 0) {
    warnings.push('Some highlighted rows couldn’t be read. They’re listed below as “Needs review” — use View source to fill in the names.')
  }
  if (!header) {
    warnings.push('NOVA couldn’t read the header of this sheet. Enter the facility below.')
  }

  const { patients, ignoredRows } = buildDetectedPatients(scanned.rows, readings)
  if (patients.length === 0) {
    throw new AnalyzerError(
      ignoredRows > 0
        ? 'NOVA found highlighted rows, but none of them looked like patient rows. This layout may not be supported yet.'
        : 'No highlighted patients were detected.',
    )
  }

  // A patient highlighted twice on the sheet is kept once.
  const repeats = findRepeatedNames(patients)
  const unique = patients.filter((p) => !repeats.has(p.id))
  if (repeats.size > 0) {
    warnings.push(`${repeats.size} patient${repeats.size > 1 ? 's were' : ' was'} highlighted more than once on this sheet and ${repeats.size > 1 ? 'are' : 'is'} listed only once below.`)
  }

  return {
    documentType: header?.documentType ?? 'unknown',
    facility: header?.facility ?? null,
    detectedDocumentDate: header?.date ?? null,
    detectedDateLabeled: header?.dateLabeled ?? false,
    pageCount: scanned.pageCount,
    patients: unique,
    sources: Object.fromEntries(scanned.rows.map((r) => [r.id, r])),
    warnings,
  }
}

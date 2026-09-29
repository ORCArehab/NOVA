import { InvalidPDFException, PasswordException } from 'pdfjs-dist'
import type { PDFDocumentProxy } from 'pdfjs-dist'
// Importing pdfExtract also registers pdf.js's worker (GlobalWorkerOptions)
// — one setup shared with the note importer instead of a second one here.
import { pdfjsLib } from '../pdfExtract'
import { cropRectForBand, detectHighlightBands, median } from './highlights'
import type { HighlightedRow, PageScan } from './types'

// Everything in this module runs in the browser. The PDF and its rendered
// pages never leave it — only the cropped highlighted rows (and a crop of
// page 1's header) go to the server for reading. Canvases are discarded as
// soon as each page is done.

export class AnalyzerError extends Error {}

export const MAX_FILE_BYTES = 25 * 1024 * 1024
export const MAX_PAGES = 40

// ~150 DPI — enough for the AI to read printed names off a crop, small
// enough that scanning every pixel of a 40-page sheet stays quick.
const RENDER_DPI = 150
const MAX_RENDER_EDGE = 2400
// Crops are downscaled to this width before being sent — full-width rows
// at 150 DPI are ~1275px already, so this only bites on oversized pages.
const MAX_CROP_WIDTH = 1600
// Page 1's top slice, where facility name and service date are printed.
// Kept small and cut off above the first highlighted row: this crop is
// sent for reading too, and on a sheet with a short title block anything
// lower is table rows — names of patients nobody highlighted.
const HEADER_FRACTION = 0.12
const MIN_HEADER_FRACTION = 0.05

// Checks that don't need to open the file. Magic bytes are checked
// separately (readPdf) since a renamed .pdf can still be anything.
export function validateFileBasics(file: { name: string; type: string; size: number }): string | null {
  const looksLikePdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')
  if (!looksLikePdf) return 'Only PDF files can be analyzed. Export or scan the sheet as a PDF and try again.'
  if (file.size === 0) return 'This file is empty.'
  if (file.size > MAX_FILE_BYTES) {
    return `This PDF is too large (${Math.round(file.size / 1024 / 1024)} MB). The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB — try splitting it or scanning at a lower resolution.`
  }
  return null
}

export function hasPdfSignature(bytes: Uint8Array): boolean {
  // "%PDF-" may be preceded by a little junk; the spec allows it within
  // the first 1024 bytes.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024))
  return head.includes('%PDF-')
}

// The loaded document plus a way to free it — pdf.js keeps the parsed PDF
// (and its worker-side copy) alive until the loading task is destroyed.
export interface OpenedPdf {
  pdf: PDFDocumentProxy
  close: () => Promise<void>
}

export async function openPdf(file: File): Promise<OpenedPdf> {
  const basicsError = validateFileBasics(file)
  if (basicsError) throw new AnalyzerError(basicsError)

  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!hasPdfSignature(bytes)) {
    throw new AnalyzerError('This file isn’t a valid PDF, even though its name ends in .pdf.')
  }

  const task = pdfjsLib.getDocument({ data: bytes })
  const close = () => task.destroy()
  let pdf: PDFDocumentProxy
  try {
    pdf = await task.promise
  } catch (err) {
    await close()
    if (err instanceof PasswordException) {
      throw new AnalyzerError('This PDF is password-protected. Remove the password (or re-export it) and try again.')
    }
    if (err instanceof InvalidPDFException) {
      throw new AnalyzerError('This PDF appears to be damaged and couldn’t be opened.')
    }
    throw new AnalyzerError('Couldn’t open this PDF.')
  }

  if (pdf.numPages > MAX_PAGES) {
    await close()
    throw new AnalyzerError(`This PDF has ${pdf.numPages} pages. The limit is ${MAX_PAGES} — split it into smaller files and analyze each one.`)
  }
  return { pdf, close }
}

async function renderPage(pdf: PDFDocumentProxy, pageNumber: number): Promise<HTMLCanvasElement> {
  const page = await pdf.getPage(pageNumber)
  const base = page.getViewport({ scale: 1 })
  const scale = Math.min(RENDER_DPI / 72, MAX_RENDER_EDGE / Math.max(base.width, base.height))
  const viewport = page.getViewport({ scale })

  const canvas = document.createElement('canvas')
  canvas.width = Math.floor(viewport.width)
  canvas.height = Math.floor(viewport.height)
  // White background: a transparent canvas reads as black pixels, and
  // highlight annotations (for PDFs marked up digitally rather than on
  // paper) are drawn into this same render by default.
  await page.render({ canvas, viewport, background: '#ffffff' }).promise
  page.cleanup()
  return canvas
}

function cropToDataUrl(source: HTMLCanvasElement, rect: { x: number; y: number; width: number; height: number }): string {
  const scale = Math.min(1, MAX_CROP_WIDTH / rect.width)
  const out = document.createElement('canvas')
  out.width = Math.round(rect.width * scale)
  out.height = Math.max(1, Math.round(rect.height * scale))
  const ctx = out.getContext('2d')
  if (!ctx) throw new AnalyzerError('Your browser couldn’t process this PDF.')
  ctx.drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, out.width, out.height)
  return out.toDataURL('image/jpeg', 0.85)
}

export interface ScannedDocument {
  pageCount: number
  rows: HighlightedRow[]
  headerDataUrl: string
  pageScans: PageScan[]
}

// Render → detect → crop, one page at a time so only a single page's
// canvas is held in memory at once.
export async function scanDocument(
  { pdf, close }: OpenedPdf,
  onProgress: (page: number, total: number) => void,
): Promise<ScannedDocument> {
  const pageScans: PageScan[] = []
  const pending: { page: number; band: PageScan['bands'][number]; cropDataUrl: string }[] = []
  let headerDataUrl = ''

  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress(pageNumber, pdf.numPages)
      const canvas = await renderPage(pdf, pageNumber)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new AnalyzerError('Your browser couldn’t process this PDF.')

      const scan = detectHighlightBands(ctx.getImageData(0, 0, canvas.width, canvas.height), pageNumber)
      pageScans.push(scan)

      if (pageNumber === 1) {
        const firstBandTop = scan.bands[0]?.top ?? canvas.height
        const height = Math.max(
          Math.round(canvas.height * MIN_HEADER_FRACTION),
          Math.min(Math.round(canvas.height * HEADER_FRACTION), firstBandTop - 4),
        )
        headerDataUrl = cropToDataUrl(canvas, { x: 0, y: 0, width: canvas.width, height })
      }
      for (const band of scan.bands) {
        pending.push({ page: pageNumber, band, cropDataUrl: cropToDataUrl(canvas, cropRectForBand(band, canvas.width, canvas.height)) })
      }

      canvas.width = 0
      canvas.height = 0
    }
  } catch (err) {
    if (err instanceof AnalyzerError) throw err
    throw new AnalyzerError('Couldn’t render this PDF. It may be damaged or use an unsupported format.')
  } finally {
    await close()
  }

  const typicalHeight = median(pending.map((p) => p.band.bottom - p.band.top + 1)) || 1
  const rows: HighlightedRow[] = pending.map((p, i) => ({
    id: `r${i + 1}`,
    page: p.page,
    band: p.band,
    relativeHeight: (p.band.bottom - p.band.top + 1) / typicalHeight,
    cropDataUrl: p.cropDataUrl,
  }))

  return { pageCount: pageScans.length, rows, headerDataUrl, pageScans }
}

import * as pdfjsLib from 'pdfjs-dist'
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl

// Re-exported with the worker already configured, for the Document
// Analyzer (lib/analyzer/ingest.ts).
export { pdfjsLib }

export class PdfExtractError extends Error {}

export async function extractTextFromPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer()

  let pdf
  try {
    pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
  } catch {
    throw new PdfExtractError("Couldn't read this file — make sure it's a valid PDF.")
  }

  const pageTexts: string[] = []
  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item) => ('str' in item ? item.str : ''))
      .join(' ')
    pageTexts.push(pageText)
  }

  const text = pageTexts.join('\n\n').trim()

  if (text.length === 0) {
    throw new PdfExtractError(
      "This PDF doesn't contain selectable text (likely a scanned document). Scanned PDFs aren't supported in this version.",
    )
  }

  return text
}

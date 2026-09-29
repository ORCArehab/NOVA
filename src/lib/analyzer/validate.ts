import type { Confidence, DetectedPatient, HighlightedRow, RowReading } from './types'

// Turns the AI's readings of each highlighted row into reviewable patients,
// grading confidence from signals we can actually observe — the shape of
// the highlight (deterministic), the AI's own report of legibility, and
// whether the result looks like a name at all.

// Letters (any script), spaces, apostrophes, periods, and hyphens.
const NAME_PATTERN = /^\p{L}[\p{L}\s'’.-]*$/u

export function isPlausibleName(name: string): boolean {
  const trimmed = name.trim()
  return trimmed.length >= 2 && NAME_PATTERN.test(trimmed)
}

// A band this many times taller than the sheet's typical one probably
// covers more than one row.
const TALL_BAND = 1.8
// Below this fill, the "highlight" is faint, patchy, or a partial stroke.
const FAINT_BAND = 0.35

const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 }

function lowest(a: Confidence, b: Confidence): Confidence {
  return RANK[a] >= RANK[b] ? a : b
}

export interface ValidationSummary {
  patients: DetectedPatient[]
  // Highlighted strips the AI said hold no patient (column headers etc.).
  ignoredRows: number
}

export function buildDetectedPatients(rows: HighlightedRow[], readings: RowReading[]): ValidationSummary {
  const rowById = new Map(rows.map((r) => [r.id, r]))
  const patients: DetectedPatient[] = []
  let ignoredRows = 0

  for (const reading of readings) {
    const row = rowById.get(reading.id)
    if (!row) continue
    if (reading.notAPatientRow) {
      ignoredRows++
      continue
    }

    const shared: { confidence: Confidence; issues: string[] } = { confidence: 'high', issues: [] }
    const tallBand = row.relativeHeight >= TALL_BAND
    if (reading.patients.length > 1 && !tallBand) {
      // The highlight is one row tall, so it can hold one patient — any
      // extra name the AI reported came from a neighboring, unhighlighted
      // row at the crop's edge. The AI doesn't get to add rows; every name
      // from this strip waits for a human to pick the highlighted one.
      shared.confidence = 'low'
      shared.issues.push('NOVA read more than one name in a single highlighted row. View the source and keep only the highlighted patient.')
    } else if (tallBand || reading.patients.length > 1) {
      shared.confidence = 'medium'
      shared.issues.push('The highlight may cover more than one row.')
    }
    if (row.band.density < FAINT_BAND) {
      shared.confidence = lowest(shared.confidence, 'medium')
      shared.issues.push('The highlight is faint or partial.')
    }

    reading.patients.forEach((p, index) => {
      let confidence = shared.confidence
      const issues = [...shared.issues]
      const name = p.name ?? ''

      if (!p.name) {
        confidence = 'low'
        issues.push('NOVA couldn’t read a name in this row.')
      } else {
        if (p.legibility !== 'clear') {
          confidence = lowest(confidence, 'low')
          issues.push('Some letters were hard to read — check the spelling.')
        }
        if (!isPlausibleName(name)) {
          confidence = lowest(confidence, 'low')
          issues.push('This doesn’t look like a complete name.')
        } else if (name.trim().split(/\s+/).length < 2) {
          confidence = lowest(confidence, 'medium')
          issues.push('Only one name was found.')
        }
      }

      patients.push({
        id: `${row.id}-${index + 1}`,
        name,
        page: row.page,
        sourceRowId: row.id,
        color: row.band.color,
        confidence,
        issues,
      })
    })
  }

  return { patients, ignoredRows }
}

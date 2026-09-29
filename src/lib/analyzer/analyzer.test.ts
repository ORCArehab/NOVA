import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPatient, listPatients } from '../patientStore'
import { batchRows } from './batching'
import { checkDocumentDate, roundOptions } from './documentDate'
import { assessPatient, findRepeatedNames, normalizeFacility, normalizeName } from './duplicates'
import { importPatients } from './importPatients'
import type { HighlightedRow, RowReading } from './types'
import { buildDetectedPatients, isPlausibleName } from './validate'

// patientStore persists to localStorage — an in-memory stand-in per test.
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})

const TEAM = 'team-1'
const DATE = '2026-09-29'

function row(id: string, overrides: Partial<HighlightedRow> = {}): HighlightedRow {
  return {
    id,
    page: 1,
    band: { top: 0, bottom: 20, left: 0, right: 300, color: 'yellow', density: 0.9 },
    relativeHeight: 1,
    cropDataUrl: 'data:image/jpeg;base64,AA==',
    ...overrides,
  }
}

function reading(id: string, name: string | null, legibility: 'clear' | 'partial' | 'unclear' = 'clear'): RowReading {
  return { id, notAPatientRow: false, patients: [{ name, legibility }] }
}

describe('normalizeName', () => {
  it('ignores case, accents, punctuation, word order, and middle initials', () => {
    const key = normalizeName('Michael Reyes')
    expect(normalizeName('REYES, MICHAEL J.')).toBe(key)
    expect(normalizeName('Michaél  Reyes')).toBe(key)
    expect(normalizeName("Kevin O'Brien")).toBe(normalizeName('Kevin O’Brien'))
    expect(normalizeName('Mary-Jane Watson')).toBe(normalizeName('Mary Jane Watson'))
  })

  it('still tells different people apart', () => {
    expect(normalizeName('Michael Reyes')).not.toBe(normalizeName('Michelle Reyes'))
  })
})

describe('normalizeFacility', () => {
  it('ignores case, spacing, and punctuation', () => {
    expect(normalizeFacility('Cedar Grove Nursing Home')).toBe(normalizeFacility('cedar grove nursing-home.'))
  })
})

describe('buildDetectedPatients', () => {
  it('grades a clean, single-row reading as high confidence', () => {
    const { patients } = buildDetectedPatients([row('r1')], [reading('r1', 'Michael Reyes')])
    expect(patients).toEqual([
      expect.objectContaining({ id: 'r1-1', name: 'Michael Reyes', page: 1, sourceRowId: 'r1', confidence: 'high', issues: [] }),
    ])
  })

  it('marks unreadable or partially legible names as low confidence', () => {
    const { patients } = buildDetectedPatients(
      [row('r1'), row('r2'), row('r3')],
      [reading('r1', null, 'unclear'), reading('r2', 'James R', 'partial'), reading('r3', 'J4mes ???')],
    )
    expect(patients.map((p) => p.confidence)).toEqual(['low', 'low', 'low'])
  })

  it('never lets the AI add a patient beyond what a one-row highlight can hold', () => {
    // Real case: a neighboring, unhighlighted row at the crop's edge was
    // read as a second patient.
    const { patients } = buildDetectedPatients(
      [row('r1')],
      [{ id: 'r1', notAPatientRow: false, patients: [{ name: 'Josephine Moreau', legibility: 'clear' }, { name: 'Harold Bettisrew', legibility: 'clear' }] }],
    )
    expect(patients.map((p) => p.confidence)).toEqual(['low', 'low'])

    // A faint stroke on top of that must not soften it back to medium.
    const faint = buildDetectedPatients(
      [row('r1', { band: { top: 0, bottom: 20, left: 0, right: 300, color: 'yellow', density: 0.2 } })],
      [{ id: 'r1', notAPatientRow: false, patients: [{ name: 'Ann Lee', legibility: 'clear' }, { name: 'Bo Chan', legibility: 'clear' }] }],
    )
    expect(faint.patients.map((p) => p.confidence)).toEqual(['low', 'low'])
    expect(assessPatient({ name: patients[1].name, facility: 'X', date: DATE, confidence: patients[1].confidence, edited: false }, []).status).toBe('needsReview')
  })

  it('marks tall or faint highlights and multi-patient tall strips as medium', () => {
    const { patients } = buildDetectedPatients(
      [
        row('r1', { relativeHeight: 2.4 }),
        row('r2', { band: { top: 0, bottom: 20, left: 0, right: 300, color: 'pink', density: 0.2 } }),
        row('r3', { relativeHeight: 2.1 }),
      ],
      [
        reading('r1', 'Nancy Coleman'),
        reading('r2', 'Kevin OBrien'),
        { id: 'r3', notAPatientRow: false, patients: [{ name: 'Ann Lee', legibility: 'clear' }, { name: 'Bo Chan', legibility: 'clear' }] },
      ],
    )
    expect(patients.map((p) => [p.name, p.confidence])).toEqual([
      ['Nancy Coleman', 'medium'],
      ['Kevin OBrien', 'medium'],
      ['Ann Lee', 'medium'],
      ['Bo Chan', 'medium'],
    ])
    expect(patients[1].color).toBe('pink')
  })

  it('drops strips the AI identified as not a patient row, and counts them', () => {
    const result = buildDetectedPatients(
      [row('r1'), row('r2')],
      [{ id: 'r1', notAPatientRow: true, patients: [] }, reading('r2', 'Michael Reyes')],
    )
    expect(result.ignoredRows).toBe(1)
    expect(result.patients).toHaveLength(1)
  })
})

describe('isPlausibleName', () => {
  it('accepts real-world name shapes and rejects obvious misreads', () => {
    for (const n of ["Kevin O'Brien", 'Mary-Jane Watson', 'José Núñez', 'Michael J. Reyes']) expect(isPlausibleName(n)).toBe(true)
    for (const n of ['', 'J', 'James R____', 'Room 12', '???']) expect(isPlausibleName(n)).toBe(false)
  })
})

describe('assessPatient', () => {
  const base = { name: 'Michael Reyes', facility: 'Cedar Grove', date: DATE, confidence: 'high' as const, edited: false }

  it('is ready when nothing matches', () => {
    expect(assessPatient(base, []).status).toBe('ready')
  })

  it('flags an existing patient with the same name, facility, and rounding date', () => {
    const existing = [createPatient('REYES, MICHAEL', TEAM, 'cedar grove', DATE)]
    expect(assessPatient(base, existing).status).toBe('alreadyExists')
  })

  it('does not treat the same person on a different rounding date as a duplicate', () => {
    const existing = [createPatient('Michael Reyes', TEAM, 'Cedar Grove', '2026-09-28')]
    expect(assessPatient(base, existing).status).toBe('ready')
  })

  it('asks for review when the same name is at a different facility that day', () => {
    const existing = [createPatient('Michael Reyes', TEAM, 'Riverside SNF', DATE)]
    expect(assessPatient(base, existing)).toEqual({ status: 'needsReview', reason: 'Same name already on this date at Riverside SNF.' })
  })

  it('needs review for low confidence until the user corrects the name', () => {
    expect(assessPatient({ ...base, confidence: 'low' }, []).status).toBe('needsReview')
    expect(assessPatient({ ...base, confidence: 'low', edited: true }, []).status).toBe('ready')
    expect(assessPatient({ ...base, confidence: 'medium' }, []).status).toBe('ready')
  })

  it('needs review when the name is missing or implausible', () => {
    expect(assessPatient({ ...base, name: '' }, []).status).toBe('needsReview')
    expect(assessPatient({ ...base, name: 'James R____', edited: true }, []).status).toBe('needsReview')
  })
})

describe('findRepeatedNames', () => {
  it('returns the later detections of a name listed twice on the sheet', () => {
    const repeats = findRepeatedNames([
      { id: 'a', name: 'Michael Reyes' },
      { id: 'b', name: 'Nancy Coleman' },
      { id: 'c', name: 'Reyes, Michael' },
    ])
    expect([...repeats]).toEqual(['c'])
  })
})

describe('importPatients', () => {
  it('creates patients through the normal workflow on the chosen date and facility', () => {
    const { imported, skipped } = importPatients(['Michael Reyes', 'Nancy Coleman'], TEAM, ' Cedar Grove ', DATE)

    expect(skipped).toEqual([])
    expect(imported).toHaveLength(2)
    const stored = listPatients(TEAM)
    expect(stored).toHaveLength(2)
    for (const p of stored) {
      expect(p).toMatchObject({ roundingDate: DATE, facility: 'Cedar Grove', teamId: TEAM, reworded: null, signed: false, uploaded: false })
    }
  })

  it('never creates a duplicate, even if the review screen was stale', () => {
    createPatient('Michael Reyes', TEAM, 'Cedar Grove', DATE)

    const { imported, skipped } = importPatients(['REYES, MICHAEL', 'Nancy Coleman', 'Nancy  Coleman'], TEAM, 'Cedar Grove', DATE)

    expect(imported.map((p) => p.name)).toEqual(['Nancy Coleman'])
    expect(skipped).toEqual(['REYES, MICHAEL', 'Nancy  Coleman'])
    expect(listPatients(TEAM)).toHaveLength(2)
  })

  it('only checks duplicates within the same team', () => {
    createPatient('Michael Reyes', 'other-team', 'Cedar Grove', DATE)
    expect(importPatients(['Michael Reyes'], TEAM, 'Cedar Grove', DATE).imported).toHaveLength(1)
  })
})

describe('batchRows', () => {
  it('caps each request by row count and by payload size', () => {
    const small = Array.from({ length: 23 }, (_, i) => row(`r${i}`))
    expect(batchRows(small).map((b) => b.length)).toEqual([10, 10, 3])

    const big = Array.from({ length: 4 }, (_, i) => row(`r${i}`, { cropDataUrl: 'x'.repeat(600_000) }))
    expect(batchRows(big).map((b) => b.length)).toEqual([2, 2])
  })
})

describe('roundOptions', () => {
  const today = '2026-09-29'

  it('lists existing rounds newest first, with today selectable', () => {
    const options = roundOptions(
      [
        { date: '2026-09-29', total: 12, complete: 3 },
        { date: '2026-09-27', total: 4, complete: 4 },
      ],
      today,
    )
    expect(options).toEqual([
      { date: '2026-09-29', isNew: false, total: 12 },
      { date: '2026-09-27', isNew: false, total: 4 },
    ])
  })

  it('offers today as a new round when it has no patients yet', () => {
    expect(roundOptions([{ date: '2026-09-28', total: 5, complete: 0 }], today)).toEqual([
      { date: today, isNew: true, total: 0 },
      { date: '2026-09-28', isNew: false, total: 5 },
    ])
    expect(roundOptions([], today)).toEqual([{ date: today, isNew: true, total: 0 }])
  })
})

describe('checkDocumentDate', () => {
  const target = '2026-09-29'

  it('says nothing when no date was detected — the target stays authoritative', () => {
    expect(checkDocumentDate(null, false, target)).toEqual({ kind: 'none' })
  })

  it('matches when the sheet agrees with the target', () => {
    expect(checkDocumentDate('2026-09-29', true, target)).toEqual({ kind: 'match' })
  })

  it('flags a clearly labeled different date as a mismatch', () => {
    expect(checkDocumentDate('2026-09-28', true, target)).toEqual({ kind: 'mismatch', detected: '2026-09-28' })
  })

  it('only softly notes an unlabeled different date', () => {
    expect(checkDocumentDate('2026-09-28', false, target)).toEqual({ kind: 'possibleMismatch', detected: '2026-09-28' })
  })
})

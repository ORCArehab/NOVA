import type { Patient } from '../types'
import { isPlausibleName } from './validate'
import type { Confidence, ReviewStatus } from './types'

// Duplicate detection against NOVA's own patient model. A Patient record
// is one person on one rounding date at one facility, so "already exists"
// means that same combination — the same person on a different day is a
// new visit, not a duplicate.

// "Reyes, Michael J." / "MICHAEL REYES" / "Michaél  Reyes" all compare
// equal: case, accents, punctuation, word order, and middle initials are
// ignored.
export function normalizeName(name: string): string {
  let text = name.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
  const comma = text.indexOf(',')
  if (comma !== -1) text = `${text.slice(comma + 1)} ${text.slice(0, comma)}`
  return text
    .replace(/['’.]/g, '')
    .replace(/[^\p{L}\s-]/gu, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1)
    .sort()
    .join(' ')
}

export function normalizeFacility(facility: string): string {
  return facility
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')
}

export interface ReviewAssessment {
  status: ReviewStatus
  // Why it isn't simply "ready" — shown under the name in review.
  reason: string | null
}

export interface AssessInput {
  name: string
  facility: string
  date: string
  confidence: Confidence
  // The user has typed over the AI's reading — that's the human review
  // the low-confidence flag was asking for.
  edited: boolean
}

export function assessPatient(input: AssessInput, existing: Patient[]): ReviewAssessment {
  const key = normalizeName(input.name)
  const facilityKey = normalizeFacility(input.facility)

  if (!key || !isPlausibleName(input.name)) {
    return { status: 'needsReview', reason: 'Enter the patient’s name.' }
  }

  const sameDay = existing.filter((p) => p.roundingDate === input.date && normalizeName(p.name) === key)
  if (facilityKey && sameDay.some((p) => normalizeFacility(p.facility) === facilityKey)) {
    return { status: 'alreadyExists', reason: 'Already on this rounding date at this facility.' }
  }
  if (sameDay.length > 0) {
    return { status: 'needsReview', reason: `Same name already on this date at ${sameDay[0].facility}.` }
  }

  if (input.confidence === 'low' && !input.edited) {
    return { status: 'needsReview', reason: null }
  }
  return { status: 'ready', reason: null }
}

// Keeps the first detection of each name — a sheet can list the same
// patient twice (e.g. on a summary page), and importing both would create
// a duplicate within the same batch. Returns the ids that were folded in.
export function findRepeatedNames<T extends { id: string; name: string }>(items: T[]): Set<string> {
  const seen = new Set<string>()
  const repeats = new Set<string>()
  for (const item of items) {
    const key = normalizeName(item.name)
    if (!key) continue
    if (seen.has(key)) repeats.add(item.id)
    else seen.add(key)
  }
  return repeats
}

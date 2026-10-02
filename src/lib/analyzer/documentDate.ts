import type { RoundingDateSummary } from '../patientStore'

// The Analyzer works with two dates that must never stand in for each
// other:
//
//   targetRoundingDate    chosen by the user; where patients are imported
//   detectedDocumentDate  read off the sheet; only used to warn
//
// This module holds the pure logic around them: which rounds the user can
// pick, and how a detected date compares to the chosen one.

export interface RoundOption {
  date: string
  // Today, with no patients yet — importing creates it, the same way the
  // first "Add Patient" on a date does.
  isNew: boolean
  total: number
}

// Existing rounds (patientStore's listRoundingDates — the same source as
// Home's and the facility rounds' date selectors), newest first, plus today even when it
// has no patients yet: on a normal morning, today's round doesn't exist
// until this import creates it.
export function roundOptions(rounds: RoundingDateSummary[], today: string): RoundOption[] {
  const options: RoundOption[] = rounds.map((r) => ({ date: r.date, isNew: false, total: r.total }))
  if (!options.some((o) => o.date === today)) options.push({ date: today, isNew: true, total: 0 })
  return options.sort((a, b) => b.date.localeCompare(a.date))
}

export type DateCheck =
  // Nothing detected, or it agrees — nothing to say.
  | { kind: 'none' }
  | { kind: 'match' }
  // The sheet explicitly labels a different census/service date: worth
  // stopping for.
  | { kind: 'mismatch'; detected: string }
  // A different date appears, but not clearly as the service date (could
  // be a print timestamp) — mention it, don't alarm.
  | { kind: 'possibleMismatch'; detected: string }

export function checkDocumentDate(detected: string | null, labeled: boolean, target: string): DateCheck {
  if (!detected) return { kind: 'none' }
  if (detected === target) return { kind: 'match' }
  return labeled ? { kind: 'mismatch', detected } : { kind: 'possibleMismatch', detected }
}

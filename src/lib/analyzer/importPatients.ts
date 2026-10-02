import { createPatient, listPatients } from '../patientStore'
import type { Patient } from '../types'
import { normalizeFacility, normalizeName } from './duplicates'

export interface ImportOutcome {
  imported: Patient[]
  // Names skipped because they'd duplicate an existing patient (or one
  // earlier in this same batch) — re-checked here at import time, not
  // just trusted from what the review screen showed.
  skipped: string[]
}

// The only place the analyzer creates patients, and only ever called from
// an explicit "Import" click on the review screen. Goes through the same
// createPatient as the Add Patient form, so imported patients
// start in the same initial state (no note, unsigned, not uploaded) and
// land on the chosen rounding date like any other patient.
export function importPatients(names: string[], teamId: string, facility: string, roundingDate: string): ImportOutcome {
  const facilityKey = normalizeFacility(facility)
  const taken = new Set(
    listPatients(teamId)
      .filter((p) => p.roundingDate === roundingDate && normalizeFacility(p.facility) === facilityKey)
      .map((p) => normalizeName(p.name)),
  )

  const imported: Patient[] = []
  const skipped: string[] = []
  for (const raw of names) {
    const name = raw.trim()
    const key = normalizeName(name)
    if (!key || taken.has(key)) {
      skipped.push(name)
      continue
    }
    taken.add(key)
    imported.push(createPatient(name, teamId, facility.trim(), roundingDate))
  }
  return { imported, skipped }
}

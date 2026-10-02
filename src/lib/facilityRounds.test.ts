import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createPatient,
  facilityKey,
  listFacilityPatients,
  listFacilityRoundingDates,
  listFacilityRounds,
  markPatientUploaded,
  patientStage,
  saveNote,
  signPatientNote,
} from './patientStore'

// Synthetic records only.
let store: Map<string, string>
beforeEach(() => {
  store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})

const DAY = '2026-10-01'
const PROVIDER = { id: 'prov-1', name: 'Dr. Test' }

function completePatient(name: string, facility: string, date = DAY) {
  const p = createPatient(name, 'team', facility, date)
  saveNote(p.id, { noteType: 'initial', extractedText: 's', reworded: 'n', signed: false, signedAt: null, signedBy: null }, p.updatedAt)
  signPatientNote(p.id, PROVIDER)
  markPatientUploaded(p.id)
  return p
}

describe('patientStage', () => {
  const base = { extractedText: null, reworded: null, signed: false, uploaded: false }
  it('Not started without source text or a note; In progress with source text only', () => {
    expect(patientStage(base)).toBe('noNote')
    expect(patientStage({ ...base, extractedText: '   ' })).toBe('noNote')
    expect(patientStage({ ...base, extractedText: 'source' })).toBe('inProgress')
  })
  it('keeps the existing later stages unchanged', () => {
    expect(patientStage({ ...base, extractedText: 'source', reworded: 'note' })).toBe('awaitingSignature')
    expect(patientStage({ ...base, reworded: 'note', signed: true })).toBe('needsUpload')
    expect(patientStage({ ...base, reworded: 'note', signed: true, uploaded: true })).toBe('complete')
    expect(patientStage({ ...base, extractedText: 'source', uploaded: true })).toBe('inProgress')
  })
})

describe('facility rounds', () => {
  it('groups spellings with the existing facility normalization, counting patients and completed', () => {
    completePatient('Alpha One', 'Riverside SNF')
    createPatient('Alpha Two', 'team', 'riverside  snf', DAY)
    createPatient('Alpha Three', 'team', 'Riverside SNF', DAY)
    createPatient('Beta One', 'team', 'Cedar Grove', DAY)
    createPatient('Other Day', 'team', 'Riverside SNF', '2026-09-30')
    createPatient('Other Team', 'someone-else', 'Riverside SNF', DAY)

    expect(listFacilityRounds('team', DAY)).toEqual([
      { key: 'cedargrove', name: 'Cedar Grove', date: DAY, total: 1, complete: 0 },
      { key: 'riversidesnf', name: 'Riverside SNF', date: DAY, total: 3, complete: 1 },
    ])
    expect(listFacilityPatients('team', facilityKey('RIVERSIDE SNF'), DAY).map((p) => p.name).sort()).toEqual([
      'Alpha One',
      'Alpha Three',
      'Alpha Two',
    ])
    expect(listFacilityRoundingDates('team', 'riversidesnf')).toEqual([
      { date: DAY, total: 3, complete: 1 },
      { date: '2026-09-30', total: 1, complete: 0 },
    ])
  })

  it('returns nothing (not another facility or date) when a facility has no patients that day', () => {
    createPatient('Beta One', 'team', 'Cedar Grove', DAY)
    expect(listFacilityPatients('team', 'riversidesnf', DAY)).toEqual([])
    expect(listFacilityRounds('team', '2026-09-01')).toEqual([])
  })

  it('only reads: stored records are byte-for-byte unchanged, facility strings included', () => {
    createPatient('Alpha Two', 'team', 'riverside  snf', DAY)
    const before = store.get('nova:patients')
    listFacilityRounds('team', DAY)
    listFacilityPatients('team', 'riversidesnf', DAY)
    listFacilityRoundingDates('team', 'riversidesnf')
    expect(store.get('nova:patients')).toBe(before)
  })
})

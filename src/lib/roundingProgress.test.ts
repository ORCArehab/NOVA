import { describe, expect, it } from 'vitest'
import { isPatientComplete, patientStage } from './patientStore'
import { groupRoundsForHome, progressPercent } from './roundingProgress'
import type { Patient } from './types'

const round = (date: string, total = 1, complete = 0) => ({ date, total, complete })

describe('progressPercent', () => {
  it('reports the completed share of the round', () => {
    expect(progressPercent(round('2026-09-29', 12, 3))).toBe(25)
    expect(progressPercent(round('2026-09-29', 12, 12))).toBe(100)
    expect(progressPercent(round('2026-09-29', 12, 0))).toBe(0)
  })

  it('only shows 100% when every patient is done', () => {
    expect(progressPercent(round('2026-09-29', 200, 199))).toBe(99)
  })

  it('returns null instead of NaN for a round with no patients', () => {
    expect(progressPercent(round('2026-09-29', 0, 0))).toBeNull()
  })
})

describe('groupRoundsForHome', () => {
  const today = '2026-09-29'

  it('puts today first and older rounds under previous, newest first', () => {
    const dates = [round('2026-09-29'), round('2026-09-28'), round('2026-09-25')]
    expect(groupRoundsForHome(dates, today)).toEqual({
      current: dates[0],
      upcoming: [],
      previous: [dates[1], dates[2]],
    })
  })

  it('uses the most recent past round when there is none today', () => {
    const dates = [round('2026-09-27'), round('2026-09-26')]
    expect(groupRoundsForHome(dates, today)).toEqual({ current: dates[0], upcoming: [], previous: [dates[1]] })
  })

  it('keeps future-dated rounds out of current and previous, soonest first', () => {
    const dates = [round('2026-10-02'), round('2026-09-30'), round('2026-09-29'), round('2026-09-28')]
    expect(groupRoundsForHome(dates, today)).toEqual({
      current: dates[2],
      upcoming: [dates[1], dates[0]],
      previous: [dates[3]],
    })
  })

  it('handles no rounds at all', () => {
    expect(groupRoundsForHome([], today)).toEqual({ current: null, upcoming: [], previous: [] })
  })
})

describe('isPatientComplete', () => {
  const base = { reworded: 'note', signed: true, uploaded: true } as Patient

  it('requires a note, a signature, and an upload', () => {
    expect(isPatientComplete(base)).toBe(true)
    expect(isPatientComplete({ ...base, reworded: null })).toBe(false)
    expect(isPatientComplete({ ...base, signed: false })).toBe(false)
    expect(isPatientComplete({ ...base, uploaded: false })).toBe(false)
  })
})

describe('patientStage', () => {
  it('follows the workflow order and agrees with isPatientComplete', () => {
    const p = { reworded: null, signed: false, uploaded: false } as Patient
    expect(patientStage(p)).toBe('noNote')
    expect(patientStage({ ...p, reworded: 'note' })).toBe('awaitingSignature')
    expect(patientStage({ ...p, reworded: 'note', signed: true })).toBe('needsUpload')
    expect(patientStage({ ...p, reworded: 'note', signed: true, uploaded: true })).toBe('complete')
    // Unsigned after upload: back to needing a signature, not complete.
    expect(patientStage({ ...p, reworded: 'note', uploaded: true })).toBe('awaitingSignature')
  })
})

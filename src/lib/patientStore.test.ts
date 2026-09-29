import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createPatient, deletePatient, getPatientById, patientStage, saveNote, signPatientNote, unsignPatientNote, type NoteData } from './patientStore'

beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  })
})

const PROVIDER = { id: 'prov-1', name: 'Dr. Patel' }

function note(overrides: Partial<NoteData> = {}): NoteData {
  return { noteType: 'initial', extractedText: 'source', reworded: 'note v1', signed: false, signedAt: null, signedBy: null, ...overrides }
}

describe('saveNote', () => {
  it('saves over the version the workspace loaded, and keeps saving from the new version', () => {
    const p = createPatient('Martha Parks', 'team', 'Riverside SNF', '2026-09-29')

    const first = saveNote(p.id, note(), p.updatedAt)
    expect(first.status).toBe('saved')
    if (first.status !== 'saved') return
    expect(saveNote(p.id, note({ reworded: 'note v2' }), first.updatedAt).status).toBe('saved')
    expect(getPatientById(p.id)?.reworded).toBe('note v2')
  })

  it('refuses to overwrite a change made elsewhere since the note was opened', () => {
    const p = createPatient('Martha Parks', 'team', 'Riverside SNF', '2026-09-29')
    const opened = saveNote(p.id, note(), p.updatedAt)
    if (opened.status !== 'saved') throw new Error('setup')

    // Signed from the patient preview (or another tab) while the workspace still has it open.
    signPatientNote(p.id, PROVIDER)

    expect(saveNote(p.id, note({ reworded: 'stale edit' }), opened.updatedAt)).toEqual({ status: 'conflict' })
    expect(getPatientById(p.id)).toMatchObject({ reworded: 'note v1', signed: true, signedBy: PROVIDER })
  })

  it('does not bump updatedAt when nothing changed', () => {
    const p = createPatient('Martha Parks', 'team', 'Riverside SNF', '2026-09-29')
    const empty = { noteType: 'initial' as const, extractedText: null, reworded: null, signed: false, signedAt: null, signedBy: null }
    expect(saveNote(p.id, empty, p.updatedAt)).toEqual({ status: 'unchanged' })
    expect(getPatientById(p.id)?.updatedAt).toBe(p.updatedAt)
  })

  it('treats a deleted patient as a conflict rather than recreating it', () => {
    const p = createPatient('Martha Parks', 'team', 'Riverside SNF', '2026-09-29')
    deletePatient(p.id)
    expect(saveNote(p.id, note(), p.updatedAt)).toEqual({ status: 'conflict' })
    expect(getPatientById(p.id)).toBeNull()
  })
})

describe('signing', () => {
  it('records who signed and clears it on unsign, moving the patient through the workflow', () => {
    const p = createPatient('Kevin Obi', 'team', 'Cedar Grove', '2026-09-29')
    const saved = saveNote(p.id, note(), p.updatedAt)
    if (saved.status !== 'saved') throw new Error('setup')
    expect(patientStage(getPatientById(p.id)!)).toBe('awaitingSignature')

    signPatientNote(p.id, PROVIDER)
    const signed = getPatientById(p.id)!
    expect(signed).toMatchObject({ signed: true, signedBy: PROVIDER })
    expect(signed.signedAt).toEqual(expect.any(Number))
    expect(patientStage(signed)).toBe('needsUpload')

    unsignPatientNote(p.id)
    expect(getPatientById(p.id)).toMatchObject({ signed: false, signedAt: null, signedBy: null })
  })

  it('reads older signatures without a signer as signed by unknown', () => {
    const p = createPatient('Old Record', 'team', 'Cedar Grove', '2026-09-20')
    const raw = JSON.parse(localStorage.getItem('nova:patients')!)
    delete raw[0].signedBy
    raw[0] = { ...raw[0], reworded: 'x', signed: true, signedAt: 1 }
    localStorage.setItem('nova:patients', JSON.stringify(raw))
    expect(getPatientById(p.id)?.signedBy).toBeNull()
  })
})

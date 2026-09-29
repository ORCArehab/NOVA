import { dateKey, todayDateKey } from './dateUtils'
import type { NoteType, Patient, Signer } from './types'

// localStorage rather than sessionStorage — patients need to survive a tab
// close, unlike the single-document autosave in App.tsx. This is a local
// test-run stand-in; a real deployment would back this with a server.
const PATIENTS_KEY = 'nova:patients'

function readAll(): Patient[] {
  try {
    const raw = localStorage.getItem(PATIENTS_KEY)
    if (!raw) return []
    const patients = JSON.parse(raw) as Patient[]
    // Backfill for patients saved before roundingDate/facility existed —
    // without the roundingDate one, formatDateLabel() throws on the
    // missing field and blanks the whole page, since nothing here has an
    // error boundary. Best guess is the creation date, since that's the
    // closest thing to "which day's rounds they were part of" for a
    // record that predates the concept. A patient with no teamId predates
    // team accounts entirely and can't be attributed to a real team
    // anymore (team membership now lives on the server, not here), so it
    // just won't show up in any team's filtered list.
    return patients.map((p) => ({
      ...p,
      roundingDate: p.roundingDate || dateKey(new Date(p.createdAt)),
      facility: p.facility || 'Unspecified facility',
      teamId: p.teamId || '',
      signedBy: p.signedBy ?? null,
    }))
  } catch {
    return []
  }
}

function writeAll(patients: Patient[]) {
  try {
    localStorage.setItem(PATIENTS_KEY, JSON.stringify(patients))
  } catch {
    // best-effort — localStorage may be unavailable (private browsing, quota)
  }
}

export function listPatients(teamId: string): Patient[] {
  return readAll()
    .filter((p) => p.teamId === teamId)
    .sort((a, b) => b.updatedAt - a.updatedAt)
}

export function getPatientById(id: string): Patient | null {
  return readAll().find((p) => p.id === id) ?? null
}

// roundingDate defaults to today — a patient added through the normal "Add
// Patient" flow is added as part of today's rounds. Mock/seed data passes
// an explicit past date to backfill a realistic rounding-date history.
export function createPatient(
  name: string,
  teamId: string,
  facility: string,
  roundingDate: string = todayDateKey(),
): Patient {
  const now = Date.now()
  const patient: Patient = {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    noteType: 'initial',
    extractedText: null,
    reworded: null,
    signed: false,
    signedAt: null,
    signedBy: null,
    uploaded: false,
    uploadedAt: null,
    roundingDate,
    teamId,
    facility,
  }
  writeAll([...readAll(), patient])
  return patient
}

export function updatePatientNote(
  id: string,
  data: {
    noteType: NoteType
    extractedText: string | null
    reworded: string | null
    signed: boolean
    signedAt: number | null
    signedBy?: Signer | null
  },
): void {
  const patients = readAll()
  const index = patients.findIndex((p) => p.id === id)
  if (index === -1) return
  patients[index] = { ...patients[index], ...data, signedBy: data.signedBy ?? null, updatedAt: Date.now() }
  writeAll(patients)
}

export interface NoteData {
  noteType: NoteType
  extractedText: string | null
  reworded: string | null
  signed: boolean
  signedAt: number | null
  signedBy: Signer | null
}

export type SaveResult = { status: 'saved'; updatedAt: number } | { status: 'unchanged' } | { status: 'conflict' }

// The note workspace's autosave. Only writes if the stored note is still
// the version the workspace loaded (baseUpdatedAt) — if anything else
// changed it since (another tab, a sign/unsign from the patient preview),
// saving would silently overwrite that, so it reports a conflict instead.
// A deleted patient counts as a conflict too. Skips the write entirely
// when nothing differs, so opening a note doesn't bump its updatedAt.
export function saveNote(id: string, data: NoteData, baseUpdatedAt: number): SaveResult {
  const patients = readAll()
  const index = patients.findIndex((p) => p.id === id)
  if (index === -1) return { status: 'conflict' }
  const current = patients[index]
  if (current.updatedAt !== baseUpdatedAt) return { status: 'conflict' }

  const unchanged =
    current.noteType === data.noteType &&
    current.extractedText === data.extractedText &&
    current.reworded === data.reworded &&
    current.signed === data.signed &&
    current.signedAt === data.signedAt &&
    current.signedBy?.id === data.signedBy?.id
  if (unchanged) return { status: 'unchanged' }

  // Strictly increasing, so two saves in the same millisecond still read
  // as different versions.
  const updatedAt = Math.max(Date.now(), baseUpdatedAt + 1)
  patients[index] = { ...current, ...data, updatedAt }
  writeAll(patients)
  return { status: 'saved', updatedAt }
}

export function deletePatient(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id))
}

// Marks a note as pulled into a PDF for manual upload to PCC — doesn't
// touch the note content itself, just the upload status shown across the
// patient list screens.
export function markPatientUploaded(id: string): void {
  const patients = readAll()
  const index = patients.findIndex((p) => p.id === id)
  if (index === -1) return
  patients[index] = { ...patients[index], uploaded: true, uploadedAt: Date.now() }
  writeAll(patients)
}

// A provider signing off directly from the Patients-list note preview,
// without opening the full workspace — same effect as the workspace's
// Sign Note, just reachable from a different screen. Only callers that
// have checked the user is a provider should reach this.
export function signPatientNote(id: string, signer: Signer): void {
  const patients = readAll()
  const index = patients.findIndex((p) => p.id === id)
  if (index === -1) return
  patients[index] = { ...patients[index], signed: true, signedAt: Date.now(), signedBy: signer, updatedAt: Date.now() }
  writeAll(patients)
}

export function unsignPatientNote(id: string): void {
  const patients = readAll()
  const index = patients.findIndex((p) => p.id === id)
  if (index === -1) return
  patients[index] = { ...patients[index], signed: false, signedAt: null, signedBy: null, updatedAt: Date.now() }
  writeAll(patients)
}

export interface RoundingDateSummary {
  date: string
  total: number
  complete: number
}

// NOVA's one definition of a finished patient: a note, a provider
// signature, and an upload — the full pipeline, not just one stage of it.
// Rounding-date progress (Home) and completeness are both derived from
// this, so they can't drift apart.
export function isPatientComplete(p: Patient): boolean {
  return Boolean(p.reworded && p.signed && p.uploaded)
}

// Where a patient is in the workflow — the next thing that needs to
// happen for them. Checked in pipeline order, so each stage implies the
// ones before it are done; 'complete' is exactly isPatientComplete.
export type PatientStage = 'noNote' | 'awaitingSignature' | 'needsUpload' | 'complete'

export function patientStage(p: Patient): PatientStage {
  if (!p.reworded) return 'noNote'
  if (!p.signed) return 'awaitingSignature'
  if (!isPatientComplete(p)) return 'needsUpload'
  return 'complete'
}

export const PATIENT_STAGE_LABELS: Record<PatientStage, string> = {
  noNote: 'No note yet',
  awaitingSignature: 'Awaiting signature',
  needsUpload: 'Needs upload',
  complete: 'Complete',
}

// A rounding date is "complete" once every patient seen that day is
// (isPatientComplete). Sorted newest-first, since a provider opening this
// is almost always checking on today's or yesterday's rounds first.
export function listRoundingDates(teamId: string): RoundingDateSummary[] {
  const byDate = new Map<string, Patient[]>()
  for (const p of readAll().filter((p) => p.teamId === teamId)) {
    const group = byDate.get(p.roundingDate) ?? []
    group.push(p)
    byDate.set(p.roundingDate, group)
  }
  return Array.from(byDate.entries())
    .map(([date, group]) => ({
      date,
      total: group.length,
      complete: group.filter(isPatientComplete).length,
    }))
    .sort((a, b) => b.date.localeCompare(a.date))
}

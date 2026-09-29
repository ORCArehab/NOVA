import { FilePen, FilePlus2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import './PatientListScreen.css'
import RoundProgress from './RoundProgress'
import { formatDate, todayDateKey } from '../lib/dateUtils'
import { seedMockPatients } from '../lib/mockPatients'
import {
  createPatient,
  deletePatient,
  listPatients,
  listRoundingDates,
  PATIENT_STAGE_LABELS,
  patientStage,
  signPatientNote,
  unsignPatientNote,
  type PatientStage,
} from '../lib/patientStore'
import type { Patient, Signer } from '../lib/types'

interface Props {
  teamId: string
  // Providers sign; this is who a signature from the preview records.
  canSign: boolean
  signer: Signer
  activePatientId: string | null
  // The round this screen shows — opened from a Home card, the Analyzer's
  // "View Patients", or Back/Done in the note workspace.
  roundingDate: string
  onSelect: (patient: Patient) => void
  onDelete: (id: string) => void
}

const STAGES = Object.keys(PATIENT_STAGE_LABELS) as PatientStage[]

// Mock-data seeding is developer tooling — hidden outside Vite's dev server.
const DEV_TOOLS = import.meta.env.DEV

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

// "Which patient needs my attention?" — a round's progress up top, then
// the patient list as the main content, with the selected patient's note
// previewed on the right.
function PatientListScreen({ teamId, canSign, signer, activePatientId, roundingDate: roundDate, onSelect, onDelete }: Props) {
  const [patients, setPatients] = useState<Patient[]>(() => listPatients(teamId))

  const [search, setSearch] = useState('')
  const [facilityFilter, setFacilityFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<PatientStage | ''>('')

  const [addOpen, setAddOpen] = useState(false)
  const [newName, setNewName] = useState('')
  const [newFacility, setNewFacility] = useState('')

  // Armed by a first click on Delete; a second click on the same row
  // actually deletes. Only one row can be armed at a time.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Clicking a patient previews them on the right; Start Note / Edit Note
  // there is what opens the full workspace. Starts on the patient that was
  // open, so Back/Done from the workspace lands on the same preview. Held
  // as an id and read from the live list, so Sign/Unsign updates the
  // preview's status right away.
  const [previewId, setPreviewId] = useState<string | null>(activePatientId)
  const previewPatient = patients.find((p) => p.id === previewId) ?? null

  const scoped = patients.filter((p) => p.roundingDate === roundDate)
  const facilities = [...new Set(scoped.map((p) => p.facility))].sort((a, b) => a.localeCompare(b))
  const allFacilities = [...new Set(patients.map((p) => p.facility))].sort((a, b) => a.localeCompare(b))

  const query = normalize(search)
  const visiblePatients = scoped.filter(
    (p) =>
      (!query || normalize(p.name).includes(query)) &&
      (!facilityFilter || p.facility === facilityFilter) &&
      (!statusFilter || patientStage(p) === statusFilter),
  )
  const filterParts = [
    statusFilter && PATIENT_STAGE_LABELS[statusFilter],
    facilityFilter,
    query && `“${search.trim()}”`,
  ].filter(Boolean)
  const isFiltered = filterParts.length > 0

  // Same source as Home's cards, so the two always agree.
  const round = listRoundingDates(teamId).find((r) => r.date === roundDate) ?? { date: roundDate, total: 0, complete: 0 }

  function clearFilters() {
    setSearch('')
    setFacilityFilter('')
    setStatusFilter('')
  }

  function closeAddForm() {
    setAddOpen(false)
    setNewName('')
    setNewFacility('')
  }

  function handleCreate() {
    const name = newName.trim()
    const facility = newFacility.trim()
    if (!name || !facility) return
    createPatient(name, teamId, facility, roundDate)
    setPatients(listPatients(teamId))
    closeAddForm()
  }

  function handleDeleteClick(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    deletePatient(id)
    setPatients(listPatients(teamId))
    setConfirmDeleteId(null)
    if (previewId === id) setPreviewId(null)
    onDelete(id)
  }

  function handleSeedMockPatients() {
    seedMockPatients(teamId)
    setPatients(listPatients(teamId))
  }

  function handleSign() {
    if (!previewPatient || !canSign) return
    signPatientNote(previewPatient.id, signer)
    setPatients(listPatients(teamId))
  }

  function handleUnsign() {
    if (!previewPatient || !canSign) return
    unsignPatientNote(previewPatient.id)
    setPatients(listPatients(teamId))
  }

  function renderPatientRow(p: Patient) {
    const isActive = p.id === activePatientId || p.id === previewPatient?.id
    const stage = patientStage(p)
    const confirming = confirmDeleteId === p.id
    return (
      <li key={p.id} className={isActive ? 'patient-row patient-row-active' : 'patient-row'}>
        <button type="button" className="patient-row-select" onClick={() => setPreviewId(p.id)}>
          <span className="patient-row-text">
            <span className="patient-row-name">{p.name}</span>
            <span className="patient-row-meta">{p.facility}</span>
          </span>
          <span className={`patient-stage patient-stage-${stage}`}>{PATIENT_STAGE_LABELS[stage]}</span>
        </button>
        <div className="patient-row-actions">
          {confirming ? (
            <>
              <button type="button" className="btn btn-sm" onClick={() => setConfirmDeleteId(null)}>
                Cancel
              </button>
              <button type="button" className="btn btn-sm patient-row-delete-confirm" onClick={() => handleDeleteClick(p.id)}>
                Delete
              </button>
            </>
          ) : (
            <button
              type="button"
              className="patient-row-delete"
              onClick={() => handleDeleteClick(p.id)}
              aria-label={`Delete ${p.name}`}
              title="Delete patient"
            >
              <Trash2 size={15} />
            </button>
          )}
        </div>
      </li>
    )
  }

  // The selected patient: who they are, where their note stands, and the
  // one thing to do next. Start/Edit Note open the existing note
  // workspace (App's handleSelectPatient) — the preview itself is
  // read-only.
  function renderPreview(patient: Patient) {
    const stage = patientStage(patient)
    const hasNote = Boolean(patient.reworded)
    const signed = stage === 'needsUpload' || stage === 'complete'

    return (
      <>
        <div className="patient-preview-header">
          <div className="patient-preview-identity">
            <h2>{patient.name}</h2>
            <span className="patient-preview-meta">{patient.facility}</span>
            <span className={`patient-stage patient-stage-${stage}`}>{PATIENT_STAGE_LABELS[stage]}</span>
          </div>
          {hasNote ? (
            <button type="button" className="btn patient-preview-primary" onClick={() => onSelect(patient)}>
              <FilePen size={16} />
              Edit Note
            </button>
          ) : (
            <button type="button" className="btn patient-preview-primary" onClick={() => onSelect(patient)}>
              <FilePlus2 size={16} />
              Start Note
            </button>
          )}
        </div>

        {hasNote ? (
          <>
            {/* Existing workspace behavior: any edit to a signed note clears the signature. */}
            {signed && <p className="patient-preview-hint">Editing this note will remove the provider signature.</p>}
            <div className="patient-preview-text" aria-label={`Note preview for ${patient.name}`}>
              {patient.reworded}
            </div>
            {canSign && (
              <div className="patient-preview-actions">
                {patient.signed ? (
                  <button type="button" className="btn btn-sm" onClick={handleUnsign}>
                    Unsign
                  </button>
                ) : (
                  <button type="button" className="btn" onClick={handleSign}>
                    Sign Note
                  </button>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="patient-preview-no-note">
            <p>No note has been started for this patient.</p>
            <p className="patient-preview-hint">Start a note when you’re ready to begin.</p>
          </div>
        )}
      </>
    )
  }

  const emptyMessage = isFiltered ? 'No patients match these filters.' : 'No patients on this round yet.'

  return (
    <div className="patient-list-screen">
      <div className="patient-list-main">
        <div className="patient-round-header">
          <div className="patient-round-title">
            <h1>{formatDate(round.date)}</h1>
            {round.date === todayDateKey() && <span className="round-today-badge">Today</span>}
          </div>
          <RoundProgress round={round} />
        </div>

        <h2 className="patient-list-heading">Patients</h2>

        <div className="patient-toolbar">
          <input
            type="search"
            className="patient-toolbar-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search patients…"
            aria-label="Search patients by name"
          />
          {facilities.length > 1 && (
            <select value={facilityFilter} onChange={(e) => setFacilityFilter(e.target.value)} aria-label="Filter by facility">
              <option value="">Facility</option>
              {facilities.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          )}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as PatientStage | '')}
            aria-label="Filter by status"
          >
            <option value="">Status</option>
            {STAGES.map((s) => (
              <option key={s} value={s}>
                {PATIENT_STAGE_LABELS[s]}
              </option>
            ))}
          </select>
          <button type="button" className="btn btn-sm patient-toolbar-add" onClick={() => (addOpen ? closeAddForm() : setAddOpen(true))}>
            <Plus size={15} />
            Add Patient
          </button>
        </div>

        {addOpen && (
          <form
            className="patient-add"
            onSubmit={(e) => {
              e.preventDefault()
              handleCreate()
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeAddForm()
            }}
          >
            <label className="patient-add-field">
              <span>Patient name</span>
              <input value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
            </label>
            <label className="patient-add-field">
              <span>Facility</span>
              <input value={newFacility} onChange={(e) => setNewFacility(e.target.value)} list="patient-add-facilities" />
              <datalist id="patient-add-facilities">
                {allFacilities.map((f) => (
                  <option key={f} value={f} />
                ))}
              </datalist>
            </label>
            <div className="patient-add-field">
              <span>Rounding date</span>
              <span className="patient-add-date">{formatDate(roundDate)}</span>
            </div>
            <div className="patient-add-actions">
              <button type="button" className="btn btn-sm" onClick={closeAddForm}>
                Cancel
              </button>
              <button type="submit" className="btn btn-sm" disabled={!newName.trim() || !newFacility.trim()}>
                Add Patient
              </button>
            </div>
          </form>
        )}

        {isFiltered && (
          <div className="patient-filter-indicator">
            <span>
              Showing: {filterParts.join(' · ')} ({visiblePatients.length})
            </span>
            <button type="button" className="patient-text-button" onClick={clearFilters}>
              Clear filters
            </button>
          </div>
        )}

        {visiblePatients.length === 0 ? (
          <p className="patient-list-empty">{emptyMessage}</p>
        ) : (
          <ul className="patient-list">{visiblePatients.map(renderPatientRow)}</ul>
        )}

        <p className="patient-list-footnote">
          Patients are stored on this device only — not yet synced to shared storage.
          {DEV_TOOLS && (
            <>
              {' '}
              <button type="button" className="patient-text-button" onClick={handleSeedMockPatients}>
                Add 15 mock patients (dev)
              </button>
            </>
          )}
        </p>
      </div>

      <div className="patient-list-preview">
        {previewPatient ? renderPreview(previewPatient) : <p className="patient-preview-empty">Select a patient to view their note.</p>}
      </div>
    </div>
  )
}

export default PatientListScreen

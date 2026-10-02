import { ArrowLeft, FilePen, FilePlus2, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import './PatientListScreen.css'
import AddPatientForm from './AddPatientForm'
import type { FacilityRef } from './RoleSelectScreen'
import RoundProgress from './RoundProgress'
import RoundingDateSelect from './RoundingDateSelect'
import { formatDateLabel } from '../lib/dateUtils'
import { seedMockPatients } from '../lib/mockPatients'
import {
  deletePatient,
  listFacilityPatients,
  listFacilityRoundingDates,
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
  // The facility round this screen shows — opened from a Home card, the
  // Analyzer's "View Patients", or Back/Done in the note workspace.
  facility: FacilityRef
  roundingDate: string
  onChangeDate: (date: string) => void
  onBack: () => void
  onSelect: (patient: Patient) => void
  onDelete: (id: string) => void
}

const STAGES = Object.keys(PATIENT_STAGE_LABELS) as PatientStage[]

// Mock-data seeding is developer tooling — hidden outside Vite's dev server.
const DEV_TOOLS = import.meta.env.DEV

function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim()
}

// One facility's round: "which patient needs my attention?" — the facility,
// date and progress up top, then the patient list as the main content, with
// the selected patient's note previewed on the right. The same screen for
// providers and scribes; only signing depends on the role (canSign).
function PatientListScreen({
  teamId,
  canSign,
  signer,
  activePatientId,
  facility,
  roundingDate: roundDate,
  onChangeDate,
  onBack,
  onSelect,
  onDelete,
}: Props) {
  // Bumped after anything here writes to storage, to re-read it.
  const [, setVersion] = useState(0)
  const refresh = () => setVersion((v) => v + 1)
  // Exactly this facility on this date, for this team (patientStore).
  const scoped = listFacilityPatients(teamId, facility.key, roundDate)

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<PatientStage | ''>('')

  const [addOpen, setAddOpen] = useState(false)

  // Armed by a first click on Delete; a second click on the same row
  // actually deletes. Only one row can be armed at a time.
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null)
  // Clicking a patient previews them on the right; Start Note / Edit Note
  // there is what opens the full workspace. Starts on the patient that was
  // open, so Back/Done from the workspace lands on the same preview. Held
  // as an id and read from this round's patients (see previewPatient), so
  // Sign/Unsign updates the preview's status right away.
  const [previewId, setPreviewId] = useState<string | null>(activePatientId)
  // Only ever a patient in this round — a patient opened elsewhere (another
  // facility or date) is never previewed, so it can't be signed from here.
  const previewPatient = scoped.find((p) => p.id === previewId) ?? null


  const query = normalize(search)
  const visiblePatients = scoped.filter(
    (p) =>
      (!query || normalize(p.name).includes(query)) &&
      (!statusFilter || patientStage(p) === statusFilter),
  )
  const filterParts = [
    statusFilter && PATIENT_STAGE_LABELS[statusFilter],
    query && `“${search.trim()}”`,
  ].filter(Boolean)
  const isFiltered = filterParts.length > 0

  // This facility's rounds — the same counts as its Home card.
  const facilityRounds = listFacilityRoundingDates(teamId, facility.key)
  const round = facilityRounds.find((r) => r.date === roundDate) ?? { date: roundDate, total: 0, complete: 0 }

  function clearFilters() {
    setSearch('')
    setStatusFilter('')
  }

  function handleDeleteClick(id: string) {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id)
      return
    }
    deletePatient(id)
    refresh()
    setConfirmDeleteId(null)
    if (previewId === id) setPreviewId(null)
    onDelete(id)
  }

  function handleSeedMockPatients() {
    seedMockPatients(teamId)
    refresh()
  }

  function handleSign() {
    if (!previewPatient || !canSign) return
    signPatientNote(previewPatient.id, signer)
    refresh()
  }

  function handleUnsign() {
    if (!previewPatient || !canSign) return
    unsignPatientNote(previewPatient.id)
    refresh()
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

  const emptyMessage = isFiltered
    ? 'No patients match these filters.'
    : `No patients at ${facility.name} on ${formatDateLabel(roundDate)}.`

  return (
    <div className="patient-list-screen">
      <div className="patient-list-main">
        <button type="button" className="patient-text-button patient-round-back" onClick={onBack}>
          <ArrowLeft size={14} />
          All facilities
        </button>
        <div className="patient-round-header">
          <div className="patient-round-title">
            <h1>{facility.name}</h1>
            <label className="patient-round-date">
              <span>Rounding date</span>
              <RoundingDateSelect
                id="facility-round-date"
                teamId={teamId}
                rounds={facilityRounds}
                value={roundDate}
                onChange={onChangeDate}
              />
            </label>
          </div>
          {round.total > 0 && (
            <div className="patient-round-progress">
              <span className="patient-round-count">
                {round.total} patient{round.total === 1 ? '' : 's'}
              </span>
              <RoundProgress round={round} label={facility.name} hidePercent />
            </div>
          )}
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
          <button type="button" className="btn btn-sm patient-toolbar-add" onClick={() => setAddOpen((open) => !open)}>
            <Plus size={15} />
            Add Patient
          </button>
        </div>

        {addOpen && (
          <AddPatientForm
            teamId={teamId}
            initialFacility={facility.name}
            lockFacility
            roundingDate={roundDate}
            onAdded={() => {
              refresh()
              setAddOpen(false)
            }}
            onCancel={() => setAddOpen(false)}
          />
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

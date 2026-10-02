import { useState } from 'react'
import './PatientListScreen.css'
import { formatDate } from '../lib/dateUtils'
import { createPatient, listPatients } from '../lib/patientStore'
import type { Patient } from '../lib/types'

interface Props {
  teamId: string
  // Pre-filled facility. Editable unless lockFacility.
  initialFacility?: string
  // From a facility round: the patient is added to that facility only.
  lockFacility?: boolean
  // The round the patient is added to — fixed, as before.
  roundingDate: string
  onAdded: (patient: Patient) => void
  onCancel: () => void
}

// Add Patient — one form for Home and the facility round, creating the
// patient through the same createPatient as before. In a facility round the
// facility is fixed (shown, not editable), so a patient can't be saved into
// another facility while the user stays on this one.
function AddPatientForm({ teamId, initialFacility = '', lockFacility = false, roundingDate, onAdded, onCancel }: Props) {
  const [name, setName] = useState('')
  const [facility, setFacility] = useState(initialFacility)
  const knownFacilities = [...new Set(listPatients(teamId).map((p) => p.facility))].sort((a, b) => a.localeCompare(b))

  function handleCreate() {
    if (!name.trim() || !facility.trim()) return
    onAdded(createPatient(name.trim(), teamId, facility.trim(), roundingDate))
  }

  return (
    <form
      className="patient-add"
      onSubmit={(e) => {
        e.preventDefault()
        handleCreate()
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') onCancel()
      }}
    >
      <label className="patient-add-field">
        <span>Patient name</span>
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      {lockFacility ? (
        <div className="patient-add-field">
          <span>Facility</span>
          <span className="patient-add-date">{facility}</span>
        </div>
      ) : (
        <label className="patient-add-field">
          <span>Facility</span>
          <input value={facility} onChange={(e) => setFacility(e.target.value)} list="patient-add-facilities" />
          <datalist id="patient-add-facilities">
            {knownFacilities.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </label>
      )}
      <div className="patient-add-field">
        <span>Rounding date</span>
        <span className="patient-add-date">{formatDate(roundingDate)}</span>
      </div>
      <div className="patient-add-actions">
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="btn btn-sm" disabled={!name.trim() || !facility.trim()}>
          Add Patient
        </button>
      </div>
    </form>
  )
}

export default AddPatientForm

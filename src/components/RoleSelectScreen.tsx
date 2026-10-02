import { Plus } from 'lucide-react'
import { useState } from 'react'
import './RoleSelectScreen.css'
import AddPatientForm from './AddPatientForm'
import RoundProgress from './RoundProgress'
import RoundingDateSelect from './RoundingDateSelect'
import { formatDateLabel } from '../lib/dateUtils'
import { listFacilityRounds, type FacilityRoundSummary } from '../lib/patientStore'

export interface FacilityRef {
  key: string
  name: string
}

interface Props {
  teamId: string
  // The rounding date in view — held by App, so it carries into a facility
  // round and back.
  roundingDate: string
  onChangeDate: (date: string) => void
  onOpenFacility: (facility: FacilityRef) => void
  onOpenAnalyzer: () => void
}

function FacilityCard({ round, onOpen }: { round: FacilityRoundSummary; onOpen: () => void }) {
  return (
    <button type="button" className="round-card" onClick={onOpen}>
      <span className="round-card-top">
        <span className="round-card-date">{round.name}</span>
        <span className="round-card-count">
          {round.total} patient{round.total === 1 ? '' : 's'}
        </span>
      </span>
      <RoundProgress round={round} label={round.name} hidePercent />
    </button>
  )
}

// Home: pick the rounding date, then the facility. Each card is just where,
// how many, and how many are done — the patients are one click away.
function RoleSelectScreen({ teamId, roundingDate, onChangeDate, onOpenFacility, onOpenAnalyzer }: Props) {
  const [addOpen, setAddOpen] = useState(false)
  // Re-read after Add Patient; everything else comes straight from storage.
  const [, setVersion] = useState(0)
  const facilities = listFacilityRounds(teamId, roundingDate)

  return (
    <div className="home-screen">
      <div className="home-content">
        <div className="home-header">
          <h1 className="home-title">Rounds</h1>
          <label className="home-date">
            <span>Rounding date</span>
            <RoundingDateSelect id="home-round-date" teamId={teamId} value={roundingDate} onChange={onChangeDate} />
          </label>
        </div>

        {facilities.length === 0 ? (
          <div className="home-empty">
            <p>No patients on {formatDateLabel(roundingDate)}.</p>
            <p className="home-empty-hint">
              Import a census with the{' '}
              <button type="button" className="home-link" onClick={onOpenAnalyzer}>
                Analyzer
              </button>
              , or{' '}
              <button type="button" className="home-link" onClick={() => setAddOpen(true)}>
                add a patient
              </button>
              .
            </p>
          </div>
        ) : (
          <ul className="round-list">
            {facilities.map((round) => (
              <li key={round.key}>
                <FacilityCard round={round} onOpen={() => onOpenFacility({ key: round.key, name: round.name })} />
              </li>
            ))}
          </ul>
        )}

        {addOpen ? (
          <AddPatientForm
            teamId={teamId}
            roundingDate={roundingDate}
            onAdded={() => {
              setAddOpen(false)
              setVersion((v) => v + 1)
            }}
            onCancel={() => setAddOpen(false)}
          />
        ) : (
          facilities.length > 0 && (
            <button type="button" className="btn btn-sm home-add" onClick={() => setAddOpen(true)}>
              <Plus size={15} />
              Add Patient
            </button>
          )
        )}
      </div>
    </div>
  )
}

export default RoleSelectScreen

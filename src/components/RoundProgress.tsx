import { CircleCheck } from 'lucide-react'
import './RoundProgress.css'
import { formatDate } from '../lib/dateUtils'
import type { RoundingDateSummary } from '../lib/patientStore'
import { progressPercent } from '../lib/roundingProgress'

// "X of Y complete · N%" plus a bar — shared by Home's facility cards and
// the facility round's header, so the two always look and count the same
// (both fed by patientStore's facility-round helpers).
// label: what the bar is announced as (defaults to the date). hidePercent:
// just "X of Y complete" and the bar, where a percentage would be noise.
function RoundProgress({ round, label, hidePercent = false }: { round: RoundingDateSummary; label?: string; hidePercent?: boolean }) {
  const percent = progressPercent(round)
  if (percent === null) return <span className="round-progress-count">No patients yet</span>
  const done = percent === 100

  return (
    <span className={done ? 'round-progress round-progress-done' : 'round-progress'}>
      <span className="round-progress-row">
        <span className="round-progress-count">
          {done && <CircleCheck size={15} className="round-progress-check" />}
          {round.complete} of {round.total} complete
        </span>
        {!hidePercent && <span className="round-progress-percent">{percent}%</span>}
      </span>
      <span
        className="round-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${label ?? formatDate(round.date)}: ${round.complete} of ${round.total} patients complete`}
      >
        <span className="round-progress-fill" style={{ width: `${percent}%` }} />
      </span>
    </span>
  )
}

export default RoundProgress

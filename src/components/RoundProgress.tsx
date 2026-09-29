import { CircleCheck } from 'lucide-react'
import './RoundProgress.css'
import { formatDate } from '../lib/dateUtils'
import type { RoundingDateSummary } from '../lib/patientStore'
import { progressPercent } from '../lib/roundingProgress'

// "X of Y complete · N%" plus a bar — shared by Home's rounding-date cards
// and the rounding-date header on the Patients screen, so the two always
// look and count the same (both fed by patientStore's listRoundingDates).
function RoundProgress({ round }: { round: RoundingDateSummary }) {
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
        <span className="round-progress-percent">{percent}%</span>
      </span>
      <span
        className="round-progress-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-label={`${formatDate(round.date)}: ${round.complete} of ${round.total} patients complete`}
      >
        <span className="round-progress-fill" style={{ width: `${percent}%` }} />
      </span>
    </span>
  )
}

export default RoundProgress

import { useState } from 'react'
import { roundOptions } from '../lib/analyzer/documentDate'
import { formatDateLabel, todayDateKey } from '../lib/dateUtils'
import { listRoundingDates } from '../lib/patientStore'

interface Props {
  teamId: string
  value: string
  onChange: (date: string) => void
  id?: string
}

const OTHER = '__other'
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/

// Picks which round the Analyzer imports into. Options come from the same
// rounding dates Home and the Patients screen show; a date with no
// patients yet is labeled "new round" — importing into it creates it, the
// same way the first Add Patient on a date does.
function RoundingDateSelect({ teamId, value, onChange, id }: Props) {
  const [pickingOther, setPickingOther] = useState(false)
  const today = todayDateKey()
  const options = roundOptions(listRoundingDates(teamId), today)
  // A date chosen via "Other date…" (or accepted from the sheet) that
  // isn't an existing round yet.
  if (!options.some((o) => o.date === value)) {
    options.push({ date: value, isNew: true, total: 0 })
    options.sort((a, b) => b.date.localeCompare(a.date))
  }

  return (
    <span className="round-select">
      <select
        id={id}
        value={pickingOther ? OTHER : value}
        onChange={(e) => {
          if (e.target.value === OTHER) {
            setPickingOther(true)
          } else {
            setPickingOther(false)
            onChange(e.target.value)
          }
        }}
      >
        {options.map((o) => (
          <option key={o.date} value={o.date}>
            {formatDateLabel(o.date)}
            {o.isNew ? ' — new round' : ` · ${o.total} patient${o.total === 1 ? '' : 's'}`}
          </option>
        ))}
        <option value={OTHER}>Other date…</option>
      </select>
      {pickingOther && (
        <input
          type="date"
          aria-label="Choose a rounding date"
          autoFocus
          onChange={(e) => {
            if (!ISO_DATE.test(e.target.value)) return
            setPickingOther(false)
            onChange(e.target.value)
          }}
        />
      )}
    </span>
  )
}

export default RoundingDateSelect

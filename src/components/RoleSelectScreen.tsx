import { useState } from 'react'
import './RoleSelectScreen.css'
import RoundProgress from './RoundProgress'
import { formatDate, todayDateKey } from '../lib/dateUtils'
import { listRoundingDates, type RoundingDateSummary } from '../lib/patientStore'
import { groupRoundsForHome } from '../lib/roundingProgress'

interface Props {
  teamId: string
  onOpenRoundingDate: (date: string) => void
  onOpenAnalyzer: () => void
}

// Past this many previous rounds, the rest sit behind "Show older" so a
// long history doesn't bury today's round.
const PREVIOUS_VISIBLE = 10

function RoundCard({ round, isToday, onOpen }: { round: RoundingDateSummary; isToday: boolean; onOpen: () => void }) {
  return (
    <button type="button" className="round-card" onClick={onOpen}>
      <span className="round-card-top">
        <span className="round-card-date">{formatDate(round.date)}</span>
        {isToday && <span className="round-today-badge">Today</span>}
      </span>
      <RoundProgress round={round} />
    </button>
  )
}

// Home: which round am I working on, and how far along is it? Everything
// else (per-status breakdowns, the patients themselves) is one click away
// on the Patients screen's date view, so it isn't repeated here.
function RoleSelectScreen({ teamId, onOpenRoundingDate, onOpenAnalyzer }: Props) {
  const [showAllPrevious, setShowAllPrevious] = useState(false)
  const today = todayDateKey()
  const { current, upcoming, previous } = groupRoundsForHome(listRoundingDates(teamId), today)
  const visiblePrevious = showAllPrevious ? previous : previous.slice(0, PREVIOUS_VISIBLE)

  const renderCard = (round: RoundingDateSummary) => (
    <li key={round.date}>
      <RoundCard round={round} isToday={round.date === today} onOpen={() => onOpenRoundingDate(round.date)} />
    </li>
  )

  return (
    <div className="home-screen">
      <div className="home-content">
        <h1 className="home-title">Rounding Dates</h1>

        {!current && upcoming.length === 0 ? (
          <div className="home-empty">
            <p>No rounding dates yet.</p>
            <p className="home-empty-hint">
              Import a census with the{' '}
              <button type="button" className="home-link" onClick={onOpenAnalyzer}>
                Analyzer
              </button>
              , or{' '}
              <button type="button" className="home-link" onClick={() => onOpenRoundingDate(today)}>
                add patients to today’s round
              </button>
              .
            </p>
          </div>
        ) : (
          <>
            {current && <ul className="round-list">{renderCard(current)}</ul>}

            {upcoming.length > 0 && (
              <section className="home-section">
                <h2 className="home-section-heading">Upcoming</h2>
                <ul className="round-list">{upcoming.map(renderCard)}</ul>
              </section>
            )}

            {previous.length > 0 && (
              <section className="home-section">
                <h2 className="home-section-heading">Previous</h2>
                <ul className="round-list">{visiblePrevious.map(renderCard)}</ul>
                {previous.length > PREVIOUS_VISIBLE && (
                  <button type="button" className="home-link home-show-more" onClick={() => setShowAllPrevious((v) => !v)}>
                    {showAllPrevious ? 'Show fewer' : `Show ${previous.length - PREVIOUS_VISIBLE} older`}
                  </button>
                )}
              </section>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default RoleSelectScreen

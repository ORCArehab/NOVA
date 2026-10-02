import { NotebookPen, Stethoscope } from 'lucide-react'
import './TeamScreen.css'
import type { CurrentUser } from '../lib/types'

interface Props {
  currentUser: CurrentUser
}

// Read-only. Who's on which provider's team will come from ORCA's
// supervision records; until then NOVA keeps no roster of its own, so this
// shows only the signed-in user and the role ORCA gives them.
function TeamScreen({ currentUser }: Props) {
  const isProvider = currentUser.role === 'provider'

  return (
    <div className="team-screen">
      <div className="team-screen-header">
        <h1>Team</h1>
      </div>

      <div className="team-list">
        <div className="team-section-card">
          <h2 className="team-section-heading">{isProvider ? 'Provider' : 'Scribe'}</h2>
          {isProvider ? (
            <div className="team-provider-row">
              <Stethoscope size={18} className="team-provider-icon" />
              <span className="team-provider-name">{currentUser.name}</span>
              <span className="team-you-badge">You</span>
            </div>
          ) : (
            <div className="team-scribe-row">
              <NotebookPen size={15} className="team-scribe-icon" />
              <span>{currentUser.name}</span>
              <span className="team-you-badge">You</span>
            </div>
          )}
        </div>

        <div className="team-section-card">
          <p className="team-empty-note">
            Team assignments will come from ORCA. Your role is set by an ORCA administrator.
          </p>
        </div>
      </div>
    </div>
  )
}

export default TeamScreen

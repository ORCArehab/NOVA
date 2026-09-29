import { NotebookPen, Stethoscope } from 'lucide-react'
import { useEffect, useState } from 'react'
import './TeamScreen.css'
import { ApiError, fetchTeamRoster } from '../lib/apiClient'
import type { CurrentUser, TeamMember } from '../lib/types'

interface Props {
  currentUser: CurrentUser
}

// Scoped to the signed-in user's own team — a scribe sees their provider
// and teammates, a provider sees themselves and their scribes, never the
// rest of the practice's teams. Read-only: team membership is managed in
// the accounts database, not from inside NOVA.
function TeamScreen({ currentUser }: Props) {
  const [members, setMembers] = useState<TeamMember[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  function loadRoster() {
    fetchTeamRoster()
      .then(setMembers)
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : 'Failed to load the team.'))
  }

  useEffect(loadRoster, [])

  const provider = members.find((m) => m.id === currentUser.teamId)
  const scribes = members.filter((m) => m.role === 'scribe' && m.supervisorId === currentUser.teamId)

  if (loadError) {
    return (
      <div className="team-screen">
        <p className="team-empty-note">{loadError}</p>
      </div>
    )
  }

  if (!provider) return null

  return (
    <div className="team-screen">
      <div className="team-screen-header">
        <h1>Team</h1>
      </div>

      <div className="team-list">
        <div className="team-section-card">
          <h2 className="team-section-heading">Provider</h2>
          <div className="team-provider-row">
            <Stethoscope size={18} className="team-provider-icon" />
            <span className="team-provider-name">{provider.name}</span>
            {provider.id === currentUser.id && <span className="team-you-badge">You</span>}
          </div>
        </div>

        <div className="team-section-card">
          <h2 className="team-section-heading">Scribes</h2>
          {scribes.length === 0 ? (
            <p className="team-empty-note">No scribes assigned yet.</p>
          ) : (
            <div className="team-scribes-list">
              {scribes.map((scribe) => (
                <div key={scribe.id} className="team-scribe-row">
                  <NotebookPen size={15} className="team-scribe-icon" />
                  <span>{scribe.name}</span>
                  {scribe.id === currentUser.id && <span className="team-you-badge">You</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default TeamScreen

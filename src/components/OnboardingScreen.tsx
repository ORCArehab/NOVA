import { useEffect, useState } from 'react'
import './LoginScreen.css'
import { ApiError, completeOnboarding, fetchTeamRoster } from '../lib/apiClient'
import type { Role, TeamMember } from '../lib/types'

interface Props {
  name: string
  email: string
  onComplete: (member: TeamMember) => void
  onSignOut: () => void
}

// Shown once, the first time someone arrives through Google SSO without an
// account yet — Google already told us who they are, so the only thing
// left to ask is their role (and, for a scribe, whose team they're on).
// People who already have an account in the database skip this entirely.
function OnboardingScreen({ name, email, onComplete, onSignOut }: Props) {
  const [role, setRole] = useState<Role>('provider')
  const [providers, setProviders] = useState<TeamMember[]>([])
  const [supervisorId, setSupervisorId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchTeamRoster()
      .then((members) => setProviders(members.filter((m) => m.role === 'provider')))
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Failed to load providers.'))
  }, [])

  async function handleContinue() {
    setSubmitting(true)
    setError(null)
    try {
      onComplete(await completeOnboarding(role, role === 'scribe' ? supervisorId : null))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to set up your account.')
    } finally {
      setSubmitting(false)
    }
  }

  const canContinue = role === 'provider' || supervisorId.length > 0

  return (
    <div className="login-screen">
      <div className="login-screen-content">
        <h1>Welcome, {name}</h1>
        <p className="login-screen-subtitle">
          Signed in as {email}. One quick question before you start.
        </p>

        <div className="login-mode-toggle">
          <button
            type="button"
            className={role === 'provider' ? 'login-mode-option login-mode-option-active' : 'login-mode-option'}
            onClick={() => setRole('provider')}
          >
            I’m a provider
          </button>
          <button
            type="button"
            className={role === 'scribe' ? 'login-mode-option login-mode-option-active' : 'login-mode-option'}
            onClick={() => setRole('scribe')}
          >
            I’m a scribe
          </button>
        </div>

        <div className="login-form">
          {role === 'provider' ? (
            <p className="login-form-label">You’ll start your own team.</p>
          ) : providers.length === 0 ? (
            <p className="login-form-label">No providers have joined yet. Ask your provider to sign in to NOVA first.</p>
          ) : (
            <>
              <label className="login-form-label" htmlFor="onboarding-supervisor">
                Which provider do you scribe for?
              </label>
              <select id="onboarding-supervisor" value={supervisorId} onChange={(e) => setSupervisorId(e.target.value)}>
                <option value="" disabled>
                  Select a provider
                </option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </>
          )}

          {error && <p className="login-form-error">{error}</p>}

          <button type="button" className="btn" onClick={() => void handleContinue()} disabled={submitting || !canContinue}>
            {submitting ? 'Please wait…' : 'Continue'}
          </button>
        </div>

        <button type="button" className="login-signout-link" onClick={onSignOut}>
          Not you? Sign out
        </button>
      </div>
    </div>
  )
}

export default OnboardingScreen

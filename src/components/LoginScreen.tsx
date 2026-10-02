import { useEffect, useState } from 'react'
import './LoginScreen.css'
import { ApiError, demoSignIn, GOOGLE_LOGIN_URL } from '../lib/apiClient'
import { seedDemoPatientsIfEmpty } from '../lib/mockPatients'
import type { CurrentUser, Role } from '../lib/types'

interface Props {
  // Why there's no session — shown instead of silently bouncing to Google
  // again, which would just loop on the same failure (or undo a sign-out).
  authError: string | null
  signedOut: boolean
  onLogin: (user: CurrentUser) => void
}

// Messages for server/routes/auth.js's ?authError= codes.
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  domain: 'Only @orcarehab.com Google Workspace accounts can use this app.',
  no_access: 'Your ORCA account doesn’t have NOVA access. Ask an ORCA administrator to give you the Provider or Scribe role.',
  disabled: 'Your ORCA account is disabled. Contact an ORCA administrator.',
  conflict: 'This Google account doesn’t match your ORCA account. Contact an ORCA administrator.',
  unavailable: 'NOVA can’t reach ORCA to confirm your sign-in right now. Please try again in a moment.',
  cancelled: 'Google sign-in was cancelled.',
  state: 'Your sign-in link expired. Please try again.',
  not_configured: 'Sign-in isn’t configured on the server yet.',
  failed: 'Google sign-in failed. Please try again.',
}

// Local dev only (Vite's dev server) — the server refuses demo sign-in
// anywhere else regardless (see server/demo.js's demoLoginEnabled).
const DEMO_ENABLED = import.meta.env.DEV

// There's no sign-in or sign-up form — the app is reached through the
// Google Workspace app launcher and identity comes from Google. This
// screen is just the hand-off: it goes straight to Google unless there's
// a reason to stop here (an error, a deliberate sign-out, or local dev
// where the demo buttons need to be reachable).
function LoginScreen({ authError, signedOut, onLogin }: Props) {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const autoRedirect = !authError && !signedOut && !DEMO_ENABLED

  useEffect(() => {
    if (autoRedirect) window.location.assign(GOOGLE_LOGIN_URL)
  }, [autoRedirect])

  // Skips Google entirely — signs into a fixed demo account and makes sure
  // its team has the curated demo patients (seeded once, not re-seeded on
  // every click) before handing off. Same shared team either way, since
  // the Demo Scribe is supervised by the Demo Provider — the two buttons
  // are two viewpoints on one walk-through-able dataset.
  async function handleDemoLogin(role: Role) {
    setSubmitting(true)
    setError(null)
    try {
      const user = await demoSignIn(role)
      seedDemoPatientsIfEmpty(user.teamId)
      onLogin(user)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load the demo.')
    } finally {
      setSubmitting(false)
    }
  }

  if (autoRedirect) {
    return (
      <div className="login-screen">
        <p className="login-screen-subtitle">Signing you in…</p>
      </div>
    )
  }

  const message = authError ? (AUTH_ERROR_MESSAGES[authError] ?? AUTH_ERROR_MESSAGES.failed) : null

  return (
    <div className="login-screen">
      <div className="login-screen-content">
        <h1>{signedOut ? 'You’re signed out' : 'Welcome'}</h1>
        <p className="login-screen-subtitle">Sign in with your Orca Rehab Google Workspace account.</p>

        <div className="login-form">
          {message && <p className="login-form-error">{message}</p>}
          <a className="btn" href={GOOGLE_LOGIN_URL}>
            Continue with Google
          </a>
        </div>

        {DEMO_ENABLED && (
          <div className="login-demo">
            <div className="login-demo-divider">
              <span>or explore a demo (local dev only)</span>
            </div>
            <div className="login-demo-actions">
              <button type="button" className="btn btn-sm" onClick={() => void handleDemoLogin('provider')} disabled={submitting}>
                View as Provider
              </button>
              <button type="button" className="btn btn-sm" onClick={() => void handleDemoLogin('scribe')} disabled={submitting}>
                View as Scribe
              </button>
            </div>
            {error && <p className="login-form-error">{error}</p>}
            <p className="login-demo-note">Both open the same walk-through patients, viewed from each role.</p>
          </div>
        )}
      </div>
    </div>
  )
}

export default LoginScreen

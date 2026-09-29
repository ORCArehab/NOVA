import { ArrowLeft, Check, FileSignature } from 'lucide-react'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import './App.css'
import AnalyzerScreen from './components/AnalyzerScreen'
import AssistPanel from './components/AssistPanel'
import ChatPanel from './components/ChatPanel'
import CompletenessPanel, { type CompletenessStatus } from './components/CompletenessPanel'
import ImportPdfPanel from './components/ImportPdfPanel'
import LoginScreen from './components/LoginScreen'
import OnboardingScreen from './components/OnboardingScreen'
import OutputPanel, { type RewordStatus } from './components/OutputPanel'
import PatientListScreen from './components/PatientListScreen'
import RoleSelectScreen from './components/RoleSelectScreen'
import SuggestionsPanel from './components/SuggestionsPanel'
import TaskBar from './components/TaskBar'
import TeamScreen from './components/TeamScreen'
import UploadToolScreen from './components/UploadToolScreen'
import { ApiError, applySuggestions, fetchSession, rewordText, signOut, updateNoteWithAnswer } from './lib/apiClient'
import { checkCompletenessLocal } from './lib/completenessCheck'
import { getPatientById, saveNote } from './lib/patientStore'
import { resolveTeamId } from './lib/team'
import type { CurrentUser, NoteType, Patient, Signer, TeamMember } from './lib/types'

// server/routes/auth.js sends the browser back to /?authError=<code> when
// Google sign-in is rejected. Read once, then scrubbed from the address
// bar so a refresh retries sign-in instead of re-showing a stale error.
function consumeAuthError(): string | null {
  const params = new URLSearchParams(window.location.search)
  const code = params.get('authError')
  if (code) {
    params.delete('authError')
    const query = params.toString()
    window.history.replaceState(null, '', window.location.pathname + (query ? `?${query}` : ''))
  }
  return code
}

type AuthState =
  | { status: 'loading' }
  | { status: 'signedOut'; authError: string | null; deliberate: boolean }
  // Google identified them, but they have no account yet — first visit.
  | { status: 'onboarding'; name: string; email: string }
  | { status: 'signedIn' }

function App() {
  // Restored from the Google SSO session cookie on load (see the effect
  // below), so a refresh — or arriving again from the Workspace app
  // launcher — doesn't ask anyone to sign in twice. Sign Out clears it on
  // the server. Everything else on screen — which team's patients show
  // up, which role's panels render — is derived from this.
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [auth, setAuth] = useState<AuthState>({ status: 'loading' })

  useEffect(() => {
    const authError = consumeAuthError()
    fetchSession()
      .then((session) => {
        if (!session) {
          setAuth({ status: 'signedOut', authError, deliberate: false })
        } else if (!session.member) {
          setAuth({ status: 'onboarding', name: session.name, email: session.email })
        } else {
          handleLogin(session.member)
        }
      })
      .catch(() => setAuth({ status: 'signedOut', authError: 'failed', deliberate: false }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 'home' is the dashboard landing page; 'app' is the note workspace.
  // 'patients' (one rounding date)/'upload'/'analyzer'/'team' overlay whichever of those is
  // current — they don't replace the state underneath, so returning from
  // any of them lands back where you were.
  const [screen, setScreen] = useState<'home' | 'app' | 'patients' | 'upload' | 'analyzer' | 'team'>('home')
  // Which round the patients screen shows.
  const [roundDate, setRoundDate] = useState<string | null>(null)
  const [selectedPatientId, setSelectedPatientId] = useState<string | null>(null)
  const [selectedPatientName, setSelectedPatientName] = useState<string | null>(null)

  const [rewordStatus, setRewordStatus] = useState<RewordStatus>('idle')
  const [reworded, setReworded] = useState<string | null>(null)
  const [previousReworded, setPreviousReworded] = useState<string | null>(null)
  const [rewordError, setRewordError] = useState<string | null>(null)
  const [extractedText, setExtractedText] = useState<string | null>(null)
  const [noteType, setNoteType] = useState<NoteType>('initial')

  // A provider's signature attests to the note text as it stood at sign
  // time — any further edit (manual or AI-applied) invalidates it, so it
  // gets cleared automatically rather than silently going stale.
  const [signed, setSigned] = useState(false)
  const [signedAt, setSignedAt] = useState<number | null>(null)
  const [signedBy, setSignedBy] = useState<Signer | null>(null)

  // The stored version of the note this workspace loaded (its updatedAt).
  // Autosave only writes over that exact version — if the note changed
  // anywhere else meanwhile (another tab or window, a sign/unsign from the
  // patient preview), saving stops and noteConflict asks for a reload
  // instead of silently overwriting someone's work.
  const baseUpdatedAtRef = useRef(0)
  const [noteConflict, setNoteConflict] = useState(false)

  const [completenessStatus, setCompletenessStatus] = useState<CompletenessStatus>('idle')
  const [verdict, setVerdict] = useState<string | null>(null)
  const [missingItems, setMissingItems] = useState<string[]>([])

  // Bumped only on AI-driven regenerations (reword, chat answer, applied
  // suggestions) — used to trigger the Suggestions panel's auto-refresh
  // without it also firing on every keystroke of a manual edit, since
  // reworded itself changes on every keystroke too.
  const [noteVersion, setNoteVersion] = useState(0)

  // Whatever reword-affecting operation most recently ran — retry re-runs
  // exactly that, instead of always falling back to a full reword from the
  // original PDF text and silently discarding chat/suggestion progress.
  const lastOperationRef = useRef<(() => void) | null>(null)

  // Autosave to the patient's stored note, guarded against overwriting
  // changes made elsewhere (see baseUpdatedAtRef).
  useEffect(() => {
    if (!selectedPatientId || noteConflict) return
    const result = saveNote(selectedPatientId, { noteType, extractedText, reworded, signed, signedAt, signedBy }, baseUpdatedAtRef.current)
    if (result.status === 'saved') baseUpdatedAtRef.current = result.updatedAt
    else if (result.status === 'conflict') setNoteConflict(true)
  }, [selectedPatientId, noteType, extractedText, reworded, signed, signedAt, signedBy, noteConflict])

  // Loads a patient's stored note into the workspace, the same way a fresh
  // PDF import would — extractedText changing is what the Chat/Suggestions
  // panels already key their per-document resets off of, so switching
  // patients naturally clears any leftover chat draft or stale suggestion
  // selection from whoever was open before.
  function handleSelectPatient(patient: Patient) {
    setSelectedPatientId(patient.id)
    setSelectedPatientName(patient.name)
    setNoteType(patient.noteType)
    setExtractedText(patient.extractedText)
    setReworded(patient.reworded)
    setPreviousReworded(null)
    setRewordError(null)
    setRewordStatus(patient.reworded ? 'done' : 'idle')
    setSigned(patient.signed ?? false)
    setSignedAt(patient.signedAt ?? null)
    setSignedBy(patient.signedBy ?? null)
    baseUpdatedAtRef.current = patient.updatedAt
    setNoteConflict(false)
    lastOperationRef.current = null
    setNoteVersion((v) => v + 1)
    if (patient.reworded) {
      runCompletenessCheck(patient.reworded)
    } else {
      setCompletenessStatus('idle')
      setVerdict(null)
      setMissingItems([])
    }
    setScreen('app')
  }

  // Shared by handleDeletePatient (the deleted patient was open) and
  // handleSignOut (privacy — the next person to sign in on a shared
  // workstation shouldn't see a leftover note from whoever was here
  // before, especially now that it could belong to a different team).
  function resetWorkspace() {
    setSelectedPatientId(null)
    setSelectedPatientName(null)
    setNoteType('initial')
    setExtractedText(null)
    setReworded(null)
    setPreviousReworded(null)
    setRewordError(null)
    setRewordStatus('idle')
    setCompletenessStatus('idle')
    setVerdict(null)
    setMissingItems([])
    clearSignature()
    setNoteConflict(false)
    setNoteVersion((v) => v + 1)
  }

  function handleDeletePatient(id: string) {
    if (id !== selectedPatientId) return
    resetWorkspace()
  }

  function applyRewordResult(result: string, baseline: string | null) {
    setPreviousReworded(baseline)
    setReworded(result)
    setRewordStatus('done')
    clearSignature()
    setNoteVersion((v) => v + 1)
    runCompletenessCheck(result)
  }

  // A provider's signature attests to the note text as it stood at sign
  // time — any later edit, by anyone, clears it (applyRewordResult,
  // handleOutputChange), so a signature is never left on changed text.
  function clearSignature() {
    setSigned(false)
    setSignedAt(null)
    setSignedBy(null)
  }

  // Provider-only. Checked here, not just by hiding the button — though
  // with notes stored in the browser (lib/patientStore.ts) there's no
  // server to enforce it yet; see README.
  function handleSignNote() {
    if (currentUser?.role !== 'provider' || !reworded) return
    setSigned(true)
    setSignedAt(Date.now())
    setSignedBy({ id: currentUser.id, name: currentUser.name })
  }

  function handleUnsignNote() {
    if (currentUser?.role !== 'provider') return
    clearSignature()
  }

  // Throws away this workspace's unsaved view and loads what's stored now.
  function handleReloadNote() {
    const patient = selectedPatientId ? getPatientById(selectedPatientId) : null
    if (patient) handleSelectPatient(patient)
    else handleLeaveWorkspace()
  }

  async function runReword(text: string) {
    lastOperationRef.current = () => runReword(text)
    setRewordStatus('loading')
    setRewordError(null)
    try {
      const result = await rewordText(text, noteType)
      applyRewordResult(result, null)
    } catch (err) {
      setRewordError(err instanceof ApiError ? err.message : 'Failed to reword text.')
      setRewordStatus('error')
    }
  }

  // Chat answers don't reword the note from scratch — that would let the AI
  // rephrase unrelated sentences on every answer, making the diff highlight
  // noisy. Instead this edits the current note in place, touching only what
  // the new answer actually affects, so the highlight reflects real changes.
  async function handleChatAnswer(question: string, answer: string) {
    if (!reworded) return
    const baseline = reworded
    lastOperationRef.current = () => handleChatAnswer(question, answer)
    setRewordStatus('loading')
    setRewordError(null)
    try {
      const result = await updateNoteWithAnswer(reworded, question, answer)
      applyRewordResult(result, baseline)
    } catch (err) {
      setRewordError(err instanceof ApiError ? err.message : 'Failed to update the note.')
      setRewordStatus('error')
    }
  }

  // Same precise, preserve-everything-else editing approach as chat answers
  // — only now the "new information" is one or more physician-selected
  // suggestions instead of a Q&A pair.
  async function handleApplySuggestions(selected: string[]) {
    if (!reworded) return
    const baseline = reworded
    lastOperationRef.current = () => handleApplySuggestions(selected)
    setRewordStatus('loading')
    setRewordError(null)
    try {
      const result = await applySuggestions(reworded, selected)
      applyRewordResult(result, baseline)
    } catch (err) {
      setRewordError(err instanceof ApiError ? err.message : 'Failed to apply suggestions.')
      setRewordStatus('error')
    }
  }

  function runCompletenessCheck(text: string) {
    const result = checkCompletenessLocal(text)
    setVerdict(result.verdict)
    setMissingItems(result.missingItems)
    setCompletenessStatus('done')
  }

  function handleExtracted(text: string) {
    setExtractedText(text)
    void runReword(text)
    runCompletenessCheck(text)
  }

  function handleRetryReword() {
    lastOperationRef.current?.()
  }

  // Deliberately doesn't clear previousReworded — the diff highlighting
  // should stay visible while editing, not vanish on the first keystroke.
  // Only handleDismissDiff (the "Clear highlights" button) drops it.
  function handleOutputChange(text: string) {
    setReworded(text)
    if (signed) clearSignature()
  }

  function handleDismissDiff() {
    setPreviousReworded(null)
  }

  function handleRecheckCompleteness() {
    const text = reworded ?? extractedText
    if (text) runCompletenessCheck(text)
  }

  function handleOpenRound(date: string) {
    setRoundDate(date)
    setScreen('patients')
  }

  // Back/Done from the note workspace: return to the open patient's round,
  // or Home when no patient was open.
  function handleLeaveWorkspace() {
    const patient = selectedPatientId ? getPatientById(selectedPatientId) : null
    if (patient) handleOpenRound(patient.roundingDate)
    else setScreen('home')
  }

  // Sets both role and team for the session in one step — called with the
  // account behind the SSO session, a just-finished onboarding, or (local
  // dev only) a demo account.
  function handleLogin(member: TeamMember) {
    setCurrentUser({ id: member.id, name: member.name, email: member.email, role: member.role, teamId: resolveTeamId(member) })
    setAuth({ status: 'signedIn' })
    setScreen('home')
  }

  // Ends the app's session, not their Google Workspace one — and lands on
  // a "signed out" screen rather than bouncing straight back through
  // Google, which would silently sign them right back in.
  async function handleSignOut() {
    await signOut()
    resetWorkspace()
    setCurrentUser(null)
    setAuth({ status: 'signedOut', authError: null, deliberate: true })
    setScreen('home')
  }

  let pageContent: ReactNode

  // The single canonical "go home" action, used by the TaskBar's Home
  // button regardless of which screen it's clicked from.
  function handleGoHome() {
    setScreen('home')
  }

  if (auth.status === 'loading') {
    pageContent = null
  } else if (auth.status === 'onboarding') {
    pageContent = (
      <OnboardingScreen name={auth.name} email={auth.email} onComplete={handleLogin} onSignOut={() => void handleSignOut()} />
    )
  } else if (!currentUser) {
    pageContent = (
      <LoginScreen
        authError={auth.status === 'signedOut' ? auth.authError : null}
        signedOut={auth.status === 'signedOut' && auth.deliberate}
        onLogin={handleLogin}
      />
    )
  } else if (screen === 'patients' && roundDate) {
    pageContent = (
      <PatientListScreen
        // Remount per round — filters and the preview belong to one round.
        key={roundDate}
        teamId={currentUser.teamId}
        canSign={currentUser.role === 'provider'}
        signer={{ id: currentUser.id, name: currentUser.name }}
        activePatientId={selectedPatientId}
        roundingDate={roundDate}
        onSelect={handleSelectPatient}
        onDelete={handleDeletePatient}
      />
    )
  } else if (screen === 'upload') {
    pageContent = <UploadToolScreen teamId={currentUser.teamId} />
  } else if (screen === 'analyzer') {
    pageContent = (
      <AnalyzerScreen teamId={currentUser.teamId} onViewPatients={handleOpenRound} />
    )
  } else if (screen === 'team') {
    pageContent = <TeamScreen currentUser={currentUser} />
  } else if (screen === 'home') {
    pageContent = (
      <RoleSelectScreen
        teamId={currentUser.teamId}
        onOpenRoundingDate={handleOpenRound}
        onOpenAnalyzer={() => setScreen('analyzer')}
      />
    )
  } else {
    const isProvider = currentUser.role === 'provider'

    // One role/status-aware action. Scribes hand off; providers sign.
    // Nobody signs an empty note, and a signature shows who and when.
    let noteAction: ReactNode = null
    if (signed) {
      noteAction = (
        <span className="note-signed">
          <span className="note-signed-label">
            Signed{signedBy ? ` by ${signedBy.name}` : ''}
            {signedAt ? ` on ${new Date(signedAt).toLocaleString()}` : ''}
          </span>
          {isProvider && (
            <button type="button" className="note-text-button" onClick={handleUnsignNote}>
              Unsign
            </button>
          )}
        </span>
      )
    } else if (reworded && isProvider) {
      noteAction = (
        <button type="button" className="btn note-primary" onClick={handleSignNote} disabled={noteConflict}>
          <FileSignature size={15} />
          Sign Note
        </button>
      )
    } else if (reworded) {
      noteAction = (
        <button type="button" className="btn note-primary" onClick={handleLeaveWorkspace}>
          <Check size={15} />
          Ready for Provider
        </button>
      )
    }

    pageContent = (
      <div className="app-container">
        <div className="app-topbar">
          <div className="app-topbar-left">
            <button type="button" className="btn btn-sm" onClick={handleLeaveWorkspace}>
              <ArrowLeft size={15} />
              Back
            </button>
            <span className="app-topbar-patient">
              {selectedPatientName ? `Patient: ${selectedPatientName}` : 'No patient selected'}
            </span>
          </div>
          <div className="app-topbar-actions">{noteAction}</div>
        </div>
        {noteConflict && (
          <div className="note-conflict" role="alert">
            <span>
              This note was changed somewhere else (another tab or window) after you opened it, so changes made here
              since then weren’t saved.
            </span>
            <button type="button" className="btn btn-sm" onClick={handleReloadNote}>
              Reload note
            </button>
          </div>
        )}
        {/* One workspace for every role — the same note, panels, and AI
            tools. Roles differ only in capabilities: providers also get AI
            Suggestions and signing. */}
        <div className="app-shell">
          <div className="left-column">
            <ImportPdfPanel noteType={noteType} onNoteTypeChange={setNoteType} onExtracted={handleExtracted} />
            <CompletenessPanel
              status={completenessStatus}
              verdict={verdict}
              missingItems={missingItems}
              onRecheck={handleRecheckCompleteness}
            />
          </div>
          <AssistPanel
            interview={<ChatPanel extractedText={extractedText} currentNoteText={reworded} onAnswer={handleChatAnswer} />}
            suggestions={
              isProvider ? (
                <SuggestionsPanel
                  noteText={reworded}
                  originalText={extractedText}
                  noteVersion={noteVersion}
                  onApply={handleApplySuggestions}
                />
              ) : undefined
            }
          />
          <OutputPanel
            status={rewordStatus}
            reworded={reworded}
            previousReworded={previousReworded}
            error={rewordError}
            onRetry={handleRetryReword}
            onChange={handleOutputChange}
            onDismissDiff={handleDismissDiff}
          />
        </div>
      </div>
    )
  }

  return (
    <div className="app-shell-root">
      <TaskBar
        currentUser={currentUser}
        onHome={handleGoHome}
        onOpenTeam={() => setScreen('team')}
        onOpenUploadTool={() => setScreen('upload')}
        onOpenAnalyzer={() => setScreen('analyzer')}
        onSignOut={() => void handleSignOut()}
      />
      <div className="app-body">
        <div className="app-page-content">{pageContent}</div>
      </div>
    </div>
  )
}

export default App

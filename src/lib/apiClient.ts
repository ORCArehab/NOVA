import type {
  ApiErrorResponse,
  ApplySuggestionsResponse,
  ChatHistoryMessage,
  ChatResponse,
  CurrentUser,
  NoteType,
  Role,
  RewordResponse,
  Suggestion,
  SuggestionsResponse,
  UpdateNoteResponse,
} from './types'
import type { HeaderReading, RowReading } from './analyzer/types'

export class ApiError extends Error {}

function readErrorMessage(data: unknown): string {
  return (data as ApiErrorResponse | null)?.error ?? 'Something went wrong. Please try again.'
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new ApiError("Can't reach the server. Is it running?")
  }

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    throw new ApiError(readErrorMessage(data))
  }

  return data as T
}

export function rewordText(text: string, noteType: NoteType): Promise<string> {
  return postJson<RewordResponse>('/api/reword', { text, noteType }).then((r) => r.reworded)
}

export function sendChatMessage(noteText: string, history: ChatHistoryMessage[]): Promise<string> {
  return postJson<ChatResponse>('/api/chat', { noteText, history }).then((r) => r.reply)
}

export function updateNoteWithAnswer(noteText: string, question: string, answer: string): Promise<string> {
  return postJson<UpdateNoteResponse>('/api/update-note', { noteText, question, answer }).then((r) => r.updatedNote)
}

export function getSuggestions(noteText: string, originalText: string): Promise<Suggestion[]> {
  return postJson<SuggestionsResponse>('/api/suggestions', { noteText, originalText }).then((r) => r.suggestions)
}

export function applySuggestions(noteText: string, suggestions: string[]): Promise<string> {
  return postJson<ApplySuggestionsResponse>('/api/apply-suggestions', { noteText, suggestions }).then(
    (r) => r.updatedNote,
  )
}

// Google Workspace SSO — see server/routes/auth.js. There's no sign-in
// form: the browser is sent to /api/auth/google/login, and comes back with
// a session cookie that every other /api call rides on automatically.
export const GOOGLE_LOGIN_URL = '/api/auth/google/login'

// The signed-in user, or why there isn't one: 'signedOut' (no valid
// session) or 'noAccess' (signed in to ORCA without a NOVA role). The
// server re-checks their ORCA roles on every call.
export type SessionResult = { status: 'signedIn'; user: CurrentUser } | { status: 'signedOut' } | { status: 'noAccess' }

export async function fetchSession(): Promise<SessionResult> {
  let res: Response
  try {
    res = await fetch('/api/auth/me')
  } catch {
    throw new ApiError("Can't reach the server. Is it running?")
  }
  const data = await res.json().catch(() => null)
  if (res.status === 401) return { status: 'signedOut' }
  if (res.status === 403) return { status: 'noAccess' }
  if (!res.ok) throw new ApiError(readErrorMessage(data))
  return { status: 'signedIn', user: (data as { user: CurrentUser }).user }
}

export async function signOut(): Promise<void> {
  await fetch('/api/auth/logout', { method: 'POST' }).catch(() => undefined)
}

// Local dev only — the server 404s this anywhere else.
export function demoSignIn(role: Role): Promise<CurrentUser> {
  return postJson<{ user: CurrentUser }>('/api/auth/demo', { role }).then((r) => r.user)
}

// Document Analyzer — see server/routes/analyzeDocument.js. Only cropped
// highlighted rows and page 1's header are sent, never the whole PDF.
export function readDocumentHeader(image: string): Promise<HeaderReading> {
  return postJson<HeaderReading>('/api/analyze-document/header', { image })
}

export function readDocumentRows(rows: { id: string; image: string }[]): Promise<RowReading[]> {
  return postJson<{ rows: RowReading[] }>('/api/analyze-document/rows', { rows }).then((r) => r.rows)
}

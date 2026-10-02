# Note Observation & Validation Assistant

Import a patient progress-notes PDF, extract its text client-side, and get a
version reworded into a standard PM&R progress note format via GPT. An AI
chat then interviews the clinician to fill in gaps in the patient's
functional/rehab profile, and an AI suggestions panel proposes reviewable
additions (referrals, medications, equipment, follow-up) — the clinician
selects what to add, and it lands in the note as their own direct plan,
never as invented clinical fact.

## Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in `OPENAI_API_KEY` (get one at
   [platform.openai.com/api-keys](https://platform.openai.com/api-keys)).
   Real sign-in also needs the Google and ORCA settings (see
   [Sign-in](#sign-in) below) — without them, the local-dev-only demo
   buttons still work.
3. `npm run gen-cert` — generates a self-signed TLS cert into `certs/`
   (gitignored) so both dev servers can run over HTTPS. Your browser will
   warn that the cert isn't trusted; that's expected for a local dev cert.
4. `npm run dev:all` — starts the Vite dev server (`:5173`) and the API
   server (`:3001`) together, both over HTTPS.

## How it works

- PDF text extraction runs entirely in the browser via `pdf.js` — no OCR
  service, no cost, and the raw PDF file never leaves the browser. Only
  text-based PDFs are supported; scanned/image-only PDFs will show an error.
- The extracted text is sent to a small Express backend (`/server`), which
  calls the OpenAI API to reword it into the PM&R progress note structure
  defined in `server/progressNoteSkeleton.js`. The API key lives only in the
  server's `.env` and is never exposed to the browser.
- In parallel, the extracted text is scanned locally (in the browser, no API
  call, no cost) with a fixed keyword check per required section (subjective,
  PMH, social/family history, allergies, medications, exam, labs,
  assessment/plan). Any section whose usual header/keywords aren't found is
  flagged as worth a second look — a heuristic warning, not a claim that
  content is actually missing.
- **AI Chat** (`server/routes/chat.js`) interviews the clinician one question
  at a time to fill in gaps, prioritizing a PM&R-specific patient profile —
  current rehab services (PT/OT/speech frequency and progress), assistive
  devices, functional status, prior level of function, living situation,
  patient goals, pain's functional impact, safety, and discharge planning —
  before falling back to generic section gaps, and skipping anything already
  documented. A Skip button is available for questions the clinician can't
  answer. Each answer updates the note in place via
  `server/routes/updateNote.js`, instructed to touch only the section the
  answer affects and preserve everything else character-for-character, so
  the diff highlight below stays precise instead of showing incidental AI
  rephrasing.
- **AI Suggestions** (`server/routes/suggestions.js`) proactively generates
  categorized, physician-reviewable suggestions — referrals, medications,
  equipment, safety, follow-up, documentation — from the note and the
  original source text. Medication suggestions can name a specific drug and
  dose for a symptom clearly stated in the note (e.g. reported trouble
  sleeping → melatonin), with guardrails: always cross-checked against the
  note's documented allergies, never a specific dose for controlled
  substances/anticoagulants/insulin (a generic "reassess" instead), and a
  persistent on-screen reminder to verify against interactions and
  renal/hepatic function before prescribing. The clinician selects which
  suggestions to add; `server/routes/applySuggestions.js` adds only the
  selected ones, rephrased as the clinician's own direct plan — never hedged
  language like "consider."
- The Reworded Output panel shows what changed after each chat answer or
  applied suggestion as an editable, highlighted diff — new content is
  highlighted in green, and you can type directly into it without losing the
  highlighting. A "Clear highlights" button drops back to a plain editable
  view.
- The API server writes an access-only audit trail to `server/logs/audit.log`
  (`server/auditLog.js`) — timestamp, method, path, status, user, IP. The
  audit log never contains note text or model output, only who accessed the
  endpoint and when. Every `/api` route except `/api/auth` requires a
  signed-in Google Workspace session — see below.
- Both dev servers run over HTTPS using a locally generated self-signed cert
  (`certs/`, gitignored — regenerate with `npm run gen-cert`).

## Document Analyzer

The **Analyzer** screen turns a facility billing or census sheet, with that
day's patients highlighted (usually highlighter on paper, then scanned in
color), into patients on a rounding date. It never creates a patient on
its own: the user reviews, corrects and confirms every import.

The pipeline is split so that deterministic image processing decides
*which* rows are highlighted, and AI only reads *what those rows say*:

| Stage | Where | Module |
|---|---|---|
| Validate + open the PDF (type, size ≤ 25 MB, ≤ 40 pages, password, corruption) | Browser | `src/lib/analyzer/ingest.ts` |
| Render each page (~150 DPI), find highlighter-colored bands by pixel color | Browser | `src/lib/analyzer/highlights.ts` |
| Crop each band full-width, plus a small header strip from page 1 | Browser | `src/lib/analyzer/ingest.ts` |
| Read names / facility / date from the crops (OpenAI vision, JSON output) | Server | `server/routes/analyzeDocument.js`, `server/documentReader.js`, `server/analyzerSchema.js` |
| Grade confidence (highlight shape, legibility, name plausibility) | Browser | `src/lib/analyzer/validate.ts` |
| Duplicate check (name + facility + rounding date, per team) | Browser | `src/lib/analyzer/duplicates.ts` |
| Review, then import through the normal `createPatient` | Browser | `src/components/AnalyzerReview.tsx`, `src/lib/analyzer/importPatients.ts` |

`src/lib/analyzer/analyze.ts` chains the stages together.

Data handling: the PDF and its rendered pages never leave the browser and
are never stored. Only the cropped highlighted rows and the header strip
are sent to the server, which passes them to OpenAI and keeps nothing. The
header strip stops above the first highlighted row, but on a sheet with a
very short title block it can still include a table row or two. Failures
log only an error status and code, never images or model output. The same
OpenAI BAA / zero-retention caveat as the rest of the app applies (see the
compliance note below). `OPENAI_VISION_MODEL` can override the model if
`OPENAI_MODEL` is ever set to one without image input.

Not supported yet: handwritten names, and sheets scanned in black-and-white
(the highlighter disappears).

Tests: `npm test` (vitest), which covers highlight detection, row
validation, duplicate detection, import, the server's input/output
validation, and sign-in and sessions against a fake ORCA
(`server/auth.test.js`).

## Sign-in

There's no sign-in or sign-up form, and NOVA keeps no accounts or roles of
its own. Identity comes from the ORCA Backend API:

1. The app is reached from the Google Workspace app launcher. NOVA sends the
   browser through Google with its own OAuth client
   (`server/routes/auth.js`); anyone already signed into Workspace goes
   straight through without seeing a Google screen.
2. NOVA's server sends the resulting Google ID token to ORCA
   (`POST /v1/identity/sessions`, authenticated with `NOVA_API_KEY`). ORCA
   verifies it, checks it's an active ORCA Workspace account, and returns the
   person, their roles and an ORCA user token (`server/orcaClient.js`).
3. ORCA's roles decide access (`server/identity.js`): **PROVIDER** uses NOVA
   as a provider (can sign notes), **SCRIBE** as a scribe; someone with both
   is a provider. Anyone else is turned away. Roles are assigned in ORCA, never
   chosen in NOVA.
4. The session is an encrypted, HttpOnly cookie (`server/session.js`) holding
   the ORCA token. It ends after 30 idle minutes or 12 hours, whichever comes
   first, and never outlives the ORCA token. NOVA re-checks the person with
   ORCA at least every 5 minutes and on every page load, so role changes and
   deactivations in ORCA take effect within minutes.

The browser never sees `NOVA_API_KEY`, the ORCA token, the Google client
secret or the session key.

Teams: a provider's patients are their own; a scribe works in their own list
unless `NOVA_SCRIBE_TEAMS` maps them to a provider's. That mapping is
compatibility only — it chooses a patient list and grants nothing — until
ORCA's supervision records replace it. The Team page shows only the
signed-in user.

Setup (one time):

1. In [Google Cloud Console](https://console.cloud.google.com/), under a
   project owned by the Workspace org: **APIs & Services → OAuth consent
   screen**, choose **Internal** (only your Workspace users can sign in, and
   they aren't shown a consent prompt).
2. **Credentials → Create credentials → OAuth client ID**, type **Web
   application**. Add these **Authorized redirect URIs**:
   - `https://<your-deployed-domain>/api/auth/google/callback`
   - `http://localhost:5173/api/auth/google/callback` for local dev (use
     `https://` if you ran `npm run gen-cert`)
3. Put the client ID and secret in `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET`, and list the client ID in the ORCA API's
   `GOOGLE_CLIENT_IDS` as `nova:<client id>` (ORCA only accepts NOVA
   sign-ins issued to NOVA's own client).
4. To add it to the app launcher, go to Google Admin console → **Apps → Web
   and mobile apps → Add app → Add custom web app** (or a shared bookmark)
   and point it at the deployed URL.

The **View as Provider / View as Scribe** demo buttons bypass Google and ORCA
with fixed synthetic people (`server/demo.js`), so they only exist in local
dev. The frontend shows them only under Vite's dev
server, and the server refuses `/api/auth/demo` on Vercel or when
`NODE_ENV=production`.

## Deploying to Vercel

**Only use synthetic/mock patient data on a deployment until the OpenAI BAA
is signed and zero data retention is confirmed** — see the compliance note
below. Vercel itself can be made HIPAA-eligible (BAA available on Pro/
Enterprise), but that's a separate step from the OpenAI BAA, and neither is
in place by default.

The API is structured to run both as a local long-running process
(`server/index.js`, used by `npm run dev:server`) and as a Vercel serverless
function (`api/index.js`) — both just wrap the same Express app defined in
`server/app.js`. `vercel.json` rewrites all `/api/*` requests to that
function.

To deploy: connect this repo in Vercel (or `vercel --prod` if using the
CLI), then set these under Project Settings → Environment Variables:

- `OPENAI_API_KEY` — required, the app will fail on cold start without it.
- `OPENAI_MODEL` — optional, defaults to `gpt-4o-mini`.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` — required for sign-in (see
  [Sign-in](#sign-in)).
- `ORCA_API_URL`, `NOVA_API_KEY` — required for sign-in: the ORCA Backend
  API's URL and NOVA's application key for it.
- `SESSION_SECRET` — required, at least 32 random characters
  (`openssl rand -hex 32`); encrypts the session cookie. Sign-in reports
  "not configured" without it.
- `ALLOWED_EMAIL_DOMAIN` — optional, defaults to `orcarehab.com`.
- `NOVA_SCRIBE_TEAMS` — optional, `scribe@orcarehab.com:<provider ORCA person
  id>,...` (see [Sign-in](#sign-in)).

Note that `certs/` (the local self-signed TLS cert) is irrelevant on
Vercel — Vercel terminates HTTPS itself, so `api/index.js` never touches
that cert-loading logic at all. Also, the audit log writes to `console.log`
instead of a local file when deployed (`server/auditLog.js` detects the
`VERCEL` env var Vercel sets automatically) — view it under your Vercel
project's Function Logs, since a serverless function's local filesystem
isn't persistent between invocations.

## Privacy / compliance note

This app sends extracted patient note text to OpenAI's API — for rewording,
the chat interview, and generating/applying suggestions. Before using this
with real patient data in any regulated context, you still need, at minimum:

- **A signed Business Associate Agreement (BAA) with OpenAI**, with zero data
  retention enabled on your account. This is a legal/procurement step handled
  directly with OpenAI — nothing in this codebase can satisfy it, and no PHI
  should go through this app until it's in place.
- **A real TLS certificate** for any non-localhost deployment — the
  self-signed cert here is for local development only and will not be
  trusted by browsers or valid for a real domain.
- **Server-side patient storage** — sign-in is enforced on every API route
  (Google Workspace SSO, domain-locked), but patients and their notes live
  in the browser's `localStorage` (`src/lib/patientStore.ts`), not on the
  server. Until they move to a shared database:
  - a scribe and a provider only share a note if they use the same browser
    on the same computer;
  - team access and provider-only signing are checked in the app's code
    (`App.tsx` `handleSignNote`, `PatientListScreen` `handleSign`), but
    there's no server to enforce them;
  - editing conflicts are only caught between tabs and windows of the same
    browser (`saveNote` refuses to overwrite a note that changed since it
    was opened). Across devices, a shared store needs the same version
    check.
- **Administrative safeguards** required by the HIPAA Security Rule that are
  entirely outside of code: a documented risk analysis, workforce training,
  breach notification procedures, and a retention/disposal policy.

The app itself never logs extracted text or model output (only the access
metadata described above). Notes autosave to the patient's record in the
browser's `localStorage` as you work. The AI interview and suggestions for
the open note are cached in `sessionStorage` (cleared when the tab closes).
None of this is sent to the server except the text passed to the AI routes.

## Note workflow

Scribes and providers use the same note workspace on the same note: import
a PDF, run the AI interview, check completeness, edit the reworded output.
Roles differ only in capabilities. Providers also get AI Suggestions (a tab
beside the interview) and sign. A scribe finishes with **Ready for
Provider**. There's no separate state for that: an unsigned note is
"Awaiting signature". A provider can start and sign a note with no scribe
involved. A signature records who signed and when. Any later edit, by
anyone, clears it, and uploading doesn't lock the note.

## Scope

Not supported in this version: scanned/image PDFs (no OCR), streaming
responses, server-side persistence of patients.

import { daysAgoDateKey } from './dateUtils'
import { createPatient, listPatients, markPatientUploaded, updatePatientNote } from './patientStore'

type MockState = 'noNote' | 'unsigned' | 'signedNotUploaded' | 'complete'

interface MockPatientSpec {
  name: string
  daysAgo: number
  state: MockState
  facility: string
}

// Fictional names and a hand-picked spread across 4 rounding dates, so the
// home page's rounding-date list tells a coherent story: older rounds are
// further along than today's, the way a real clinic's backlog actually
// looks — instead of every date having the same random mix. Facilities are
// spread across a few fictional sites, the way one provider's rounds
// actually cover several buildings in a day.
const MOCK_PATIENTS: MockPatientSpec[] = [
  // 3 days ago — fully wrapped up.
  { name: 'Alice Turner', daysAgo: 3, state: 'complete', facility: 'Sunrise Rehab Center' },
  { name: 'Marcus Bell', daysAgo: 3, state: 'complete', facility: 'Sunrise Rehab Center' },
  { name: 'Priya Nair', daysAgo: 3, state: 'complete', facility: 'Riverside SNF' },
  { name: 'James O’Connor', daysAgo: 3, state: 'complete', facility: 'Riverside SNF' },
  // 2 days ago — nearly done, one still needs uploading.
  { name: 'Fatima Ali', daysAgo: 2, state: 'complete', facility: 'Cedar Grove Nursing Home' },
  { name: 'Robert Chen', daysAgo: 2, state: 'complete', facility: 'Cedar Grove Nursing Home' },
  { name: 'Linda Garcia', daysAgo: 2, state: 'complete', facility: 'Sunrise Rehab Center' },
  { name: 'David Kim', daysAgo: 2, state: 'signedNotUploaded', facility: 'Riverside SNF' },
  // Yesterday — still mostly in progress.
  { name: 'Sophia Rossi', daysAgo: 1, state: 'complete', facility: 'Valley View Hospital' },
  { name: 'Michael Brown', daysAgo: 1, state: 'signedNotUploaded', facility: 'Valley View Hospital' },
  { name: 'Emma Wilson', daysAgo: 1, state: 'unsigned', facility: 'Cedar Grove Nursing Home' },
  { name: 'Carlos Mendez', daysAgo: 1, state: 'noNote', facility: 'Sunrise Rehab Center' },
  // Today — just getting started.
  { name: 'Grace Park', daysAgo: 0, state: 'noNote', facility: 'Riverside SNF' },
  { name: 'Daniel Foster', daysAgo: 0, state: 'noNote', facility: 'Valley View Hospital' },
  { name: 'Olivia Martin', daysAgo: 0, state: 'unsigned', facility: 'Sunrise Rehab Center' },
]

// The fixed roster behind the sign-in page's "View as Provider"/"View as
// Scribe" demo buttons (see LoginScreen.tsx) — exactly 3 facilities, each
// with one patient at every stage of the workflow (nothing started yet,
// drafted and awaiting signature, signed and awaiting upload, fully done),
// all dated today so a presenter sees the whole pipeline at a glance
// without digging into rounding-date history.
const DEMO_PATIENTS: MockPatientSpec[] = [
  { name: 'Robert Hayes', daysAgo: 0, state: 'noNote', facility: 'Sunrise Rehab Center' },
  { name: 'Linda Martinez', daysAgo: 0, state: 'unsigned', facility: 'Sunrise Rehab Center' },
  { name: 'Carlos Jimenez', daysAgo: 0, state: 'signedNotUploaded', facility: 'Sunrise Rehab Center' },
  { name: 'Patricia Wong', daysAgo: 0, state: 'complete', facility: 'Sunrise Rehab Center' },
  { name: 'James Bennett', daysAgo: 0, state: 'noNote', facility: 'Riverside SNF' },
  { name: 'Angela Torres', daysAgo: 0, state: 'unsigned', facility: 'Riverside SNF' },
  { name: 'Kevin O’Brien', daysAgo: 0, state: 'signedNotUploaded', facility: 'Riverside SNF' },
  { name: 'Susan Patel', daysAgo: 0, state: 'complete', facility: 'Riverside SNF' },
  { name: 'Michael Reyes', daysAgo: 0, state: 'noNote', facility: 'Cedar Grove Nursing Home' },
  { name: 'Nancy Coleman', daysAgo: 0, state: 'unsigned', facility: 'Cedar Grove Nursing Home' },
  { name: 'David Nguyen', daysAgo: 0, state: 'signedNotUploaded', facility: 'Cedar Grove Nursing Home' },
  { name: 'Barbara Fischer', daysAgo: 0, state: 'complete', facility: 'Cedar Grove Nursing Home' },
]

function mockNoteText(name: string): string {
  return `# PHYSICAL MEDICINE AND REHABILITATION CONSULTATION

---

## HISTORY OF PRESENT ILLNESS
${name} presents for follow-up regarding ongoing rehabilitation progress. Reports gradual improvement in function and pain control with the current therapy plan.

---

## ASSESSMENT/PLAN
Continue current physical therapy regimen. Follow up in 4 weeks to reassess progress.`
}

function seedPatients(specs: MockPatientSpec[], teamId: string): void {
  for (const spec of specs) {
    const patient = createPatient(spec.name, teamId, spec.facility, daysAgoDateKey(spec.daysAgo))
    if (spec.state === 'noNote') continue

    const noteText = mockNoteText(spec.name)
    const signed = spec.state === 'signedNotUploaded' || spec.state === 'complete'
    updatePatientNote(patient.id, {
      noteType: 'initial',
      extractedText: noteText,
      reworded: noteText,
      signed,
      signedAt: signed ? Date.now() : null,
    })

    if (spec.state === 'complete') {
      markPatientUploaded(patient.id)
    }
  }
}

// Seeds a realistic spread of patients — no note, unsigned note, signed but
// not uploaded, and fully complete — across 4 rounding dates, so the
// facility cards, facility rounds and rounding-date lists have something
// real to show without clicking through the full flow 15 times by hand.
export function seedMockPatients(teamId: string): void {
  seedPatients(MOCK_PATIENTS, teamId)
}

// Only seeds once per team — the demo buttons sign into the same fixed
// account every time, and re-seeding on every click would keep piling up
// duplicate patients instead of showing a stable, walk-through-able demo.
export function seedDemoPatientsIfEmpty(teamId: string): void {
  if (listPatients(teamId).length > 0) return
  seedPatients(DEMO_PATIENTS, teamId)
}

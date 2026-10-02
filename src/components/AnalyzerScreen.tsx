import { CircleCheck, FileUp, Loader2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import './AnalyzerScreen.css'
import AnalyzerReview from './AnalyzerReview'
import RoundingDateSelect from './RoundingDateSelect'
import { analyzeDocument, type AnalyzerProgress } from '../lib/analyzer/analyze'
import { AnalyzerError, validateFileBasics } from '../lib/analyzer/ingest'
import type { ImportOutcome } from '../lib/analyzer/importPatients'
import type { AnalysisResult } from '../lib/analyzer/types'
import { formatDateLabel, todayDateKey } from '../lib/dateUtils'

interface Props {
  teamId: string
  // The round it was opened from (a facility round, or Home's date) —
  // pre-filled, still changeable.
  initialDate?: string
  initialFacility?: string | null
  onViewPatients: (roundingDate: string, facility: string) => void
}

type Phase =
  | { name: 'idle'; error: string | null }
  | { name: 'analyzing'; fileName: string; progress: AnalyzerProgress }
  | { name: 'review'; fileName: string; result: AnalysisResult }
  | { name: 'done'; outcome: ImportOutcome; roundingDate: string; facility: string }

function progressLabel(progress: AnalyzerProgress): string {
  switch (progress.step) {
    case 'opening':
      return 'Opening PDF…'
    case 'scanning':
      return `Looking for highlights — page ${progress.page} of ${progress.total}…`
    case 'reading':
      return `Reading highlighted rows — ${progress.done} of ${progress.total}…`
  }
}

// Billing/census sheet in, reviewed patients out. Nothing is created until
// the user confirms on the review screen (AnalyzerReview), and the PDF,
// its rendered pages, and the row crops live only in this component's
// memory — leaving the screen discards them.
function AnalyzerScreen({ teamId, initialDate, initialFacility = null, onViewPatients }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: 'idle', error: null })
  // Where confirmed patients will be imported — chosen by the user before
  // uploading, defaulting to the round it was opened from (else today's). The date NOVA reads off the
  // sheet (result.detectedDocumentDate) is only ever compared against
  // this; it never replaces it without the user choosing so in review.
  const [targetRoundingDate, setTargetRoundingDate] = useState(() => initialDate || todayDateKey())
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  // Guards against a slow analysis finishing after the user has left the
  // screen or started over.
  const runRef = useRef(0)

  useEffect(() => () => void runRef.current++, [])

  async function handleFile(file: File | undefined) {
    if (!file) return
    const basicsError = validateFileBasics(file)
    if (basicsError) {
      setPhase({ name: 'idle', error: basicsError })
      return
    }

    const run = ++runRef.current
    setPhase({ name: 'analyzing', fileName: file.name, progress: { step: 'opening' } })
    try {
      const result = await analyzeDocument(file, (progress) => {
        if (runRef.current === run) setPhase({ name: 'analyzing', fileName: file.name, progress })
      })
      if (runRef.current === run) setPhase({ name: 'review', fileName: file.name, result })
    } catch (err) {
      if (runRef.current !== run) return
      // AnalyzerError messages are written for the user; anything else is
      // unexpected and never shown raw.
      setPhase({ name: 'idle', error: err instanceof AnalyzerError ? err.message : 'Something went wrong while analyzing this PDF. Please try again.' })
    }
  }

  function startOver() {
    runRef.current++
    setPhase({ name: 'idle', error: null })
  }

  if (phase.name === 'review') {
    return (
      <div className="analyzer-screen">
        <AnalyzerReview
          teamId={teamId}
          fileName={phase.fileName}
          result={phase.result}
          targetRoundingDate={targetRoundingDate}
          onChangeTarget={setTargetRoundingDate}
          onCancel={startOver}
          initialFacility={initialFacility}
          onImported={(outcome, roundingDate, facility) => setPhase({ name: 'done', outcome, roundingDate, facility })}
        />
      </div>
    )
  }

  if (phase.name === 'done') {
    const { imported, skipped } = phase.outcome
    return (
      <div className="analyzer-screen">
        <div className="analyzer-card analyzer-done">
          <CircleCheck size={32} className="analyzer-done-icon" />
          <h1>
            {imported.length} patient{imported.length === 1 ? '' : 's'} imported successfully.
          </h1>
          <p className="analyzer-muted">Added to {formatDateLabel(phase.roundingDate)} rounds, ready for notes.</p>
          {skipped.length > 0 && (
            <p className="analyzer-muted">
              {skipped.length} skipped because {skipped.length === 1 ? 'that patient was' : 'they were'} already on this rounding date.
            </p>
          )}
          <div className="analyzer-done-actions">
            <button type="button" className="btn btn-sm" onClick={startOver}>
              Analyze another document
            </button>
            <button type="button" className="btn" onClick={() => onViewPatients(phase.roundingDate, phase.facility)}>
              View Patients
            </button>
          </div>
        </div>
      </div>
    )
  }

  const analyzing = phase.name === 'analyzing'

  return (
    <div className="analyzer-screen">
      <div className="analyzer-header">
        <h1>Document Analyzer</h1>
        <p className="analyzer-muted">
          Upload a billing sheet or census sheet and NOVA will identify highlighted patients for review.
        </p>
      </div>

      {phase.name === 'idle' && phase.error && (
        <div className="analyzer-banner analyzer-banner-error" role="alert">
          {phase.error}
        </div>
      )}

      <div className="analyzer-target">
        <label className="analyzer-target-label" htmlFor="analyzer-target-date">
          Rounding date
        </label>
        {analyzing ? (
          <span className="analyzer-target-fixed">{formatDateLabel(targetRoundingDate)}</span>
        ) : (
          <RoundingDateSelect id="analyzer-target-date" teamId={teamId} value={targetRoundingDate} onChange={setTargetRoundingDate} />
        )}
      </div>

      {analyzing ? (
        <div className="analyzer-card analyzer-progress" aria-live="polite">
          <Loader2 size={22} className="analyzer-spinner" />
          <div>
            <p className="analyzer-progress-file">{phase.fileName}</p>
            <p className="analyzer-muted">{progressLabel(phase.progress)}</p>
          </div>
        </div>
      ) : (
        <div
          className={dragging ? 'analyzer-dropzone analyzer-dropzone-active' : 'analyzer-dropzone'}
          onDragOver={(e) => {
            e.preventDefault()
            setDragging(true)
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDragging(false)
            void handleFile(e.dataTransfer.files[0])
          }}
        >
          <FileUp size={28} className="analyzer-dropzone-icon" />
          <p className="analyzer-dropzone-title">Drag &amp; drop a PDF here</p>
          <span className="analyzer-muted">or</span>
          <button type="button" className="btn" onClick={() => inputRef.current?.click()}>
            Choose PDF
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="application/pdf,.pdf"
            hidden
            onChange={(e) => {
              void handleFile(e.target.files?.[0])
              e.target.value = ''
            }}
          />
          <ul className="analyzer-supported">
            <li>Billing sheets</li>
            <li>Census sheets</li>
            <li>Scanned or exported PDF, highlighted in color</li>
          </ul>
        </div>
      )}

      <p className="analyzer-privacy">
        The PDF stays in your browser. Only the highlighted rows, plus a strip from the top of the first page for the facility
        and date, are sent to NOVA’s AI to be read. Nothing is added to NOVA until you review and confirm.
      </p>
    </div>
  )
}

export default AnalyzerScreen

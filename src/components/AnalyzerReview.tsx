import { AlertTriangle, Eye, EyeOff, X } from 'lucide-react'
import { useMemo, useState } from 'react'
import './AnalyzerScreen.css'
import RoundingDateSelect from './RoundingDateSelect'
import { checkDocumentDate } from '../lib/analyzer/documentDate'
import { assessPatient, normalizeFacility, type ReviewAssessment } from '../lib/analyzer/duplicates'
import { importPatients, type ImportOutcome } from '../lib/analyzer/importPatients'
import type { AnalysisResult, DetectedPatient, DocumentType } from '../lib/analyzer/types'
import { isPlausibleName } from '../lib/analyzer/validate'
import { formatDate, formatDateLabel } from '../lib/dateUtils'
import { listPatients } from '../lib/patientStore'

interface Props {
  teamId: string
  fileName: string
  result: AnalysisResult
  // Where patients will be imported — the user's choice, owned by
  // AnalyzerScreen. result.detectedDocumentDate is only compared to it.
  targetRoundingDate: string
  onChangeTarget: (date: string) => void
  onCancel: () => void
  // The facility round the Analyzer was opened from, if any.
  initialFacility?: string | null
  onImported: (outcome: ImportOutcome, roundingDate: string, facility: string) => void
}

interface ReviewRow {
  detected: DetectedPatient
  name: string
  edited: boolean
  // null until the user ticks/unticks it: the default then follows the
  // row's current status (checked when Ready), so changing the facility
  // or target date re-selects rows that stop being duplicates.
  selected: boolean | null
  removed: boolean
}

const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  billing_sheet: 'Billing Sheet',
  census_sheet: 'Census Sheet',
  unknown: 'Other document',
}

const STATUS_LABEL = { ready: 'Ready', alreadyExists: 'Already exists', needsReview: 'Needs review' } as const

// The human-confirmation step between extraction and import. Every value
// here — document details, names, which rows to import — is editable, and
// duplicate status is recomputed live against the facility and target
// rounding date the user settles on, not just what the AI read off the
// sheet.
function AnalyzerReview({ teamId, fileName, result, targetRoundingDate, onChangeTarget, onCancel, initialFacility, onImported }: Props) {
  const existing = useMemo(() => listPatients(teamId), [teamId])
  const knownFacilities = useMemo(() => [...new Set(existing.map((p) => p.facility))].sort(), [existing])

  const [documentType, setDocumentType] = useState<DocumentType>(result.documentType)
  // Opened from a facility round: that facility, unless changed here.
  // Otherwise whatever the sheet's header says.
  const [facility, setFacility] = useState(initialFacility ?? result.facility ?? '')
  const sheetDiffers =
    Boolean(result.facility) && Boolean(facility.trim()) && normalizeFacility(result.facility ?? '') !== normalizeFacility(facility)
  // The target date the user explicitly kept despite a mismatch — the
  // warning stays dismissed only for that date.
  const [keptDate, setKeptDate] = useState<string | null>(null)
  const date = targetRoundingDate
  const [sourceOpenId, setSourceOpenId] = useState<string | null>(null)
  const [importError, setImportError] = useState<string | null>(null)

  const [rows, setRows] = useState<ReviewRow[]>(() =>
    result.patients.map((detected) => ({ detected, name: detected.name, edited: false, selected: null, removed: false })),
  )

  const assessed = rows
    .filter((r) => !r.removed)
    .map((row) => {
      const assessment: ReviewAssessment = assessPatient(
        { name: row.name, facility, date, confidence: row.detected.confidence, edited: row.edited },
        existing,
      )
      const importable = assessment.status !== 'alreadyExists' && isPlausibleName(row.name)
      return { row, assessment, importable, checked: (row.selected ?? assessment.status === 'ready') && importable }
    })

  const toImport = assessed.filter((a) => a.checked)
  const needsReviewCount = assessed.filter((a) => a.assessment.status === 'needsReview').length
  const existsCount = assessed.filter((a) => a.assessment.status === 'alreadyExists').length
  const removedCount = rows.length - assessed.length
  const dateCheck = checkDocumentDate(result.detectedDocumentDate, result.detectedDateLabeled, date)
  const mismatchUnresolved = dateCheck.kind === 'mismatch' && keptDate !== date
  const canImport = toImport.length > 0 && facility.trim().length > 0 && !mismatchUnresolved

  function updateRow(id: string, patch: Partial<ReviewRow>) {
    setRows((prev) => prev.map((r) => (r.detected.id === id ? { ...r, ...patch } : r)))
  }

  function setAllSelected(selected: boolean) {
    setRows((prev) => prev.map((r) => ({ ...r, selected })))
  }

  function handleImport() {
    if (!canImport) return
    try {
      const outcome = importPatients(
        toImport.map((a) => a.row.name),
        teamId,
        facility,
        date,
      )
      onImported(outcome, date, facility.trim())
    } catch {
      setImportError('Couldn’t save the patients. Check that your browser allows site storage and try again.')
    }
  }

  const detectedCount = assessed.length
  const summary =
    needsReviewCount > 0
      ? `NOVA found ${detectedCount} possible patient${detectedCount === 1 ? '' : 's'}, but ${needsReviewCount} need${needsReviewCount === 1 ? 's' : ''} review.`
      : `${detectedCount} highlighted patient${detectedCount === 1 ? '' : 's'} detected.`

  return (
    <div className="analyzer-review">
      <div className="analyzer-header">
        <h1>Analysis Complete</h1>
        <p className="analyzer-muted">
          {fileName} · {result.pageCount} page{result.pageCount === 1 ? '' : 's'}
        </p>
      </div>

      {result.warnings.map((w) => (
        <div key={w} className="analyzer-banner">
          {w}
        </div>
      ))}

      <div className="analyzer-card analyzer-details">
        <label className="analyzer-field">
          <span>Document type</span>
          <select value={documentType} onChange={(e) => setDocumentType(e.target.value as DocumentType)}>
            {Object.entries(DOCUMENT_TYPE_LABEL).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        {/* A div, not a <label>: the "Use it" button must not become what the
            label activates. The label itself covers only the word "Facility". */}
        <div className="analyzer-field analyzer-field-wide">
          <span>
            <label htmlFor="analyzer-facility">Facility</label>
            {!result.facility && <em className="analyzer-field-hint"> — not found on the sheet</em>}
            {sheetDiffers && (
              <em className="analyzer-field-hint">
                {' '}— the sheet reads “{result.facility}”{' '}
                <button type="button" className="analyzer-link" onClick={() => setFacility(result.facility ?? '')}>
                  Use it
                </button>
              </em>
            )}
          </span>
          <input
            id="analyzer-facility"
            value={facility}
            onChange={(e) => setFacility(e.target.value)}
            placeholder="Enter facility"
            list="analyzer-facilities"
            className={facility.trim() ? undefined : 'analyzer-input-missing'}
          />
          <datalist id="analyzer-facilities">
            {knownFacilities.map((f) => (
              <option key={f} value={f} />
            ))}
          </datalist>
        </div>
        <div className="analyzer-field">
          <label htmlFor="analyzer-review-target">Rounding date</label>
          <RoundingDateSelect id="analyzer-review-target" teamId={teamId} value={date} onChange={onChangeTarget} />
          {dateCheck.kind === 'match' && <span className="analyzer-field-note">Matches the date on the sheet.</span>}
          {dateCheck.kind === 'possibleMismatch' && (
            <span className="analyzer-field-note">
              The sheet also shows {formatDate(dateCheck.detected)}, but it isn’t clearly labeled as the census date.
            </span>
          )}
        </div>
      </div>

      {mismatchUnresolved && dateCheck.kind === 'mismatch' && (
        <div className="analyzer-banner analyzer-mismatch" role="alert">
          <p className="analyzer-mismatch-title">
            <AlertTriangle size={16} />
            Date mismatch
          </p>
          <p>
            This sheet is dated <strong>{formatDate(dateCheck.detected)}</strong>, but you’re importing into{' '}
            <strong>{formatDate(date)}</strong>.
          </p>
          <div className="analyzer-mismatch-actions">
            <button type="button" className="btn btn-sm" onClick={() => onChangeTarget(dateCheck.detected)}>
              Use {formatDate(dateCheck.detected)}
            </button>
            <button type="button" className="btn btn-sm" onClick={() => setKeptDate(date)}>
              Keep {formatDate(date)}
            </button>
          </div>
        </div>
      )}

      <div className="analyzer-summary">
        <p className="analyzer-summary-text">
          {summary}
          {existsCount > 0 && ` ${existsCount} already exist${existsCount === 1 ? 's' : ''}.`}
        </p>
        <div className="analyzer-summary-actions">
          <button type="button" className="btn btn-sm" onClick={() => setAllSelected(true)}>
            Select All
          </button>
          <button type="button" className="btn btn-sm" onClick={() => setAllSelected(false)}>
            Deselect All
          </button>
        </div>
      </div>

      <ul className="analyzer-rows">
        {assessed.map(({ row, assessment, importable, checked }) => {
          const { detected } = row
          const source = result.sources[detected.sourceRowId]
          const sourceOpen = sourceOpenId === detected.id
          const showIssues = !row.edited && detected.issues.length > 0
          return (
            <li key={detected.id} className={checked ? 'analyzer-row analyzer-row-checked' : 'analyzer-row'}>
              <div className="analyzer-row-main">
                <input
                  type="checkbox"
                  className="analyzer-row-check"
                  checked={checked}
                  disabled={!importable}
                  onChange={(e) => updateRow(detected.id, { selected: e.target.checked })}
                  aria-label={`Import ${row.name || 'this patient'}`}
                />
                <div className="analyzer-row-body">
                  <input
                    className="analyzer-row-name"
                    value={row.name}
                    placeholder="Enter patient name"
                    onChange={(e) => updateRow(detected.id, { name: e.target.value, edited: true })}
                    aria-label="Patient name"
                  />
                  <span className="analyzer-row-meta">
                    {facility.trim() || 'No facility'} · Page {detected.page}
                    <span className={`analyzer-color-dot analyzer-color-${detected.color}`} title={`${detected.color} highlight`} />
                  </span>
                  {(assessment.reason || showIssues) && (
                    <span className="analyzer-row-issues">{[assessment.reason, ...(showIssues ? detected.issues : [])].filter(Boolean).join(' ')}</span>
                  )}
                </div>
                <div className="analyzer-row-actions">
                  {detected.confidence === 'medium' && !row.edited && assessment.status === 'ready' && (
                    <span className="analyzer-badge analyzer-badge-uncertain" title="Importable, but double-check it against the source">
                      Uncertain
                    </span>
                  )}
                  <span className={`analyzer-badge analyzer-badge-${assessment.status}`}>{STATUS_LABEL[assessment.status]}</span>
                  {source && (
                    <button
                      type="button"
                      className="analyzer-icon-button"
                      onClick={() => setSourceOpenId(sourceOpen ? null : detected.id)}
                      aria-label={sourceOpen ? 'Hide source row' : 'View source row'}
                      title={sourceOpen ? 'Hide source' : 'View source'}
                    >
                      {sourceOpen ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  )}
                  <button
                    type="button"
                    className="analyzer-icon-button"
                    onClick={() => updateRow(detected.id, { removed: true })}
                    aria-label="Remove this detection"
                    title="Remove"
                  >
                    <X size={16} />
                  </button>
                </div>
              </div>
              {sourceOpen && source && (
                <div className="analyzer-source">
                  <img src={source.cropDataUrl} alt={`Highlighted row from page ${source.page}`} />
                </div>
              )}
            </li>
          )
        })}
      </ul>

      {removedCount > 0 && (
        <button type="button" className="analyzer-link" onClick={() => setRows((prev) => prev.map((r) => ({ ...r, removed: false })))}>
          {removedCount} removed — restore
        </button>
      )}

      <div className="analyzer-footer">
        {importError && <p className="analyzer-error-text">{importError}</p>}
        {!facility.trim() ? (
          <p className="analyzer-muted">Enter a facility to import.</p>
        ) : mismatchUnresolved ? (
          <p className="analyzer-muted">Choose which date to use above.</p>
        ) : (
          <p className="analyzer-muted">
            {toImport.length} selected · into <strong>{formatDateLabel(date)}</strong>
          </p>
        )}
        <button type="button" className="btn btn-sm" onClick={onCancel}>
          Cancel
        </button>
        <button type="button" className="btn analyzer-import" onClick={handleImport} disabled={!canImport}>
          Import {toImport.length} Patient{toImport.length === 1 ? '' : 's'}
        </button>
      </div>
    </div>
  )
}

export default AnalyzerReview

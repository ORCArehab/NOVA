import { useEffect, useRef, useState } from 'react'
import { diffWords } from 'diff'
import './OutputPanel.css'

export type RewordStatus = 'idle' | 'loading' | 'error' | 'done'

interface Props {
  status: RewordStatus
  reworded: string | null
  previousReworded: string | null
  error: string | null
  onRetry: () => void
  onChange: (text: string) => void
  onDismissDiff: () => void
}

interface DiffEditableProps {
  oldText: string
  newText: string
  onChange: (text: string) => void
}

// Builds the diff once per baseline and lets the browser own the DOM from
// then on — re-rendering on every keystroke (the way a controlled React
// element normally would) would reset the cursor and fight the user's
// typing. Only a genuinely new baseline (a fresh AI regeneration) rebuilds
// the highlighted content; edits after that just flow out via onInput.
function DiffEditable({ oldText, newText, onChange }: DiffEditableProps) {
  const ref = useRef<HTMLDivElement>(null)
  const renderedForRef = useRef<string | null>(null)

  useEffect(() => {
    if (!ref.current || renderedForRef.current === oldText) return
    renderedForRef.current = oldText

    const el = ref.current
    el.innerHTML = ''
    for (const part of diffWords(oldText, newText)) {
      if (part.removed) continue
      if (part.added) {
        const span = document.createElement('span')
        span.className = 'diff-added'
        span.textContent = part.value
        el.appendChild(span)
      } else {
        el.appendChild(document.createTextNode(part.value))
      }
    }
    // Only the baseline should trigger a rebuild — see comment above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [oldText])

  return (
    <div
      ref={ref}
      className="output-text output-diff"
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onInput={(e) => onChange(e.currentTarget.innerText)}
    />
  )
}

function OutputPanel({
  status,
  reworded,
  previousReworded,
  error,
  onRetry,
  onChange,
  onDismissDiff,
}: Props) {
  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    if (!reworded) return
    await navigator.clipboard.writeText(reworded)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const showDiff = status === 'done' && reworded !== null && previousReworded !== null

  return (
    <section className="panel">
      <div className="output-header">
        <h2>Reworded Output</h2>
        {status === 'done' && reworded && (
          <button type="button" className="btn btn-sm" onClick={handleCopy}>
            {copied ? 'Copied!' : 'Copy text'}
          </button>
        )}
      </div>
      <div className="panel-content output-content">
        {status === 'idle' && (
          <p className="output-placeholder">Import a PDF to see the reworded note here.</p>
        )}
        {status === 'loading' && <p className="output-placeholder">Rewording…</p>}
        {status === 'error' && (
          <div className="output-error">
            <p>{error}</p>
            <button type="button" className="btn" onClick={onRetry}>
              Try again
            </button>
          </div>
        )}
        {status === 'done' && reworded !== null && showDiff && (
          <div className="output-diff-wrap">
            <div className="output-diff-banner">
              <span>Highlighted: what changed from the interview — still editable</span>
              <button type="button" className="btn btn-sm" onClick={onDismissDiff}>
                Clear highlights
              </button>
            </div>
            <DiffEditable oldText={previousReworded} newText={reworded} onChange={onChange} />
          </div>
        )}
        {status === 'done' && reworded !== null && !showDiff && (
          <textarea
            className="output-text"
            value={reworded}
            onChange={(e) => onChange(e.target.value)}
            spellCheck={false}
          />
        )}
      </div>
    </section>
  )
}

export default OutputPanel

import { FileUp, Loader2 } from 'lucide-react'
import { useRef, useState } from 'react'
import './AnalyzerScreen.css'

interface Props {
  // true: the Analyzer can be used. false: it can't. null: still checking.
  available: boolean | null
  onFile: (file: File | undefined) => void
}

// Where a sheet is chosen. Unless the Analyzer is confirmed available there
// is no file input and nothing hands a file on, so no PDF can be picked,
// read or cropped, and nothing is sent. A file dropped here meanwhile is
// swallowed so the browser doesn't open it either.
function AnalyzerDropzone({ available, onFile }: Props) {
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  if (available !== true) {
    return (
      <div
        className="analyzer-dropzone analyzer-dropzone-unavailable"
        aria-live="polite"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => e.preventDefault()}
      >
        {available === null ? (
          <>
            <Loader2 size={22} className="analyzer-spinner" />
            <p className="analyzer-muted">Checking the Analyzer…</p>
          </>
        ) : (
          <>
            <FileUp size={28} className="analyzer-dropzone-icon" />
            <p className="analyzer-dropzone-title">Analyzer is currently unavailable.</p>
          </>
        )}
      </div>
    )
  }

  return (
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
        onFile(e.dataTransfer.files[0])
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
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <ul className="analyzer-supported">
        <li>Billing sheets</li>
        <li>Census sheets</li>
        <li>Scanned or exported PDF, highlighted in color</li>
      </ul>
    </div>
  )
}

export default AnalyzerDropzone

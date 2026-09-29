import { useState, type ReactNode } from 'react'
import './AssistPanel.css'

interface Props {
  interview: ReactNode
  // Provider capability — AI plan suggestions. Absent for scribes, who
  // then see just the interview with no tab bar.
  suggestions?: ReactNode
}

type Tab = 'interview' | 'suggestions'

// The note workspace's AI column. Both panels stay mounted while hidden,
// so switching tabs doesn't lose the interview or refetch suggestions.
function AssistPanel({ interview, suggestions }: Props) {
  const [tab, setTab] = useState<Tab>('interview')

  if (!suggestions) return <div className="assist-column">{interview}</div>

  return (
    <div className="assist-column">
      <div className="assist-tabs" role="tablist" aria-label="AI assistance">
        {(['interview', 'suggestions'] as const).map((t) => (
          <button
            key={t}
            type="button"
            role="tab"
            id={`assist-tab-${t}`}
            aria-selected={tab === t}
            aria-controls={`assist-panel-${t}`}
            className={tab === t ? 'assist-tab assist-tab-active' : 'assist-tab'}
            onClick={() => setTab(t)}
          >
            {t === 'interview' ? 'Interview' : 'Suggestions'}
          </button>
        ))}
      </div>
      <div className="assist-body" role="tabpanel" id="assist-panel-interview" aria-labelledby="assist-tab-interview" hidden={tab !== 'interview'}>
        {interview}
      </div>
      <div className="assist-body" role="tabpanel" id="assist-panel-suggestions" aria-labelledby="assist-tab-suggestions" hidden={tab !== 'suggestions'}>
        {suggestions}
      </div>
    </div>
  )
}

export default AssistPanel

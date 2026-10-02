import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import AnalyzerDropzone from './AnalyzerDropzone'

// Rendered to static HTML: what a user can interact with in each state.
const render = (available: boolean | null) => renderToStaticMarkup(<AnalyzerDropzone available={available} onFile={() => {}} />)

describe('AnalyzerDropzone', () => {
  it('when unavailable: says so, and offers no way to choose a PDF', () => {
    const html = render(false)
    expect(html).toContain('Analyzer is currently unavailable.')
    expect(html).not.toContain('type="file"')
    expect(html).not.toContain('Choose PDF')
    expect(html).not.toMatch(/openai|api key|vercel|configur/i)
  })

  it('while checking: no way to choose a PDF yet', () => {
    const html = render(null)
    expect(html).toContain('Checking the Analyzer')
    expect(html).not.toContain('type="file"')
    expect(html).not.toContain('Choose PDF')
  })

  it('when available: the existing drop zone, file input and Choose PDF', () => {
    const html = render(true)
    expect(html).toContain('type="file"')
    expect(html).toContain('accept="application/pdf,.pdf"')
    expect(html).toContain('Choose PDF')
    expect(html).toContain('Drag &amp; drop a PDF here')
    expect(html).not.toContain('currently unavailable')
  })
})

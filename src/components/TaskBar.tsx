import { ChevronDown, Home, LogOut, ScanSearch, Upload, UserCircle, Users } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import './TaskBar.css'
import orcaIcon from '../assets/orca-icon.png'
import type { CurrentUser } from '../lib/types'

interface Props {
  currentUser: CurrentUser | null
  onHome: () => void
  onOpenTeam: () => void
  onOpenUploadTool: () => void
  onOpenAnalyzer: () => void
  onSignOut: () => void
}

// Home, Team, Analyzer, and Upload all navigate to a screen. Patients
// aren't a nav item: you reach them through a round on Home. The Profile
// dropdown shows whoever is actually signed in (see LoginScreen/App.tsx's
// handleLogin) — there's no separate sign-in action here, since signing in
// is the app's full-page gate, not a menu item.
function TaskBar({
  currentUser,
  onHome,
  onOpenTeam,
  onOpenUploadTool,
  onOpenAnalyzer,
  onSignOut,
}: Props) {
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!profileOpen) return
    function handleClickOutside(e: MouseEvent) {
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [profileOpen])

  function handleSignOut() {
    setProfileOpen(false)
    onSignOut()
  }

  return (
    <div className="task-bar">
      <div className="task-bar-brand">
        <img src={orcaIcon} alt="" className="task-bar-icon" />
        <span className="task-bar-wordmark">ORCA Rehab</span>
      </div>
      <div className="task-bar-actions">
        <button type="button" className="task-bar-button" onClick={onHome}>
          <Home size={17} />
          Home
        </button>
        <button type="button" className="task-bar-button" onClick={onOpenTeam}>
          <Users size={17} />
          Team
        </button>
        <button type="button" className="task-bar-button" onClick={onOpenAnalyzer}>
          <ScanSearch size={17} />
          Analyzer
        </button>
        <button type="button" className="task-bar-button" onClick={onOpenUploadTool}>
          <Upload size={17} />
          Upload
        </button>
        {currentUser && (
          <div className="task-bar-dropdown" ref={profileRef}>
            <button type="button" className="task-bar-button" onClick={() => setProfileOpen((open) => !open)}>
              <UserCircle size={17} />
              {currentUser.name}
              <ChevronDown size={14} />
            </button>
            {profileOpen && (
              <div className="task-bar-dropdown-menu">
                <button type="button" className="task-bar-dropdown-item" onClick={handleSignOut}>
                  <LogOut size={16} />
                  Sign Out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default TaskBar

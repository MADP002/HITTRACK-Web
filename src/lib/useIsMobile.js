// ════════════════════════════════════════════════════════
//  HITTRACK — useIsMobile
//
//  Re-renders the calling component when the viewport crosses
//  the mobile breakpoint. Use to swap layouts:
//
//    const isMobile = useIsMobile()
//    <div style={{ gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr' }}>
//
//  Default breakpoint is 768px — anything narrower is "mobile".
//  Pass a custom breakpoint as the only argument if needed:
//
//    const isPhone = useIsMobile(480)   // phones only, not tablets
// ════════════════════════════════════════════════════════
import { useState, useEffect } from 'react'

const DEFAULT_BREAKPOINT = 768

export function useIsMobile(breakpoint = DEFAULT_BREAKPOINT) {
  const [isMobile, setIsMobile] = useState(
    typeof window !== 'undefined' && window.innerWidth < breakpoint
  )
  useEffect(() => {
    if (typeof window === 'undefined') return
    function handle() { setIsMobile(window.innerWidth < breakpoint) }
    window.addEventListener('resize', handle)
    // Run once on mount in case window was already at the breakpoint
    handle()
    return () => window.removeEventListener('resize', handle)
  }, [breakpoint])
  return isMobile
}

export default useIsMobile

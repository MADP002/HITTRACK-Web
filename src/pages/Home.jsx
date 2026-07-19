import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db } from '../firebase'
import { doc, getDoc, setDoc, updateDoc, collection, getDocs, query, where, onSnapshot, addDoc, deleteDoc, serverTimestamp, increment, runTransaction, arrayUnion } from 'firebase/firestore'
import Navbar from '../components/Navbar'
import { buildSchedule, buildWorkout, EXERCISE_POOLS, fmtDuration, isRichExercise, exerciseName } from '../lib/scheduleBuilder'
import { evaluateAdaptations, computeDifficulty, computeDifficultyBreakdown, buildResetDayWorkout, getChampionBonusExercise, getDayStatus } from '../lib/adaptiveEngine'
import { computeTrainingStats } from '../lib/trainingStats'
import { logActivity } from '../lib/activityLog'
import { isClassActive, getClassDayLabel, isClassToday } from '../lib/classLifecycle'
import { useIsMobile } from '../lib/useIsMobile'
import { computeMembershipState, daysRemaining, fmtExpiry, fmtRemaining, getStatusColor, getStatusIcon, canBook, STATUS } from '../lib/membership'
import { getMemberLevel } from '../lib/memberLevel'

// ── CONSTANTS ─────────────────────────────────────────
const CIRCUMFERENCE      = 339
const WORKOUTS_PER_LEVEL = 25
const LEVELS             = ['Beginner','Intermediate','Advanced','Expert','Elite']
const LEVEL_COLOR        = { Beginner:'#fb923c', Intermediate:'#f5c842', Advanced:'#22c55e', Expert:'#42a5f5', Elite:'#c084fc' }
const MILESTONE_BADGES   = [10,20,30,40,50,60]

// Rules that make a REAL, visible change to today's workout (Item 5 — action
// tie-in). Used to show an "Applied to today" badge on those decisions.
const RULE_ACTION = {
  RESET_DAY:     "Today swapped to a light Reset Day",
  CHAMPION_MODE: "Champion bonus exercise added to today",
}

const TIPS = [
  {icon:'🥊',category:'TECHNIQUE',   text:"Keep your chin tucked and shoulders raised when jabbing. Protects your jaw and makes punches harder to read."},
  {icon:'🦵',category:'FOOTWORK',    text:"Never cross your feet when moving. Use the step-drag method — lead foot moves first, rear follows. Keeps your base solid."},
  {icon:'💨',category:'BREATHING',   text:"Exhale sharply on every punch. This tightens your core, increases power, and prevents breath-holding under pressure."},
  {icon:'🛡️',category:'DEFENSE',     text:"Rotate your hips fully when throwing hooks — try 3 sets of 20 before your next session to rebuild muscle memory."},
  {icon:'🔥',category:'CONDITIONING',text:"Shadow box for 3 rounds before hitting the bag. Warms up muscles, sharpens combos, and builds muscle memory faster."},
  {icon:'🧠',category:'MINDSET',     text:"Consistency beats intensity. Training 4 days at 70% beats 1 day at 100%. Show up even when you don't feel like it."},
  {icon:'⚡',category:'POWER',       text:"Power comes from legs and hips, not arms. Drive from your back foot and rotate your whole body into every cross."},
]

// ── HELPERS ───────────────────────────────────────────
// Local-timezone YYYY-MM-DD (NOT toISOString — that's UTC and would shift a
// late-evening PH workout to the next calendar day).
const ymdLocal = (input) => {
  const x = new Date(input)
  return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`
}

// Local midnight (ms) — used for whole-day diffs without UTC drift.
const startOfDay = (d) => { const x = new Date(d); x.setHours(0,0,0,0); return x.getTime() }

// Completion checkmarks (and any pre-generated bonus / booked-extra sessions)
// are stored keyed by RELATIVE schedule index: 0 = today, 1 = tomorrow, …
// But the schedule re-anchors to the real "today" on every load, so a map that
// was saved on an earlier day is stale: yesterday's finished day-0 would render
// as today's day-0 (the workout shows complete before the day even starts).
// Shift every key back by the number of calendar days elapsed since the map was
// saved, dropping days now in the past and keeping future entries pinned to
// their real calendar day.
const shiftDayMap = (map, days) => {
  if (!map || !days || days <= 0) return map || {}
  const out = {}
  for (const [k, v] of Object.entries(map)) {
    const ni = parseInt(k, 10) - days
    if (Number.isInteger(ni) && ni >= 0) out[ni] = v
  }
  return out
}

// Friendly relative time for the adaptation timeline ("Today" / "3d ago").
const relTime = (ms) => {
  if (!ms) return ''
  const days = Math.round((startOfDay(Date.now()) - startOfDay(ms)) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7)  return `${days}d ago`
  if (days < 30) return `${Math.floor(days / 7)}w ago`
  return new Date(ms).toLocaleDateString()
}

const glass = (extra={}) => ({
  background:'linear-gradient(135deg,rgba(30,28,28,0.97),rgba(18,16,16,0.99))',
  borderRadius:20, border:'1px solid rgba(245,200,66,0.15)',
  boxShadow:'0 8px 40px rgba(0,0,0,0.5),inset 0 1px 0 rgba(245,200,66,0.08)',
  overflow:'hidden', ...extra,
})

function BadgePopup({milestone, onClose}) {
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{...glass(),padding:'44px 52px',textAlign:'center',maxWidth:380,width:'90%',animation:'popIn 0.4s cubic-bezier(0.34,1.56,0.64,1)'}}>
        <div style={{fontSize:68,marginBottom:12}}>🏅</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:13,letterSpacing:'0.2em',color:'#f5c842',marginBottom:6}}>BADGE UNLOCKED!</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:'#f0ece8',marginBottom:10}}>{milestone} Workout Badge</div>
        <div style={{fontSize:13,color:'#7a7570',lineHeight:1.7,marginBottom:28}}>
          You completed <strong style={{color:'#f5c842'}}>{milestone} workouts</strong>! Next milestone at {milestone+10}.
        </div>
        <button onClick={onClose} style={{background:'linear-gradient(135deg,#f5c842,#e84a2f)',color:'#fff',border:'none',borderRadius:50,padding:'13px 36px',fontSize:14,fontWeight:700,cursor:'pointer'}}>
          🎉 Let's Go!
        </button>
      </div>
    </div>
  )
}

// ── MAIN ─────────────────────────────────────────────
export default function Home() {
  const navigate  = useNavigate()
  const ringRef   = useRef(null)
  const canvasRef = useRef(null)
  const isMobile  = useIsMobile()  // re-renders on viewport resize
  const [profile, setProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hittrack_profile') || '{}') } catch { return {} }
  })

  // ── MEMBERSHIP STATE — derived from profile, used for banner + booking gate
  const membershipState = computeMembershipState(profile.membership)
  const membershipBlocked = !canBook(profile.membership)  // EXPIRED or PAUSED
  const daysLeft = daysRemaining(profile.membership)
  const isMember = (profile.role || 'member') === 'member'  // coaches/admin don't see membership UI

  // Canonical level needs trainingLevel from the stats doc (mobile writes it).
  const [trainingLevel, setTrainingLevel] = useState(null)
  useEffect(() => {
    const user = auth.currentUser
    if (!user) return
    let cancelled = false
    getDoc(doc(db, 'stats', user.uid)).then(s => {
      if (!cancelled && s.exists()) setTrainingLevel(s.data().trainingLevel ?? null)
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])
  const memberLevel = getMemberLevel({ experience: profile.experience, trainingLevel })

  // ── UNIFIED COMPLETION LOG (Items 3 + 4) ──────────────────────────────
  //  Both web and mobile write a `trainingSessions` doc per completed day.
  //  We load this member's real, dated session history to power BOTH the
  //  missed-days view and the adaptive engine's weekly/missed inputs.
  const [trainedDates, setTrainedDates] = useState([])  // ['YYYY-MM-DD', ...] sorted
  useEffect(() => {
    const user = auth.currentUser
    if (!user) return
    const q = query(collection(db, 'trainingSessions'), where('uid', '==', user.uid))
    const unsub = onSnapshot(q, (snap) => {
      const set = new Set()
      snap.docs.forEach(d => {
        const ts = d.data().completedAt
        const ms = ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : null)
        if (ms) set.add(ymdLocal(ms))
      })
      setTrainedDates([...set].sort())
    }, (e) => console.warn('trainingSessions load:', e.message))
    return () => unsub()
  }, [])

  // ── FREE-TRIAL WELCOME — Item 5. Shown once per account on first Home visit
  //    while the member is on a trial. localStorage flag prevents re-showing.
  const [showTrialWelcome, setShowTrialWelcome] = useState(false)
  useEffect(() => {
    if (!isMember) return
    if (membershipState !== STATUS.TRIAL) return
    const uid = auth.currentUser?.uid
    if (!uid) return
    const key = `hittrack_trial_welcomed_${uid}`
    try {
      if (!localStorage.getItem(key)) {
        setShowTrialWelcome(true)
        localStorage.setItem(key, '1')
      }
    } catch {}
  }, [isMember, membershipState])

  // Workout tracking state — load from Firestore
  const [dayChecked,        setDayChecked]        = useState({})
  const [generatedWorkouts, setGeneratedWorkouts]  = useState({})
  const [bookedExtras,      setBookedExtras]       = useState({})
  const [classStatuses,     setClassStatuses]      = useState([])
  const [classes,           setClasses]            = useState([])
  const [loadingClasses,    setLoadingClasses]     = useState(true)

  // ── ADAPTIVE ENGINE state (Issue 3 — Step 3+5) ──
  const [adaptiveDecisions, setAdaptiveDecisions] = useState([])
  const [adaptiveDifficulty, setAdaptiveDifficulty] = useState(3)
  const [adaptiveOpen, setAdaptiveOpen]   = useState(false)  // explainability modal
  const [adaptiveLog, setAdaptiveLog]     = useState([])      // last 10 from Firestore
  const [adaptiveClearedAt, setAdaptiveClearedAt] = useState(0) // hide timeline before this ms (localStorage, non-destructive)
  const [resetDayActive, setResetDayActive] = useState(false) // Step 4 auto-substitution flag
  const [championBonusActive, setChampionBonusActive] = useState(false) // Champion bonus injected into today

  // ── Cancel-booking confirmation (Improvement 1) ──
  const [cancelConfirm, setCancelConfirm] = useState(null) // { classIndex, classData } | null

  const [schedule]        = useState(() => buildSchedule(profile, new Date()))
  const [selDay,           setSelDay]       = useState(0)
  const [badgePopup,       setBadgePopup]   = useState(null)
  const [unlockedBadges,   setUnlockedBadges] = useState([])
  const [displayPct,       setDisplayPct]   = useState(0)
  const [tipIdx,           setTipIdx]       = useState(0)
  const [tipVisible,       setTipVisible]   = useState(true)
  const [conflictModal,    setConflictModal] = useState(null)
  const [saving,           setSaving]       = useState(false)

  const date = new Date().toLocaleDateString('en-US', {weekday:'long', year:'numeric', month:'long', day:'numeric'})

  // ── Load workout data from Firestore on mount ─────────
  useEffect(() => {
    const user = auth.currentUser
    if (!user) return
    getDoc(doc(db, 'workouts', user.uid)).then(snap => {
      if (!snap.exists()) return
      const data = snap.data()
      // Stored maps are keyed by relative day index (0 = today). Re-anchor them
      // to the current date so a workout finished on a previous day doesn't show
      // up as already complete on today's plan. See shiftDayMap.
      const daysElapsed = data.updatedAt
        ? Math.floor((startOfDay(Date.now()) - startOfDay(data.updatedAt)) / 86400000)
        : 0
      const dc = shiftDayMap(data.dayChecked || {}, daysElapsed)
      const gw = shiftDayMap(data.generatedWorkouts || {}, daysElapsed)
      const be = shiftDayMap(data.bookedExtras || {}, daysElapsed)
      setDayChecked(dc)
      setGeneratedWorkouts(gw)
      setBookedExtras(be)
      // Persist once per day rollover so updatedAt tracks today and the same
      // data isn't shifted again on the next load.
      if (daysElapsed > 0) saveWorkoutData(dc, gw, be)
    }).catch(console.error)
  }, [])

  // ── Load classes from Firestore (REALTIME — Issue 2 fix) ──
  // Switched from one-shot getDocs to onSnapshot so enrolled counts
  // and new classes appear instantly for every member.
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'classes'), (snap) => {
      const cls = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(isClassActive)
      setClasses(cls)
      setLoadingClasses(false)
    }, (err) => {
      console.error('Classes stream error:', err)
      setLoadingClasses(false)
    })
    return () => unsub()
  }, [])

  // ── Load THIS user's bookings (REALTIME) ────────────────
  // Was: classStatuses defaulted to all 'open' on every reload, wiping the
  // visual "Booked" state. Now we subscribe to bookings and rebuild it.
  const [myBookings, setMyBookings] = useState([])  // [{id, classId, ...}, ...]
  useEffect(() => {
    const u = auth.currentUser
    if (!u) return
    const q = query(collection(db, 'bookings'), where('userId', '==', u.uid))
    const unsub = onSnapshot(q, (snap) => {
      setMyBookings(snap.docs.map(d => ({ id: d.id, ...d.data() })))
    }, (err) => console.error('My bookings stream error:', err))
    return () => unsub()
  }, [])

  // Rebuild classStatuses whenever classes or myBookings change
  useEffect(() => {
    if (classes.length === 0) { setClassStatuses([]); return }
    const bookedIds = new Set(myBookings.map(b => b.classId))
    setClassStatuses(classes.map(c => bookedIds.has(c.id) ? 'booked' : 'open'))
  }, [classes, myBookings])

  // ── Clean up bookedExtras when classes are deleted/cancelled/ended ──
  // If a class no longer has an active booking, remove its entry from the workout
  useEffect(() => {
    const activeBookedLabels = new Set(
      myBookings
        .filter(b => classes.some(c => c.id === b.classId))
        .map(b => `📅 ${b.className} (${b.classTime})`)
    )
    let changed = false
    const cleaned = {}
    for (const [dayKey, extras] of Object.entries(bookedExtras)) {
      const filtered = extras.filter(ex => {
        if (typeof ex === 'string' && ex.startsWith('📅')) {
          return activeBookedLabels.has(ex)
        }
        return true
      })
      if (filtered.length !== extras.length) changed = true
      if (filtered.length > 0) cleaned[dayKey] = filtered
      else cleaned[dayKey] = []
    }
    if (changed) {
      setBookedExtras(cleaned)
      // Also clean up corresponding dayChecked entries
      const newChecked = { ...dayChecked }
      for (const [dayKey, extras] of Object.entries(bookedExtras)) {
        if (cleaned[dayKey]?.length !== extras.length) {
          const baseLen = (schedule[parseInt(dayKey)]?.workout?.exercises?.length || 0) + (generatedWorkouts[parseInt(dayKey)]?.exercises?.length || 0)
          const totalLen = baseLen + (cleaned[dayKey]?.length || 0)
          if (newChecked[dayKey]) {
            newChecked[dayKey] = newChecked[dayKey].slice(0, totalLen)
          }
        }
      }
      setDayChecked(newChecked)
      saveWorkoutData(newChecked, generatedWorkouts, cleaned)
    }
  }, [myBookings, classes])

  // ── Load announcements/notifications ────────────────────
  // Shows:
  //   1. Gym-wide announcements (audience='all' or unset)
  //   2. Personally-targeted notifications for THIS member (thank-yous etc.)
  //      Filter EXCLUDES level_change since those get a celebration popup instead.
  const [announcements, setAnnouncements] = useState([])
  const [dismissedAnnouncements, setDismissedAnnouncements] = useState([])
  useEffect(() => {
    const user = auth.currentUser
    if (!user) return
    // Load dismissed list from user doc
    getDoc(doc(db, 'users', user.uid)).then(s => {
      if (s.exists() && Array.isArray(s.data().dismissedAnnouncements)) {
        setDismissedAnnouncements(s.data().dismissedAnnouncements)
      }
    }).catch(() => {})
    import('firebase/firestore').then(({ onSnapshot, orderBy: fbOrderBy, query: fbQuery }) => {
      const q = fbQuery(collection(db, 'notifications'), fbOrderBy('createdAt', 'desc'))
      const unsub = onSnapshot(q, (snap) => {
        const ns = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(n => {
            if (n.audience === 'all' || !n.audience) {
              return n.type !== 'level_change'
            }
            if (n.targetUserId === user.uid && n.type !== 'level_change') {
              return true
            }
            return false
          })
        setAnnouncements(ns)
      }, () => {})
      return unsub
    })
  }, [])

  const visibleAnnouncements = announcements.filter(n => !dismissedAnnouncements.includes(n.id))

  async function dismissAnnouncement(notifId) {
    const user = auth.currentUser
    if (!user) return
    setDismissedAnnouncements(prev => [...prev, notifId])
    try { await updateDoc(doc(db, 'users', user.uid), { dismissedAnnouncements: arrayUnion(notifId) }) } catch (e) { console.error('Dismiss failed:', e) }
  }

  async function clearAllAnnouncements() {
    const user = auth.currentUser
    if (!user || visibleAnnouncements.length === 0) return
    const ids = visibleAnnouncements.map(n => n.id)
    setDismissedAnnouncements(prev => [...prev, ...ids])
    try { await updateDoc(doc(db, 'users', user.uid), { dismissedAnnouncements: arrayUnion(...ids) }) } catch (e) { console.error('Clear all failed:', e) }
  }

  // ── Load coach feedback for this member ───────────────
  const [coachFeedback, setCoachFeedback] = useState([])
  useEffect(() => {
    const user = auth.currentUser
    if (!user) return
    import('firebase/firestore').then(({ query, where }) => {
      const q = query(collection(db, 'feedback'), where('memberId', '==', user.uid))
      getDocs(q).then(snap => {
        const fbs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        setCoachFeedback(fbs)
      }).catch(() => {})
    })
  }, [])

  // ════════════════════════════════════════════════════════
  //  COACH FEEDBACK — Member can clear after reading
  //
  //  Members own their feedback (it's addressed to them) and may
  //  delete entries once they've read them, so the list doesn't
  //  stockpile. Coach + admin retain their own copies on their side.
  // ════════════════════════════════════════════════════════
  const [clearFbConfirm, setClearFbConfirm] = useState(false)
  const [clearingFb, setClearingFb] = useState(false)

  async function deleteFeedback(fbId) {
    if (!fbId) return
    // Snapshot for rollback
    const prev = coachFeedback
    // Optimistic remove
    setCoachFeedback(p => p.filter(f => f.id !== fbId))
    try {
      const { deleteDoc, doc } = await import('firebase/firestore')
      await deleteDoc(doc(db, 'feedback', fbId))
    } catch (e) {
      console.error('Delete feedback failed:', e)
      setCoachFeedback(prev) // rollback
      if (e.code === 'permission-denied' || /permission/i.test(e.message || '')) {
        alert('❌ Permission denied. Coach must update Firestore rules to allow member delete on feedback.')
      } else {
        alert('❌ Could not delete: ' + (e.message || 'unknown error'))
      }
    }
  }

  async function clearAllFeedback() {
    if (coachFeedback.length === 0) return
    setClearingFb(true)
    const prev = coachFeedback
    // Optimistic clear
    setCoachFeedback([])
    try {
      const { deleteDoc, doc, writeBatch } = await import('firebase/firestore')
      // Batch in chunks of 500 (Firestore limit)
      const ids = prev.map(f => f.id).filter(Boolean)
      const chunks = []
      for (let i = 0; i < ids.length; i += 500) chunks.push(ids.slice(i, i + 500))
      for (const chunk of chunks) {
        const batch = writeBatch(db)
        chunk.forEach(id => batch.delete(doc(db, 'feedback', id)))
        await batch.commit()
      }
      setClearFbConfirm(false)
    } catch (e) {
      console.error('Clear feedback failed:', e)
      setCoachFeedback(prev) // rollback
      alert('❌ Failed to clear: ' + (e.message || 'unknown error'))
    } finally {
      setClearingFb(false)
    }
  }

  // ── Save workout data to Firestore ───────────────────
  const saveWorkoutData = useCallback(async (checked, generated, extras) => {
    const user = auth.currentUser
    if (!user) return
    try {
      await updateDoc(doc(db, 'workouts', user.uid), {
        dayChecked:        checked,
        generatedWorkouts: generated,
        bookedExtras:      extras,
        updatedAt:         new Date().toISOString(),
      })
    } catch {
      // Create doc if it doesn't exist yet
      try {
        const { setDoc, serverTimestamp } = await import('firebase/firestore')
        await setDoc(doc(db, 'workouts', user.uid), {
          dayChecked:        checked,
          generatedWorkouts: generated,
          bookedExtras:      extras,
          updatedAt:         new Date().toISOString(),
        })
      } catch (e) { console.error(e) }
    }
  }, [])

  // ── Save stats to Firestore stats/{uid} (for leaderboard) ──
  // IMPORTANT: Also saves name/goal/experience so leaderboard can read it
  // without needing access to other users' profile documents
  const saveStats = useCallback(async (stats) => {
    const user = auth.currentUser
    if (!user) return
    localStorage.setItem('hittrack_stats', JSON.stringify(stats))
    try {
      const { setDoc } = await import('firebase/firestore')
      const profileRaw = localStorage.getItem('hittrack_profile')
      const p = profileRaw ? JSON.parse(profileRaw) : {}
      await setDoc(doc(db, 'stats', user.uid), {
        ...stats,
        // Include display fields so leaderboard works for all members
        name:       p.name       || '',
        goal:       p.goal       || 'Learn Boxing',
        experience: p.experience || 'Beginner',
        uid:        user.uid,
        updatedAt:  new Date().toISOString(),
      }, { merge: true })
    } catch(e) { console.error('Stats save error:', e) }
  }, [])

  // ── Unified completion log (Items 3 + 4) ──────────────────────────────
  //  When a workout day is finished on WEB, write a dated trainingSessions
  //  record so web + mobile share ONE history. Idempotent: deterministic doc
  //  id + a guard against re-logging a date we already have. Create-only
  //  (rules have no update on trainingSessions), so it never overwrites a
  //  richer mobile-written doc for the same day.
  async function logWebSession() {
    const user = auth.currentUser
    if (!user) return
    const todayStr = ymdLocal(Date.now())
    if (trainedDates.includes(todayStr)) return
    try {
      await setDoc(doc(db, 'trainingSessions', `${user.uid}_${todayStr}_web`), {
        uid:         user.uid,
        memberName:  profile.name || 'Member',
        source:      'web',
        date:        todayStr,
        completedAt: serverTimestamp(),
      })
      setTrainedDates(prev => prev.includes(todayStr) ? prev : [...prev, todayStr].sort())
    } catch (e) { console.warn('Web session log (non-fatal):', e.message) }
  }

  // Canvas background
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); let animId, t = 0
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize(); window.addEventListener('resize', resize)
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); t += 0.005
      ctx.strokeStyle = 'rgba(245,200,66,0.025)'; ctx.lineWidth = 1
      const g = 80
      for (let x = 0; x < canvas.width+g; x += g) { const o=(t*15)%g; ctx.beginPath(); ctx.moveTo(x-o,0); ctx.lineTo(x-o,canvas.height); ctx.stroke() }
      for (let y = 0; y < canvas.height+g; y += g) { const o=(t*8)%g;  ctx.beginPath(); ctx.moveTo(0,y-o); ctx.lineTo(canvas.width,y-o); ctx.stroke() }
      const orbs = [
        {x:canvas.width*0.1,  y:canvas.height*0.15, r:280, c:'rgba(232,74,47,0.04)'},
        {x:canvas.width*0.9,  y:canvas.height*0.4,  r:320, c:'rgba(245,200,66,0.03)'},
        {x:canvas.width*0.5,  y:canvas.height*0.85, r:250, c:'rgba(192,132,252,0.025)'},
      ]
      orbs.forEach(o => {
        const grd = ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r)
        grd.addColorStop(0,o.c); grd.addColorStop(1,'transparent')
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,Math.PI*2); ctx.fill()
      })
      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [])

  useEffect(() => { const t = setInterval(() => setTipIdx(i => (i+1)%TIPS.length), 8000); return () => clearInterval(t) }, [])
  useEffect(() => { if (!tipVisible) { const t = setTimeout(() => { setTipVisible(true); setTipIdx(i => (i+1)%TIPS.length) }, 30000); return () => clearTimeout(t) } }, [tipVisible])

  // ── DERIVED VALUES — unified stats from the shared trainingSessions log ──
  // streak / weekly% / total all come from distinct TRAINING DAYS (Today's
  // Workout completed OR mobile camera Lab done), via lib/trainingStats — the
  // single source of truth shared with mobile. `dayChecked` is now used ONLY for
  // the today's-workout check-off UI below, not for these global stats.
  const dpwTarget = Math.min(Math.max(profile?.daysPerWeek || 3, 1), 7)
  const { totalWorkouts, streak, weeklyPct } = computeTrainingStats(trainedDates, dpwTarget)

  // Distinct training days in the current (Mon–Sun) week — for the "This Week" stat.
  const completedThisWeek = (() => {
    const mon = new Date(); mon.setHours(0, 0, 0, 0)
    const dow = mon.getDay(); mon.setDate(mon.getDate() - (dow === 0 ? 6 : dow - 1))
    return trainedDates.filter(ds => new Date(ds + 'T00:00:00') >= mon).length
  })()

  // Workout-milestone progress — pure gamification (a badge every 25 workouts).
  // This is NOT the member's skill division. Division = memberLevel (canonical),
  // shown separately in the "Skill Level" pill. We intentionally avoid level
  // words (Beginner/Intermediate/…) here so the two never look like they disagree.
  const milestoneFloor = Math.floor(totalWorkouts / WORKOUTS_PER_LEVEL) * WORKOUTS_PER_LEVEL
  const nextBadgeAt    = milestoneFloor + WORKOUTS_PER_LEVEL
  const levelPct       = ((totalWorkouts % WORKOUTS_PER_LEVEL) / WORKOUTS_PER_LEVEL) * 100
  const toNext         = WORKOUTS_PER_LEVEL - (totalWorkouts % WORKOUTS_PER_LEVEL)

  // (weeklyPct now comes from computeTrainingStats above — training days vs target,
  //  not the old checked-exercise ratio. See unify-stats decision.)

  const selDayData    = schedule[selDay]
  const workout       = generatedWorkouts[selDay] || selDayData?.workout || null
  const baseExercises = workout?.exercises || []
  const extraExercises= bookedExtras[selDay] || []
  const allExercises  = [...baseExercises, ...extraExercises]
  const checked       = dayChecked[selDay] || allExercises.map(() => false)
  const completedCount= checked.filter(Boolean).length
  const workoutDone   = allExercises.length > 0 && completedCount === allExercises.length

  const lc = { Beginner:'#fb923c', Intermediate:'#f5c842', Advanced:'#4ade80', Expert:'#42a5f5', Elite:'#c084fc' }[memberLevel] || '#f5c842'

  // Difficulty breakdown for the reasoning modal (Item 5). Same composite as the
  // engine, exposed component-by-component so the score is explainable.
  const diffParts = computeDifficultyBreakdown({ experience: memberLevel, streak, weeklyPct, totalWorkouts })

  // Update ring
  useEffect(() => {
    if (ringRef.current) {
      const off = CIRCUMFERENCE - (weeklyPct/100) * CIRCUMFERENCE
      ringRef.current.style.strokeDashoffset = off
    }
    setDisplayPct(weeklyPct)
  }, [weeklyPct])

  // Badge check + save stats to Firestore.
  // NOTE: currentLevel is intentionally NOT written anymore — level comes
  // only from mobile training or admin/coach promote (see lib/memberLevel).
  useEffect(() => {
    const milestone = MILESTONE_BADGES.find(m => totalWorkouts === m && !unlockedBadges.includes(m))
    if (milestone) { setTimeout(() => setBadgePopup(milestone), 600); setUnlockedBadges(p => [...p, milestone]) }
    saveStats({ totalWorkouts, streak, weeklyPct, updatedAt: new Date().toISOString() })
  }, [totalWorkouts, streak, weeklyPct])

  // ════════════════════════════════════════════════════════
  //  ADAPTIVE ENGINE — Steps 3, 4, 5
  //
  //  Runs whenever the dependencies change. Pure, deterministic,
  //  fully explainable. Persists every decision to Firestore for
  //  the audit log (capstone defense gold).
  // ════════════════════════════════════════════════════════
  useEffect(() => {
    if (!profile?.experience || allExercises.length === 0) return

    // Build REAL weekly history from the unified trainingSessions log (Item 4).
    // Each week (Mon–Sun) = distinct days trained ÷ the member's weekly target,
    // most-recent first. Replaces the old forward-schedule estimate that made
    // past weeks always read 0% and fired a false "deload" suggestion.
    const trainedSet = new Set(trainedDates)
    const dpw    = Math.min(Math.max(profile.daysPerWeek || 3, 1), 7)
    const today0 = new Date(); today0.setHours(0, 0, 0, 0)
    const thisMonday = (() => {
      const x = new Date(today0); const dow = x.getDay()
      x.setDate(x.getDate() - (dow === 0 ? 6 : dow - 1)); return x
    })()
    // COMPLETED weeks only (w starts at 1 — exclude the in-progress current
    // week, which always reads low mid-week) AND only weeks from the member's
    // FIRST session onward. A week before they ever trained is "no data yet",
    // not 0% effort — so new/sporadic members can't trip a false deload.
    const firstMs = trainedDates.length ? new Date(trainedDates[0] + 'T00:00:00').getTime() : null
    const weeks = []
    for (let w = 1; w <= 4; w++) {
      const start = new Date(thisMonday); start.setDate(start.getDate() - w * 7)
      const end   = new Date(start);      end.setDate(end.getDate() + 7)
      if (firstMs != null && end.getTime() <= firstMs) continue  // entirely before first session
      let trained = 0
      for (const ds of trainedSet) {
        const d = new Date(ds + 'T00:00:00')
        if (d >= start && d < end) trained++
      }
      weeks.push({ weekStart: ymdLocal(start), pct: Math.min(100, Math.round((trained / dpw) * 100)) })
    }

    // Days since the member last trained (Item 4). One rest day is always fine,
    // so missed = gap − 1. Zero if they trained today, or if they've never
    // trained (brand-new members are covered by the NEW_MEMBER_BOOST rule).
    let missedStreak = 0
    if (trainedSet.size > 0 && !trainedSet.has(ymdLocal(today0))) {
      let lastMs = 0
      for (const ds of trainedSet) {
        const ms = new Date(ds + 'T00:00:00').getTime()
        if (ms > lastMs) lastMs = ms
      }
      const gapDays = Math.floor((today0.getTime() - lastMs) / 86400000)
      missedStreak = Math.max(0, gapDays - 1)
    }

    // Build engine input state. experience = CANONICAL level (admin promote OR
    // mobile training), not the raw profile field — so difficulty + level-up
    // rules agree with the Skill Level shown on screen.
    const state = {
      experience: memberLevel,
      goal: profile.goal,
      streak,
      weeklyPct,
      totalWorkouts,
      weeklyHistory: weeks,
      missedDaysInARow: missedStreak,
    }

    const decisions = evaluateAdaptations(state)
    const difficulty = computeDifficulty(state)
    setAdaptiveDecisions(decisions)
    setAdaptiveDifficulty(difficulty)

    // Step 4 — Reset Day auto-substitution
    const hasResetDecision = decisions.some(d => d.rule === 'RESET_DAY')
    if (hasResetDecision && !resetDayActive && selDay === 0) {
      // Replace today's workout with the light reset variant
      const resetWorkout = buildResetDayWorkout()
      setGeneratedWorkouts(prev => ({ ...prev, 0: resetWorkout }))
      setDayChecked(prev => ({ ...prev, 0: new Array(resetWorkout.exercises.length).fill(false) }))
      setResetDayActive(true)
    } else if (!hasResetDecision && resetDayActive) {
      setResetDayActive(false)
    }

    // Champion Mode — actually inject the bonus exercise into today (Item 5
    // visible action tie-in). Previously the rule CLAIMED it added one but never
    // did; now the claim is true. Added as a normal extra on day 0, guarded so
    // it's injected once and removed when the streak no longer qualifies.
    const hasChampion = decisions.some(d => d.rule === 'CHAMPION_MODE')
    const championEx  = getChampionBonusExercise(profile.goal)
    if (hasChampion && !championBonusActive && selDay === 0) {
      setBookedExtras(prev => {
        const day0 = prev[0] || []
        if (day0.includes(championEx)) return prev
        return { ...prev, 0: [...day0, championEx] }
      })
      setDayChecked(prev => ({ ...prev, 0: [...(prev[0] || []), false] }))
      setChampionBonusActive(true)
    } else if (!hasChampion && championBonusActive) {
      setBookedExtras(prev => {
        const day0 = prev[0] || []
        if (!day0.includes(championEx)) return prev
        return { ...prev, 0: day0.filter(e => e !== championEx) }
      })
      setChampionBonusActive(false)
    }

    // Step 5 — Persist decisions to Firestore (best-effort, non-blocking)
    const persist = async () => {
      const user = auth.currentUser
      if (!user || decisions.length === 0) return
      try {
        // Throttle: persist a given decision-set at most once per DAY (localStorage,
        // not sessionStorage) so page reloads don't stack duplicate audit entries.
        const sigDay = ymdLocal(Date.now())
        const sigKey = 'hittrack_last_adaptive_' + user.uid
        const sig = sigDay + ':' + decisions.map(d => d.rule).sort().join('|')
        if (localStorage.getItem(sigKey) === sig) return
        localStorage.setItem(sigKey, sig)
        // Write each decision as its own audit entry
        for (const d of decisions) {
          await addDoc(collection(db, 'adaptiveDecisions'), {
            userId: user.uid,
            userName: profile.name || 'Member',
            rule: d.rule,
            severity: d.severity,
            title: d.title,
            message: d.message,
            dataUsed: d.dataUsed || null,
            difficulty,
            createdAt: serverTimestamp(),
          })
        }
      } catch (err) {
        console.warn('Adaptive log persist (non-fatal):', err)
      }
    }
    persist()
  }, [memberLevel, profile?.goal, streak, weeklyPct, totalWorkouts, allExercises.length, trainedDates])

  // Load last 10 adaptive decisions for explainability modal
  useEffect(() => {
    const user = auth.currentUser
    if (!user) return
    const q = query(collection(db, 'adaptiveDecisions'), where('userId', '==', user.uid))
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
        .slice(0, 10)
      setAdaptiveLog(docs)
    }, (err) => console.warn('Adaptive log stream:', err))
    return () => unsub()
  }, [])

  // Load this user's timeline "clear" cutoff (non-destructive — see below).
  useEffect(() => {
    const uid = auth.currentUser?.uid
    if (!uid) return
    try { setAdaptiveClearedAt(Number(localStorage.getItem('hittrack_adaptive_cleared_' + uid)) || 0) } catch {}
  }, [])

  // "Clear" the timeline VIEW — hides entries logged before now. NON-DESTRUCTIVE:
  // the Firestore audit records stay intact (auditability is the point of the
  // feature); only this device's display is filtered. Reversible by removing the
  // localStorage key. We do NOT delete adaptiveDecisions docs.
  function clearAdaptiveTimeline() {
    const uid = auth.currentUser?.uid
    if (!uid) return
    const now = Date.now()
    try { localStorage.setItem('hittrack_adaptive_cleared_' + uid, String(now)) } catch {}
    setAdaptiveClearedAt(now)
  }

  // ════════════════════════════════════════════════════════
  //  LEVEL CHANGE WATCHER — Coach/Admin promoted you?
  //  Detects level_change notifications for this user, shows a
  //  celebratory popup, and refreshes the profile so the UI
  //  immediately reflects the new level.
  // ════════════════════════════════════════════════════════
  const [levelChangePopup, setLevelChangePopup] = useState(null)
  useEffect(() => {
    const user = auth.currentUser
    if (!user) return
    const q = query(
      collection(db, 'notifications'),
      where('targetUserId', '==', user.uid),
      where('type', '==', 'level_change')
    )
    const unsub = onSnapshot(q, async (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      if (docs.length === 0) return
      const latest = docs[0]
      // Dedupe — only show once per notification id per session
      const seenKey = 'hittrack_seen_level_changes'
      const seen = JSON.parse(sessionStorage.getItem(seenKey) || '[]')
      if (seen.includes(latest.id)) return
      // Refresh profile from Firestore (gets the new experience field)
      try {
        const userSnap = await getDoc(doc(db, 'users', user.uid))
        if (userSnap.exists()) {
          const fresh = userSnap.data()
          const merged = { ...profile, ...fresh }
          setProfile(merged)
          localStorage.setItem('hittrack_profile', JSON.stringify(merged))
        }
      } catch (e) { console.warn('Could not refresh profile:', e) }
      // Show the popup
      setLevelChangePopup(latest)
      sessionStorage.setItem(seenKey, JSON.stringify([...seen, latest.id]))
    }, (err) => console.warn('Level change watcher:', err))
    return () => unsub()
  }, [])

  // ════════════════════════════════════════════════════════
  //  CLASS THANK-YOU WATCHER — Coach thanked you for showing up?
  //  Detects class_thanks notifications targeted at this member,
  //  shows a one-time celebratory popup. Notification stays in the
  //  member's announcements widget too (handled by the loader above).
  // ════════════════════════════════════════════════════════
  const [thanksPopup, setThanksPopup] = useState(null)
  useEffect(() => {
    const user = auth.currentUser
    if (!user) return
    const q = query(
      collection(db, 'notifications'),
      where('targetUserId', '==', user.uid),
      where('type', '==', 'class_thanks')
    )
    const unsub = onSnapshot(q, (snap) => {
      const docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      if (docs.length === 0) return
      const latest = docs[0]
      // Dedupe — only show once per notification id per session
      const seenKey = 'hittrack_seen_class_thanks'
      const seen = JSON.parse(sessionStorage.getItem(seenKey) || '[]')
      if (seen.includes(latest.id)) return
      // Only show if it arrived recently (last 24h) — don't spam on fresh logins
      const createdMs = (latest.createdAt?.seconds || 0) * 1000
      if (createdMs && (Date.now() - createdMs) > 24 * 60 * 60 * 1000) {
        // Mark as seen but don't show the popup
        sessionStorage.setItem(seenKey, JSON.stringify([...seen, latest.id]))
        return
      }
      setThanksPopup(latest)
      sessionStorage.setItem(seenKey, JSON.stringify([...seen, latest.id]))
    }, (err) => console.warn('Thank-you watcher:', err))
    return () => unsub()
  }, [])

  // ── ACTIONS ───────────────────────────────────────────
  function toggleEx(scheduleIdx, exIdx) {
    if (membershipBlocked) {
      console.warn('🔒 Membership inactive — exercise tracking locked')
      return
    }
    if (scheduleIdx > 0) {
      console.warn('🔒 Future workouts are locked until their scheduled date')
      return
    }
    if (scheduleIdx < 0) return
    setDayChecked(prev => {
      const total = allExercises.length
      const arr   = [...(prev[scheduleIdx] || new Array(total).fill(false))]
      // Sequential lock: cannot check an exercise unless all previous are done
      if (!arr[exIdx]) {
        for (let p = 0; p < exIdx; p++) {
          if (!arr[p]) return prev
        }
      }
      // Allow unchecking only the last checked exercise (can't uncheck middle ones)
      if (arr[exIdx]) {
        for (let n = exIdx + 1; n < arr.length; n++) {
          if (arr[n]) return prev
        }
      }
      arr[exIdx] = !arr[exIdx]
      const next  = { ...prev, [scheduleIdx]: arr }
      saveWorkoutData(next, generatedWorkouts, bookedExtras)
      // Completing TODAY's workout logs a unified session record (Items 3+4).
      if (scheduleIdx === 0 && arr.length > 0 && arr.every(Boolean)) logWebSession()
      return next
    })
  }

  function generateRandom(scheduleIdx) {
    if (scheduleIdx < 0) return
    const exp  = profile?.experience || 'Beginner'
    const goal = profile?.goal || 'Learn Boxing'
    const seed = Math.floor(Math.random() * 1000) + totalWorkouts + streak + scheduleIdx
    const generated = buildWorkout(exp, goal, seed, null)
    const newW = {
      ...generated,
      title: `Bonus Session 🎲 — ${generated.title}`,
      type: 'generated',
    }
    const nextGen = { ...generatedWorkouts, [scheduleIdx]: newW }
    setGeneratedWorkouts(nextGen)
    const nextChecked = { ...dayChecked, [scheduleIdx]: new Array(newW.exercises.length).fill(false) }
    setDayChecked(nextChecked)
    saveWorkoutData(nextChecked, nextGen, bookedExtras)
  }

  function handleBook(i) {
    const cls = classes[i]
    if (!cls) return
    if (classStatuses[i] === 'booked') {
      // Open confirmation modal instead of canceling immediately
      setCancelConfirm({ classIndex: i, classData: cls })
      return
    }
    // Membership gate — can't create new bookings when expired/paused.
    // (Cancellation of EXISTING bookings is still allowed above — they may
    // want to free their slot even if their plan lapsed.)
    if (membershipBlocked) {
      const reason = membershipState === STATUS.EXPIRED
        ? 'Your membership has expired. Speak with the admin to renew before booking.'
        : 'Your membership is paused. Ask the admin to resume access.'
      alert(`🔒 ${reason}`)
      return
    }
    // Pre-flight: check if class is already full (server will re-check atomically)
    if (cls.spots && (cls.enrolled || 0) >= cls.spots) {
      alert(`❌ "${cls.name}" is full. First come, first served — try another class.`)
      return
    }
    // Find matching workout day for conflict check
    const dayMap = { Sunday:0, Monday:1, Tuesday:2, Wednesday:3, Thursday:4, Friday:5, Saturday:6 }
    const today = new Date()
    let targetDayIdx
    if (cls.date) {
      const [y, m, d] = cls.date.split('-').map(Number)
      targetDayIdx = new Date(y, m - 1, d).getDay()
    } else {
      targetDayIdx = dayMap[cls.day] ?? -1
    }
    let matchDay = -1
    for (let d = 0; d < schedule.length; d++) {
      const dDate = new Date(today); dDate.setDate(today.getDate() + d)
      if (dDate.getDay() === targetDayIdx) { matchDay = d; break }
    }
    const hasWorkout = matchDay >= 0 && (schedule[matchDay]?.workout || generatedWorkouts[matchDay])
    if (hasWorkout && matchDay >= 0) {
      setConflictModal({ classIdx:i, classData:cls, dayIdx:matchDay, existingWorkout: schedule[matchDay]?.workout || generatedWorkouts[matchDay] })
    } else {
      doBook(i, cls, matchDay)
    }
  }

  // ── ATOMIC BOOKING (Issue 2 fix) ─────────────────────
  // Uses a Firestore transaction for true first-come first-serve.
  // Notifies the coach in realtime via the notifications collection.
  async function doBook(i, cls, dayIdx) {
    const user = auth.currentUser
    if (!user || !cls?.id) return
    try {
      // 1. Check if already booked (cheap read first)
      const dupQuery = query(collection(db,'bookings'), where('userId','==',user.uid), where('classId','==',cls.id))
      const dupSnap = await getDocs(dupQuery)
      if (!dupSnap.empty) {
        alert(`You've already booked "${cls.name}".`)
        return
      }
      // 2. Atomic transaction: increment enrolled & create booking together
      await runTransaction(db, async (tx) => {
        const classRef = doc(db,'classes',cls.id)
        const classSnap = await tx.get(classRef)
        if (!classSnap.exists()) throw new Error('Class no longer exists')
        const data = classSnap.data()
        const enrolled = data.enrolled || 0
        const spots = data.spots || 0
        if (spots > 0 && enrolled >= spots) {
          throw new Error(`SOLD_OUT:"${cls.name}" filled up while you were booking. First come, first served.`)
        }
        tx.update(classRef, { enrolled: increment(1) })
        const bookingRef = doc(collection(db,'bookings'))
        tx.set(bookingRef, {
          userId: user.uid,
          userName: profile.name || 'Member',
          classId: cls.id,
          className: cls.name,
          classDay: cls.day || '',
          classTime: cls.time || '',
          coach: cls.coach || '',
          createdAt: serverTimestamp(),
        })
      })
      // 3. Log to activity feed (separate from announcements — coach/admin see this in their dashboard)
      logActivity({
        type: 'booking_created',
        actorId: user.uid,
        actorName: profile.name || 'Member',
        actorRole: 'member',
        payload: {
          classId: cls.id,
          className: cls.name,
          classDay: cls.day || '',
          classTime: cls.time || '',
          coach: cls.coach || '',
        },
      })
    } catch (e) {
      console.error('Booking error:', e)
      const msg = String(e?.message||'')
      if (msg.startsWith('SOLD_OUT:')) alert('🚫 ' + msg.replace('SOLD_OUT:',''))
      else alert('Booking failed: ' + (msg || 'unknown error'))
    }
  }

  async function cancelBooking(cls) {
    const user = auth.currentUser
    if (!user || !cls?.id) return
    try {
      // Find the user's booking doc for this class
      const q = query(collection(db,'bookings'), where('userId','==',user.uid), where('classId','==',cls.id))
      const snap = await getDocs(q)
      if (snap.empty) return  // nothing to cancel
      // Atomic: delete the booking + decrement enrolled
      await runTransaction(db, async (tx) => {
        const classRef = doc(db,'classes',cls.id)
        const classSnap = await tx.get(classRef)
        if (classSnap.exists()) {
          const cur = classSnap.data().enrolled || 0
          if (cur > 0) tx.update(classRef, { enrolled: increment(-1) })
        }
        for (const bd of snap.docs) tx.delete(doc(db,'bookings',bd.id))
      })
      // Log cancellation to activity feed
      logActivity({
        type: 'booking_cancelled',
        actorId: user.uid,
        actorName: profile.name || 'Member',
        actorRole: 'member',
        payload: {
          classId: cls.id,
          className: cls.name,
          classDay: cls.day || '',
          classTime: cls.time || '',
          coach: cls.coach || '',
        },
      })
    } catch (e) {
      console.error('Cancel booking error:', e)
      alert('Could not cancel booking: ' + (e.message || 'unknown error'))
    }
  }

  function handleConflictProceed() {
    if (!conflictModal) return
    const { classIdx, classData, dayIdx } = conflictModal
    doBook(classIdx, classData, dayIdx)
    const extraEx = `📅 ${classData.name} (${classData.time})`
    const nextChecked = { ...dayChecked, [dayIdx]: [...(dayChecked[dayIdx]||[]), false] }
    const nextExtras  = { ...bookedExtras, [dayIdx]: [...(bookedExtras[dayIdx]||[]), extraEx] }
    setDayChecked(nextChecked)
    setBookedExtras(nextExtras)
    saveWorkoutData(nextChecked, generatedWorkouts, nextExtras)
    setConflictModal(null)
  }

  const tip = TIPS[tipIdx]

  return (
    <>
      <Navbar user={{ name: profile.name || 'Athlete' }}/>
      {badgePopup && <BadgePopup milestone={badgePopup} onClose={() => setBadgePopup(null)}/>}

      {/* FREE-TRIAL WELCOME MODAL — Item 5 */}
      {showTrialWelcome && (
        <div onClick={()=>setShowTrialWelcome(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:22,border:'1.5px solid rgba(66,165,245,0.4)',maxWidth:420,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.8),0 0 50px rgba(66,165,245,0.2)',textAlign:'center'}}>
            <div style={{position:'absolute',left:0,top:0,right:0,height:5,background:'linear-gradient(90deg,#42a5f5,#4ade80,#f5c842)'}}/>
            <div style={{padding:'36px 30px 30px'}}>
              <div style={{fontSize:56,marginBottom:10,lineHeight:1}}>🎉</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,letterSpacing:'0.04em',color:'#f0ece8',lineHeight:1.1,marginBottom:10}}>
                WELCOME TO HITTRACK!
              </div>
              <div style={{display:'inline-flex',alignItems:'center',gap:8,padding:'8px 16px',background:'rgba(66,165,245,0.12)',border:'1px solid rgba(66,165,245,0.35)',borderRadius:50,marginBottom:18}}>
                <span style={{fontSize:9,fontWeight:800,letterSpacing:'0.1em',color:'#42a5f5',textTransform:'uppercase'}}>Trial</span>
                <span style={{fontSize:11,color:'#cdd5dc',fontWeight:600}}>
                  {daysLeft != null && daysLeft >= 0 ? `${daysLeft} day${daysLeft===1?'':'s'} left` : '7 days'}
                </span>
              </div>
              <div style={{fontSize:13,color:'#b0ada8',lineHeight:1.7,marginBottom:24}}>
                You{'’'}re on a <strong style={{color:'#42a5f5'}}>7-day trial</strong>. Book classes, track your workouts, and explore everything HITTRACK offers. When your trial ends, speak with the gym admin to continue your membership.
              </div>
              <button onClick={()=>setShowTrialWelcome(false)}
                style={{width:'100%',background:'linear-gradient(135deg,#42a5f5,#1e6db8)',color:'#fff',border:'none',borderRadius:50,padding:'14px',fontSize:14,fontWeight:800,letterSpacing:'0.04em',cursor:'pointer',boxShadow:'0 6px 20px rgba(66,165,245,0.4)'}}>
                Let{'’'}s Go 🥊
              </button>
            </div>
          </div>
        </div>
      )}
      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',zIndex:0,pointerEvents:'none'}}/>

      {/* Conflict Modal */}
      {conflictModal && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...glass(),padding:'32px 36px',maxWidth:420,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:40,marginBottom:12}}>⚠️</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:'#f5c842',marginBottom:8}}>Schedule Conflict!</div>
            <div style={{fontSize:13,color:'#b0ada8',lineHeight:1.7,marginBottom:20}}>
              You already have <strong style={{color:'#f0ece8'}}>{conflictModal.existingWorkout?.title}</strong> on <strong style={{color:'#f0ece8'}}>{conflictModal.classData.day}</strong>. Add this class to your workout?
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <button onClick={handleConflictProceed} style={{background:'linear-gradient(135deg,#42a5f5,#1565c0)',color:'#fff',border:'none',borderRadius:50,padding:'12px',fontSize:13,fontWeight:700,cursor:'pointer'}}>✅ Yes, Add to My Workout</button>
              <button onClick={() => setConflictModal(null)} style={{background:'transparent',color:'#7a7570',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'11px',fontSize:13,fontWeight:700,cursor:'pointer'}}>✕ Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/*  LEVEL CHANGE CELEBRATION POPUP                      */}
      {/*  Shown when coach/admin promotes or moves the member */}
      {/* ════════════════════════════════════════════════════ */}
      {levelChangePopup && (() => {
        const oldLv = levelChangePopup.oldLevel || 'Beginner'
        const newLv = levelChangePopup.newLevel || 'Beginner'
        const LEVELS_ORDER = ['Beginner','Intermediate','Advanced']
        const isPromote = LEVELS_ORDER.indexOf(newLv) > LEVELS_ORDER.indexOf(oldLv)
        const lc = { Beginner:'#fb923c', Intermediate:'#f5c842', Advanced:'#22c55e' }[newLv] || '#f5c842'
        const lvIc = { Beginner:'🥊', Intermediate:'⚡', Advanced:'🔥' }[newLv] || '🥊'
        return (
          <div onClick={()=>setLevelChangePopup(null)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',backdropFilter:'blur(12px)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',padding:20,animation:'popIn 0.4s ease'}}>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:24,border:`2px solid ${lc}55`,maxWidth:440,width:'100%',overflow:'hidden',boxShadow:`0 30px 80px rgba(0,0,0,0.8),0 0 60px ${lc}40`}}>
              {/* Burst */}
              <div style={{position:'absolute',top:-50,left:'50%',transform:'translateX(-50%)',width:280,height:280,borderRadius:'50%',background:`radial-gradient(circle,${lc}30,transparent 70%)`,pointerEvents:'none'}}/>
              <div style={{position:'relative',padding:'34px 30px 28px',textAlign:'center'}}>
                <div style={{fontSize:54,marginBottom:8}}>{isPromote?'🎉':'🎚'}</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,letterSpacing:'0.06em',color:lc,marginBottom:6,textShadow:`0 0 20px ${lc}66`}}>
                  {isPromote?'LEVELED UP!':'LEVEL UPDATED'}
                </div>
                <div style={{fontSize:11,color:'#888',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginBottom:24}}>
                  By {levelChangePopup.from || 'Your Coach'}
                </div>

                {/* Old → New visual */}
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:16,marginBottom:24}}>
                  {/* Old */}
                  <div style={{textAlign:'center',opacity:0.4}}>
                    <div style={{width:62,height:62,borderRadius:'50%',background:'rgba(255,255,255,0.04)',border:'2px solid rgba(255,255,255,0.1)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,margin:'0 auto 6px'}}>
                      {{Beginner:'🥊',Intermediate:'⚡',Advanced:'🔥'}[oldLv]||'🥊'}
                    </div>
                    <div style={{fontSize:9,color:'#666',fontWeight:800,letterSpacing:'0.1em'}}>{oldLv.toUpperCase()}</div>
                  </div>
                  {/* Arrow */}
                  <div style={{fontSize:24,color:lc,opacity:0.7}}>{isPromote?'➡':'⬅'}</div>
                  {/* New */}
                  <div style={{textAlign:'center'}}>
                    <div style={{width:74,height:74,borderRadius:'50%',background:`linear-gradient(135deg,${lc},${lc}aa)`,border:`3px solid ${lc}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:32,margin:'0 auto 6px',boxShadow:`0 8px 24px ${lc}66,inset 0 2px 6px rgba(255,255,255,0.2)`}}>
                      {lvIc}
                    </div>
                    <div style={{fontSize:11,fontWeight:800,color:lc,letterSpacing:'0.1em',textShadow:`0 0 10px ${lc}66`}}>{newLv.toUpperCase()}</div>
                  </div>
                </div>

                <div style={{fontSize:13,color:'#b0ada8',lineHeight:1.7,marginBottom:24,padding:'0 8px'}}>
                  {levelChangePopup.message || `You're now ${newLv}. Your training plan and leaderboard division have been updated.`}
                </div>

                <button onClick={()=>setLevelChangePopup(null)}
                  style={{width:'100%',background:`linear-gradient(135deg,${lc},${lc}cc)`,color:'#000',border:'none',borderRadius:50,padding:'14px',fontSize:13,fontWeight:800,letterSpacing:'0.08em',cursor:'pointer',boxShadow:`0 6px 20px ${lc}50,inset 0 1px 0 rgba(255,255,255,0.2)`,transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)'}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow=`0 10px 30px ${lc}80,inset 0 1px 0 rgba(255,255,255,0.25)`}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow=`0 6px 20px ${lc}50,inset 0 1px 0 rgba(255,255,255,0.2)`}}>
                  🥊 LET'S GO!
                </button>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ════════════════════════════════════════════════════ */}
      {/*  CLASS THANK-YOU POPUP — Shown after coach ends a    */}
      {/*  class you participated in. One-time per notification.*/}
      {/* ════════════════════════════════════════════════════ */}
      {thanksPopup && (
        <div onClick={()=>setThanksPopup(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',backdropFilter:'blur(12px)',zIndex:3000,display:'flex',alignItems:'center',justifyContent:'center',padding:20,animation:'popIn 0.4s ease'}}>
          <div onClick={e=>e.stopPropagation()}
            style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:24,border:'2px solid rgba(34,197,94,0.55)',maxWidth:440,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.8),0 0 60px rgba(34,197,94,0.4)'}}>
            {/* Burst */}
            <div style={{position:'absolute',top:-50,left:'50%',transform:'translateX(-50%)',width:280,height:280,borderRadius:'50%',background:'radial-gradient(circle,rgba(34,197,94,0.3),transparent 70%)',pointerEvents:'none'}}/>
            <div style={{position:'relative',padding:'34px 30px 28px',textAlign:'center'}}>
              <div style={{fontSize:54,marginBottom:8}}>🙏</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,letterSpacing:'0.06em',color:'#22c55e',marginBottom:6,textShadow:'0 0 20px rgba(34,197,94,0.5)'}}>
                THANK YOU!
              </div>
              <div style={{fontSize:11,color:'#888',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginBottom:24}}>
                From {thanksPopup.from || 'Your Coach'}
              </div>
              {/* Class info */}
              {thanksPopup.className && (
                <div style={{display:'inline-flex',alignItems:'center',gap:10,padding:'10px 18px',background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.25)',borderRadius:50,marginBottom:20}}>
                  <span style={{fontSize:18}}>🥊</span>
                  <span style={{fontSize:13,fontWeight:800,letterSpacing:'0.06em',color:'#22c55e'}}>{thanksPopup.className}</span>
                </div>
              )}
              <div style={{fontSize:13,color:'#b0ada8',lineHeight:1.7,marginBottom:24,padding:'0 8px'}}>
                {thanksPopup.message || `Thanks for showing up! Great work — keep stepping into the ring.`}
              </div>
              <button onClick={()=>setThanksPopup(null)}
                style={{width:'100%',background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'#fff',border:'none',borderRadius:50,padding:'14px',fontSize:13,fontWeight:800,letterSpacing:'0.08em',cursor:'pointer',boxShadow:'0 6px 20px rgba(34,197,94,0.5),inset 0 1px 0 rgba(255,255,255,0.2)',transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)'}}
                onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 10px 30px rgba(34,197,94,0.7),inset 0 1px 0 rgba(255,255,255,0.25)'}}
                onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 6px 20px rgba(34,197,94,0.5),inset 0 1px 0 rgba(255,255,255,0.2)'}}>
                🥊 SEE YOU NEXT CLASS!
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/*  CLEAR ALL FEEDBACK — confirmation                    */}
      {/* ════════════════════════════════════════════════════ */}
      {clearFbConfirm && (
        <div onClick={()=>!clearingFb && setClearFbConfirm(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'2px solid rgba(232,74,47,0.4)',maxWidth:440,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.8),0 0 50px rgba(232,74,47,0.25)'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#c93820)'}}/>
            <div style={{padding:'22px 26px',display:'flex',flexDirection:'column',gap:16,position:'relative'}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:44,height:44,borderRadius:12,background:'linear-gradient(135deg,#e84a2f,#c93820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(232,74,47,0.5)'}}>🧹</div>
                <div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#e84a2f'}}>CLEAR ALL FEEDBACK?</div>
                  <div style={{fontSize:9,color:'#888',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>This action is permanent</div>
                </div>
              </div>
              <div style={{padding:'14px 16px',background:'rgba(232,74,47,0.06)',border:'1px solid rgba(232,74,47,0.2)',borderRadius:12,fontSize:12,color:'#bbb',lineHeight:1.6}}>
                All <strong style={{color:'#e84a2f'}}>{coachFeedback.length}</strong> coach feedback entries will be permanently deleted from your view. Make sure you've read them — your coach won't be notified.
              </div>
              <div style={{display:'flex',gap:10}}>
                <button onClick={()=>setClearFbConfirm(false)} disabled={clearingFb}
                  style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:clearingFb?'not-allowed':'pointer',opacity:clearingFb?0.5:1}}>
                  KEEP THEM
                </button>
                <button onClick={clearAllFeedback} disabled={clearingFb}
                  style={{flex:1.3,background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:clearingFb?'not-allowed':'pointer',boxShadow:'0 4px 14px rgba(232,74,47,0.4)',opacity:clearingFb?0.7:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                  {clearingFb ? (<>
                    <span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                    CLEARING...
                  </>) : `🧹 CLEAR ${coachFeedback.length}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/*  CANCEL BOOKING — Confirmation Modal (Improvement 1) */}
      {/* ════════════════════════════════════════════════════ */}
      {cancelConfirm && (
        <div onClick={() => setCancelConfirm(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e => e.stopPropagation()}
            style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'1px solid rgba(232,74,47,0.3)',maxWidth:420,width:'100%',overflow:'hidden',boxShadow:'0 24px 60px rgba(0,0,0,0.7),0 0 40px rgba(232,74,47,0.15)'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#c93820)'}}/>
            <div style={{padding:'30px 32px',textAlign:'center'}}>
              <div style={{width:64,height:64,margin:'0 auto 16px',borderRadius:'50%',background:'linear-gradient(135deg,rgba(232,74,47,0.2),rgba(232,74,47,0.05))',border:'2px solid rgba(232,74,47,0.4)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:30,boxShadow:'0 6px 20px rgba(232,74,47,0.3)'}}>🥊</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#e84a2f',letterSpacing:'0.04em',marginBottom:6}}>CANCEL BOOKING?</div>
              <div style={{fontSize:9,color:'#666',letterSpacing:'0.18em',textTransform:'uppercase',fontWeight:700,marginBottom:16}}>This action will free up your spot</div>
              {/* Class info card */}
              <div style={{background:'rgba(232,74,47,0.06)',border:'1px solid rgba(232,74,47,0.2)',borderRadius:12,padding:'14px 16px',marginBottom:18,textAlign:'left',display:'flex',gap:12,alignItems:'center'}}>
                <div style={{width:46,height:46,borderRadius:11,background:'linear-gradient(135deg,#e84a2f,#c93820)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#fff',flexShrink:0,boxShadow:'0 4px 12px rgba(232,74,47,0.4)'}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,lineHeight:1}}>{(cancelConfirm.classData.day||'').slice(0,3).toUpperCase()}</div>
                  <div style={{fontSize:7,fontWeight:800,letterSpacing:'0.06em',marginTop:2,opacity:0.85}}>{cancelConfirm.classData.time}</div>
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:3}}>{cancelConfirm.classData.name}</div>
                  <div style={{fontSize:10,color:'#888'}}>👨‍🏫 {cancelConfirm.classData.coach||'Coach'}</div>
                </div>
              </div>
              <div style={{fontSize:11,color:'#888',lineHeight:1.7,marginBottom:22}}>
                Are you sure you want to cancel? Someone else may grab your spot — first come, first served.
              </div>
              <div style={{display:'flex',gap:10}}>
                <button onClick={() => setCancelConfirm(null)}
                  style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#888',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.05em',cursor:'pointer',transition:'all 0.2s'}}
                  onMouseEnter={e=>{e.currentTarget.style.background='rgba(255,255,255,0.08)';e.currentTarget.style.color='#f0ece8'}}
                  onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.color='#888'}}>
                  KEEP MY SPOT
                </button>
                <button onClick={() => { cancelBooking(cancelConfirm.classData); setCancelConfirm(null) }}
                  style={{flex:1,background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.05em',cursor:'pointer',boxShadow:'0 4px 14px rgba(232,74,47,0.4)',transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)'}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 8px 22px rgba(232,74,47,0.55)'}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 4px 14px rgba(232,74,47,0.4)'}}>
                  ✕ CANCEL BOOKING
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/*  ADAPTIVE COACH — "Why these decisions?" modal       */}
      {/*  Capstone defense gold: shows the rule engine's      */}
      {/*  reasoning, audit log, and explainability layer.     */}
      {/* ════════════════════════════════════════════════════ */}
      {adaptiveOpen && (
        <div onClick={() => setAdaptiveOpen(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e => e.stopPropagation()}
            style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'1px solid rgba(192,132,252,0.3)',maxWidth:680,width:'100%',maxHeight:'85vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 24px 60px rgba(0,0,0,0.7),0 0 40px rgba(192,132,252,0.15)'}}>
            {/* Left accent stripe */}
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#c084fc,#42a5f5)'}}/>
            {/* Header */}
            <div style={{padding:'20px 28px',borderBottom:'1px solid rgba(192,132,252,0.15)',background:'linear-gradient(135deg,rgba(192,132,252,0.06) 0%,transparent 60%)',display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:42,height:42,borderRadius:11,background:'linear-gradient(135deg,#c084fc,#7b1fa2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,boxShadow:'0 4px 14px rgba(192,132,252,0.4)'}}>🧠</div>
              <div style={{flex:1}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.06em',color:'#f0ece8'}}>ADAPTIVE COACH — REASONING</div>
                <div style={{fontSize:9,color:'#9d8ec0',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>Rule-based decisions · Fully auditable</div>
              </div>
              <button onClick={() => setAdaptiveOpen(false)}
                style={{width:32,height:32,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:9,color:'#888',fontSize:16,cursor:'pointer'}}>✕</button>
            </div>

            {/* Body — scrollable */}
            <div style={{padding:'22px 28px',overflowY:'auto',flex:1,display:'flex',flexDirection:'column',gap:20}}>

              {/* Current state snapshot */}
              <div>
                <div style={{fontSize:9,fontWeight:800,color:'#9d8ec0',letterSpacing:'0.16em',textTransform:'uppercase',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'inline-block',width:14,height:2,background:'#c084fc'}}/>
                  Current State
                </div>
                <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(4,1fr)',gap:8}}>
                  {[
                    {label:'Streak', val:`${streak}d`, color:streak>=14?'#f5c842':'#42a5f5'},
                    {label:'Weekly', val:`${weeklyPct}%`, color:weeklyPct>=80?'#22c55e':weeklyPct>=40?'#f5c842':'#e84a2f'},
                    {label:'Difficulty', val:adaptiveDifficulty, color:'#c084fc'},
                    {label:'Total', val:totalWorkouts, color:'#42a5f5'},
                  ].map((s,i) => (
                    <div key={i} style={{padding:'10px 12px',background:`${s.color}10`,border:`1px solid ${s.color}25`,borderRadius:10}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:s.color,lineHeight:1}}>{s.val}</div>
                      <div style={{fontSize:8,color:'#666',fontWeight:700,letterSpacing:'0.12em',marginTop:3}}>{s.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Difficulty breakdown (Item 5) — why the score is what it is */}
              <div>
                <div style={{fontSize:9,fontWeight:800,color:'#9d8ec0',letterSpacing:'0.16em',textTransform:'uppercase',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'inline-block',width:14,height:2,background:'#c084fc'}}/>
                  Difficulty Breakdown
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',padding:'12px 14px',background:'rgba(192,132,252,0.05)',border:'1px solid rgba(192,132,252,0.18)',borderRadius:10}}>
                  {[
                    {lbl:`${diffParts.level} base`, val:diffParts.levelBase.toFixed(1), c:'#c084fc'},
                    {lbl:'streak',  val:`+${diffParts.streakBonus.toFixed(1)}`,  c:'#42a5f5'},
                    {lbl:'weekly',  val:`+${diffParts.weeklyBonus.toFixed(1)}`,  c:'#22c55e'},
                    {lbl:'veteran', val:`+${diffParts.veteranBonus.toFixed(1)}`, c:'#f5c842'},
                  ].map((p,i)=>(
                    <div key={i} style={{textAlign:'center',padding:'6px 10px',background:`${p.c}12`,border:`1px solid ${p.c}30`,borderRadius:8,minWidth:60}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:17,color:p.c,lineHeight:1}}>{p.val}</div>
                      <div style={{fontSize:7,color:'#888',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',marginTop:3}}>{p.lbl}</div>
                    </div>
                  ))}
                  <span style={{fontSize:18,color:'#555',fontWeight:700}}>=</span>
                  <div style={{textAlign:'center',padding:'6px 12px',background:'rgba(192,132,252,0.18)',border:'1px solid rgba(192,132,252,0.45)',borderRadius:8}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:'#c084fc',lineHeight:1}}>{diffParts.total}</div>
                    <div style={{fontSize:7,color:'#9d8ec0',fontWeight:700,letterSpacing:'0.1em',marginTop:3}}>/ 10</div>
                  </div>
                </div>
                <div style={{fontSize:9,color:'#666',marginTop:6,fontStyle:'italic'}}>Higher level, longer streaks, better weekly completion, and total workouts each push the load up.</div>
              </div>

              {/* Active rules */}
              <div>
                <div style={{fontSize:9,fontWeight:800,color:'#9d8ec0',letterSpacing:'0.16em',textTransform:'uppercase',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'inline-block',width:14,height:2,background:'#c084fc'}}/>
                  Rules Fired This Session ({adaptiveDecisions.length})
                </div>
                {adaptiveDecisions.length === 0 ? (
                  <div style={{padding:'20px',textAlign:'center',background:'rgba(255,255,255,0.02)',borderRadius:10,border:'1px dashed rgba(255,255,255,0.06)',fontSize:11,color:'#666'}}>
                    No rules fired — engine is observing.
                  </div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {adaptiveDecisions.map((d, i) => {
                      const sevColor = d.severity === 'celebrate' ? '#f5c842'
                                     : d.severity === 'positive'  ? '#22c55e'
                                     : d.severity === 'warning'   ? '#e84a2f'
                                     :                              '#42a5f5'
                      return (
                        <div key={i} style={{padding:'12px 14px',background:`${sevColor}10`,border:`1px solid ${sevColor}25`,borderRadius:11}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:5,flexWrap:'wrap'}}>
                            <span style={{fontSize:8,fontWeight:800,padding:'3px 8px',borderRadius:50,background:`${sevColor}22`,color:sevColor,letterSpacing:'0.1em',fontFamily:'monospace'}}>{d.rule}</span>
                            <span style={{fontSize:11,fontWeight:700,color:sevColor}}>{d.title}</span>
                          </div>
                          <div style={{fontSize:11,color:'#a8a29e',lineHeight:1.6,marginBottom:8}}>{d.message}</div>
                          {RULE_ACTION[d.rule] && (
                            <div style={{display:'inline-flex',alignItems:'center',gap:6,fontSize:9,fontWeight:800,color:'#22c55e',background:'rgba(34,197,94,0.1)',border:'1px solid rgba(34,197,94,0.3)',borderRadius:50,padding:'4px 10px',marginBottom:8,letterSpacing:'0.04em'}}>
                              ⚡ APPLIED · {RULE_ACTION[d.rule]}
                            </div>
                          )}
                          {d.dataUsed && (
                            <div style={{fontSize:9,color:'#666',fontFamily:'monospace',background:'rgba(0,0,0,0.4)',padding:'6px 9px',borderRadius:6,wordBreak:'break-word'}}>
                              <span style={{color:sevColor,fontWeight:700}}>data:</span> {JSON.stringify(d.dataUsed)}
                            </div>
                          )}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Adaptation timeline — plain-language history of every automatic
                  change the coach made (Item 5). Newest first; rule codes dropped
                  for the member view; entries before the (non-destructive) clear
                  cutoff are hidden. */}
              {adaptiveLog.length > 0 && (
                <div>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                    <div style={{fontSize:9,fontWeight:800,color:'#9d8ec0',letterSpacing:'0.16em',textTransform:'uppercase',display:'flex',alignItems:'center',gap:8}}>
                      <span style={{display:'inline-block',width:14,height:2,background:'#c084fc'}}/>
                      Adaptation Timeline
                    </div>
                    <button onClick={clearAdaptiveTimeline}
                      style={{background:'transparent',border:'1px solid rgba(255,255,255,0.12)',borderRadius:50,padding:'4px 12px',fontSize:9,fontWeight:700,color:'#888',cursor:'pointer',letterSpacing:'0.06em'}}
                      onMouseEnter={e=>{e.currentTarget.style.color='#ccc';e.currentTarget.style.borderColor='rgba(255,255,255,0.25)'}}
                      onMouseLeave={e=>{e.currentTarget.style.color='#888';e.currentTarget.style.borderColor='rgba(255,255,255,0.12)'}}>
                      Clear
                    </button>
                  </div>
                  <div style={{fontSize:10,color:'#777',marginBottom:10,lineHeight:1.5}}>Every change your coach made to your plan, automatically — newest first.</div>
                  {(() => {
                    // Hide entries before the clear cutoff, then collapse consecutive
                    // identical decisions into one row with a ×count.
                    const visible = adaptiveLog.filter(l => ((l.createdAt?.seconds || 0) * 1000) > adaptiveClearedAt)
                    if (visible.length === 0) return (
                      <div style={{padding:'16px',textAlign:'center',background:'rgba(255,255,255,0.02)',borderRadius:10,border:'1px dashed rgba(255,255,255,0.06)',fontSize:11,color:'#666'}}>
                        Timeline cleared — new adaptations will appear here.
                      </div>
                    )
                    const runs = []
                    for (const log of visible) {
                      const last = runs[runs.length - 1]
                      if (last && last.rule === log.rule && last.title === log.title) last.count++
                      else runs.push({ ...log, count: 1 })
                    }
                    return (
                      <div style={{display:'flex',flexDirection:'column',gap:5,maxHeight:200,overflowY:'auto'}}>
                        {runs.map((log) => {
                          const sevColor = log.severity === 'celebrate' ? '#f5c842'
                                         : log.severity === 'positive'  ? '#22c55e'
                                         : log.severity === 'warning'   ? '#e84a2f'
                                         :                                '#42a5f5'
                          const ms = (log.createdAt?.seconds || 0) * 1000
                          return (
                            <div key={log.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',background:'rgba(255,255,255,0.02)',borderRadius:8,borderLeft:`2px solid ${sevColor}`}}>
                              <span style={{width:7,height:7,borderRadius:'50%',background:sevColor,flexShrink:0,boxShadow:`0 0 6px ${sevColor}`}}/>
                              <span style={{flex:1,fontSize:11,color:'#c9c5c1',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{log.title}</span>
                              {log.count > 1 && <span style={{fontSize:9,fontWeight:800,color:sevColor,flexShrink:0}}>×{log.count}</span>}
                              <span style={{fontSize:9,color:'#666',flexShrink:0}}>{relTime(ms)}</span>
                            </div>
                          )
                        })}
                      </div>
                    )
                  })()}
                </div>
              )}

              {/* Footer note for academic defense */}
              <div style={{padding:'12px 14px',background:'rgba(192,132,252,0.06)',border:'1px solid rgba(192,132,252,0.2)',borderRadius:10,fontSize:10,color:'#9d8ec0',lineHeight:1.6}}>
                <strong style={{color:'#c084fc'}}>How it works:</strong> The engine evaluates your performance against 7 explicit rules every session. Every decision is logged with the data that triggered it — making the system explainable, auditable, and academically defensible.
              </div>
            </div>
          </div>
        </div>
      )}

      <div style={{position:'relative',zIndex:1,maxWidth:1500,margin:'0 auto',padding:isMobile?'14px 12px 40px':'24px 40px 60px',display:'flex',flexDirection:'column',gap:isMobile?12:16,fontFamily:'Montserrat,sans-serif'}}>

        {/* ════════════════════════════════════════════════════ */}
        {/*  MEMBERSHIP BANNER — shown for members only when     */}
        {/*  state needs attention (trial, expiring, expired,    */}
        {/*  paused, none). Active members with >7 days see      */}
        {/*  nothing — banner stays out of their way.            */}
        {/* ════════════════════════════════════════════════════ */}
        {isMember && (() => {
          const state = membershipState
          const days = daysLeft
          const isExpiringSoon = (state === STATUS.ACTIVE || state === STATUS.TRIAL) && days !== null && days >= 0 && days <= 7

          // No banner for active members with plenty of time, or legacy users
          if ((state === STATUS.ACTIVE && !isExpiringSoon) || state === STATUS.LEGACY) return null

          // Banner config per state
          let cfg
          if (state === STATUS.EXPIRED) {
            cfg = { color:'#e84a2f', bg:'rgba(232,74,47,0.08)', border:'rgba(232,74,47,0.35)', icon:'🔒', title:'Membership expired', body:'Bookings are locked. Speak with the gym admin to renew your plan.', cta:null }
          } else if (state === STATUS.PAUSED) {
            cfg = { color:'#9ca3af', bg:'rgba(156,163,175,0.06)', border:'rgba(156,163,175,0.3)', icon:'⏸', title:'Membership paused', body:'Your expiry timer is frozen. See the admin to resume access.', cta:null }
          } else if (state === STATUS.NONE) {
            cfg = { color:'#888', bg:'rgba(255,255,255,0.03)', border:'rgba(255,255,255,0.1)', icon:'⚪', title:'No active membership', body:'Speak with the gym admin to set up your plan.', cta:null }
          } else if (state === STATUS.TRIAL) {
            cfg = { color:'#42a5f5', bg:'rgba(66,165,245,0.07)', border:'rgba(66,165,245,0.3)', icon:'🎁', title:`Trial · ${days} day${days===1?'':'s'} left`, body:`Your 7-day trial ends ${fmtExpiry(profile.membership)}. Speak with admin to continue after.`, cta:null }
          } else {
            // ACTIVE but expiring soon
            cfg = { color:'#f5c842', bg:'rgba(245,200,66,0.08)', border:'rgba(245,200,66,0.35)', icon:'⚠', title:`Expiring in ${days} day${days===1?'':'s'}`, body:`Membership expires ${fmtExpiry(profile.membership)}. Renew with admin before access is locked.`, cta:null }
          }

          return (
            <div style={{
              ...glass({borderRadius:14}),
              padding:isMobile?'14px 16px':'14px 22px',
              border:`1px solid ${cfg.border}`,
              background:cfg.bg,
              display:'flex',alignItems:isMobile?'flex-start':'center',gap:14,
              flexDirection:isMobile?'column':'row',
              position:'relative',overflow:'hidden',
            }}>
              {/* Accent stripe */}
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:`linear-gradient(180deg,${cfg.color},${cfg.color}66)`}}/>
              <div style={{display:'flex',alignItems:'center',gap:14,flex:1,minWidth:0}}>
                <div style={{width:42,height:42,borderRadius:11,background:`${cfg.color}18`,border:`1.5px solid ${cfg.color}40`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>
                  {cfg.icon}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:'0.05em',color:cfg.color,lineHeight:1.1}}>
                    {cfg.title}
                  </div>
                  <div style={{fontSize:11,color:'#aaa',marginTop:3,lineHeight:1.5}}>
                    {cfg.body}
                  </div>
                </div>
              </div>
            </div>
          )
        })()}

        {/* STREAK */}
        <div style={{...glass({borderRadius:14}),padding:'14px 28px',display:'flex',alignItems:'center',justifyContent:'space-between',border:'1px solid rgba(232,74,47,0.2)'}}>
          <div style={{display:'flex',alignItems:'center',gap:16}}>
            <span style={{fontSize:36}}>{streak > 0 ? '🔥' : '⭕'}</span>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.06em',color:'#f0ece8'}}>
                {streak > 0 ? `${streak} Day Streak!` : 'Complete your first workout to start a streak!'}
              </div>
              <div style={{fontSize:13,color:'#7a7570',marginTop:2}}>
                {streak > 0 ? 'Keep going — train today to maintain your streak.' : 'Check off exercises below to log your first workout.'}
              </div>
            </div>
          </div>
          <button style={s.accentBtn} onClick={() => navigate('/stats')}>View Stats →</button>
        </div>

        {/* HERO ROW */}
        <div style={{...s.heroRow, gridTemplateColumns: isMobile ? '1fr' : '1fr 1.5fr 0.9fr', gap: isMobile ? 12 : 16}}>

          {/* WELCOME CARD */}
          <div style={{...glass(),padding:'22px',display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'flex',alignItems:'center',gap:12}}>
              <div style={s.heroAvatar}>{(profile.name||'A')[0].toUpperCase()}</div>
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,letterSpacing:'0.06em',color:'#7a7570'}}>HIT<span style={{color:'#e84a2f'}}>TRACK</span></div>
                <div style={{fontSize:18,fontWeight:700}}>Welcome, <em style={{color:'#e84a2f',fontStyle:'normal'}}>{profile.name||'Athlete'}!</em></div>
                <div style={{fontSize:11,color:'#555',marginTop:2}}>{date}</div>
              </div>
            </div>
            {/* Profile tags from Program Builder — real data */}
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              {[
                {icon:'🥊',val:profile.stance||'—',    label:'Stance'},
                {icon:'⭐',val:memberLevel, label:'Level'},
                {icon:'🎯',val:profile.goal||'—',       label:'Goal'},
              ].map((b,i) => (
                <div key={i} style={{background:'rgba(245,200,66,0.07)',border:'1px solid rgba(245,200,66,0.15)',borderRadius:8,padding:'6px 10px',flex:1}}>
                  <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase'}}>{b.label}</div>
                  <div style={{fontSize:11,fontWeight:700,color:'#f5c842',marginTop:2}}>{b.icon} {b.val}</div>
                </div>
              ))}
            </div>
            {/* Stats from Firestore */}
            <div style={{display:'flex',background:'rgba(255,255,255,0.03)',borderRadius:12,padding:'10px',border:'1px solid rgba(245,200,66,0.08)'}}>
              {[
                {val:totalWorkouts,       label:'🥊 Workouts',  color:totalWorkouts>0?'#4ade80':'#f5c842'},
                {val:`${completedThisWeek}/7`, label:'📅 This Week', color:'#f5c842'},
                {val:streak,              label:'🔥 Streak',    color:streak>0?'#e84a2f':'#f5c842'},
              ].map((st,i,arr) => (
                <div key={i} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3,borderRight:i<arr.length-1?'1px solid rgba(255,255,255,0.08)':'none'}}>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:st.color}}>{st.val}</span>
                  <span style={{fontSize:9,color:'#555',fontWeight:600,letterSpacing:'0.06em',textTransform:'uppercase'}}>{st.label}</span>
                </div>
              ))}
            </div>
            {/* Workout milestones — gamification only (a badge every 25 workouts).
                NOT the skill level; the canonical level is the "Skill Level" pill below. */}
            <div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                <span style={{fontSize:10,fontWeight:700,color:'#7a7570',textTransform:'uppercase',letterSpacing:'0.08em'}}>🏅 Workout Milestones</span>
                <span style={{fontSize:10,fontWeight:700,color:'#f5c842'}}>{toNext} to next badge</span>
              </div>
              <div style={{height:8,background:'#2a2424',borderRadius:50,overflow:'hidden'}}>
                <div style={{height:'100%',background:'linear-gradient(90deg,#e84a2f,#f5c842)',borderRadius:50,width:`${levelPct}%`,transition:'width 0.6s ease'}}/>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginTop:5}}>
                <span style={{fontSize:9,fontWeight:700,color:'#555'}}>{milestoneFloor}</span>
                <span style={{fontSize:9,fontWeight:700,color:'#f5c842'}}>{totalWorkouts} workouts</span>
                <span style={{fontSize:9,fontWeight:700,color:'#555'}}>🏅 {nextBadgeAt}</span>
              </div>
            </div>
            <div style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',borderRadius:50,padding:'10px',textAlign:'center',boxShadow:'0 4px 20px rgba(232,74,47,0.3)'}}>
              <div style={{fontSize:9,fontWeight:600,letterSpacing:'0.12em',color:'rgba(255,255,255,0.65)',textTransform:'uppercase',marginBottom:2}}>Skill Level</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#fff'}}>{memberLevel.toUpperCase()}</div>
            </div>
          </div>

          {/* TODAY'S WORKOUT */}
          <div style={{...glass(),padding:'22px 24px',display:'flex',flexDirection:'column',gap:12,position:'relative'}}>

            {/* ════════════════════════════════════════════════ */}
            {/*  MEMBERSHIP LOCK OVERLAY                          */}
            {/*  Member can SEE today's workout but can't mark    */}
            {/*  exercises complete. Read-only preview mode.      */}
            {/* ════════════════════════════════════════════════ */}
            {membershipBlocked && (
              <div style={{position:'absolute',top:14,right:18,zIndex:5,display:'flex',alignItems:'center',gap:8,padding:'8px 14px',background:'linear-gradient(135deg,rgba(232,74,47,0.18),rgba(232,74,47,0.06))',border:'1px solid rgba(232,74,47,0.45)',borderRadius:50,backdropFilter:'blur(8px)',boxShadow:'0 4px 14px rgba(232,74,47,0.25)'}}>
                <span style={{fontSize:14}}>🔒</span>
                <span style={{fontSize:10,fontWeight:800,letterSpacing:'0.08em',color:'#e84a2f',textTransform:'uppercase'}}>
                  Read-only · Renew to track
                </span>
              </div>
            )}

            {/* ════════════════════════════════════════════════ */}
            {/*  🧠 ADAPTIVE COACH widget (Issue 3 — Step 3)    */}
            {/*  Visible proof that the rule-based AI is active. */}
            {/* ════════════════════════════════════════════════ */}
            <div style={{position:'relative',overflow:'hidden',borderRadius:14,
              background:'linear-gradient(135deg,rgba(192,132,252,0.10),rgba(66,165,245,0.06) 60%,rgba(20,15,15,0.4))',
              border:'1px solid rgba(192,132,252,0.25)',
              padding:'14px 16px',display:'flex',flexDirection:'column',gap:10,
              boxShadow:'0 8px 24px rgba(0,0,0,0.3),inset 0 1px 0 rgba(192,132,252,0.15)'}}>
              {/* Left accent stripe */}
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:'linear-gradient(180deg,#c084fc,#42a5f5)'}}/>

              {/* Header */}
              <div style={{display:'flex',alignItems:'center',gap:10,paddingLeft:6}}>
                <div style={{width:32,height:32,borderRadius:9,background:'linear-gradient(135deg,#c084fc,#7b1fa2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,boxShadow:'0 4px 12px rgba(192,132,252,0.4)'}}>🧠</div>
                <div style={{flex:1}}>
                  <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap'}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,letterSpacing:'0.06em',color:'#f0ece8'}}>ADAPTIVE COACH</div>
                    <div style={{display:'flex',alignItems:'center',gap:5,fontSize:9,fontWeight:800,color:'#22c55e',letterSpacing:'0.08em'}}>
                      <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#22c55e',animation:'pulseDot 1.6s ease-in-out infinite'}}/>
                      ACTIVE
                    </div>
                  </div>
                  <div style={{fontSize:9,color:'#9d8ec0',letterSpacing:'0.08em',fontWeight:600,marginTop:1}}>Rule-based · {adaptiveDecisions.length} {adaptiveDecisions.length===1?'decision':'decisions'} this session</div>
                </div>
                <div style={{textAlign:'right',padding:'4px 10px',borderRadius:8,background:'rgba(0,0,0,0.25)',border:'1px solid rgba(192,132,252,0.2)'}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#c084fc',lineHeight:1}}>{adaptiveDifficulty}</div>
                  <div style={{fontSize:7,color:'#9d8ec0',letterSpacing:'0.12em',fontWeight:700}}>DIFFICULTY</div>
                </div>
              </div>

              {/* Decisions list (or empty state) */}
              {adaptiveDecisions.length === 0 ? (
                <div style={{paddingLeft:6,fontSize:11,color:'#9d8ec0',fontStyle:'italic'}}>
                  Engine analyzing your habits — keep training to unlock insights.
                </div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:6,paddingLeft:6}}>
                  {adaptiveDecisions.slice(0, 3).map((d, i) => {
                    const sevColor = d.severity === 'celebrate' ? '#f5c842'
                                   : d.severity === 'positive'  ? '#22c55e'
                                   : d.severity === 'warning'   ? '#e84a2f'
                                   :                              '#42a5f5'
                    return (
                      <div key={i} style={{display:'flex',alignItems:'flex-start',gap:8,padding:'7px 10px',background:`${sevColor}10`,border:`1px solid ${sevColor}25`,borderRadius:9}}>
                        <div style={{width:5,height:5,borderRadius:'50%',background:sevColor,marginTop:7,flexShrink:0,boxShadow:`0 0 8px ${sevColor}`}}/>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontSize:11,fontWeight:700,color:sevColor,letterSpacing:'0.02em'}}>{d.title}</div>
                          <div style={{fontSize:10,color:'#a8a29e',lineHeight:1.5,marginTop:2}}>{d.message}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Why these decisions? */}
              <button onClick={() => setAdaptiveOpen(true)}
                style={{alignSelf:'flex-start',marginLeft:6,background:'transparent',border:'1px solid rgba(192,132,252,0.35)',borderRadius:50,padding:'6px 14px',fontSize:10,fontWeight:700,color:'#c084fc',cursor:'pointer',letterSpacing:'0.05em',transition:'all 0.2s'}}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(192,132,252,0.1)';e.currentTarget.style.transform='translateX(2px)'}}
                onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.transform='translateX(0)'}}>
                Why these decisions? →
              </button>
            </div>

            {/* 28-day strip */}
            <div style={{overflowX:'auto',paddingBottom:4}}>
              <div style={{display:'flex',gap:0,minWidth:'max-content'}}>
                {schedule.map((d,i) => {
                  const ch   = dayChecked[i] || []
                  const hasGen = !!generatedWorkouts[i]
                  const isActive = d.isWorkout || hasGen
                  const done = isActive && ch.length > 0 && ch.every(Boolean)
                  const part = isActive && ch.some(Boolean) && !done
                  const weekStart = i % 7 === 0 && i > 0
                  return (
                    <div key={i} style={{display:'flex',alignItems:'stretch'}}>
                      {weekStart && <div style={{width:1,background:'rgba(245,200,66,0.15)',margin:'0 5px',flexShrink:0}}/>}
                      <div onClick={() => setSelDay(i)}
                        style={{minWidth:40,textAlign:'center',padding:'7px 3px',borderRadius:11,cursor:'pointer',flexShrink:0,marginRight:3,
                          border:`1.5px solid ${i===selDay?'#f5c842':done?'rgba(74,222,128,0.4)':part?'rgba(232,74,47,0.35)':isActive?'rgba(232,74,47,0.2)':'rgba(255,255,255,0.05)'}`,
                          background:i===selDay?'rgba(245,200,66,0.1)':d.isToday?'rgba(232,74,47,0.06)':done?'rgba(74,222,128,0.04)':'rgba(255,255,255,0.02)',
                          boxShadow:i===selDay?'0 0 10px rgba(245,200,66,0.2)':'none',
                          transition:'all 0.15s'}}
                      >
                        <div style={{fontSize:9,fontWeight:700,color:i===selDay?'#f5c842':d.isToday?'#e84a2f':done?'#4ade80':isActive?'#b0ada8':'#444'}}>{d.dayName.slice(0,2).toUpperCase()}</div>
                        <div style={{fontSize:12,fontWeight:700,color:i===selDay?'#f5c842':d.isToday?'#f0ece8':done?'#4ade80':isActive?'#f0ece8':'#333',marginTop:1}}>{d.date.getDate()}</div>
                        <div style={{width:5,height:5,borderRadius:'50%',margin:'3px auto 0',background:done?'#4ade80':part?'#e84a2f':isActive?'rgba(232,74,47,0.4)':'transparent'}}/>
                      </div>
                    </div>
                  )
                })}
              </div>
              {/* Week dots */}
              <div style={{display:'flex',justifyContent:'center',gap:4,marginTop:5}}>
                {[0,1,2,3].map(w => (
                  <div key={w} style={{height:3,borderRadius:50,transition:'all 0.3s',width:Math.floor(selDay/7)===w?24:8,background:Math.floor(selDay/7)===w?'#f5c842':'rgba(255,255,255,0.1)'}}/>
                ))}
              </div>
            </div>

            {/* ── TRAINING ACTIVITY — last 14 days (Item 3: spot missed days) ──
                Real, dated history from the unified trainingSessions log. A day
                is "trained" if a session (web OR mobile) exists for it; gaps are
                days with no session. */}
            {(() => {
              const set = new Set(trainedDates)
              const days = []
              for (let i = 13; i >= 0; i--) {
                const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - i)
                const ds = ymdLocal(d)
                days.push({ d, ds, trained: set.has(ds), isToday: i === 0 })
              }
              const trainedCount = days.filter(x => x.trained).length
              return (
                <div style={{marginTop:2}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:6}}>
                    <span style={{fontSize:10,fontWeight:700,color:'#7a7570',textTransform:'uppercase',letterSpacing:'0.08em'}}>📆 Last 14 Days</span>
                    <span style={{fontSize:10,fontWeight:700,color:trainedCount>0?'#4ade80':'#7a7570'}}>{trainedCount} trained</span>
                  </div>
                  <div style={{display:'flex',gap:3}}>
                    {days.map((x,i) => (
                      <div key={i} title={`${x.ds}${x.trained?' · trained':' · no session'}`} style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:3}}>
                        <div style={{width:'100%',height:22,borderRadius:5,background:x.trained?'rgba(74,222,128,0.22)':'rgba(255,255,255,0.035)',border:`1px solid ${x.isToday?'#f5c842':x.trained?'rgba(74,222,128,0.5)':'rgba(255,255,255,0.06)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,color:'#4ade80'}}>
                          {x.trained?'✓':''}
                        </div>
                        <span style={{fontSize:7,color:x.isToday?'#f5c842':'#555',fontWeight:700}}>{x.d.getDate()}</span>
                      </div>
                    ))}
                  </div>
                  <div style={{fontSize:9,color:'#555',marginTop:5,fontStyle:'italic'}}>Green = you trained (web or mobile). Gaps are days with no session.</div>
                </div>
              )
            })()}

            {/* Back / Next */}
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <button style={{...s.ghostBtn,padding:'5px 12px',fontSize:11,opacity:selDay===0?0.3:1}} onClick={() => setSelDay(i => Math.max(0,i-1))} disabled={selDay===0}>← Back</button>
              <div style={{textAlign:'center'}}>
                <div style={{fontSize:10,fontWeight:700,color:selDayData?.isToday?'#e84a2f':'#f5c842',letterSpacing:'0.08em'}}>{selDayData?.isToday?'TODAY':`DAY +${selDay}`}</div>
                <div style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{selDayData?.dayName}, {selDayData?.dateStr}</div>
              </div>
              <button style={{...s.ghostBtn,padding:'5px 12px',fontSize:11,opacity:selDay===27?0.3:1}} onClick={() => setSelDay(i => Math.min(27,i+1))} disabled={selDay===27}>Next →</button>
            </div>

            {workout ? (
              <>
                {/* ════════════════════════════════════════════════ */}
                {/*  WORKOUT HEADER — Smart Title + Rich Metadata    */}
                {/* ════════════════════════════════════════════════ */}
                <div style={{position:'relative',overflow:'hidden',padding:'4px 0 6px'}}>
                  <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:8,flexWrap:'wrap'}}>
                    <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:workout.type==='generated'?'#c084fc':'#e84a2f',background:workout.type==='generated'?'rgba(192,132,252,0.12)':'rgba(232,74,47,0.12)',padding:'3px 9px',borderRadius:50,border:`1px solid ${workout.type==='generated'?'rgba(192,132,252,0.25)':'rgba(232,74,47,0.25)'}`}}>
                      {workout.type==='generated'?'🎲 RANDOM':'🥊 WORKOUT'}
                    </div>
                    {workout.goal && (
                      <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:'#f5c842',background:'rgba(245,200,66,0.12)',padding:'3px 9px',borderRadius:50,border:'1px solid rgba(245,200,66,0.25)'}}>
                        🎯 {workout.goal.toUpperCase()}
                      </div>
                    )}
                    {workout.difficulty && (
                      <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.12em',color:'#42a5f5',background:'rgba(66,165,245,0.12)',padding:'3px 9px',borderRadius:50,border:'1px solid rgba(66,165,245,0.25)'}}>
                        ⚡ {workout.difficulty.toUpperCase()}
                      </div>
                    )}
                  </div>
                  {/* Smart auto-title (POWER DAY / CARDIO BURN / etc.) */}
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:'0.05em',color:'#f0ece8',lineHeight:1,textShadow:'0 0 18px rgba(232,74,47,0.4)',marginBottom:6}}>
                    {workout.title}
                  </div>
                  {/* Subtitle: date · duration · calories · session focus */}
                  <div style={{display:'flex',alignItems:'center',gap:8,fontSize:10,color:'#888',flexWrap:'wrap'}}>
                    <span style={{fontWeight:700,color:'#aaa'}}>{selDayData?.dayName}, {selDayData?.dateStr}</span>
                    <span style={{color:'#444'}}>·</span>
                    <span style={{color:'#f5c842',fontWeight:700}}>⏱ {workout.duration}</span>
                    {workout.totalCalories>0 && (<>
                      <span style={{color:'#444'}}>·</span>
                      <span style={{color:'#e84a2f',fontWeight:700}}>🔥 ~{workout.totalCalories} cal</span>
                    </>)}
                    {workout.subtitle && (<>
                      <span style={{color:'#444'}}>·</span>
                      <span style={{color:'#888',fontStyle:'italic'}}>{workout.subtitle}</span>
                    </>)}
                  </div>
                </div>
                {/* 🔒 LOCKED DAY BANNER (Issue 3 — Step 1) */}
                {selDay > 0 && (
                  <div style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',borderRadius:12,background:'linear-gradient(135deg,rgba(120,113,108,0.1),rgba(80,75,70,0.06))',border:'1px solid rgba(120,113,108,0.25)'}}>
                    <div style={{fontSize:24}}>🔒</div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:11,fontWeight:800,color:'#a8a29e',letterSpacing:'0.08em',textTransform:'uppercase'}}>Locked · Unlocks {selDayData?.dateStr}</div>
                      <div style={{fontSize:10,color:'#78716c',marginTop:2}}>Future workouts can't be checked early — come back on the scheduled day. The Adaptive Coach watches for missed days.</div>
                    </div>
                  </div>
                )}
                <div>
                  <div style={{height:5,background:'#2a2424',borderRadius:50,overflow:'hidden',marginBottom:4}}>
                    <div style={{height:'100%',borderRadius:50,background:workoutDone?'linear-gradient(90deg,#4ade80,#22c55e)':'linear-gradient(90deg,#e84a2f,#f5c842)',width:`${allExercises.length>0?(completedCount/allExercises.length)*100:0}%`,transition:'width 0.4s ease'}}/>
                  </div>
                  <div style={{fontSize:10,color:workoutDone?'#4ade80':'#7a7570',fontWeight:600}}>{workoutDone?'✅ Workout Complete!':selDay>0?`${allExercises.length} exercises planned`:`${completedCount}/${allExercises.length} done`}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8,flex:1}}>
                  {allExercises.map((ex,i) => {
                    const isLocked = selDay > 0
                    const isRich = isRichExercise(ex)
                    const exName = exerciseName(ex)
                    const isExtra = extraExercises.includes(ex)
                    const isMemberLocked = membershipBlocked
                    // Sequential lock: exercise is locked if any previous exercise is not done
                    const isSeqLocked = selDay === 0 && !isLocked && !isMemberLocked && i > 0 && checked.slice(0, i).some(c => !c)
                    const effectiveLocked = isLocked || isMemberLocked || isSeqLocked
                    // Type color mapping (for rich exercises)
                    const TYPE_COLOR = {
                      warmup:       '#fb923c', // orange — warmup
                      striking:     '#e84a2f', // red — main striking
                      technique:    '#42a5f5', // blue — technique
                      conditioning: '#22c55e', // green — cardio
                      strength:     '#c084fc', // purple — strength
                      recovery:     '#78716c', // gray — recovery
                    }
                    const typeColor = isRich ? (TYPE_COLOR[ex.type] || '#888') : '#42a5f5'
                    return (
                    <div key={i} onClick={() => effectiveLocked ? null : toggleEx(selDay,i)}
                      style={{display:'flex',gap:11,padding:isRich?'12px 13px':'10px 12px',borderRadius:11,cursor:effectiveLocked?'not-allowed':'pointer',
                        background:effectiveLocked?'rgba(255,255,255,0.015)':checked[i]?'rgba(74,222,128,0.05)':isExtra?'rgba(66,165,245,0.04)':'rgba(255,255,255,0.02)',
                        border:`1px solid ${effectiveLocked?'rgba(255,255,255,0.04)':checked[i]?'rgba(74,222,128,0.18)':isExtra?'rgba(66,165,245,0.15)':isRich?typeColor+'18':'rgba(255,255,255,0.04)'}`,
                        opacity:effectiveLocked?0.55:1,
                        transition:'all 0.25s',
                        position:'relative',
                        overflow:'hidden'}}>
                      {/* Left checkmark/index circle */}
                      <div style={{width:28,height:28,borderRadius:'50%',background:isSeqLocked?'#1e1818':isLocked?'#1a1818':checked[i]?'#4ade80':isRich?typeColor+'20':'#2a2424',border:isSeqLocked?'2px dashed rgba(245,200,66,0.3)':isLocked?'2px dashed #555':checked[i]?'none':isRich?`2px solid ${typeColor}55`:'2px solid #444',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:isSeqLocked?'#f5c842':isLocked?'#666':checked[i]?'#fff':isRich?typeColor:'#555',flexShrink:0,transform:checked[i]&&!effectiveLocked?'scale(1.1)':'scale(1)',transition:'all 0.25s',marginTop:2}}>
                        {isSeqLocked?'🔒':isLocked?'🔒':checked[i]?'✓':i+1}
                      </div>
                      {/* Body */}
                      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',gap:isRich?5:0}}>
                        {/* Name row */}
                        <div style={{display:'flex',alignItems:'center',gap:7,flexWrap:'wrap'}}>
                          <span style={{fontSize:13,fontWeight:isRich?700:500,color:isLocked?'#666':checked[i]?'#7a7570':'#f0ece8',textDecoration:checked[i]&&!isLocked?'line-through':'none',transition:'all 0.25s',letterSpacing:isRich?'0.01em':0}}>{exName}</span>
                          {isRich && !checked[i] && !isLocked && (
                            <span style={{fontSize:7,fontWeight:800,padding:'2px 7px',borderRadius:50,background:typeColor+'18',color:typeColor,border:`1px solid ${typeColor}30`,letterSpacing:'0.1em',textTransform:'uppercase'}}>{ex.type}</span>
                          )}
                          {isExtra&&!checked[i]&&!isLocked&&<span style={{fontSize:9,background:'rgba(66,165,245,0.15)',color:'#42a5f5',border:'1px solid rgba(66,165,245,0.25)',borderRadius:50,padding:'2px 6px',fontWeight:700}}>BOOKED</span>}
                        </div>
                        {/* Rich metadata — only for rich exercises */}
                        {isRich && !checked[i] && !isLocked && (
                          <>
                            {/* Stats line */}
                            <div style={{display:'flex',alignItems:'center',gap:8,flexWrap:'wrap',fontSize:10,color:'#888'}}>
                              {ex.rounds > 1 && (<>
                                <span style={{color:typeColor,fontWeight:700}}>{ex.rounds} rounds × {fmtDuration(ex.duration_per_round)}</span>
                              </>)}
                              {ex.rounds === 1 && (
                                <span style={{color:typeColor,fontWeight:700}}>{fmtDuration(ex.duration_per_round)}</span>
                              )}
                              {ex.rest_seconds > 0 && ex.rounds > 1 && (<>
                                <span style={{color:'#444'}}>·</span>
                                <span><span style={{color:'#666'}}>rest</span> <span style={{color:'#aaa',fontWeight:600}}>{fmtDuration(ex.rest_seconds)}</span></span>
                              </>)}
                              {ex.est_calories > 0 && (<>
                                <span style={{color:'#444'}}>·</span>
                                <span style={{color:'#e84a2f',fontWeight:600}}>🔥 ~{ex.est_calories} cal</span>
                              </>)}
                            </div>
                            {/* Focus line */}
                            {ex.focus && (
                              <div style={{fontSize:10,color:'#999',lineHeight:1.5,fontStyle:'italic'}}>
                                <span style={{color:typeColor,fontWeight:700,fontStyle:'normal'}}>Focus:</span> {ex.focus}
                              </div>
                            )}
                            {/* Cues */}
                            {ex.cues && ex.cues.length > 0 && (
                              <div style={{display:'flex',flexDirection:'column',gap:2,marginTop:1}}>
                                {ex.cues.map((cue, ci) => (
                                  <div key={ci} style={{fontSize:9,color:'#888',display:'flex',gap:5,alignItems:'flex-start',lineHeight:1.5}}>
                                    <span style={{color:typeColor,fontWeight:700,flexShrink:0}}>▸</span>
                                    <span>{cue}</span>
                                  </div>
                                ))}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                      {/* Status text */}
                      <div style={{fontSize:10,color:isSeqLocked?'#f5c84288':isLocked?'#444':checked[i]?'#4ade80':'#555',fontWeight:600,flexShrink:0,marginTop:2}}>{isSeqLocked?'finish prev':isLocked?'locked':checked[i]?'done':'tap'}</div>
                    </div>
                    )
                  })}
                </div>
                {selDay === 0 && (
                  <button style={{...s.accentBtn,background:workoutDone?'linear-gradient(135deg,#4ade80,#22c55e)':'linear-gradient(135deg,#e84a2f,#c93820)',boxShadow:workoutDone?'0 4px 16px rgba(74,222,128,0.35)':'0 4px 16px rgba(232,74,47,0.35)'}}>
                    {workoutDone?'🎉 Workout Complete!':'Continue Training →'}
                  </button>
                )}
              </>
            ) : (
              <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,padding:'16px 0'}}>
                <div style={{fontSize:44}}>😴</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#f0ece8'}}>Rest Day</div>
                <div style={{fontSize:12,color:'#555',textAlign:'center',lineHeight:1.7,maxWidth:240}}>Recovery is essential. Your body rebuilds stronger on rest days.</div>
                <div style={{width:'100%',background:'rgba(192,132,252,0.06)',border:'1px solid rgba(192,132,252,0.15)',borderRadius:14,padding:'14px',textAlign:'center'}}>
                  <div style={{fontSize:12,color:'#c084fc',fontWeight:700,marginBottom:6}}>🎲 Feeling Motivated?</div>
                  <div style={{fontSize:11,color:'#7a7570',marginBottom:10,lineHeight:1.6}}>Generate an adaptive workout based on your {profile.experience||'Beginner'} level and {profile.goal||'Learn Boxing'} goal!</div>
                  <button style={{background:'linear-gradient(135deg,#7b1fa2,#c084fc)',color:'#fff',border:'none',borderRadius:50,padding:'10px 24px',fontSize:12,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 14px rgba(192,132,252,0.4)',transition:'all 0.2s'}}
                    onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(192,132,252,0.5)'}}
                    onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='0 4px 14px rgba(192,132,252,0.4)'}}
                    onClick={() => generateRandom(selDay)}>
                    Generate Workout 🎲
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ════════════════════════════════════════════════ */}
          {/*  🏅 BADGES — Cinematic Trophy Showcase           */}
          {/* ════════════════════════════════════════════════ */}
          {(() => {
            const earnedBadges = MILESTONE_BADGES.filter(m => totalWorkouts >= m)
            const earnedCount = earnedBadges.length
            const latestEarned = earnedBadges[earnedBadges.length-1]
            const nextMilestone = MILESTONE_BADGES.find(m => totalWorkouts < m) || MILESTONE_BADGES[MILESTONE_BADGES.length-1]
            const prevMilestone = MILESTONE_BADGES[MILESTONE_BADGES.indexOf(nextMilestone) - 1] || 0
            const range = nextMilestone - prevMilestone
            const progress = totalWorkouts - prevMilestone
            const pct = range > 0 ? Math.min((progress/range)*100, 100) : 100
            const featuredVal = latestEarned || nextMilestone
            const featuredEarned = !!latestEarned
            // Tier system based on total workouts — gives the widget identity
            const TIER_TABLE = [
              {min:0,   max:9,   name:'ROOKIE',     color:'#888888', icon:'🥊'},
              {min:10,  max:19,  name:'CONTENDER',  color:'#fb923c', icon:'🥊'},
              {min:20,  max:29,  name:'PROSPECT',   color:'#22c55e', icon:'⚡'},
              {min:30,  max:39,  name:'WARRIOR',    color:'#42a5f5', icon:'🔥'},
              {min:40,  max:49,  name:'CHAMPION',   color:'#c084fc', icon:'🏆'},
              {min:50,  max:99,  name:'LEGEND',     color:'#f5c842', icon:'👑'},
              {min:100, max:Infinity, name:'IMMORTAL', color:'#e84a2f', icon:'💎'},
            ]
            const tier = TIER_TABLE.find(t => totalWorkouts >= t.min && totalWorkouts <= t.max) || TIER_TABLE[0]
            // Per-milestone tier color (each badge gets its own glow color)
            const MILESTONE_COLOR = {
              10:'#fb923c', 20:'#22c55e', 30:'#42a5f5',
              40:'#c084fc', 50:'#f5c842', 60:'#e84a2f',
            }
            return (
              <div style={{position:'relative',overflow:'hidden',borderRadius:20,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:`1.5px solid ${tier.color}30`,padding:'20px 22px',display:'flex',flexDirection:'column',gap:14,boxShadow:`0 12px 40px rgba(0,0,0,0.5),0 0 30px ${tier.color}15`}}>
                {/* Animated radial glow background */}
                <div style={{position:'absolute',top:-60,right:-60,width:240,height:240,borderRadius:'50%',background:`radial-gradient(circle,${tier.color}20,transparent 65%)`,pointerEvents:'none',animation:'badgeGlowPulse 3.5s ease-in-out infinite'}}/>
                <div style={{position:'absolute',bottom:-80,left:-80,width:200,height:200,borderRadius:'50%',background:`radial-gradient(circle,${tier.color}15,transparent 70%)`,pointerEvents:'none',opacity:0.6}}/>
                {/* Left accent stripe */}
                <div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:`linear-gradient(180deg,${tier.color},${tier.color}66)`}}/>

                {/* Header — TIER PILL + CTA */}
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',position:'relative',zIndex:1,gap:8}}>
                  <div style={{display:'flex',alignItems:'center',gap:7,padding:'4px 10px',borderRadius:50,background:`${tier.color}15`,border:`1px solid ${tier.color}40`,boxShadow:`0 0 12px ${tier.color}30`}}>
                    <span style={{fontSize:13}}>{tier.icon}</span>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:11,letterSpacing:'0.12em',color:tier.color,textShadow:`0 0 8px ${tier.color}88`}}>{tier.name}</span>
                  </div>
                  <button style={{background:'transparent',color:'#888',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'4px 10px',fontSize:9,fontWeight:800,cursor:'pointer',letterSpacing:'0.05em',transition:'all 0.2s',whiteSpace:'nowrap'}}
                    onClick={() => navigate('/achievements')}
                    onMouseEnter={e=>{e.currentTarget.style.color=tier.color;e.currentTarget.style.borderColor=tier.color+'55';e.currentTarget.style.transform='translateX(2px)'}}
                    onMouseLeave={e=>{e.currentTarget.style.color='#888';e.currentTarget.style.borderColor='rgba(255,255,255,0.1)';e.currentTarget.style.transform='translateX(0)'}}>
                    HALL →
                  </button>
                </div>

                {/* FEATURED TROPHY — big icon with glow burst */}
                <div style={{display:'flex',alignItems:'center',gap:14,position:'relative',zIndex:1}}>
                  <div style={{position:'relative',flexShrink:0}}>
                    {featuredEarned && (
                      <div style={{position:'absolute',inset:-8,borderRadius:'50%',background:`radial-gradient(circle,${MILESTONE_COLOR[featuredVal]},transparent 70%)`,opacity:0.5,animation:'pulseTrophy 2.5s ease-in-out infinite',pointerEvents:'none'}}/>
                    )}
                    <div style={{position:'relative',width:60,height:60,borderRadius:16,background:featuredEarned?`linear-gradient(135deg,${MILESTONE_COLOR[featuredVal]},${MILESTONE_COLOR[featuredVal]}88)`:'rgba(40,35,32,0.7)',border:`2px solid ${featuredEarned?MILESTONE_COLOR[featuredVal]:'rgba(255,255,255,0.08)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:28,boxShadow:featuredEarned?`0 6px 18px ${MILESTONE_COLOR[featuredVal]}55,inset 0 2px 6px rgba(255,255,255,0.2)`:'none',filter:featuredEarned?'none':'grayscale(0.7) brightness(0.55)'}}>
                      🏅
                      {!featuredEarned && (
                        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.45)',borderRadius:16}}>
                          <span style={{fontSize:18}}>🔒</span>
                        </div>
                      )}
                    </div>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:8,color:featuredEarned?MILESTONE_COLOR[featuredVal]:'#666',letterSpacing:'0.14em',fontWeight:800,textTransform:'uppercase',marginBottom:3}}>
                      {featuredEarned?'✓ Latest Earned':'🎯 Next Target'}
                    </div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:featuredEarned?MILESTONE_COLOR[featuredVal]:'#aaa',letterSpacing:'0.04em',lineHeight:1.1,textShadow:featuredEarned?`0 0 12px ${MILESTONE_COLOR[featuredVal]}66`:'none'}}>
                      {featuredVal} WORKOUT BADGE
                    </div>
                    <div style={{fontSize:9,color:'#777',marginTop:3,letterSpacing:'0.04em'}}>
                      {earnedCount} of {MILESTONE_BADGES.length} unlocked
                    </div>
                  </div>
                </div>

                {/* Progress to next */}
                <div style={{position:'relative',zIndex:1}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:5}}>
                    <span style={{fontSize:8,color:'#666',fontWeight:800,letterSpacing:'0.12em',textTransform:'uppercase'}}>
                      {pct>=100 && totalWorkouts>=60?'All earned!':`To ${nextMilestone}`}
                    </span>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color:tier.color}}>
                      {totalWorkouts}<span style={{color:'#444',fontSize:10}}>/{nextMilestone}</span>
                    </span>
                  </div>
                  <div style={{position:'relative',height:7,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden',border:'1px solid rgba(255,255,255,0.05)'}}>
                    <div style={{height:'100%',background:`linear-gradient(90deg,${tier.color},${tier.color}cc)`,borderRadius:50,width:`${pct}%`,transition:'width 0.8s ease',boxShadow:`0 0 10px ${tier.color}aa`}}/>
                    {pct > 0 && pct < 100 && (
                      <div style={{position:'absolute',top:0,bottom:0,width:30,background:'linear-gradient(90deg,transparent,rgba(255,255,255,0.3),transparent)',animation:'shine 2.5s ease-in-out infinite',left:`calc(${pct}% - 30px)`}}/>
                    )}
                  </div>
                </div>

                {/* TROPHY LADDER — 6 tier-colored milestones */}
                <div style={{display:'flex',gap:5,alignItems:'center',justifyContent:'space-between',position:'relative',zIndex:1}}>
                  {MILESTONE_BADGES.slice(0,6).map((m,i) => {
                    const earned = totalWorkouts >= m
                    const c = MILESTONE_COLOR[m] || '#888'
                    const isNext = !earned && m === nextMilestone
                    return (
                      <div key={i} title={`${m} workouts${earned?' — earned':isNext?' — next!':''}`}
                        style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',gap:4,cursor:'default',transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)'}}
                        onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-3px) scale(1.08)'}}
                        onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)'}}>
                        <div style={{position:'relative'}}>
                          {earned && (
                            <div style={{position:'absolute',inset:-4,borderRadius:'50%',background:`radial-gradient(circle,${c}55,transparent 70%)`,pointerEvents:'none'}}/>
                          )}
                          <div style={{position:'relative',width:30,height:30,borderRadius:'50%',background:earned?`linear-gradient(135deg,${c},${c}aa)`:isNext?'rgba(245,200,66,0.08)':'rgba(255,255,255,0.04)',border:`2px solid ${earned?c:isNext?'rgba(245,200,66,0.4)':'rgba(255,255,255,0.08)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,color:earned?'#0a0808':isNext?'#f5c842':'#444',fontWeight:800,boxShadow:earned?`0 0 12px ${c}88,inset 0 1px 4px rgba(255,255,255,0.2)`:isNext?'0 0 8px rgba(245,200,66,0.3)':'none',animation:isNext?'pulseTrophy 2s ease-in-out infinite':'none'}}>
                            {earned?'✓':isNext?'🎯':m}
                          </div>
                        </div>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:9,color:earned?c:isNext?'#f5c842':'#444',letterSpacing:'0.06em',textShadow:earned?`0 0 6px ${c}66`:'none'}}>{m}</div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )
          })()}
        </div>

        {/* BOTTOM GRID */}
        <div style={s.bottomGrid}>

          {/* ════════════════════════════════════════════════ */}
          {/*  UPCOMING CLASSES — Cinematic boxing fight cards */}
          {/* ════════════════════════════════════════════════ */}
          <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.12)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#f5c842)'}}/>
            <div style={{padding:'14px 18px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'linear-gradient(135deg,rgba(232,74,47,0.06) 0%,transparent 60%)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:'0.06em',color:'#f0ece8'}}>📋 UPCOMING CLASSES</div>
                {classes.length>0&&<span style={{fontSize:8,fontWeight:800,padding:'2px 7px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em'}}>{classes.length}</span>}
              </div>
              {classStatuses.filter(s=>s==='booked').length>0&&(
                <div style={{display:'flex',alignItems:'center',gap:5,fontSize:9,fontWeight:700,color:'#22c55e'}}>
                  <span style={{display:'inline-block',width:5,height:5,borderRadius:'50%',background:'#22c55e',animation:'pulseDot 1.6s ease-in-out infinite'}}/>
                  {classStatuses.filter(s=>s==='booked').length} BOOKED
                </div>
              )}
            </div>
            {loadingClasses ? (
              <div style={{padding:30,textAlign:'center',color:'#555',fontSize:11}}>Loading…</div>
            ) : classes.length === 0 ? (
              <div style={{padding:'30px 20px',textAlign:'center'}}>
                <div style={{fontSize:34,marginBottom:8,opacity:0.4}}>📋</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:'#888',letterSpacing:'0.06em',marginBottom:4}}>NO CLASSES SCHEDULED</div>
                <div style={{fontSize:10,color:'#555'}}>Check back soon — your coach is planning sessions 🥊</div>
              </div>
            ) : (
              <div style={{padding:'10px',display:'flex',flexDirection:'column',gap:8}}>
                {classes.map((c,i) => {
                  const isBooked = classStatuses[i]==='booked'
                  const spotsLeft = c.spots ? c.spots - (c.enrolled||0) : null
                  const lc = LEVEL_COLOR[c.level]||'#f5c842'
                  const dayLabel = getClassDayLabel(c)
                  const dayShort = c.date ? dayLabel : (c.day||'').slice(0,3).toUpperCase()
                  const isTodayCls = isClassToday(c)
                  return (
                    <div key={c.id}
                      style={{position:'relative',display:'flex',alignItems:'center',gap:12,background:isBooked?'linear-gradient(135deg,rgba(34,197,94,0.08),rgba(20,15,14,0.7))':'linear-gradient(135deg,rgba(40,30,28,0.5),rgba(20,15,14,0.7))',borderRadius:14,padding:'12px 14px',border:`1px solid ${isBooked?'rgba(34,197,94,0.3)':'rgba(255,255,255,0.06)'}`,transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',cursor:'default'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform='translateX(3px)';e.currentTarget.style.borderColor=isBooked?'rgba(34,197,94,0.5)':`${lc}55`;e.currentTarget.style.boxShadow=`0 6px 20px ${isBooked?'rgba(34,197,94,0.2)':lc+'22'}`}}
                      onMouseLeave={e=>{e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.borderColor=isBooked?'rgba(34,197,94,0.3)':'rgba(255,255,255,0.06)';e.currentTarget.style.boxShadow='none'}}>
                      {/* Left accent stripe for booked */}
                      {isBooked&&<div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:'linear-gradient(180deg,#22c55e,transparent)',borderRadius:'14px 0 0 14px'}}/>}
                      {/* Day badge */}
                      <div style={{width:48,height:48,borderRadius:11,background:isBooked?'linear-gradient(135deg,#22c55e,#15803d)':`linear-gradient(135deg,${lc},${lc}aa)`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:isBooked?'#fff':'#000',flexShrink:0,boxShadow:isBooked?'0 4px 12px rgba(34,197,94,0.4)':`0 4px 12px ${lc}40`,border:isTodayCls&&!isBooked?'2px solid #4ade80':`2px solid ${isBooked?'rgba(34,197,94,0.5)':lc+'66'}`}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:c.date?10:16,lineHeight:1,textAlign:'center',padding:'0 2px'}}>{dayShort}</div>
                        <div style={{fontSize:7,fontWeight:800,letterSpacing:'0.08em',marginTop:2,opacity:0.85}}>{c.time}</div>
                      </div>
                      {/* Info */}
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:3,flexWrap:'wrap'}}>
                          <span style={{fontSize:13,fontWeight:700,color:isBooked?'#22c55e':'#f0ece8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{c.name}</span>
                          {isBooked&&<span style={{fontSize:7,fontWeight:800,padding:'2px 6px',borderRadius:50,background:'rgba(34,197,94,0.2)',color:'#22c55e',letterSpacing:'0.1em',flexShrink:0}}>BOOKED</span>}
                          {isTodayCls&&!isBooked&&<span style={{fontSize:7,fontWeight:800,padding:'2px 6px',borderRadius:50,background:'rgba(74,222,128,0.12)',color:'#4ade80',border:'1px solid rgba(74,222,128,0.25)',letterSpacing:'0.1em',flexShrink:0}}>TODAY</span>}
                        </div>
                        <div style={{display:'flex',gap:5,fontSize:10,alignItems:'center',flexWrap:'wrap',color:'#888'}}>
                          {c.coach&&<><span style={{color:'#e84a2f',fontWeight:700}}>👨‍🏫 {c.coach}</span><span style={{color:'#444'}}>·</span></>}
                          <span style={{fontSize:9,fontWeight:700,padding:'1px 6px',borderRadius:50,background:`${lc}15`,color:lc,letterSpacing:'0.06em',textTransform:'uppercase'}}>{c.level||'Beginner'}</span>
                          {c.createdBy&&<><span style={{color:'#444'}}>·</span><span style={{fontSize:9,color:c.createdByRole==='admin'?'#c084fc':'#888',fontWeight:600}}>by {c.createdBy}</span></>}
                        </div>
                        {c.description && (
                          <div style={{fontSize:10,color:'#888',lineHeight:1.5,marginTop:4,fontStyle:'italic'}}>📝 {c.description}</div>
                        )}
                        {!isBooked && spotsLeft !== null && spotsLeft <= 3 && spotsLeft > 0 && (
                          <div style={{fontSize:9,color:'#f5c842',fontWeight:700,marginTop:4,letterSpacing:'0.04em'}}>⚠️ Only {spotsLeft} spot{spotsLeft===1?'':'s'} left!</div>
                        )}
                        {!isBooked && spotsLeft === 0 && (
                          <div style={{fontSize:9,color:'#e84a2f',fontWeight:700,marginTop:4,letterSpacing:'0.04em'}}>🚫 Class full</div>
                        )}
                      </div>
                      {/* Action button */}
                      <button onClick={() => handleBook(i)}
                        disabled={!isBooked && (spotsLeft === 0 || membershipBlocked)}
                        title={!isBooked && membershipBlocked ? (membershipState === STATUS.EXPIRED ? 'Renew membership to book' : 'Membership paused') : undefined}
                        style={{
                          background:isBooked?'rgba(34,197,94,0.12)':(membershipBlocked && !isBooked)?'rgba(232,74,47,0.06)':spotsLeft===0?'rgba(255,255,255,0.04)':'linear-gradient(135deg,#e84a2f,#c93820)',
                          color:isBooked?'#22c55e':(membershipBlocked && !isBooked)?'#666':spotsLeft===0?'#444':'#fff',
                          border:isBooked?'1px solid rgba(34,197,94,0.3)':(membershipBlocked && !isBooked)?'1px solid rgba(232,74,47,0.2)':'none',
                          borderRadius:50,padding:'8px 14px',fontSize:10,fontWeight:800,letterSpacing:'0.05em',
                          cursor:(!isBooked && (spotsLeft===0 || membershipBlocked))?'not-allowed':'pointer',
                          whiteSpace:'nowrap',
                          boxShadow:!isBooked && !membershipBlocked && spotsLeft!==0?'0 4px 14px rgba(232,74,47,0.35)':'none',
                          transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',
                          flexShrink:0,
                        }}
                        onMouseEnter={e=>{
                          if(isBooked){e.currentTarget.style.background='rgba(232,74,47,0.15)';e.currentTarget.style.color='#e84a2f';e.currentTarget.style.borderColor='rgba(232,74,47,0.35)';e.currentTarget.style.transform='scale(1.04)'}
                          else if(!membershipBlocked && spotsLeft!==0){e.currentTarget.style.transform='translateY(-2px) scale(1.04)';e.currentTarget.style.boxShadow='0 6px 18px rgba(232,74,47,0.5)'}
                        }}
                        onMouseLeave={e=>{
                          if(isBooked){e.currentTarget.style.background='rgba(34,197,94,0.12)';e.currentTarget.style.color='#22c55e';e.currentTarget.style.borderColor='rgba(34,197,94,0.3)';e.currentTarget.style.transform='scale(1)'}
                          else if(!membershipBlocked && spotsLeft!==0){e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 4px 14px rgba(232,74,47,0.35)'}
                        }}>
                        {isBooked?'✓ BOOKED':(membershipBlocked && !isBooked)?'🔒 LOCKED':spotsLeft===0?'FULL':'🥊 BOOK'}
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* WEEKLY PROGRESS RING removed — data already in hero card stats */}
        </div>

        {/* ════════════════════════════════════════════════ */}
        {/*  COACH FEEDBACK + GYM ANNOUNCEMENTS — side-by-side */}
        {/* ════════════════════════════════════════════════ */}
        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16}}>

          {/* COACH FEEDBACK */}
          <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(232,74,47,0.15)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#c93820)'}}/>
            <div style={{padding:'14px 18px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'linear-gradient(135deg,rgba(232,74,47,0.06) 0%,transparent 60%)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:30,height:30,borderRadius:9,background:'linear-gradient(135deg,#e84a2f,#c93820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,boxShadow:'0 4px 12px rgba(232,74,47,0.3)'}}>💬</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,letterSpacing:'0.06em',color:'#f0ece8'}}>COACH FEEDBACK</div>
                {coachFeedback.length>0&&<span style={{fontSize:8,fontWeight:800,padding:'2px 7px',borderRadius:50,background:'rgba(232,74,47,0.15)',color:'#e84a2f',letterSpacing:'0.08em'}}>{coachFeedback.length}</span>}
              </div>
              {coachFeedback.length >= 2 && (
                <button onClick={()=>setClearFbConfirm(true)} title="Clear all feedback"
                  style={{background:'rgba(232,74,47,0.08)',color:'#e84a2f',border:'1px solid rgba(232,74,47,0.25)',borderRadius:50,padding:'5px 11px',fontSize:9,fontWeight:800,letterSpacing:'0.08em',cursor:'pointer',display:'flex',alignItems:'center',gap:4,transition:'all 0.2s'}}
                  onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.18)';e.currentTarget.style.transform='translateY(-1px)'}}
                  onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.08)';e.currentTarget.style.transform='translateY(0)'}}>
                  🧹 CLEAR ALL
                </button>
              )}
            </div>
            {coachFeedback.length===0?(
              <div style={{padding:'30px 16px',textAlign:'center'}}>
                <div style={{fontSize:28,marginBottom:6,opacity:0.4}}>📭</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color:'#888',letterSpacing:'0.06em',marginBottom:3}}>NO FEEDBACK YET</div>
                <div style={{fontSize:9,color:'#555',letterSpacing:'0.04em'}}>Keep training — your coach will leave notes here</div>
              </div>
            ):(
              <div style={{display:'flex',flexDirection:'column',maxHeight:280,overflowY:'auto'}}>
                {coachFeedback.map((fb,i)=>(
                  <div key={fb.id||i} style={{position:'relative',padding:'12px 16px',borderBottom:i<coachFeedback.length-1?'1px solid rgba(255,255,255,0.04)':'none',transition:'background 0.2s'}}
                    onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.04)';const btn=e.currentTarget.querySelector('.fb-del');if(btn)btn.style.opacity='1'}}
                    onMouseLeave={e=>{e.currentTarget.style.background='transparent';const btn=e.currentTarget.querySelector('.fb-del');if(btn)btn.style.opacity='0'}}>
                    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:6}}>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{width:26,height:26,borderRadius:'50%',background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'1.5px solid rgba(232,74,47,0.4)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:800}}>🥊</div>
                        <div>
                          <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.02em'}}>{fb.coachName||'Coach'}</div>
                          <div style={{fontSize:8,color:'#555',letterSpacing:'0.05em'}}>{fb.createdAt?.seconds?new Date(fb.createdAt.seconds*1000).toLocaleDateString('en-US',{month:'short',day:'numeric'}):''}</div>
                        </div>
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:8}}>
                        <div style={{display:'flex',gap:1}}>
                          {Array.from({length:5},(_,j)=>(
                            <span key={j} style={{color:j<(fb.rating||0)?'#f5c842':'#2a2424',fontSize:11,filter:j<(fb.rating||0)?'drop-shadow(0 0 3px rgba(245,200,66,0.6))':'none'}}>★</span>
                          ))}
                        </div>
                        <button className="fb-del"
                          onClick={()=>deleteFeedback(fb.id)}
                          title="Delete this feedback"
                          style={{opacity:0,width:22,height:22,background:'rgba(120,113,108,0.12)',color:'#a8a29e',border:'1px solid rgba(120,113,108,0.3)',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10,cursor:'pointer',transition:'all 0.2s ease',padding:0,flexShrink:0}}
                          onMouseEnter={e=>{e.stopPropagation();e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.color='#e84a2f';e.currentTarget.style.borderColor='rgba(232,74,47,0.4)';e.currentTarget.style.transform='scale(1.12)'}}
                          onMouseLeave={e=>{e.stopPropagation();e.currentTarget.style.background='rgba(120,113,108,0.12)';e.currentTarget.style.color='#a8a29e';e.currentTarget.style.borderColor='rgba(120,113,108,0.3)';e.currentTarget.style.transform='scale(1)'}}>🗑</button>
                      </div>
                    </div>
                    <div style={{fontSize:11,color:'#b0ada8',lineHeight:1.6,paddingLeft:34,fontStyle:'italic'}}>&ldquo;{fb.text}&rdquo;</div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* GYM ANNOUNCEMENTS — always visible */}
          <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.15)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#f5c842,#e08820)'}}/>
            <div style={{padding:'14px 18px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'linear-gradient(135deg,rgba(245,200,66,0.06) 0%,transparent 60%)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:30,height:30,borderRadius:9,background:'linear-gradient(135deg,#f5c842,#e08820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,boxShadow:'0 4px 12px rgba(245,200,66,0.3)'}}>📢</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15,letterSpacing:'0.06em',color:'#f0ece8'}}>GYM ANNOUNCEMENTS</div>
                <span style={{fontSize:8,fontWeight:800,padding:'2px 7px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em'}}>{visibleAnnouncements.length}</span>
              </div>
              {visibleAnnouncements.length > 0 && (
                <button onClick={clearAllAnnouncements} title="Clear all announcements"
                  style={{fontSize:9,fontWeight:700,padding:'5px 12px',borderRadius:50,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',color:'#888',cursor:'pointer',transition:'all 0.2s',letterSpacing:'0.04em'}}
                  onMouseEnter={e=>{e.currentTarget.style.color='#f5c842';e.currentTarget.style.borderColor='rgba(245,200,66,0.3)'}}
                  onMouseLeave={e=>{e.currentTarget.style.color='#888';e.currentTarget.style.borderColor='rgba(255,255,255,0.1)'}}>
                  Clear All
                </button>
              )}
            </div>
            {visibleAnnouncements.length > 0 ? (
              <div style={{display:'flex',flexDirection:'column',maxHeight:320,overflowY:'auto'}}>
                {visibleAnnouncements.map((n,i)=>{
                  const ts = n.createdAt?.toDate ? n.createdAt.toDate() : (n.createdAt?.seconds ? new Date(n.createdAt.seconds * 1000) : null)
                  const dateStr = ts ? ts.toLocaleDateString('en-US', { month:'short', day:'numeric', year:'numeric' }) : ''
                  const timeStr = ts ? ts.toLocaleTimeString('en-US', { hour:'numeric', minute:'2-digit' }) : ''
                  return(
                    <div key={n.id} style={{padding:'12px 16px',borderBottom:i<visibleAnnouncements.length-1?'1px solid rgba(255,255,255,0.04)':'none',display:'flex',gap:10,alignItems:'flex-start',transition:'background 0.2s',position:'relative'}}
                      onMouseEnter={e=>e.currentTarget.style.background='rgba(245,200,66,0.04)'}
                      onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                      <div style={{width:26,height:26,borderRadius:8,background:'linear-gradient(135deg,#f5c842,#e08820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0,boxShadow:'0 3px 10px rgba(245,200,66,0.3)'}}>📢</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:700,color:'#f0ece8',marginBottom:3,letterSpacing:'0.01em'}}>{n.title}</div>
                        <div style={{fontSize:10,color:'#888',lineHeight:1.55,marginBottom:4}}>{n.message}</div>
                        <div style={{display:'flex',alignItems:'center',gap:6,fontSize:9,color:'#555',letterSpacing:'0.04em',flexWrap:'wrap'}}>
                          <span>From <strong style={{color:'#777'}}>{n.from}</strong></span>
                          {dateStr && <><span style={{color:'#333'}}>·</span><span>{dateStr} at {timeStr}</span></>}
                        </div>
                      </div>
                      <button onClick={(e)=>{e.stopPropagation();dismissAnnouncement(n.id)}} title="Dismiss"
                        style={{width:22,height:22,borderRadius:'50%',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',color:'#555',fontSize:10,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0,transition:'all 0.2s'}}
                        onMouseEnter={e=>{e.currentTarget.style.color='#e84a2f';e.currentTarget.style.borderColor='rgba(232,74,47,0.3)';e.currentTarget.style.background='rgba(232,74,47,0.1)'}}
                        onMouseLeave={e=>{e.currentTarget.style.color='#555';e.currentTarget.style.borderColor='rgba(255,255,255,0.08)';e.currentTarget.style.background='rgba(255,255,255,0.04)'}}>
                        ✕
                      </button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div style={{padding:'30px 20px',textAlign:'center'}}>
                <div style={{fontSize:28,marginBottom:8,opacity:0.4}}>📢</div>
                <div style={{fontSize:11,color:'#555',letterSpacing:'0.04em'}}>No announcements right now</div>
              </div>
            )}
          </div>
        </div>

        {/* TIPS — Compact strip */}
        {tipVisible && (
          <div style={{position:'relative',overflow:'hidden',borderRadius:14,background:'linear-gradient(135deg,rgba(245,200,66,0.06),rgba(20,15,15,0.5))',border:'1px solid rgba(245,200,66,0.18)',padding:'12px 16px',display:'flex',alignItems:'center',gap:12}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:'linear-gradient(180deg,#f5c842,#e08820)'}}/>
            <div style={{width:34,height:34,borderRadius:9,background:'linear-gradient(135deg,#f5c842,#e08820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0,boxShadow:'0 3px 10px rgba(245,200,66,0.35)'}}>
              <span>{tip.icon}</span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                <span style={{fontSize:9,fontWeight:800,letterSpacing:'0.15em',color:'#f5c842'}}>💡 {tip.category.toUpperCase()}</span>
                <span style={{fontSize:8,color:'#555',fontWeight:700,letterSpacing:'0.08em'}}>{tipIdx+1}/{TIPS.length}</span>
              </div>
              <div style={{fontSize:12,color:'#b0ada8',lineHeight:1.55}}>{tip.text}</div>
            </div>
            <div style={{display:'flex',gap:5,flexShrink:0}}>
              <button style={{...s.navBtn,width:26,height:26,fontSize:14}} onClick={() => setTipIdx(i => (i-1+TIPS.length)%TIPS.length)}>‹</button>
              <button style={{...s.navBtn,width:26,height:26,fontSize:14}} onClick={() => setTipIdx(i => (i+1)%TIPS.length)}>›</button>
              <button title="Dismiss" style={{width:26,height:26,borderRadius:'50%',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',color:'#555',fontSize:11,cursor:'pointer',fontWeight:700}} onClick={() => setTipVisible(false)}>✕</button>
            </div>
          </div>
        )}
        {!tipVisible && (
          <div style={{...glass({borderRadius:10}),padding:'10px 18px',fontSize:12,color:'#f5c842',fontWeight:600,cursor:'pointer',textAlign:'center'}} onClick={() => setTipVisible(true)}>
            💡 New boxing tip available — tap to read
          </div>
        )}

      </div>
      <style>{`
        @keyframes popIn{from{opacity:0;transform:scale(0.7)}to{opacity:1;transform:scale(1)}}
        @keyframes pulseDot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:0.6}}
        @keyframes badgeGlowPulse{0%,100%{transform:scale(1);opacity:0.7}50%{transform:scale(1.15);opacity:1}}
        @keyframes pulseTrophy{0%,100%{transform:scale(1);opacity:0.6}50%{transform:scale(1.15);opacity:0.9}}
        @keyframes shine{0%{transform:translateX(-100%);opacity:0}50%{opacity:1}100%{transform:translateX(200%);opacity:0}}
      `}</style>
    </>
  )
}

const s = {
  heroRow:   {display:'grid',gridTemplateColumns:'1fr 1.5fr 0.9fr',gap:16},
  bottomGrid:{display:'grid',gridTemplateColumns:'1fr',gap:16},
  heroAvatar:{width:52,height:52,borderRadius:'50%',border:'2.5px solid #e84a2f',background:'linear-gradient(135deg,#2a2020,#3a2828)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,fontWeight:700,color:'#e84a2f',fontFamily:"'Bebas Neue',sans-serif",flexShrink:0,boxShadow:'0 0 16px rgba(232,74,47,0.3)'},
  accentBtn: {background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'10px 22px',fontSize:13,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'},
  ghostBtn:  {background:'transparent',color:'#7a7570',border:'1.5px solid rgba(255,255,255,0.12)',borderRadius:50,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer'},
  navBtn:    {width:30,height:30,borderRadius:'50%',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#f0ece8',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,lineHeight:1},
}

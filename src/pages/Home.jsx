import { useEffect, useRef, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { auth, db } from '../firebase'
import { doc, getDoc, updateDoc, collection, getDocs, query, where } from 'firebase/firestore'
import Navbar from '../components/Navbar'
import { buildSchedule, EXERCISE_POOLS } from '../lib/scheduleBuilder'

// ── CONSTANTS ─────────────────────────────────────────
const CIRCUMFERENCE      = 339
const WORKOUTS_PER_LEVEL = 25
const LEVELS             = ['Beginner','Intermediate','Advanced','Expert','Elite']
const MILESTONE_BADGES   = [10,20,30,40,50,60]

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

  // Load profile from localStorage (synced from Firestore by App.jsx)
  const [profile, setProfile] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hittrack_profile') || '{}') } catch { return {} }
  })

  // Workout tracking state — load from Firestore
  const [dayChecked,        setDayChecked]        = useState({})
  const [generatedWorkouts, setGeneratedWorkouts]  = useState({})
  const [bookedExtras,      setBookedExtras]       = useState({})
  const [classStatuses,     setClassStatuses]      = useState([])
  const [classes,           setClasses]            = useState([])
  const [loadingClasses,    setLoadingClasses]     = useState(true)

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
      if (snap.exists()) {
        const data = snap.data()
        if (data.dayChecked)        setDayChecked(data.dayChecked)
        if (data.generatedWorkouts) setGeneratedWorkouts(data.generatedWorkouts)
        if (data.bookedExtras)      setBookedExtras(data.bookedExtras)
      }
    }).catch(console.error)
  }, [])

  // ── Load classes from Firestore ───────────────────────
  useEffect(() => {
    getDocs(collection(db, 'classes')).then(snap => {
      const cls = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      setClasses(cls)
      setClassStatuses(cls.map(() => 'open'))
      setLoadingClasses(false)
    }).catch(() => setLoadingClasses(false))
  }, [])

  // ── Load announcements/notifications ────────────────────
  const [announcements, setAnnouncements] = useState([])
  useEffect(() => {
    import('firebase/firestore').then(({ onSnapshot, orderBy: fbOrderBy, query: fbQuery }) => {
      const q = fbQuery(collection(db, 'notifications'), fbOrderBy('createdAt', 'desc'))
      const unsub = onSnapshot(q, (snap) => {
        const ns = snap.docs.map(d => ({ id: d.id, ...d.data() }))
          .filter(n => n.audience === 'all' || !n.audience)
        setAnnouncements(ns.slice(0, 3)) // show latest 3
      }, () => {})
      return unsub
    })
  }, [])

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

  // ── DERIVED VALUES ────────────────────────────────────
  const thisWeekWorkouts = schedule.slice(0,7).filter(d => d.isWorkout || !!generatedWorkouts[d.idx])

  const totalWorkouts = Object.entries(dayChecked).filter(([idx, ch]) => {
    const day = schedule[parseInt(idx)]
    return (day?.isWorkout || !!generatedWorkouts[parseInt(idx)]) && ch.length > 0 && ch.every(Boolean)
  }).length

  const completedThisWeek = thisWeekWorkouts.filter(d => {
    const ch = dayChecked[d.idx] || []
    return ch.length > 0 && ch.every(Boolean)
  }).length

  const streak = (() => {
    let s = 0
    for (const d of schedule) {
      if (!d.isWorkout && !generatedWorkouts[d.idx]) continue
      const ch = dayChecked[d.idx] || []
      if (ch.length > 0 && ch.every(Boolean)) s++
      else break
    }
    return s
  })()

  const levelIdx     = Math.min(Math.floor(totalWorkouts / WORKOUTS_PER_LEVEL), LEVELS.length-1)
  const currentLevel = LEVELS[levelIdx]
  const nextLevel    = LEVELS[Math.min(levelIdx+1, LEVELS.length-1)]
  const levelPct     = ((totalWorkouts % WORKOUTS_PER_LEVEL) / WORKOUTS_PER_LEVEL) * 100
  const toNext       = WORKOUTS_PER_LEVEL - (totalWorkouts % WORKOUTS_PER_LEVEL)

  const totalExThisWeek   = thisWeekWorkouts.reduce((a,d) => a + (d.workout?.exercises?.length || 0), 0)
  const checkedExThisWeek = thisWeekWorkouts.reduce((a,d) => a + (dayChecked[d.idx]||[]).filter(Boolean).length, 0)
  const weeklyPct         = totalExThisWeek > 0 ? Math.round((checkedExThisWeek/totalExThisWeek)*100) : 0

  const selDayData    = schedule[selDay]
  const workout       = generatedWorkouts[selDay] || selDayData?.workout || null
  const baseExercises = workout?.exercises || []
  const extraExercises= bookedExtras[selDay] || []
  const allExercises  = [...baseExercises, ...extraExercises]
  const checked       = dayChecked[selDay] || allExercises.map(() => false)
  const completedCount= checked.filter(Boolean).length
  const workoutDone   = allExercises.length > 0 && completedCount === allExercises.length

  const lc = { Beginner:'#fb923c', Intermediate:'#f5c842', Advanced:'#4ade80', Expert:'#42a5f5', Elite:'#c084fc' }[currentLevel] || '#f5c842'

  // Update ring
  useEffect(() => {
    if (ringRef.current) {
      const off = CIRCUMFERENCE - (weeklyPct/100) * CIRCUMFERENCE
      ringRef.current.style.strokeDashoffset = off
    }
    setDisplayPct(weeklyPct)
  }, [weeklyPct])

  // Badge check + save stats to Firestore
  useEffect(() => {
    const milestone = MILESTONE_BADGES.find(m => totalWorkouts === m && !unlockedBadges.includes(m))
    if (milestone) { setTimeout(() => setBadgePopup(milestone), 600); setUnlockedBadges(p => [...p, milestone]) }
    saveStats({ totalWorkouts, streak, weeklyPct, currentLevel, updatedAt: new Date().toISOString() })
  }, [totalWorkouts, streak, weeklyPct, currentLevel])

  // ── ACTIONS ───────────────────────────────────────────
  function toggleEx(scheduleIdx, exIdx) {
    setDayChecked(prev => {
      const total = allExercises.length
      const arr   = [...(prev[scheduleIdx] || new Array(total).fill(false))]
      arr[exIdx]  = !arr[exIdx]
      const next  = { ...prev, [scheduleIdx]: arr }
      saveWorkoutData(next, generatedWorkouts, bookedExtras)
      return next
    })
  }

  function generateRandom(scheduleIdx) {
    const exp    = profile?.experience || 'Beginner'
    const goal   = profile?.goal || 'Learn Boxing'
    const pool   = EXERCISE_POOLS[exp]?.[goal] || EXERCISE_POOLS.Beginner['Learn Boxing']
    const used   = schedule.flatMap(d => d.workout?.exercises || [])
    const avail  = pool.filter(e => !used.includes(e))
    const pick   = (avail.length >= 2 ? avail : [...pool]).sort(() => Math.random()-0.5).slice(0,2)
    const newW   = { title:'Spontaneous Training 🎲', exercises:['Warm Up',...pick,'Cool Down'], duration:'30m', type:'generated' }
    const nextGen = { ...generatedWorkouts, [scheduleIdx]: newW }
    setGeneratedWorkouts(nextGen)
    const nextChecked = { ...dayChecked, [scheduleIdx]: new Array(4).fill(false) }
    setDayChecked(nextChecked)
    saveWorkoutData(nextChecked, nextGen, bookedExtras)
  }

  function handleBook(i) {
    const cls = classes[i]
    if (!cls) return
    if (classStatuses[i] === 'booked') {
      setClassStatuses(prev => { const n=[...prev]; n[i]='open'; return n })
      return
    }
    // Check conflict
    const matchDay = schedule.findIndex(d => d.dayName === cls.day?.split(',')[0]?.trim())
    const hasWorkout = matchDay >= 0 && (schedule[matchDay]?.workout || generatedWorkouts[matchDay])
    if (hasWorkout && matchDay >= 0) {
      setConflictModal({ classIdx:i, classData:cls, dayIdx:matchDay, existingWorkout: schedule[matchDay]?.workout || generatedWorkouts[matchDay] })
    } else {
      doBook(i, cls, matchDay)
    }
  }

  async function doBook(i, cls, dayIdx) {
    setClassStatuses(prev => { const n=[...prev]; n[i]='booked'; return n })
    // Save booking to Firestore
    try {
      const user = auth.currentUser
      if (!user || !cls?.id) return
      const { addDoc } = await import('firebase/firestore')
      // Check not already booked
      const existingQuery = query(
        collection(db, 'bookings'),
        where('userId', '==', user.uid),
        where('classId', '==', cls.id)
      )
      const existing = await getDocs(existingQuery)
      if (existing.empty) {
        await addDoc(collection(db, 'bookings'), {
          userId: user.uid,
          userName: profile.name || 'Member',
          classId: cls.id,
          className: cls.name,
          createdAt: new Date().toISOString(),
        })
        // Update enrolled count on class
        await updateDoc(doc(db, 'classes', cls.id), {
          enrolled: (cls.enrolled || 0) + 1,
        })
      }
    } catch(e) { console.error('Booking error:', e) }
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

      <div style={{position:'relative',zIndex:1,maxWidth:1500,margin:'0 auto',padding:'24px 40px 60px',display:'flex',flexDirection:'column',gap:16,fontFamily:'Montserrat,sans-serif'}}>

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
        <div style={s.heroRow}>

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
                {icon:'⭐',val:profile.experience||'—', label:'Level'},
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
            {/* Level progress */}
            <div>
              <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                <span style={{fontSize:10,fontWeight:700,color:'#7a7570',textTransform:'uppercase',letterSpacing:'0.08em'}}>{currentLevel} → {nextLevel}</span>
                <span style={{fontSize:10,fontWeight:700,color:'#f5c842'}}>{levelPct.toFixed(0)}% · {toNext} to go</span>
              </div>
              <div style={{height:8,background:'#2a2424',borderRadius:50,overflow:'hidden'}}>
                <div style={{height:'100%',background:'linear-gradient(90deg,#e84a2f,#f5c842)',borderRadius:50,width:`${levelPct}%`,transition:'width 0.6s ease'}}/>
              </div>
              <div style={{display:'flex',justifyContent:'space-between',marginTop:5}}>
                {LEVELS.map((lv,i) => (
                  <span key={i} style={{fontSize:9,fontWeight:700,color:i===levelIdx?'#f5c842':i<levelIdx?'#4ade80':'#333'}}>
                    {i<=levelIdx?'●':'○'} {lv.slice(0,3).toUpperCase()}
                  </span>
                ))}
              </div>
            </div>
            <div style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',borderRadius:50,padding:'10px',textAlign:'center',boxShadow:'0 4px 20px rgba(232,74,47,0.3)'}}>
              <div style={{fontSize:9,fontWeight:600,letterSpacing:'0.12em',color:'rgba(255,255,255,0.65)',textTransform:'uppercase',marginBottom:2}}>Skill Level</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#fff'}}>{currentLevel.toUpperCase()}</div>
            </div>
          </div>

          {/* TODAY'S WORKOUT */}
          <div style={{...glass(),padding:'22px 24px',display:'flex',flexDirection:'column',gap:12}}>
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
                <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                  <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',color:workout.type==='generated'?'#c084fc':'#e84a2f',background:workout.type==='generated'?'rgba(192,132,252,0.1)':'rgba(232,74,47,0.1)',padding:'4px 12px',borderRadius:50}}>
                    {workout.type==='generated'?'🎲 RANDOM':'WORKOUT'}
                  </div>
                  <div style={{fontSize:12,color:'#7a7570',fontWeight:600}}>⏱ {workout.duration}</div>
                </div>
                <div style={{fontSize:16,fontWeight:700,color:'#f0ece8'}}>{workout.title}</div>
                <div>
                  <div style={{height:5,background:'#2a2424',borderRadius:50,overflow:'hidden',marginBottom:4}}>
                    <div style={{height:'100%',borderRadius:50,background:workoutDone?'linear-gradient(90deg,#4ade80,#22c55e)':'linear-gradient(90deg,#e84a2f,#f5c842)',width:`${allExercises.length>0?(completedCount/allExercises.length)*100:0}%`,transition:'width 0.4s ease'}}/>
                  </div>
                  <div style={{fontSize:10,color:workoutDone?'#4ade80':'#7a7570',fontWeight:600}}>{workoutDone?'✅ Workout Complete!`':`${completedCount}/${allExercises.length} done`}</div>
                </div>
                <div style={{display:'flex',flexDirection:'column',gap:8,flex:1}}>
                  {allExercises.map((ex,i) => (
                    <div key={i} onClick={() => toggleEx(selDay,i)}
                      style={{display:'flex',alignItems:'center',gap:10,padding:'10px 12px',borderRadius:11,cursor:'pointer',
                        background:checked[i]?'rgba(74,222,128,0.05)':extraExercises.includes(ex)?'rgba(66,165,245,0.04)':'rgba(255,255,255,0.02)',
                        border:`1px solid ${checked[i]?'rgba(74,222,128,0.15)':extraExercises.includes(ex)?'rgba(66,165,245,0.15)':'rgba(255,255,255,0.04)'}`,
                        transition:'all 0.2s'}}>
                      <div style={{width:26,height:26,borderRadius:'50%',background:checked[i]?'#4ade80':'#2a2424',border:checked[i]?'none':'2px solid #444',display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,fontWeight:700,color:checked[i]?'#fff':'#555',flexShrink:0,transform:checked[i]?'scale(1.1)':'scale(1)',transition:'all 0.2s'}}>
                        {checked[i]?'✓':i+1}
                      </div>
                      <div style={{fontSize:13,fontWeight:500,flex:1,color:checked[i]?'#7a7570':'#f0ece8',textDecoration:checked[i]?'line-through':'none',transition:'all 0.25s'}}>{ex}</div>
                      {extraExercises.includes(ex)&&!checked[i]&&<span style={{fontSize:9,background:'rgba(66,165,245,0.15)',color:'#42a5f5',border:'1px solid rgba(66,165,245,0.25)',borderRadius:50,padding:'2px 6px',fontWeight:700}}>BOOKED</span>}
                      <div style={{fontSize:10,color:checked[i]?'#4ade80':'#555',fontWeight:600}}>{checked[i]?'done':'tap'}</div>
                    </div>
                  ))}
                </div>
                <button style={{...s.accentBtn,background:workoutDone?'linear-gradient(135deg,#4ade80,#22c55e)':'linear-gradient(135deg,#e84a2f,#c93820)',boxShadow:workoutDone?'0 4px 16px rgba(74,222,128,0.35)':'0 4px 16px rgba(232,74,47,0.35)'}}>
                  {workoutDone?'🎉 Workout Complete!':'Continue Training →'}
                </button>
              </>
            ) : (
              <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',gap:14,padding:'16px 0'}}>
                <div style={{fontSize:44}}>😴</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#f0ece8'}}>Rest Day</div>
                <div style={{fontSize:12,color:'#555',textAlign:'center',lineHeight:1.7,maxWidth:240}}>Recovery is essential. Your body rebuilds stronger on rest days.</div>
                <div style={{width:'100%',background:'rgba(192,132,252,0.06)',border:'1px solid rgba(192,132,252,0.15)',borderRadius:14,padding:'14px',textAlign:'center'}}>
                  <div style={{fontSize:12,color:'#c084fc',fontWeight:700,marginBottom:6}}>🎲 Feeling Motivated?</div>
                  <div style={{fontSize:11,color:'#7a7570',marginBottom:10,lineHeight:1.6}}>Generate a workout based on your {profile.experience||'Beginner'} level — won't overlap your plan!</div>
                  <button style={{background:'linear-gradient(135deg,#7b1fa2,#c084fc)',color:'#fff',border:'none',borderRadius:50,padding:'9px 22px',fontSize:12,fontWeight:700,cursor:'pointer'}} onClick={() => generateRandom(selDay)}>
                    Generate Workout 🎲
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* ACHIEVEMENT */}
          <div style={{...glass(),padding:'22px',display:'flex',flexDirection:'column',alignItems:'center',gap:12,textAlign:'center'}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:'0.12em',color:'#f5c842',background:'rgba(245,200,66,0.1)',padding:'4px 12px',borderRadius:50}}>
              {totalWorkouts>=10?'🎉 UNLOCKED!':'MILESTONE BADGE'}
            </div>
            <div style={{fontSize:44}}>🏅</div>
            <div style={{fontSize:14,fontWeight:700,color:'#f0ece8'}}>10 Workout Badge</div>
            <div style={{width:'100%'}}>
              <div style={{height:8,background:'#2a2424',borderRadius:50,overflow:'hidden',marginBottom:5}}>
                <div style={{height:'100%',background:'linear-gradient(90deg,#f5c842,#e84a2f)',borderRadius:50,width:`${Math.min((totalWorkouts/10)*100,100)}%`,transition:'width 0.6s ease'}}/>
              </div>
              <div style={{fontSize:12,textAlign:'right'}}><span style={{color:'#f5c842',fontWeight:700}}>{Math.min(totalWorkouts,10)}</span><span style={{color:'#555'}}>/10</span></div>
            </div>
            <div style={{fontSize:11,color:'#7a7570'}}>{totalWorkouts>=10?'Next badge at 20 workouts!':`${10-totalWorkouts} more workout${10-totalWorkouts!==1?'s':''} to go!`}</div>
            <div style={{width:'100%',background:'rgba(255,255,255,0.02)',borderRadius:10,padding:'10px',display:'flex',flexDirection:'column',gap:6}}>
              <div style={{fontSize:10,color:'#555',fontWeight:700,letterSpacing:'0.06em',textAlign:'left',marginBottom:2}}>MILESTONES</div>
              {MILESTONE_BADGES.slice(0,4).map((m,i) => (
                <div key={i} style={{display:'flex',alignItems:'center',gap:8}}>
                  <div style={{width:18,height:18,borderRadius:'50%',background:totalWorkouts>=m?'#4ade80':'#2a2424',border:`1.5px solid ${totalWorkouts>=m?'#4ade80':'#444'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:9,color:totalWorkouts>=m?'#fff':'#555',fontWeight:700,flexShrink:0}}>{totalWorkouts>=m?'✓':''}</div>
                  <div style={{flex:1,height:4,background:'#2a2424',borderRadius:50,overflow:'hidden'}}>
                    <div style={{height:'100%',background:totalWorkouts>=m?'#4ade80':'#f5c842',borderRadius:50,width:`${Math.min((totalWorkouts/m)*100,100)}%`,transition:'width 0.5s ease'}}/>
                  </div>
                  <div style={{fontSize:10,color:totalWorkouts>=m?'#4ade80':'#7a7570',fontWeight:700,width:32,textAlign:'right'}}>{m}🥊</div>
                </div>
              ))}
            </div>
            <button style={{...s.ghostBtn,color:'#f5c842',borderColor:'rgba(245,200,66,0.3)',width:'100%'}} onClick={() => navigate('/achievements')}>View All Badges</button>
          </div>
        </div>

        {/* BOTTOM GRID */}
        <div style={s.bottomGrid}>

          {/* UPCOMING CLASSES — from Firestore */}
          <div style={glass()}>
            <div style={{fontSize:14,fontWeight:700,padding:'16px 18px 12px',borderBottom:'1px solid rgba(245,200,66,0.08)'}}>Upcoming Classes</div>
            {loadingClasses ? (
              <div style={{padding:24,textAlign:'center',color:'#555',fontSize:12}}>Loading classes...</div>
            ) : classes.length === 0 ? (
              <div style={{padding:24,textAlign:'center',color:'#555',fontSize:12}}>No classes scheduled yet. Check back soon!</div>
            ) : (
              <div style={{padding:'10px',display:'flex',flexDirection:'column',gap:8}}>
                {classes.map((c,i) => (
                  <div key={c.id} style={{display:'flex',alignItems:'center',gap:10,background:'rgba(255,255,255,0.03)',borderRadius:12,padding:'12px 13px',border:`1px solid ${classStatuses[i]==='booked'?'rgba(74,222,128,0.2)':'rgba(245,200,66,0.06)'}`,transition:'border-color 0.3s'}}>
                    <div style={{flex:1,display:'flex',flexDirection:'column',gap:3}}>
                      <div style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{c.name}</div>
                      <div style={{display:'flex',gap:6,fontSize:11,alignItems:'center',flexWrap:'wrap'}}>
                        <span style={{color:'#e84a2f',fontWeight:600}}>{c.coach}</span>
                        <span style={{color:'#555'}}>·</span>
                        <span style={{color:'#b0ada8'}}>{c.day}</span>
                        <span style={{color:'#555'}}>·</span>
                        <span style={{color:'#f5c842',fontWeight:600}}>{c.time}</span>
                      </div>
                      {c.spots && (c.spots - (c.enrolled||0)) <= 3 && classStatuses[i]==='open' && (
                        <div style={{fontSize:10,color:'#f5c842',fontWeight:700}}>⚠️ Only {c.spots-(c.enrolled||0)} spots left!</div>
                      )}
                      {classStatuses[i]==='booked' && <div style={{fontSize:10,color:'#4ade80',fontWeight:700}}>✅ You are registered</div>}
                    </div>
                    <button onClick={() => handleBook(i)}
                      style={{background:classStatuses[i]==='booked'?'rgba(74,222,128,0.12)':'#e84a2f',color:classStatuses[i]==='booked'?'#4ade80':'#fff',border:classStatuses[i]==='booked'?'1px solid rgba(74,222,128,0.3)':'none',borderRadius:50,padding:'7px 16px',fontSize:11,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap',transition:'all 0.2s'}}>
                      {classStatuses[i]==='booked'?'✓ Booked':'Book'}
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* WEEKLY PROGRESS RING */}
          <div style={{...glass(),display:'flex',flexDirection:'column',alignItems:'center',padding:'22px 18px',gap:14}}>
            <div style={{fontSize:13,fontWeight:700,alignSelf:'flex-start'}}>Weekly Progress</div>
            <div style={{position:'relative',width:140,height:140}}>
              <svg style={{transform:'rotate(-90deg)'}} width="140" height="140" viewBox="0 0 140 140">
                <circle fill="none" stroke="#2a2424" strokeWidth="14" cx="70" cy="70" r="54"/>
                <circle ref={ringRef} fill="none" stroke="#f5c842" strokeWidth="14" strokeLinecap="round" cx="70" cy="70" r="54" strokeDasharray={CIRCUMFERENCE} strokeDashoffset={CIRCUMFERENCE} style={{transition:'stroke-dashoffset 0.7s cubic-bezier(0.4,0,0.2,1)'}}/>
              </svg>
              <div style={{position:'absolute',inset:0,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center'}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:34,color:'#f5c842',lineHeight:1}}>{displayPct}%</div>
                <div style={{fontSize:10,color:'#7a7570',fontWeight:600}}>Done</div>
              </div>
            </div>
            <div style={{fontSize:11,color:'#555',textAlign:'center',lineHeight:1.6}}>Check off exercises to update this ring</div>
            <div style={{width:'100%',display:'flex',flexDirection:'column',gap:8}}>
              {[
                {icon:'🔥',label:'Streak',        val:`${streak} day${streak!==1?'s':''}`,  color:'#e84a2f'},
                {icon:'🥊',label:'Total Workouts', val:totalWorkouts,                          color:'#f5c842'},
                {icon:'📅',label:'Done This Week', val:`${completedThisWeek}/7`,               color:'#4ade80'},
                {icon:'⭐',label:'Level',          val:currentLevel,                           color:lc},
              ].map((st,i) => (
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,padding:'8px 10px',background:'rgba(255,255,255,0.02)',borderRadius:10,border:'1px solid rgba(255,255,255,0.04)'}}>
                  <span style={{fontSize:18}}>{st.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{fontSize:9,color:'#555',fontWeight:600,letterSpacing:'0.06em',textTransform:'uppercase'}}>{st.label}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:st.color,letterSpacing:'0.04em'}}>{st.val}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* COACH FEEDBACK — always visible */}
        <div style={glass()}>
          <div style={{padding:'14px 20px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontSize:13,fontWeight:700}}>💬 Coach Feedback</div>
            {coachFeedback.length>0&&<div style={{fontSize:10,color:'#e84a2f',fontWeight:700,background:'rgba(232,74,47,0.1)',borderRadius:50,padding:'3px 10px',border:'1px solid rgba(232,74,47,0.2)'}}>{coachFeedback.length} note{coachFeedback.length!==1?'s':''}</div>}
          </div>
          {coachFeedback.length===0?(
            <div style={{padding:'28px 20px',textAlign:'center',display:'flex',flexDirection:'column',alignItems:'center',gap:10}}>
              <div style={{fontSize:32,opacity:0.4}}>📭</div>
              <div style={{fontSize:12,color:'#555',lineHeight:1.7}}>No feedback yet from your coach.<br/>Keep training — your coach will leave notes here!</div>
            </div>
          ):(
            <div style={{display:'flex',flexDirection:'column',gap:0,maxHeight:300,overflowY:'auto'}}>
              {coachFeedback.map((fb,i)=>(
                <div key={fb.id||i} style={{padding:'14px 18px',borderBottom:'1px solid rgba(255,255,255,0.04)',display:'flex',flexDirection:'column',gap:8}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <div style={{width:30,height:30,borderRadius:'50%',background:'rgba(232,74,47,0.15)',border:'1.5px solid rgba(232,74,47,0.3)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13}}>🥊</div>
                      <div>
                        <div style={{fontSize:12,fontWeight:700,color:'#e84a2f'}}>{fb.coachName||'Coach'}</div>
                        <div style={{fontSize:9,color:'#555'}}>{fb.createdAt?.seconds?new Date(fb.createdAt.seconds*1000).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):''}</div>
                      </div>
                    </div>
                    <div style={{display:'flex',gap:2}}>
                      {Array.from({length:5},(_,j)=>(
                        <span key={j} style={{color:j<(fb.rating||0)?'#f5c842':'#2a2424',fontSize:13}}>★</span>
                      ))}
                    </div>
                  </div>
                  <div style={{fontSize:12,color:'#b0ada8',lineHeight:1.7,background:'rgba(255,255,255,0.02)',borderRadius:10,padding:'10px 14px',border:'1px solid rgba(255,255,255,0.05)',fontStyle:'italic'}}>&ldquo;{fb.text}&rdquo;</div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ANNOUNCEMENTS */}
        {announcements.length > 0 && (
          <div style={{...glass({borderRadius:14}),border:'1px solid rgba(245,200,66,0.15)'}}>
            <div style={{padding:'12px 18px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',gap:8}}>
              <span style={{fontSize:16}}>📢</span>
              <div style={{fontSize:13,fontWeight:700,color:'#f5c842'}}>Gym Announcements</div>
              <div style={{fontSize:10,background:'rgba(245,200,66,0.1)',color:'#f5c842',border:'1px solid rgba(245,200,66,0.2)',borderRadius:50,padding:'2px 8px',fontWeight:700}}>{announcements.length}</div>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:0}}>
              {announcements.map((n,i)=>(
                <div key={n.id} style={{padding:'12px 18px',borderBottom:i<announcements.length-1?'1px solid rgba(255,255,255,0.04)':'none',display:'flex',gap:10,alignItems:'flex-start'}}>
                  <div style={{width:28,height:28,borderRadius:8,background:'rgba(245,200,66,0.12)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>📢</div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:12,fontWeight:700,color:'#f0ece8',marginBottom:3}}>{n.title}</div>
                    <div style={{fontSize:11,color:'#7a7570',lineHeight:1.6}}>{n.message}</div>
                    <div style={{fontSize:9,color:'#444',marginTop:4}}>From: {n.from}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* TIPS */}
        {tipVisible && (
          <div style={{...glass({borderRadius:16}),padding:'18px 22px',display:'flex',alignItems:'center',justifyContent:'space-between',gap:20}}>
            <div style={{display:'flex',gap:14,alignItems:'center',flex:1}}>
              <div style={{width:44,height:44,borderRadius:12,background:'rgba(245,200,66,0.1)',display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                <span style={{fontSize:22}}>{tip.icon}</span>
              </div>
              <div style={{flex:1}}>
                <div style={{display:'flex',alignItems:'center',gap:12,marginBottom:5}}>
                  <span style={{fontSize:10,fontWeight:700,letterSpacing:'0.1em',color:'#f5c842'}}>💡 BOXING TIP · {tip.category}</span>
                  <span style={{fontSize:10,color:'#555',fontWeight:600}}>{tipIdx+1}/{TIPS.length}</span>
                </div>
                <div style={{fontSize:13,color:'#b0ada8',lineHeight:1.7}}>{tip.text}</div>
              </div>
            </div>
            <div style={{display:'flex',flexDirection:'column',alignItems:'center',gap:8,flexShrink:0}}>
              <div style={{display:'flex',gap:6}}>
                <button style={s.navBtn} onClick={() => setTipIdx(i => (i-1+TIPS.length)%TIPS.length)}>‹</button>
                <button style={s.navBtn} onClick={() => setTipIdx(i => (i+1)%TIPS.length)}>›</button>
              </div>
              <div style={{display:'flex',gap:5}}>
                {TIPS.map((_,i) => <div key={i} style={{width:6,height:6,borderRadius:'50%',background:i===tipIdx?'#f5c842':'#333',cursor:'pointer',transition:'all 0.2s'}} onClick={() => setTipIdx(i)}/>)}
              </div>
              <button style={{fontSize:11,color:'#555',background:'none',border:'none',cursor:'pointer',fontWeight:600}} onClick={() => setTipVisible(false)}>✕ Dismiss</button>
            </div>
          </div>
        )}
        {!tipVisible && (
          <div style={{...glass({borderRadius:10}),padding:'10px 18px',fontSize:12,color:'#f5c842',fontWeight:600,cursor:'pointer',textAlign:'center'}} onClick={() => setTipVisible(true)}>
            💡 New boxing tip available — tap to read
          </div>
        )}

      </div>
      <style>{`@keyframes popIn{from{opacity:0;transform:scale(0.7)}to{opacity:1;transform:scale(1)}}`}</style>
    </>
  )
}

const s = {
  heroRow:   {display:'grid',gridTemplateColumns:'1fr 1.5fr 0.9fr',gap:16},
  bottomGrid:{display:'grid',gridTemplateColumns:'1.2fr 0.8fr',gap:16},
  heroAvatar:{width:52,height:52,borderRadius:'50%',border:'2.5px solid #e84a2f',background:'linear-gradient(135deg,#2a2020,#3a2828)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,fontWeight:700,color:'#e84a2f',fontFamily:"'Bebas Neue',sans-serif",flexShrink:0,boxShadow:'0 0 16px rgba(232,74,47,0.3)'},
  accentBtn: {background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'10px 22px',fontSize:13,fontWeight:700,cursor:'pointer',whiteSpace:'nowrap'},
  ghostBtn:  {background:'transparent',color:'#7a7570',border:'1.5px solid rgba(255,255,255,0.12)',borderRadius:50,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer'},
  navBtn:    {width:30,height:30,borderRadius:'50%',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',color:'#f0ece8',fontSize:16,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center',fontWeight:700,lineHeight:1},
}

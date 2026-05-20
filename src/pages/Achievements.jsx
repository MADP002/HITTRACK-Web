import { useState, useEffect, useRef, useMemo } from 'react'
import Navbar from '../components/Navbar'
import { auth, db } from '../firebase'
import { doc, getDoc, collection, getDocs } from 'firebase/firestore'

// ════════════════════════════════════════════════════════
//  HALL OF CHAMPIONS — Achievements
//
//  All 22 badges, XP system, rank-based achievements, and
//  canvas background preserved. Layered on top: cinematic
//  Hero Trophy Showcase, Rarity Stat Bar, bigger badge
//  cards, click-to-zoom showcase modal, and sectioned gallery.
// ════════════════════════════════════════════════════════

const glass = (extra={}) => ({
  background:'linear-gradient(135deg,rgba(30,28,28,0.97),rgba(18,16,16,0.99))',
  borderRadius:20, border:'1px solid rgba(245,200,66,0.15)',
  boxShadow:'0 8px 40px rgba(0,0,0,0.5),inset 0 1px 0 rgba(245,200,66,0.08)',
  overflow:'hidden', ...extra,
})

// ── BADGE DEFINITIONS (unchanged from your version) ──
const BADGES = [
  // WORKOUT MILESTONES
  { id:'w1',  category:'Milestones', icon:'🥊', title:'First Punch',      desc:'Complete your very first workout',        rarity:'common',    xp:50,   condition: s => s.totalWorkouts >= 1  },
  { id:'w2',  category:'Milestones', icon:'🏅', title:'10 Workouts',       desc:'Complete 10 workouts',                   rarity:'common',    xp:100,  condition: s => s.totalWorkouts >= 10 },
  { id:'w3',  category:'Milestones', icon:'🥈', title:'20 Workouts',       desc:'Complete 20 workouts',                   rarity:'uncommon',  xp:200,  condition: s => s.totalWorkouts >= 20 },
  { id:'w4',  category:'Milestones', icon:'🥇', title:'30 Workouts',       desc:'Complete 30 workouts',                   rarity:'uncommon',  xp:300,  condition: s => s.totalWorkouts >= 30 },
  { id:'w5',  category:'Milestones', icon:'💎', title:'50 Workouts',       desc:'Complete 50 workouts',                   rarity:'rare',      xp:500,  condition: s => s.totalWorkouts >= 50 },
  { id:'w6',  category:'Milestones', icon:'👑', title:'100 Workouts',      desc:'Complete 100 workouts — true fighter',   rarity:'legendary', xp:1000, condition: s => s.totalWorkouts >= 100},

  // STREAK BADGES
  { id:'s1',  category:'Streaks',    icon:'🔥', title:'On Fire',           desc:'Maintain a 3-day training streak',        rarity:'common',    xp:75,   condition: s => s.streak >= 3  },
  { id:'s2',  category:'Streaks',    icon:'🔥', title:'Week Warrior',      desc:'Maintain a 7-day training streak',        rarity:'uncommon',  xp:150,  condition: s => s.streak >= 7  },
  { id:'s3',  category:'Streaks',    icon:'⚡', title:'Unstoppable',       desc:'Maintain a 14-day training streak',       rarity:'rare',      xp:300,  condition: s => s.streak >= 14 },
  { id:'s4',  category:'Streaks',    icon:'👑', title:'Iron Will',         desc:'Maintain a 30-day training streak',       rarity:'legendary', xp:750,  condition: s => s.streak >= 30 },

  // LEVEL BADGES
  { id:'l1',  category:'Levels',     icon:'🌱', title:"Beginner's Heart",  desc:'Start your boxing journey',               rarity:'common',    xp:50,   condition: s => s.totalWorkouts >= 1  },
  { id:'l2',  category:'Levels',     icon:'⚡', title:'Intermediate',      desc:'Reach Intermediate level (25 workouts)',  rarity:'uncommon',  xp:400,  condition: s => s.totalWorkouts >= 25 },
  { id:'l3',  category:'Levels',     icon:'🔥', title:'Advanced Fighter',  desc:'Reach Advanced level (50 workouts)',      rarity:'rare',      xp:800,  condition: s => s.totalWorkouts >= 50 },
  { id:'l4',  category:'Levels',     icon:'💎', title:'Expert',            desc:'Reach Expert level (75 workouts)',        rarity:'epic',      xp:1200, condition: s => s.totalWorkouts >= 75 },
  { id:'l5',  category:'Levels',     icon:'👑', title:'Elite',             desc:'Reach Elite level (100 workouts)',        rarity:'legendary', xp:2000, condition: s => s.totalWorkouts >= 100},

  // WEEKLY CONSISTENCY
  { id:'c1',  category:'Consistency',icon:'📅', title:'Consistent',        desc:'Complete 50% of weekly workouts',         rarity:'common',    xp:80,   condition: s => s.weeklyPct >= 50  },
  { id:'c2',  category:'Consistency',icon:'📅', title:'Dedicated',         desc:'Complete 75% of weekly workouts',         rarity:'uncommon',  xp:160,  condition: s => s.weeklyPct >= 75  },
  { id:'c3',  category:'Consistency',icon:'🏆', title:'Perfect Week',      desc:'Complete 100% of weekly workouts',        rarity:'rare',      xp:350,  condition: s => s.weeklyPct >= 100 },

  // LEADERBOARD
  { id:'r1',  category:'Rankings',   icon:'📊', title:'On the Board',      desc:'Appear on the gym leaderboard',           rarity:'common',    xp:50,   condition: s => s.totalWorkouts >= 1  },
  { id:'r2',  category:'Rankings',   icon:'🏅', title:'Top 10',            desc:'Reach top 10 on the leaderboard',         rarity:'uncommon',  xp:300,  condition: s => s.rank <= 10 && s.rank > 0 },
  { id:'r3',  category:'Rankings',   icon:'🥉', title:'Podium',            desc:'Reach top 3 on the leaderboard',          rarity:'epic',      xp:700,  condition: s => s.rank <= 3  && s.rank > 0 },
  { id:'r4',  category:'Rankings',   icon:'🥇', title:'Champion',          desc:'Reach #1 on the gym leaderboard',         rarity:'legendary', xp:1500, condition: s => s.rank === 1               },
]

const RARITY = {
  common:    { name:'Common',    color:'#b0bec5', glow:'rgba(176,190,197,0.35)', stars:1 },
  uncommon:  { name:'Uncommon',  color:'#22c55e', glow:'rgba(34,197,94,0.4)',    stars:2 },
  rare:      { name:'Rare',      color:'#42a5f5', glow:'rgba(66,165,245,0.45)',  stars:3 },
  epic:      { name:'Epic',      color:'#c084fc', glow:'rgba(192,132,252,0.5)',  stars:4 },
  legendary: { name:'Legendary', color:'#f5c842', glow:'rgba(245,200,66,0.6)',   stars:5 },
}

const CATEGORIES = [
  { id:'All',         icon:'🏆', color:'#f5c842' },
  { id:'Milestones',  icon:'🥊', color:'#e84a2f' },
  { id:'Streaks',     icon:'🔥', color:'#e84a2f' },
  { id:'Levels',      icon:'⚡', color:'#42a5f5' },
  { id:'Consistency', icon:'📅', color:'#22c55e' },
  { id:'Rankings',    icon:'📊', color:'#c084fc' },
]

const DIVISIONS = ['Beginner', 'Intermediate', 'Advanced']
const LEVEL_BONUS_MAP = { Beginner:0, Intermediate:150, Advanced:350, Expert:600, Elite:1000 }

function normalizeDivision(level) {
  const normalized = String(level || 'Beginner').trim()
  return DIVISIONS.includes(normalized) ? normalized : 'Beginner'
}
function calcMyScore(totalWorkouts, streak, weeklyPct, level) {
  return (totalWorkouts*10)+(streak*5)+(LEVEL_BONUS_MAP[level]||0)+Math.round(weeklyPct*1.5)
}
function calcMemberScore(u) {
  return ((u.totalWorkouts||0)*10)+((u.streak||0)*5)+(LEVEL_BONUS_MAP[u.experience||u.currentLevel||u.level]||0)+Math.round((u.weeklyPct||0)*1.5)
}

function getProgress(badge, stats) {
  if (badge.id.startsWith('w')) {
    const targets = { w1:1, w2:10, w3:20, w4:30, w5:50, w6:100 }
    return Math.min(stats.totalWorkouts / (targets[badge.id]||1), 1)
  }
  if (badge.id.startsWith('s')) {
    const targets = { s1:3, s2:7, s3:14, s4:30 }
    return Math.min(stats.streak / (targets[badge.id]||1), 1)
  }
  if (badge.id.startsWith('l')) {
    const targets = { l1:1, l2:25, l3:50, l4:75, l5:100 }
    return Math.min(stats.totalWorkouts / (targets[badge.id]||1), 1)
  }
  if (badge.id.startsWith('c')) {
    const targets = { c1:50, c2:75, c3:100 }
    return Math.min(stats.weeklyPct / (targets[badge.id]||1), 1)
  }
  if (badge.id === 'r1') return Math.min(stats.totalWorkouts, 1)
  if (badge.id === 'r2') return stats.rank<=10 && stats.rank>0 ? 1 : 0
  if (badge.id === 'r3') return stats.rank<=3  && stats.rank>0 ? 1 : 0
  if (badge.id === 'r4') return stats.rank===1 ? 1 : 0
  return 0
}

function getProgressLabel(badge, stats) {
  if (badge.id.startsWith('w')) {
    const targets = { w1:1, w2:10, w3:20, w4:30, w5:50, w6:100 }
    const t = targets[badge.id]||1
    return `${Math.min(stats.totalWorkouts,t)}/${t}`
  }
  if (badge.id.startsWith('s')) {
    const targets = { s1:3, s2:7, s3:14, s4:30 }
    const t = targets[badge.id]||1
    return `${Math.min(stats.streak,t)}/${t}`
  }
  if (badge.id.startsWith('l')) {
    const targets = { l1:1, l2:25, l3:50, l4:75, l5:100 }
    const t = targets[badge.id]||1
    return `${Math.min(stats.totalWorkouts,t)}/${t}`
  }
  if (badge.id.startsWith('c')) {
    const targets = { c1:50, c2:75, c3:100 }
    const t = targets[badge.id]||1
    return `${Math.min(stats.weeklyPct,t)}%/${t}%`
  }
  if (badge.id === 'r2') return `Rank #${stats.rank}/10`
  if (badge.id === 'r3') return `Rank #${stats.rank}/3`
  if (badge.id === 'r4') return `Rank #${stats.rank}`
  return ''
}

// ════════════════════════════════════════════════════════
//  BADGE CARD — Bigger, more cinematic
// ════════════════════════════════════════════════════════
function BadgeCard({ badge, unlocked, progress, stats, onClick, idx }) {
  const [mounted, setMounted] = useState(false)
  const [hovered, setHovered] = useState(false)
  const r = RARITY[badge.rarity]
  useEffect(() => { const t=setTimeout(()=>setMounted(true), idx*40); return ()=>clearTimeout(t) }, [idx])

  return (
    <div
      onClick={onClick}
      onMouseEnter={()=>setHovered(true)}
      onMouseLeave={()=>setHovered(false)}
      style={{
        position:'relative', overflow:'hidden', cursor:'pointer',
        background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',
        borderRadius:18,
        border:`1.5px solid ${unlocked ? (hovered ? r.color : r.color+'55') : (hovered ? r.color+'30' : 'rgba(255,255,255,0.06)')}`,
        padding:'20px 18px 18px',
        display:'flex', flexDirection:'column', gap:10,
        minHeight:240,
        opacity: mounted ? 1 : 0,
        transform: mounted ? (hovered ? 'translateY(-6px) scale(1.02)' : 'translateY(0) scale(1)') : 'translateY(20px) scale(0.95)',
        transition: `all 0.4s cubic-bezier(0.34,1.2,0.64,1) ${idx*40}ms, transform 0.3s cubic-bezier(0.34,1.56,0.64,1)`,
        boxShadow: hovered ? `0 16px 40px rgba(0,0,0,0.6),0 0 30px ${r.glow}` : (unlocked ? `0 4px 14px ${r.glow}25` : '0 2px 8px rgba(0,0,0,0.3)'),
      }}>

      <div style={{position:'absolute', top:12, right:14, fontSize:9, letterSpacing:'0.05em', color:r.color, fontWeight:800, textShadow:unlocked?`0 0 8px ${r.color}88`:'none', opacity:unlocked?1:0.5}}>
        {Array.from({length:r.stars}).map(()=>'★').join('')}
      </div>

      {unlocked && (
        <div style={{position:'absolute', left:'50%', top:30, transform:'translateX(-50%)', width:140, height:140, borderRadius:'50%', background:`radial-gradient(circle,${r.glow},transparent 70%)`, pointerEvents:'none', opacity:hovered?0.9:0.55, transition:'opacity 0.3s'}}/>
      )}

      <div style={{position:'relative', display:'flex', justifyContent:'center', marginTop:8, marginBottom:2}}>
        <div style={{
          position:'relative', width:78, height:78, borderRadius:18,
          background: unlocked ? `linear-gradient(135deg,${r.color},${r.color}88)` : 'rgba(40,35,32,0.7)',
          border: `2px solid ${unlocked?r.color:'rgba(255,255,255,0.08)'}`,
          display:'flex', alignItems:'center', justifyContent:'center',
          fontSize:36,
          boxShadow: unlocked ? `0 6px 18px ${r.glow},inset 0 2px 6px rgba(255,255,255,0.15)` : 'none',
          filter: unlocked ? 'none' : 'grayscale(0.85) brightness(0.55)',
          transition: 'all 0.3s ease',
          animation: unlocked && hovered ? 'badgeBounce 0.5s ease' : 'none',
        }}>
          {badge.icon}
          {!unlocked && (
            <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.5)', borderRadius:18}}>
              <span style={{fontSize:24}}>🔒</span>
            </div>
          )}
        </div>
      </div>

      <div style={{textAlign:'center'}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:16, letterSpacing:'0.04em', color:unlocked?r.color:'#888', marginBottom:3, textShadow:unlocked?`0 0 10px ${r.glow}`:'none', lineHeight:1.2}}>
          {badge.title}
        </div>
        <div style={{fontSize:10, color:'#777', lineHeight:1.5, padding:'0 4px'}}>
          {badge.desc}
        </div>
      </div>

      <div style={{marginTop:'auto', paddingTop:6, display:'flex', flexDirection:'column', gap:6}}>
        <div style={{display:'flex', justifyContent:'center'}}>
          <span style={{fontSize:9, fontWeight:800, padding:'3px 10px', borderRadius:50, background:unlocked?`${r.color}22`:'rgba(255,255,255,0.04)', color:unlocked?r.color:'#666', border:`1px solid ${unlocked?r.color+'55':'rgba(255,255,255,0.08)'}`, letterSpacing:'0.08em'}}>
            {unlocked ? '+' : ''}{badge.xp} XP
          </span>
        </div>
        {unlocked ? (
          <div style={{display:'flex', justifyContent:'center'}}>
            <span style={{fontSize:9, fontWeight:800, padding:'4px 12px', borderRadius:50, background:`linear-gradient(135deg,${r.color},${r.color}cc)`, color:'#0a0808', letterSpacing:'0.1em', boxShadow:`0 4px 12px ${r.glow}`}}>
              ✓ UNLOCKED
            </span>
          </div>
        ) : (
          <div>
            <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:4, padding:'0 2px'}}>
              <span style={{fontSize:8, color:'#555', fontWeight:700, letterSpacing:'0.1em'}}>PROGRESS</span>
              <span style={{fontSize:9, color:r.color, fontWeight:700}}>{getProgressLabel(badge, stats) || `${Math.round((progress||0)*100)}%`}</span>
            </div>
            <div style={{height:5, background:'rgba(255,255,255,0.04)', borderRadius:50, overflow:'hidden', border:'1px solid rgba(255,255,255,0.04)'}}>
              <div style={{height:'100%', background:`linear-gradient(90deg,${r.color},${r.color}aa)`, borderRadius:50, width:`${Math.min((progress||0)*100, 100)}%`, transition:'width 0.6s ease', boxShadow:`0 0 6px ${r.color}aa`}}/>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ════════════════════════════════════════════════════════
//  MAIN
// ════════════════════════════════════════════════════════
export default function Achievements() {
  const canvasRef = useRef(null)
  const [category, setCategory] = useState('All')
  const [showOnly, setShowOnly] = useState('all')
  const [showcase, setShowcase] = useState(null)
  const [firestoreStats, setFirestoreStats] = useState(null)
  const [gymScores, setGymScores] = useState([])

  // localStorage as instant fallback
  const localProfile = useMemo(() => {
    try {
      const p = JSON.parse(localStorage.getItem('hittrack_profile') || '{}')
      const s = JSON.parse(localStorage.getItem('hittrack_stats')   || '{}')
      return { ...p, ...s }
    } catch { return {} }
  }, [])

  // Load user stats + gym members from Firestore
  useEffect(() => {
    const user = auth.currentUser
    if (!user) return
    (async () => {
      try {
        // Load user's own stats from Firestore
        const [userSnap, statsSnap] = await Promise.all([
          getDoc(doc(db, 'users', user.uid)),
          getDoc(doc(db, 'stats', user.uid)),
        ])
        const userData = userSnap.exists() ? userSnap.data() : {}
        const statsData = statsSnap.exists() ? statsSnap.data() : {}
        setFirestoreStats({ ...userData, ...statsData })

        // Load all gym members for rank calculation
        const usersSnap = await getDocs(collection(db, 'users'))
        const scores = []
        for (const ud of usersSnap.docs) {
          const d = ud.data()
          if (d.role && d.role !== 'member') continue
          if (d.status === 'inactive') continue
          if (!d.name) continue
          let memberStats = {}
          try {
            const ss = await getDoc(doc(db, 'stats', ud.id))
            if (ss.exists()) memberStats = ss.data()
          } catch(e) { /* ok */ }
          const merged = { ...d, ...memberStats }
          const division = normalizeDivision(
            d.experience || memberStats.experience || d.currentLevel || memberStats.currentLevel || d.level
          )
          scores.push({ uid: ud.id, score: Math.round(calcMemberScore(merged)), division })
        }
        setGymScores(scores)
      } catch (e) {
        console.warn('Achievements data load:', e.message)
      }
    })()
  }, [])

  // Merge: Firestore takes priority over localStorage
  const profile = firestoreStats ? { ...localProfile, ...firestoreStats } : localProfile

  const totalWorkouts = profile.totalWorkouts || 0
  const streak        = profile.streak        || 0
  const weeklyPct     = profile.weeklyPct     || 0
  const currentLevel  = profile.currentLevel  || profile.experience || 'Beginner'
  const myDivision    = normalizeDivision(currentLevel)

  // Rank within your division — same logic as the Leaderboard page
  const rank = (() => {
    const myUid = auth.currentUser?.uid
    const divisionMembers = gymScores
      .filter(u => u.division === myDivision)
      .sort((a, b) => b.score - a.score)
    if (divisionMembers.length === 0) return 1
    const idx = divisionMembers.findIndex(u => u.uid === myUid)
    if (idx >= 0) return idx + 1
    const myScore = calcMyScore(totalWorkouts, streak, weeklyPct, currentLevel)
    return divisionMembers.filter(u => u.score > myScore).length + 1
  })()

  const stats = { totalWorkouts, streak, weeklyPct, rank }

  const badgeStatus = useMemo(() => BADGES.map(b => ({ ...b, unlocked: b.condition(stats) })), [totalWorkouts, streak, weeklyPct, rank])

  const unlockedCount    = badgeStatus.filter(b => b.unlocked).length
  const totalXP          = badgeStatus.filter(b => b.unlocked).reduce((a,b) => a+b.xp, 0)
  const totalPossibleXP  = BADGES.reduce((a,b) => a+b.xp, 0)
  const completionPct    = Math.round((unlockedCount/BADGES.length)*100)

  const rarityCount = useMemo(() => {
    const c = { common:0, uncommon:0, rare:0, epic:0, legendary:0 }
    badgeStatus.filter(b => b.unlocked).forEach(b => c[b.rarity]++)
    return c
  }, [badgeStatus])

  const featured = useMemo(() => {
    const order = ['legendary','epic','rare','uncommon','common']
    for (const tier of order) {
      const got = badgeStatus.filter(b => b.unlocked && b.rarity === tier)
      if (got.length > 0) return got[got.length-1]
    }
    const locked = badgeStatus.filter(b => !b.unlocked)
    if (locked.length === 0) return badgeStatus[0]
    return locked.sort((a,b) => getProgress(b, stats) - getProgress(a, stats))[0]
  }, [badgeStatus, stats])

  const filtered = badgeStatus
    .filter(b => category === 'All' || b.category === category)
    .filter(b => showOnly === 'all' || (showOnly==='unlocked' ? b.unlocked : !b.unlocked))

  const grouped = useMemo(() => {
    if (category !== 'All') return [{ cat:category, items:filtered }]
    const map = {}
    filtered.forEach(b => { (map[b.category] = map[b.category] || []).push(b) })
    return Object.entries(map).map(([cat, items]) => ({ cat, items }))
  }, [filtered, category])

  // Canvas grid background (preserved)
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); let animId, t=0
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize(); window.addEventListener('resize', resize)
    const draw = () => {
      ctx.clearRect(0,0,canvas.width,canvas.height); t += 0.005
      ctx.strokeStyle = 'rgba(245,200,66,0.025)'; ctx.lineWidth = 1
      const g = 80
      for (let x=0; x<canvas.width+g; x+=g) { const o=(t*15)%g; ctx.beginPath(); ctx.moveTo(x-o,0); ctx.lineTo(x-o,canvas.height); ctx.stroke() }
      for (let y=0; y<canvas.height+g; y+=g) { const o=(t*8)%g;  ctx.beginPath(); ctx.moveTo(0,y-o); ctx.lineTo(canvas.width,y-o); ctx.stroke() }
      const orbs = [
        {x:canvas.width*0.1, y:canvas.height*0.2, r:300, c:'rgba(245,200,66,0.04)'},
        {x:canvas.width*0.9, y:canvas.height*0.6, r:280, c:'rgba(232,74,47,0.03)'},
        {x:canvas.width*0.5, y:canvas.height*0.9, r:250, c:'rgba(192,132,252,0.03)'},
      ]
      orbs.forEach(o => {
        const grd = ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r)
        grd.addColorStop(0, o.c); grd.addColorStop(1, 'transparent')
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(o.x,o.y,o.r,0,Math.PI*2); ctx.fill()
      })
      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [])

  return (
    <>
      <Navbar user={{name: profile.name||'Athlete'}}/>
      <canvas ref={canvasRef} style={{position:'fixed', inset:0, width:'100%', height:'100%', zIndex:0, pointerEvents:'none'}}/>

      <div style={{position:'relative', zIndex:1, maxWidth:1400, margin:'0 auto', padding:'24px 40px 80px', display:'flex', flexDirection:'column', gap:18, fontFamily:'Montserrat,sans-serif'}}>

        {/* HEADER */}
        <div style={{...glass({borderRadius:20}), padding:'24px 32px', display:'flex', alignItems:'center', justifyContent:'space-between', position:'relative', overflow:'hidden', border:'1px solid rgba(245,200,66,0.2)', flexWrap:'wrap', gap:20}}>
          <div style={{position:'absolute', top:-40, right:200, fontSize:140, opacity:0.04, filter:'blur(2px)', userSelect:'none', animation:'trophyFloat 4s ease infinite', pointerEvents:'none'}}>🏆</div>
          <div style={{position:'relative', zIndex:1}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:36, letterSpacing:'0.06em', color:'#f0ece8', lineHeight:1, textShadow:'0 0 24px rgba(245,200,66,0.3)'}}>
              🏆 HALL OF CHAMPIONS
            </div>
            <div style={{fontSize:11, color:'#777', letterSpacing:'0.18em', textTransform:'uppercase', fontWeight:700, marginTop:6}}>
              {profile.name||'Athlete'} · Your boxing trophy room
            </div>
          </div>
          <div style={{display:'flex', gap:10, position:'relative', zIndex:1, flexWrap:'wrap'}}>
            {[
              {label:'Unlocked',   val:`${unlockedCount}/${BADGES.length}`,  color:'#f5c842'},
              {label:'Total XP',   val:totalXP.toLocaleString(),             color:'#22c55e'},
              {label:'Completion', val:`${completionPct}%`,                  color:'#e84a2f'},
            ].map((st,i) => (
              <div key={i} style={{textAlign:'center', background:'rgba(255,255,255,0.04)', border:`1px solid ${st.color}33`, borderRadius:14, padding:'12px 18px', minWidth:96}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:24, color:st.color, lineHeight:1, textShadow:`0 0 12px ${st.color}66`}}>{st.val}</div>
                <div style={{fontSize:8, color:'#666', fontWeight:700, letterSpacing:'0.12em', marginTop:4, textTransform:'uppercase'}}>{st.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* HERO TROPHY SHOWCASE */}
        {featured && (() => {
          const r = RARITY[featured.rarity]
          const isUnlocked = featured.unlocked
          const prog = getProgress(featured, stats)
          return (
            <div onClick={()=>setShowcase(featured)}
              style={{position:'relative', overflow:'hidden', cursor:'pointer', borderRadius:24, background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)', border:`2px solid ${r.color}55`, padding:'30px 36px', boxShadow:`0 20px 60px rgba(0,0,0,0.6),0 0 60px ${r.glow}`, display:'flex', gap:30, alignItems:'center', flexWrap:'wrap'}}>
              <div style={{position:'absolute', top:-100, right:-100, width:400, height:400, borderRadius:'50%', background:`radial-gradient(circle,${r.glow},transparent 65%)`, pointerEvents:'none', animation:'heroGlow 4s ease-in-out infinite'}}/>
              <div style={{position:'absolute', bottom:-80, left:-80, width:320, height:320, borderRadius:'50%', background:`radial-gradient(circle,${r.glow},transparent 70%)`, pointerEvents:'none', opacity:0.5}}/>
              <div style={{position:'relative', flexShrink:0}}>
                <div style={{position:'absolute', inset:-20, borderRadius:'50%', background:`radial-gradient(circle,${r.glow},transparent 70%)`, animation:'pulseTrophy 2.5s ease-in-out infinite', pointerEvents:'none'}}/>
                <div style={{position:'relative', width:160, height:160, borderRadius:30, background:isUnlocked?`linear-gradient(135deg,${r.color},${r.color}88)`:'rgba(40,35,32,0.8)', border:`3px solid ${r.color}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:72, boxShadow:`0 12px 40px ${r.glow},inset 0 4px 12px rgba(255,255,255,0.15)`, filter:isUnlocked?'none':'grayscale(0.7) brightness(0.6)'}}>
                  {featured.icon}
                  {!isUnlocked && (
                    <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.45)', borderRadius:30}}>
                      <span style={{fontSize:50}}>🔒</span>
                    </div>
                  )}
                </div>
              </div>
              <div style={{flex:1, minWidth:260, position:'relative', zIndex:1}}>
                <div style={{display:'flex', alignItems:'center', gap:8, marginBottom:8, flexWrap:'wrap'}}>
                  <span style={{fontSize:9, fontWeight:800, padding:'4px 10px', borderRadius:50, background:isUnlocked?`${r.color}25`:'rgba(255,255,255,0.04)', color:isUnlocked?r.color:'#666', border:`1px solid ${isUnlocked?r.color+'55':'rgba(255,255,255,0.08)'}`, letterSpacing:'0.12em', textTransform:'uppercase'}}>
                    {isUnlocked ? '🏆 LATEST UNLOCK' : '🎯 NEXT TARGET'}
                  </span>
                  <span style={{fontSize:9, fontWeight:800, padding:'4px 10px', borderRadius:50, background:`${r.color}22`, color:r.color, border:`1px solid ${r.color}44`, letterSpacing:'0.1em', textTransform:'uppercase'}}>
                    {Array.from({length:r.stars}).map(()=>'★').join('')} {r.name}
                  </span>
                  <span style={{fontSize:9, fontWeight:700, color:'#666', letterSpacing:'0.1em'}}>· {featured.category} · +{featured.xp} XP</span>
                </div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:42, color:isUnlocked?r.color:'#888', letterSpacing:'0.04em', lineHeight:1, marginBottom:8, textShadow:isUnlocked?`0 0 20px ${r.glow}`:'none'}}>
                  {featured.title}
                </div>
                <div style={{fontSize:13, color:'#aaa', lineHeight:1.6, marginBottom:14}}>{featured.desc}</div>
                {isUnlocked ? (
                  <div style={{display:'flex', gap:10, alignItems:'center'}}>
                    <div style={{padding:'8px 16px', background:`linear-gradient(135deg,${r.color},${r.color}aa)`, borderRadius:50, fontSize:11, fontWeight:800, color:'#0a0808', letterSpacing:'0.1em', boxShadow:`0 4px 14px ${r.glow}`}}>✓ UNLOCKED</div>
                    <span style={{fontSize:10, color:'#888'}}>Tap to view details 🥊</span>
                  </div>
                ) : (
                  <div>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6}}>
                      <span style={{fontSize:9, color:'#666', fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase'}}>Progress</span>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:18, color:r.color}}>{getProgressLabel(featured, stats) || `${Math.round(prog*100)}%`}</span>
                    </div>
                    <div style={{height:10, background:'rgba(255,255,255,0.04)', borderRadius:50, overflow:'hidden', border:'1px solid rgba(255,255,255,0.04)'}}>
                      <div style={{height:'100%', background:`linear-gradient(90deg,${r.color},${r.color}cc)`, borderRadius:50, width:`${prog*100}%`, transition:'width 0.8s ease', boxShadow:`0 0 14px ${r.color}aa`}}/>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* XP PROGRESS BAR */}
        <div style={{...glass({borderRadius:14}), padding:'14px 22px'}}>
          <div style={{display:'flex', justifyContent:'space-between', marginBottom:8, alignItems:'baseline'}}>
            <span style={{fontSize:10, fontWeight:800, color:'#888', letterSpacing:'0.12em', textTransform:'uppercase'}}>Overall XP Progress</span>
            <span style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:14, color:'#f5c842', letterSpacing:'0.04em'}}>{totalXP.toLocaleString()} <span style={{color:'#666'}}>/ {totalPossibleXP.toLocaleString()} XP</span></span>
          </div>
          <div style={{height:10, background:'rgba(255,255,255,0.06)', borderRadius:50, overflow:'hidden', position:'relative', border:'1px solid rgba(255,255,255,0.04)'}}>
            <div style={{position:'absolute', inset:0, background:'repeating-linear-gradient(90deg,transparent,transparent 40px,rgba(255,255,255,0.03) 40px,rgba(255,255,255,0.03) 41px)'}}/>
            <div style={{height:'100%', background:'linear-gradient(90deg,#e84a2f,#f5c842,#22c55e)', borderRadius:50, width:`${(totalXP/totalPossibleXP)*100}%`, transition:'width 1.2s ease', boxShadow:'0 0 20px rgba(245,200,66,0.5)'}}/>
          </div>
          <div style={{display:'flex', justifyContent:'space-between', marginTop:8}}>
            {['Beginner','Intermediate','Advanced','Expert','Legend'].map((l,i) => (
              <span key={i} style={{fontSize:9, color:'#555', fontWeight:700, letterSpacing:'0.06em'}}>{l}</span>
            ))}
          </div>
        </div>

        {/* RARITY STAT BAR */}
        <div style={{display:'grid', gridTemplateColumns:'repeat(5,1fr)', gap:10}}>
          {Object.entries(RARITY).map(([key, r]) => {
            const total = BADGES.filter(b => b.rarity === key).length
            const got = rarityCount[key]
            return (
              <div key={key} style={{position:'relative', overflow:'hidden', padding:'12px 14px', background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)', border:`1px solid ${r.color}25`, borderRadius:12, display:'flex', alignItems:'center', gap:10, transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)', cursor:'default'}}
                onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-3px)'; e.currentTarget.style.borderColor=r.color+'66'; e.currentTarget.style.boxShadow=`0 8px 24px ${r.glow}`}}
                onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)'; e.currentTarget.style.borderColor=r.color+'25'; e.currentTarget.style.boxShadow='none'}}>
                <div style={{width:36, height:36, borderRadius:10, background:`linear-gradient(135deg,${r.color},${r.color}aa)`, display:'flex', alignItems:'center', justifyContent:'center', color:'#0a0808', flexShrink:0, fontFamily:"'Bebas Neue',sans-serif", fontSize:18, fontWeight:800, boxShadow:`0 4px 12px ${r.glow}`}}>
                  {got}
                </div>
                <div style={{flex:1, minWidth:0}}>
                  <div style={{display:'flex', alignItems:'center', gap:4, marginBottom:3}}>
                    <span style={{fontSize:8, fontWeight:800, color:r.color, letterSpacing:'0.12em', textTransform:'uppercase'}}>{r.name}</span>
                    <span style={{fontSize:8, color:r.color, fontWeight:800}}>{Array.from({length:r.stars}).map(()=>'★').join('')}</span>
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:6}}>
                    <div style={{flex:1, height:4, background:'rgba(255,255,255,0.04)', borderRadius:50, overflow:'hidden'}}>
                      <div style={{height:'100%', background:r.color, borderRadius:50, width:total>0?`${(got/total)*100}%`:'0%', transition:'width 0.6s ease', boxShadow:`0 0 6px ${r.color}88`}}/>
                    </div>
                    <span style={{fontSize:8, color:'#666', fontWeight:700, flexShrink:0}}>{got}/{total}</span>
                  </div>
                </div>
              </div>
            )
          })}
        </div>

        {/* FILTERS */}
        <div style={{display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap'}}>
          <div style={{display:'flex', gap:4, background:'rgba(255,255,255,0.03)', borderRadius:50, padding:4, border:'1px solid rgba(255,255,255,0.06)', flexWrap:'wrap'}}>
            {CATEGORIES.map(cat => {
              const active = category === cat.id
              return (
                <button key={cat.id} onClick={()=>setCategory(cat.id)}
                  style={{display:'flex', alignItems:'center', gap:6, background:active?`${cat.color}20`:'transparent', color:active?cat.color:'#666', border:active?`1px solid ${cat.color}55`:'1px solid transparent', borderRadius:50, padding:'7px 14px', fontSize:10, fontWeight:800, cursor:'pointer', letterSpacing:'0.06em', transition:'all 0.25s'}}>
                  <span style={{fontSize:12}}>{cat.icon}</span>
                  {cat.id.toUpperCase()}
                </button>
              )
            })}
          </div>
          <div style={{display:'flex', gap:4, background:'rgba(255,255,255,0.03)', borderRadius:50, padding:4, border:'1px solid rgba(255,255,255,0.06)'}}>
            {[['all','All'],['unlocked','Unlocked ✓'],['locked','Locked 🔒']].map(([val,label]) => {
              const active = showOnly === val
              return (
                <button key={val} onClick={()=>setShowOnly(val)}
                  style={{background:active?'rgba(34,197,94,0.15)':'transparent', color:active?'#22c55e':'#666', border:active?'1px solid rgba(34,197,94,0.3)':'1px solid transparent', borderRadius:50, padding:'7px 14px', fontSize:10, fontWeight:800, cursor:'pointer', letterSpacing:'0.06em', transition:'all 0.25s'}}>
                  {label}
                </button>
              )
            })}
          </div>
        </div>

        {/* GALLERY */}
        {filtered.length === 0 ? (
          <div style={{...glass({borderRadius:18}), padding:'50px', textAlign:'center'}}>
            <div style={{fontSize:42, marginBottom:12, opacity:0.4}}>🔍</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:'#888', letterSpacing:'0.06em'}}>NO BADGES FOUND</div>
            <div style={{fontSize:11, color:'#555', marginTop:6}}>Try changing your filter</div>
          </div>
        ) : (
          grouped.map(({ cat, items }) => {
            const catInfo = CATEGORIES.find(c => c.id === cat) || CATEGORIES[0]
            const sectionUnlocked = items.filter(b => b.unlocked).length
            return (
              <div key={cat} style={{display:'flex', flexDirection:'column', gap:12}}>
                {category === 'All' && (
                  <div style={{display:'flex', alignItems:'center', gap:10, padding:'2px 4px'}}>
                    <span style={{fontSize:18}}>{catInfo.icon}</span>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:'0.08em', color:catInfo.color, textShadow:`0 0 14px ${catInfo.color}55`}}>{cat.toUpperCase()}</span>
                    <span style={{fontSize:9, fontWeight:800, padding:'2px 9px', borderRadius:50, background:`${catInfo.color}20`, color:catInfo.color, letterSpacing:'0.1em', border:`1px solid ${catInfo.color}40`}}>{sectionUnlocked}/{items.length}</span>
                    <div style={{flex:1, height:1, background:`linear-gradient(90deg,${catInfo.color}30,transparent)`}}/>
                  </div>
                )}
                <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:14}}>
                  {items.map((b,i) => (
                    <BadgeCard key={b.id} badge={b} unlocked={b.unlocked}
                      progress={b.unlocked?1:getProgress(b, stats)}
                      stats={stats}
                      onClick={()=>setShowcase(b)}
                      idx={i}/>
                  ))}
                </div>
              </div>
            )
          })
        )}
      </div>

      {/* SHOWCASE MODAL */}
      {showcase && (() => {
        const r = RARITY[showcase.rarity]
        const prog = getProgress(showcase, stats)
        return (
          <div onClick={()=>setShowcase(null)}
            style={{position:'fixed', inset:0, background:'rgba(0,0,0,0.92)', backdropFilter:'blur(12px)', zIndex:2000, display:'flex', alignItems:'center', justifyContent:'center', padding:20, animation:'popIn 0.3s ease'}}>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative', background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)', borderRadius:24, border:`2px solid ${r.color}66`, maxWidth:480, width:'100%', overflow:'hidden', boxShadow:`0 30px 80px rgba(0,0,0,0.8),0 0 60px ${r.glow}`, padding:'34px 32px', textAlign:'center'}}>
              <div style={{position:'absolute', top:-80, left:'50%', transform:'translateX(-50%)', width:360, height:360, borderRadius:'50%', background:`radial-gradient(circle,${r.glow},transparent 65%)`, pointerEvents:'none'}}/>
              <button onClick={()=>setShowcase(null)} style={{position:'absolute', top:14, right:14, width:32, height:32, background:'rgba(255,255,255,0.05)', border:'1px solid rgba(255,255,255,0.1)', borderRadius:9, color:'#888', fontSize:14, cursor:'pointer'}}>✕</button>
              <div style={{position:'relative'}}>
                <div style={{position:'relative', display:'inline-block', marginBottom:20}}>
                  {showcase.unlocked && <div style={{position:'absolute', inset:-20, borderRadius:'50%', background:`radial-gradient(circle,${r.glow},transparent 70%)`, animation:'pulseTrophy 2.5s ease-in-out infinite'}}/>}
                  <div style={{position:'relative', width:140, height:140, borderRadius:26, background:showcase.unlocked?`linear-gradient(135deg,${r.color},${r.color}88)`:'rgba(40,35,32,0.8)', border:`3px solid ${r.color}`, display:'flex', alignItems:'center', justifyContent:'center', fontSize:64, boxShadow:`0 12px 36px ${r.glow},inset 0 4px 10px rgba(255,255,255,0.15)`, filter:showcase.unlocked?'none':'grayscale(0.7) brightness(0.6)'}}>
                    {showcase.icon}
                    {!showcase.unlocked && <div style={{position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,0.45)', borderRadius:26}}><span style={{fontSize:46}}>🔒</span></div>}
                  </div>
                </div>
                <div style={{display:'flex', justifyContent:'center', gap:6, marginBottom:8, flexWrap:'wrap'}}>
                  <span style={{fontSize:9, fontWeight:800, padding:'4px 12px', borderRadius:50, background:`${r.color}22`, color:r.color, border:`1px solid ${r.color}55`, letterSpacing:'0.1em'}}>
                    {Array.from({length:r.stars}).map(()=>'★').join('')} {r.name.toUpperCase()}
                  </span>
                  <span style={{fontSize:9, fontWeight:800, padding:'4px 12px', borderRadius:50, background:'rgba(245,200,66,0.15)', color:'#f5c842', border:'1px solid rgba(245,200,66,0.35)', letterSpacing:'0.1em'}}>
                    +{showcase.xp} XP
                  </span>
                </div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:36, color:showcase.unlocked?r.color:'#888', letterSpacing:'0.04em', lineHeight:1, marginBottom:8, textShadow:showcase.unlocked?`0 0 16px ${r.glow}`:'none'}}>{showcase.title}</div>
                <div style={{fontSize:13, color:'#aaa', lineHeight:1.7, marginBottom:24}}>{showcase.desc}</div>
                {showcase.unlocked ? (
                  <div style={{padding:'14px 18px', background:`linear-gradient(135deg,${r.color}22,${r.color}10)`, border:`1px solid ${r.color}55`, borderRadius:14}}>
                    <div style={{fontSize:11, fontWeight:800, color:r.color, letterSpacing:'0.1em', textTransform:'uppercase'}}>✓ Achievement Earned</div>
                    <div style={{fontSize:10, color:'#888', marginTop:4}}>You've made it to the Hall of Champions for this milestone 🥊</div>
                  </div>
                ) : (
                  <div>
                    <div style={{display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:8, padding:'0 4px'}}>
                      <span style={{fontSize:9, color:'#666', fontWeight:700, letterSpacing:'0.12em', textTransform:'uppercase'}}>Progress to unlock</span>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:20, color:r.color}}>{getProgressLabel(showcase, stats) || `${Math.round(prog*100)}%`}</span>
                    </div>
                    <div style={{height:12, background:'rgba(255,255,255,0.04)', borderRadius:50, overflow:'hidden', border:'1px solid rgba(255,255,255,0.04)'}}>
                      <div style={{height:'100%', background:`linear-gradient(90deg,${r.color},${r.color}cc)`, borderRadius:50, width:`${prog*100}%`, transition:'width 0.8s ease', boxShadow:`0 0 14px ${r.color}aa`}}/>
                    </div>
                    <div style={{fontSize:11, color:'#888', marginTop:14}}>Keep training — you're on the way 🥊</div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

      <style>{`
        @keyframes trophyFloat { 0%,100% { transform: translateY(0) rotate(-3deg) } 50% { transform: translateY(-8px) rotate(3deg) } }
        @keyframes badgeBounce { 0%,100% { transform: scale(1) } 50% { transform: scale(1.2) } }
        @keyframes pulseTrophy { 0%,100% { transform: scale(1); opacity: 0.6 } 50% { transform: scale(1.15); opacity: 0.9 } }
        @keyframes heroGlow { 0%,100% { transform: scale(1); opacity: 1 } 50% { transform: scale(1.1); opacity: 0.7 } }
        @keyframes popIn { from { opacity: 0; transform: scale(0.85) } to { opacity: 1; transform: scale(1) } }
      `}</style>
    </>
  )
}

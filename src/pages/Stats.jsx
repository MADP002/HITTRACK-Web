import { useState, useEffect, useRef } from 'react'
import Navbar from '../components/Navbar'
import { auth, db } from '../firebase'
import { doc, getDoc, collection, getDocs, query, orderBy, limit } from 'firebase/firestore'
import { computeMembershipState, canBook, STATUS } from '../lib/membership'

// ── HELPERS ───────────────────────────────────────────
const glass = (extra={}) => ({
  background:'linear-gradient(135deg,rgba(30,28,28,0.97),rgba(18,16,16,0.99))',
  borderRadius:20, border:'1px solid rgba(245,200,66,0.15)',
  boxShadow:'0 8px 40px rgba(0,0,0,0.5),inset 0 1px 0 rgba(245,200,66,0.08)',
  overflow:'hidden', ...extra,
})

function AnimNum({ target, suffix='', decimals=0, duration=1200 }) {
  const [val,setVal]=useState(0)
  useEffect(()=>{
    let frame; const start=Date.now()
    const tick=()=>{
      const p=Math.min((Date.now()-start)/duration,1)
      setVal(parseFloat((target*(1-Math.pow(1-p,3))).toFixed(decimals)))
      if(p<1) frame=requestAnimationFrame(tick)
    }
    frame=requestAnimationFrame(tick)
    return()=>cancelAnimationFrame(frame)
  },[target])
  return <>{val.toLocaleString(undefined,{minimumFractionDigits:decimals,maximumFractionDigits:decimals})}{suffix}</>
}

function Bar({ value, max=100, color, delay=0 }) {
  const [w,setW]=useState(0)
  useEffect(()=>{ const t=setTimeout(()=>setW((value/max)*100),delay+300); return()=>clearTimeout(t) },[value])
  return(
    <div style={{flex:1,height:7,background:'rgba(255,255,255,0.06)',borderRadius:50,overflow:'hidden'}}>
      <div style={{height:'100%',borderRadius:50,background:color,width:`${w}%`,transition:'width 1.1s cubic-bezier(0.4,0,0.2,1)',boxShadow:`0 0 10px ${color}66`}}/>
    </div>
  )
}

const DIVISIONS = ['Beginner', 'Intermediate', 'Advanced']
const LEVEL_BONUS = { Beginner:0, Intermediate:150, Advanced:350, Expert:600, Elite:1000 }

function normalizeDivision(level) {
  const normalized = String(level || 'Beginner').trim()
  return DIVISIONS.includes(normalized) ? normalized : 'Beginner'
}
const LEVEL_COLOR = { Beginner:'#fb923c', Intermediate:'#f5c842', Advanced:'#4ade80', Expert:'#42a5f5', Elite:'#c084fc' }
const LEVEL_ICON  = { Beginner:'🥊', Intermediate:'⚡', Advanced:'🔥', Expert:'💎', Elite:'👑' }
function calcScore(u){ return ((u.workouts||u.totalWorkouts||0)*10)+((u.streak||0)*5)+(LEVEL_BONUS[u.level||u.currentLevel||u.experience]||0)+Math.round((u.weeklyPct||0)*1.5) }

// Radar (4 axes — comparable % within division)
const CX=130,CY=118,R=88
const RADAR_LABELS=['Workouts','Streak','Weekly%','Score']
const RADAR_COUNT=RADAR_LABELS.length

function radarPt(i, count, pct) {
  const a=(Math.PI*2*i)/count-Math.PI/2
  const r=(Math.min(Math.max(pct,0),100)/100)*R
  return{x:CX+r*Math.cos(a),y:CY+r*Math.sin(a)}
}
function gridPt(i,count,frac){
  const a=(Math.PI*2*i)/count-Math.PI/2
  return{x:CX+R*frac*Math.cos(a),y:CY+R*frac*Math.sin(a)}
}
function polygonPoints(pts){
  return pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
}

// ── MAIN ─────────────────────────────────────────────
export default function Stats() {
  const canvasRef=useRef(null)
  const [mounted,setMounted]=useState(false)
  const [radarIn,setRadarIn]=useState(false)
  const [poseData, setPoseData] = useState(null)
  const [poseSessions, setPoseSessions] = useState([])
  const [poseLoading, setPoseLoading] = useState(true)
  const [gymMembers, setGymMembers] = useState([])
  const [gymLoading, setGymLoading] = useState(true)

  // Read from both profile + stats
  const profile = (() => {
    try {
      const p = JSON.parse(localStorage.getItem('hittrack_profile')||'{}')
      const s = JSON.parse(localStorage.getItem('hittrack_stats')||'{}')
      return {...p,...s}
    } catch { return {} }
  })()

  // Load real gym members from Firestore for comparison
  useEffect(() => {
    (async () => {
      try {
        const usersSnap = await getDocs(collection(db, 'users'))
        const members = []
        for (const ud of usersSnap.docs) {
          const userData = ud.data()
          if (userData.role && userData.role !== 'member') continue
          if (userData.status === 'inactive') continue
          if (!userData.name) continue
          let stats = {}
          try {
            const ss = await getDoc(doc(db, 'stats', ud.id))
            if (ss.exists()) stats = ss.data()
          } catch(e) { /* stats may be missing */ }
          const merged = { ...userData, ...stats, uid: ud.id }
          merged.workouts = merged.totalWorkouts || 0
          merged.streak = merged.streak || 0
          merged.weeklyPct = merged.weeklyPct || 0
          merged.level = normalizeDivision(
            userData.experience || stats.experience || userData.currentLevel || stats.currentLevel
          )
          merged.score = Math.round(calcScore(merged))
          members.push(merged)
        }
        setGymMembers(members)
      } catch (e) {
        console.warn('Gym data load:', e.message)
      } finally {
        setGymLoading(false)
      }
    })()
  }, [])

  // Load pose/form analytics from Firestore
  useEffect(() => {
    const user = auth.currentUser
    if (!user) { setPoseLoading(false); return }
    (async () => {
      try {
        const statsSnap = await getDoc(doc(db, 'stats', user.uid))
        if (statsSnap.exists()) {
          const d = statsSnap.data()
          if (d.totalPoseSessions && d.totalPoseSessions > 0) {
            setPoseData({
              punchSpeed: d.punchSpeed || 0,
              powerOutput: d.powerOutput || 0,
              accuracy: d.accuracy || 0,
              comboFlow: d.comboFlow || 0,
              totalPoseSessions: d.totalPoseSessions || 0,
              lastPoseSession: d.lastPoseSession || null,
              formBreakdown: d.formBreakdown || null,
            })
          }
        }
        const sessionsRef = collection(db, 'stats', user.uid, 'poseSessions')
        const sessionsQ = query(sessionsRef, orderBy('date', 'desc'), limit(5))
        const sessionsSnap = await getDocs(sessionsQ)
        const sessions = sessionsSnap.docs.map(d => ({ id: d.id, ...d.data() }))
        setPoseSessions(sessions)
      } catch (e) {
        console.warn('Pose data load:', e.message)
      } finally {
        setPoseLoading(false)
      }
    })()
  }, [])

  // Membership gate — non-members and active members ignore this.
  // Stats are members-only; expired/paused users see a blurred preview + lock card.
  const isMember = (profile.role || 'member') === 'member'
  const membershipBlocked = isMember && !canBook(profile.membership)
  const membershipState = computeMembershipState(profile.membership)

  const totalWorkouts = profile.totalWorkouts || 0
  const streak        = profile.streak        || 0
  const weeklyPct     = profile.weeklyPct     || 0
  const currentLevel  = normalizeDivision(profile.currentLevel || profile.experience)
  const levelBonus    = LEVEL_BONUS[currentLevel] || 0
  const myScore       = calcScore({ workouts:totalWorkouts, streak, weeklyPct, level:currentLevel })
  const divisionPeers = gymMembers.filter(u => u.level === currentLevel)

  const bmi = profile.bmi || (profile.height && profile.weight
    ? parseFloat((profile.weight/((profile.height/100)**2)).toFixed(1))
    : null)
  const bmiLabel = !bmi?'—':bmi<18.5?'Underweight':bmi<25?'Normal':bmi<30?'Overweight':'Obese'
  const bmiColor = !bmi?'#555':bmi<18.5?'#42a5f5':bmi<25?'#4ade80':bmi<30?'#f5c842':'#e84a2f'

  // Division rank — matches Leaderboard (Beginner / Intermediate / Advanced)
  const myUid = auth.currentUser?.uid
  const myRank = (() => {
    const sorted = [...divisionPeers].sort((a, b) => b.score - a.score)
    if (sorted.length === 0) return 1
    const idx = sorted.findIndex(u => u.uid === myUid)
    if (idx >= 0) return idx + 1
    return sorted.filter(u => u.score > myScore).length + 1
  })()

  // Division averages for radar comparison
  const GYM_AVG = (() => {
    if (divisionPeers.length === 0) return { workouts: 0, streak: 0, weeklyPct: 0, score: 0 }
    const count = divisionPeers.length
    return {
      workouts: Math.round(divisionPeers.reduce((a, u) => a + (u.workouts || 0), 0) / count),
      streak: Math.round(divisionPeers.reduce((a, u) => a + (u.streak || 0), 0) / count),
      weeklyPct: Math.round(divisionPeers.reduce((a, u) => a + (u.weeklyPct || 0), 0) / count),
      score: Math.round(divisionPeers.reduce((a, u) => a + (u.score || 0), 0) / count),
    }
  })()
  const divisionSorted = [...divisionPeers].sort((a, b) => b.score - a.score)
  const MAX_SCORE = divisionSorted.length > 0 ? divisionSorted[0].score : Math.max(myScore, 1)

  // Radar — % of division best per axis (so shapes render fairly)
  const radarAxisMax = {
    workouts: Math.max(...divisionPeers.map(u => u.workouts || 0), totalWorkouts, 1),
    streak: Math.max(...divisionPeers.map(u => u.streak || 0), streak, 1),
    weeklyPct: 100,
    score: Math.max(...divisionPeers.map(u => u.score || 0), myScore, 1),
  }
  const toPct = (val, max) => Math.min((val / max) * 100, 100)
  const myRadarPct = [
    toPct(totalWorkouts, radarAxisMax.workouts),
    toPct(streak, radarAxisMax.streak),
    toPct(weeklyPct, radarAxisMax.weeklyPct),
    toPct(myScore, radarAxisMax.score),
  ]
  const avgRadarPct = [
    toPct(GYM_AVG.workouts, radarAxisMax.workouts),
    toPct(GYM_AVG.streak, radarAxisMax.streak),
    toPct(GYM_AVG.weeklyPct, radarAxisMax.weeklyPct),
    toPct(GYM_AVG.score, radarAxisMax.score),
  ]

  const myPts  = myRadarPct.map((pct,i)=>radarPt(i,RADAR_COUNT,pct))
  const avgPts = avgRadarPct.map((pct,i)=>radarPt(i,RADAR_COUNT,pct))
  const lblPts = RADAR_LABELS.map((_,i)=>{ const a=(Math.PI*2*i)/RADAR_COUNT-Math.PI/2; return{x:CX+(R+30)*Math.cos(a),y:CY+(R+30)*Math.sin(a)} })

  useEffect(()=>{
    const t1=setTimeout(()=>setMounted(true),100)
    const t2=setTimeout(()=>setRadarIn(true),500)
    return()=>{clearTimeout(t1);clearTimeout(t2)}
  },[])

  // Canvas background
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas)return
    const ctx=canvas.getContext('2d'); let animId,t=0
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight}
    resize(); window.addEventListener('resize',resize)
    const draw=()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height); t+=0.005
      ctx.strokeStyle='rgba(245,200,66,0.025)'; ctx.lineWidth=1
      const g=80
      for(let x=0;x<canvas.width+g;x+=g){const o=(t*15)%g;ctx.beginPath();ctx.moveTo(x-o,0);ctx.lineTo(x-o,canvas.height);ctx.stroke()}
      for(let y=0;y<canvas.height+g;y+=g){const o=(t*8)%g;ctx.beginPath();ctx.moveTo(0,y-o);ctx.lineTo(canvas.width,y-o);ctx.stroke()}
      const orbs=[
        {x:canvas.width*0.1,y:canvas.height*0.15,r:280,c:'rgba(232,74,47,0.04)'},
        {x:canvas.width*0.9,y:canvas.height*0.5, r:320,c:'rgba(245,200,66,0.03)'},
        {x:canvas.width*0.5,y:canvas.height*0.9, r:250,c:'rgba(66,165,245,0.025)'},
      ]
      orbs.forEach(o=>{
        const g=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r)
        g.addColorStop(0,o.c);g.addColorStop(1,'transparent')
        ctx.fillStyle=g;ctx.beginPath();ctx.arc(o.x,o.y,o.r,0,Math.PI*2);ctx.fill()
      })
      animId=requestAnimationFrame(draw)
    }
    draw()
    return()=>{cancelAnimationFrame(animId);window.removeEventListener('resize',resize)}
  },[])

  const lc = LEVEL_COLOR[currentLevel]||'#f5c842'

  return(
    <>
      <Navbar user={{name:profile.name||'Athlete'}}/>
      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',zIndex:0,pointerEvents:'none'}}/>

      <div style={{position:'relative',zIndex:1,maxWidth:1200,margin:'0 auto',padding:'28px 40px 60px',display:'flex',flexDirection:'column',gap:20,fontFamily:'Montserrat,sans-serif'}}>

        {/* HEADER */}
        <div style={{...glass({borderRadius:18}),padding:'24px 32px',display:'flex',alignItems:'center',justifyContent:'space-between',border:'1px solid rgba(232,74,47,0.2)'}}>
          <div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:'0.06em',color:'#f0ece8',lineHeight:1}}>📊 My Stats</div>
            <div style={{fontSize:13,color:'#7a7570',marginTop:4}}>
              {profile.name||'Athlete'} · {currentLevel} · {profile.goal||'Learn Boxing'}
            </div>
          </div>
          <div style={{display:'flex',gap:12,alignItems:'center'}}>
            <div style={{textAlign:'center',background:'rgba(245,200,66,0.08)',border:'1px solid rgba(245,200,66,0.2)',borderRadius:14,padding:'12px 20px'}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,color:'#f5c842',lineHeight:1}}><AnimNum target={myScore}/></div>
              <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.1em',marginTop:3}}>MY SCORE</div>
            </div>
            <div style={{textAlign:'center',background:`${lc}12`,border:`1px solid ${lc}33`,borderRadius:14,padding:'12px 20px'}}>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,color:lc,lineHeight:1}}>#{myRank}</div>
              <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.1em',marginTop:3}}>DIV RANK</div>
            </div>
          </div>
        </div>

        {/* ════════════════════════════════════════════════ */}
        {/*  Everything below the header is membership-gated. */}
        {/*  Expired/paused members see blurred preview +     */}
        {/*  centered lock card prompting renewal.            */}
        {/* ════════════════════════════════════════════════ */}
        <div style={{position:'relative'}}>
          <div style={{
            filter: membershipBlocked ? 'blur(7px)' : 'none',
            pointerEvents: membershipBlocked ? 'none' : 'auto',
            userSelect: membershipBlocked ? 'none' : 'auto',
            transition: 'filter 0.3s',
          }}>

        {/* MAIN GRID */}
        <div style={{display:'grid',gridTemplateColumns:'1.2fr 1fr 1fr',gap:18}}>

          {/* YOU VS DIVISION AVERAGE — RADAR */}
          <div style={glass()}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid rgba(245,200,66,0.08)'}}>
              <div style={{fontSize:14,fontWeight:700}}>You vs Division Average</div>
              <div style={{fontSize:11,color:'#555',marginTop:2}}>{gymLoading ? 'Loading...' : `${currentLevel} division · ${divisionPeers.length} member${divisionPeers.length!==1?'s':''}`}</div>
            </div>
            <div style={{padding:'16px',display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
              <svg width="280" height="230" viewBox="0 0 280 230" style={{overflow:'visible',display:'block'}}>
                <defs>
                  <radialGradient id="myGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#f5c842" stopOpacity="0.25"/>
                    <stop offset="100%" stopColor="#f5c842" stopOpacity="0"/>
                  </radialGradient>
                  <filter id="glow3"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                </defs>

                {[0.25,0.5,0.75,1].map((frac,fi)=>{
                  const pts=RADAR_LABELS.map((_,i)=>gridPt(i,RADAR_COUNT,frac))
                  return<polygon key={fi} points={pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                    fill="none" stroke={frac===1?'rgba(255,255,255,0.1)':'rgba(255,255,255,0.04)'} strokeWidth={frac===1?1:0.5}/>
                })}

                {RADAR_LABELS.map((_,i)=>{
                  const end=gridPt(i,RADAR_COUNT,1)
                  return<line key={i} x1={CX} y1={CY} x2={end.x} y2={end.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
                })}

                {/* Division avg — blue */}
                <polygon
                  points={radarIn ? polygonPoints(avgPts) : polygonPoints(RADAR_LABELS.map(()=>({x:CX,y:CY})))}
                  fill="rgba(66,165,245,0.12)" stroke="#42a5f5" strokeWidth="2" strokeDasharray="6,4" strokeLinejoin="round"
                  style={{transition:'all 1.2s cubic-bezier(0.4,0,0.2,1)'}}
                />
                {avgPts.map((p,i)=>(
                  <circle key={`avg-${i}`}
                    cx={radarIn?p.x:CX} cy={radarIn?p.y:CY} r="3.5"
                    fill="#42a5f5" stroke="#1a1a1a" strokeWidth="1"
                    style={{transition:`cx 1.2s ease ${i*0.08}s,cy 1.2s ease ${i*0.08}s`}}/>
                ))}

                {/* You — gold */}
                <polygon
                  points={radarIn ? polygonPoints(myPts) : polygonPoints(RADAR_LABELS.map(()=>({x:CX,y:CY})))}
                  fill="url(#myGrad)" stroke="#f5c842" strokeWidth="2.5" strokeLinejoin="round" filter="url(#glow3)"
                  style={{transition:'all 1.2s cubic-bezier(0.4,0,0.2,1)'}}
                />
                {myPts.map((p,i)=>(
                  <circle key={`me-${i}`}
                    cx={radarIn?p.x:CX} cy={radarIn?p.y:CY} r="4.5"
                    fill={lc} stroke="#1a1a1a" strokeWidth="1.5" filter="url(#glow3)"
                    style={{transition:`cx 1.2s ease ${i*0.1}s,cy 1.2s ease ${i*0.1}s`}}/>
                ))}

                {lblPts.map((p,i)=>(
                  <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fontWeight="700" fontFamily="Montserrat,sans-serif"
                    fill="#7a7570" letterSpacing="0.06em">
                    {RADAR_LABELS[i].toUpperCase()}
                  </text>
                ))}

                <text x={CX} y={CY-6} textAnchor="middle" fontSize="22" fontWeight="700"
                  fontFamily="'Bebas Neue',sans-serif" fill="#f5c842">{myScore}</text>
                <text x={CX} y={CY+10} textAnchor="middle" fontSize="7"
                  fontFamily="Montserrat,sans-serif" fill="#666" fontWeight="600" letterSpacing="0.1em">PTS</text>
              </svg>

              {/* Legend */}
              <div style={{display:'flex',gap:16,justifyContent:'center'}}>
                <div style={{display:'flex',alignItems:'center',gap:6,fontSize:10,color:'#aaa',fontWeight:600}}>
                  <span style={{width:10,height:10,borderRadius:2,background:'rgba(245,200,66,0.25)',border:'2px solid #f5c842'}}/>You
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,fontSize:10,color:'#aaa',fontWeight:600}}>
                  <span style={{width:10,height:10,borderRadius:2,background:'rgba(66,165,245,0.15)',border:'2px dashed #42a5f5'}}/>Div. avg
                </div>
              </div>

              {/* Stat comparison rows */}
              <div style={{width:'100%',display:'flex',flexDirection:'column',gap:10,marginTop:2}}>
                {[
                  {label:'Workouts', mine:totalWorkouts, avg:GYM_AVG.workouts, max:radarAxisMax.workouts},
                  {label:'Streak',   mine:streak,         avg:GYM_AVG.streak,   max:radarAxisMax.streak},
                  {label:'Weekly %', mine:weeklyPct,       avg:GYM_AVG.weeklyPct,max:radarAxisMax.weeklyPct},
                ].map((row,i)=>{
                  const diff=row.mine-row.avg
                  const mineW=row.max>0?Math.min((row.mine/row.max)*100,100):0
                  const avgW=row.max>0?Math.min((row.avg/row.max)*100,100):0
                  return(
                    <div key={i}>
                      <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:5,fontSize:10}}>
                        <span style={{color:'#888',fontWeight:700}}>{row.label}</span>
                        <span style={{color:diff>=0?'#4ade80':'#e84a2f',fontWeight:700,fontSize:9}}>{diff>=0?'+':''}{diff} vs avg</span>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',gap:4}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:8,color:'#f5c842',fontWeight:700,width:28,flexShrink:0}}>YOU</span>
                          <div style={{flex:1,height:6,background:'rgba(255,255,255,0.05)',borderRadius:50,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${mineW}%`,background:'linear-gradient(90deg,#f5c842,#e8b020)',borderRadius:50,transition:'width 1s ease'}}/>
                          </div>
                          <span style={{fontSize:9,color:'#f5c842',fontWeight:700,minWidth:24,textAlign:'right'}}>{row.mine}</span>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <span style={{fontSize:8,color:'#42a5f5',fontWeight:700,width:28,flexShrink:0}}>AVG</span>
                          <div style={{flex:1,height:6,background:'rgba(255,255,255,0.05)',borderRadius:50,overflow:'hidden'}}>
                            <div style={{height:'100%',width:`${avgW}%`,background:'linear-gradient(90deg,#42a5f5,#2d7ab8)',borderRadius:50,transition:'width 1s ease',opacity:0.85}}/>
                          </div>
                          <span style={{fontSize:9,color:'#42a5f5',fontWeight:700,minWidth:24,textAlign:'right'}}>{row.avg}</span>
                        </div>
                      </div>
                    </div>
                  )

                })}
              </div>
            </div>
          </div>

          {/* BODY METRICS */}
          <div style={glass()}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid rgba(245,200,66,0.08)'}}>
              <div style={{fontSize:14,fontWeight:700}}>Body Metrics</div>
              <div style={{fontSize:11,color:'#555',marginTop:2}}>From your Program Builder</div>
            </div>
            <div style={{padding:'20px',display:'flex',flexDirection:'column',gap:16}}>

              {/* BMI */}
              {bmi ? (
                <div style={{background:`${bmiColor}0d`,border:`1px solid ${bmiColor}33`,borderRadius:16,padding:'18px 20px',display:'flex',alignItems:'center',gap:16}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:52,color:bmiColor,lineHeight:1,textShadow:`0 0 20px ${bmiColor}55`}}>
                    <AnimNum target={bmi} decimals={1}/>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:11,fontWeight:700,color:bmiColor,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:8}}>BMI · {bmiLabel}</div>
                    <div style={{height:6,background:'rgba(255,255,255,0.06)',borderRadius:50,overflow:'hidden'}}>
                      <div style={{height:'100%',background:bmiColor,borderRadius:50,width:`${Math.min((bmi/40)*100,100)}%`,transition:'width 1s ease',boxShadow:`0 0 8px ${bmiColor}88`}}/>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',marginTop:5}}>
                      {['18.5','25','30','40'].map((l,i)=><span key={i} style={{fontSize:8,color:'#555'}}>{l}</span>)}
                    </div>
                  </div>
                </div>
              ) : (
                <div style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:14,padding:'16px',textAlign:'center'}}>
                  <div style={{fontSize:11,color:'#555'}}>Complete Program Builder to see your BMI</div>
                </div>
              )}

              {/* Metric grid */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {[
                  {label:'Height', val:profile.height?`${profile.height}cm`:'—', icon:'📏', color:'#42a5f5'},
                  {label:'Weight', val:profile.weight?`${profile.weight}kg`:'—', icon:'⚖️', color:'#c084fc'},
                  {label:'Age',    val:profile.age?`${profile.age} yrs`:'—',     icon:'🎂', color:'#fb923c'},
                  {label:'Stance', val:profile.stance||'—',                      icon:'🥊', color:'#f5c842'},
                  {label:'Level',  val:currentLevel,                              icon:LEVEL_ICON[currentLevel]||'⭐', color:lc},
                  {label:'Goal',   val:profile.goal||'—',                        icon:'🎯', color:'#4ade80'},
                ].map((m,i)=>(
                  <div key={i} style={{background:'rgba(255,255,255,0.03)',borderRadius:12,padding:'12px',border:`1px solid ${m.color}22`,display:'flex',flexDirection:'column',gap:4,
                    opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(12px)',transition:`all 0.4s ease ${i*60}ms`}}>
                    <div style={{fontSize:16}}>{m.icon}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:m.color,letterSpacing:'0.04em',lineHeight:1.2}}>{m.val}</div>
                    <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>{m.label}</div>
                  </div>
                ))}
              </div>

              {/* Training days */}
              <div style={{background:'rgba(232,74,47,0.06)',border:'1px solid rgba(232,74,47,0.15)',borderRadius:12,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:11,fontWeight:700,color:'#e84a2f'}}>⚡ Training Schedule</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:'#f5c842'}}>
                  {profile.daysPerWeek||3}x <span style={{fontSize:12,color:'#555',fontFamily:'Montserrat,sans-serif',fontWeight:600}}>per week</span>
                </div>
              </div>
            </div>
          </div>

          {/* PUNCH ANALYTICS — MediaPipe */}
          <div style={glass()}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:14,fontWeight:700}}>Punch Analytics</div>
                <div style={{fontSize:11,color:'#555',marginTop:2}}>Powered by AI Pose Detection</div>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {poseData && <span style={{fontSize:8,fontWeight:700,color:'#4ade80',background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.25)',borderRadius:50,padding:'3px 8px',letterSpacing:'0.08em'}}>LIVE</span>}
                <div style={{fontSize:9,fontWeight:700,color:'#c084fc',background:'rgba(192,132,252,0.1)',border:'1px solid rgba(192,132,252,0.25)',borderRadius:50,padding:'3px 10px',letterSpacing:'0.08em'}}>MEDIAPIPE</div>
              </div>
            </div>
            <div style={{padding:'20px',display:'flex',flexDirection:'column',gap:14}}>

              {poseLoading ? (
                <div style={{textAlign:'center',padding:'20px',color:'#555',fontSize:11}}>Loading pose data...</div>
              ) : !poseData ? (
                <>
                  {/* No data yet — awaiting state */}
                  <div style={{background:'rgba(192,132,252,0.06)',border:'1px dashed rgba(192,132,252,0.25)',borderRadius:16,padding:'20px',textAlign:'center',display:'flex',flexDirection:'column',gap:8}}>
                    <div style={{fontSize:32}}>📱</div>
                    <div style={{fontSize:13,fontWeight:700,color:'#c084fc'}}>Live Punch Detection</div>
                    <div style={{fontSize:11,color:'#7a7570',lineHeight:1.7}}>
                      Your punch data will be captured in real-time through the <strong style={{color:'#c084fc'}}>mobile app</strong> using MediaPipe Pose Detection. Complete a live training session to populate your analytics.
                    </div>
                    <div style={{background:'rgba(192,132,252,0.08)',border:'1px solid rgba(192,132,252,0.15)',borderRadius:10,padding:'10px 14px',marginTop:4,fontSize:11,color:'#7a7570',display:'flex',alignItems:'center',gap:8}}>
                      <span>🔴</span> <span>Awaiting live session data from mobile...</span>
                    </div>
                  </div>
                  {[
                    {icon:'⚡',label:'Punch Speed',  val:'—', color:'#f5c842'},
                    {icon:'💥',label:'Power Output', val:'—', color:'#e84a2f'},
                    {icon:'🎯',label:'Accuracy',     val:'—', color:'#4ade80'},
                    {icon:'🔄',label:'Combo Flow',   val:'—', color:'#42a5f5'},
                  ].map((p,i)=>(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 12px',background:'rgba(255,255,255,0.02)',borderRadius:12,border:'1px solid rgba(255,255,255,0.04)'}}>
                      <span style={{fontSize:20,opacity:0.4}}>{p.icon}</span>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                          <span style={{fontSize:11,fontWeight:700,color:'#555'}}>{p.label}</span>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:'#333'}}>{p.val}</span>
                        </div>
                        <div style={{height:5,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden'}}>
                          <div style={{height:'100%',borderRadius:50,background:`${p.color}22`,width:'100%'}}/>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div style={{fontSize:10,color:'#555',textAlign:'center',lineHeight:1.6,marginTop:4}}>
                    Data populates automatically after completing a live boxing session on the mobile app
                  </div>
                </>
              ) : (
                <>
                  {/* REAL DATA — Pose analytics available */}
                  <div style={{background:'rgba(74,222,128,0.05)',border:'1px solid rgba(74,222,128,0.15)',borderRadius:14,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                    <div style={{display:'flex',alignItems:'center',gap:8}}>
                      <span style={{width:8,height:8,borderRadius:'50%',background:'#4ade80',boxShadow:'0 0 8px rgba(74,222,128,0.6)'}}/>
                      <span style={{fontSize:11,fontWeight:700,color:'#4ade80'}}>{poseData.totalPoseSessions} session{poseData.totalPoseSessions!==1?'s':''} recorded</span>
                    </div>
                    {poseData.lastPoseSession && (
                      <span style={{fontSize:10,color:'#666'}}>Last: {new Date(poseData.lastPoseSession).toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
                    )}
                  </div>

                  {/* Main metrics */}
                  {[
                    {icon:'⚡',label:'Punch Speed',  val:`${poseData.punchSpeed}`, unit:'ppm', color:'#f5c842', pct:Math.min(poseData.punchSpeed/120*100,100)},
                    {icon:'💥',label:'Power Output', val:`${poseData.powerOutput}`, unit:'%', color:'#e84a2f', pct:poseData.powerOutput},
                    {icon:'🎯',label:'Form Accuracy',val:`${poseData.accuracy}`, unit:'%', color:'#4ade80', pct:poseData.accuracy},
                    {icon:'🔄',label:'Combo Flow',   val:`${poseData.comboFlow}`, unit:'%', color:'#42a5f5', pct:poseData.comboFlow},
                  ].map((p,i)=>(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:`${p.color}08`,borderRadius:12,border:`1px solid ${p.color}20`,transition:'all 0.3s',opacity:mounted?1:0,transform:mounted?'translateX(0)':'translateX(-8px)'}}>
                      <span style={{fontSize:22}}>{p.icon}</span>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                          <span style={{fontSize:11,fontWeight:700,color:'#aaa'}}>{p.label}</span>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:p.color}}><AnimNum target={parseFloat(p.val)}/><span style={{fontSize:10,color:'#666',fontFamily:'Montserrat,sans-serif',marginLeft:2}}>{p.unit}</span></span>
                        </div>
                        <div style={{height:6,background:'rgba(255,255,255,0.06)',borderRadius:50,overflow:'hidden'}}>
                          <Bar value={p.pct} max={100} color={p.color} delay={i*80}/>
                        </div>
                      </div>
                    </div>
                  ))}

                  {/* Form Breakdown — per punch type */}
                  {poseData.formBreakdown && (
                    <div style={{marginTop:4}}>
                      <div style={{fontSize:10,fontWeight:700,color:'#888',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:10}}>Form Breakdown by Punch</div>
                      <div style={{display:'flex',flexDirection:'column',gap:8}}>
                        {Object.entries(poseData.formBreakdown).map(([punch, score],i)=>{
                          const punchColor = {jab:'#f5c842',cross:'#e84a2f',hook:'#c084fc',uppercut:'#42a5f5'}[punch]||'#888'
                          return(
                            <div key={punch} style={{display:'flex',alignItems:'center',gap:10}}>
                              <span style={{fontSize:10,fontWeight:700,color:punchColor,width:65,textTransform:'capitalize'}}>{punch}</span>
                              <div style={{flex:1,height:6,background:'rgba(255,255,255,0.05)',borderRadius:50,overflow:'hidden'}}>
                                <Bar value={score} max={100} color={punchColor} delay={i*60}/>
                              </div>
                              <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:punchColor,width:32,textAlign:'right'}}>{score}%</span>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Recent Sessions */}
                  {poseSessions.length > 0 && (
                    <div style={{marginTop:6}}>
                      <div style={{fontSize:10,fontWeight:700,color:'#888',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:10}}>Recent Sessions</div>
                      <div style={{display:'flex',flexDirection:'column',gap:6}}>
                        {poseSessions.map((s,i)=>{
                          const d = s.date?.toDate ? s.date.toDate() : (s.date?.seconds ? new Date(s.date.seconds*1000) : new Date(s.date))
                          return(
                            <div key={s.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',background:'rgba(255,255,255,0.02)',borderRadius:10,border:'1px solid rgba(255,255,255,0.04)'}}>
                              <div style={{width:32,height:32,borderRadius:8,background:'linear-gradient(135deg,#c084fc22,#42a5f522)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>🥊</div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:11,fontWeight:700,color:'#bbb'}}>{d.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'})}</div>
                                <div style={{fontSize:9,color:'#555',marginTop:1}}>{Math.round((s.duration||0)/60)}min · {s.totalPunches||0} punches</div>
                              </div>
                              <div style={{textAlign:'right'}}>
                                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:s.accuracy>=80?'#4ade80':s.accuracy>=60?'#f5c842':'#e84a2f'}}>{s.accuracy||0}%</div>
                                <div style={{fontSize:8,color:'#555',fontWeight:600}}>ACCURACY</div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>

        {/* SCORE BREAKDOWN */}
        <div style={glass()}>
          <div style={{padding:'18px 22px 14px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div>
              <div style={{fontSize:14,fontWeight:700}}>Score Breakdown</div>
              <div style={{fontSize:11,color:'#555',marginTop:2}}>How your leaderboard score is calculated</div>
            </div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#f5c842'}}>
              Total: <AnimNum target={myScore}/> pts
            </div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:0}}>
            {[
              {icon:'🥊',label:'Workouts',      formula:`${totalWorkouts} × 10`,  points:totalWorkouts*10,       color:'#f5c842', max:1000},
              {icon:'🔥',label:'Streak Bonus',  formula:`${streak} days × 5`,     points:streak*5,               color:'#e84a2f', max:150},
              {icon:'⭐',label:'Level Bonus',   formula:currentLevel,              points:levelBonus,             color:lc,        max:1000},
              {icon:'📅',label:'Weekly Comp.',  formula:`${weeklyPct}% × 1.5`,    points:Math.round(weeklyPct*1.5), color:'#4ade80', max:150},
            ].map((item,i,arr)=>(
              <div key={i} style={{padding:'20px 22px',borderRight:i<arr.length-1?'1px solid rgba(255,255,255,0.05)':'none',display:'flex',flexDirection:'column',gap:10}}>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:20}}>{item.icon}</span>
                  <div>
                    <div style={{fontSize:11,fontWeight:700,color:'#f0ece8'}}>{item.label}</div>
                    <div style={{fontSize:10,color:'#555'}}>{item.formula}</div>
                  </div>
                </div>
                <div style={{height:6,background:'rgba(255,255,255,0.06)',borderRadius:50,overflow:'hidden'}}>
                  <Bar value={item.points} max={item.max} color={item.color} delay={i*100}/>
                </div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:item.color,letterSpacing:'0.04em'}}>
                  +<AnimNum target={item.points}/>
                  <span style={{fontSize:11,color:'#555',fontFamily:'Montserrat,sans-serif',marginLeft:4}}>pts</span>
                </div>
              </div>
            ))}
          </div>
        </div>

          </div>{/* end blurred content */}

          {/* ════════════════════════════════════════════════ */}
          {/*  LOCK OVERLAY — centered card invites renewal     */}
          {/* ════════════════════════════════════════════════ */}
          {membershipBlocked && (
            <div style={{
              position:'absolute', top:0, left:0, right:0,
              display:'flex', alignItems:'flex-start', justifyContent:'center',
              paddingTop:80, pointerEvents:'none',
            }}>
              <div style={{
                pointerEvents:'auto',
                maxWidth:440, width:'90%',
                background:'linear-gradient(135deg,rgba(28,18,18,0.97),rgba(14,10,10,0.99))',
                borderRadius:20,
                border:`2px solid ${membershipState===STATUS.EXPIRED?'rgba(232,74,47,0.55)':'rgba(156,163,175,0.45)'}`,
                boxShadow:'0 30px 80px rgba(0,0,0,0.8), 0 0 60px rgba(232,74,47,0.25)',
                padding:'30px 28px', textAlign:'center',
                backdropFilter:'blur(12px)',
                position:'relative', overflow:'hidden',
              }}>
                <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:membershipState===STATUS.EXPIRED?'linear-gradient(180deg,#e84a2f,#c93820)':'linear-gradient(180deg,#9ca3af,#6b7280)'}}/>
                <div style={{fontSize:50,marginBottom:12,lineHeight:1}}>
                  {membershipState===STATUS.EXPIRED ? '🔒' : '⏸'}
                </div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:'0.05em',color:'#f0ece8',lineHeight:1.1,marginBottom:8}}>
                  {membershipState===STATUS.EXPIRED ? 'STATS LOCKED' : 'MEMBERSHIP PAUSED'}
                </div>
                <div style={{fontSize:12,color:'#aaa',lineHeight:1.7,marginBottom:18}}>
                  {membershipState===STATUS.EXPIRED
                    ? 'Your membership has expired — performance stats are members-only. Speak with the gym admin to renew and continue tracking your progress.'
                    : 'Your membership is paused. Resume your plan with the admin to see your latest workout breakdowns and progress data.'}
                </div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:'10px 16px',background:'rgba(232,74,47,0.08)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:12,fontSize:11,color:'#e84a2f',fontWeight:700,letterSpacing:'0.06em'}}>
                  <span>👀</span><span>Preview shown — Renew to track</span>
                </div>
              </div>
            </div>
          )}
        </div>{/* end membership gate wrapper */}

      </div>
    </>
  )
}

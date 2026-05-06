import { useState, useEffect, useRef } from 'react'
import Navbar from '../components/Navbar'

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

// ── LEADERBOARD DATA (same as Leaderboard page) ───────
const MOCK_USERS = [
  { name:'Rafael Labordo', level:'Elite',        workouts:98,  streak:21, weeklyPct:95 },
  { name:'Marcus Jimenez', level:'Expert',       workouts:76,  streak:14, weeklyPct:88 },
  { name:'Ana Reyes',      level:'Expert',       workouts:71,  streak:10, weeklyPct:82 },
  { name:'Dante Cruz',     level:'Advanced',     workouts:58,  streak:9,  weeklyPct:75 },
  { name:'Sofia Mendez',   level:'Advanced',     workouts:53,  streak:8,  weeklyPct:70 },
  { name:'Elijah Santos',  level:'Advanced',     workouts:49,  streak:7,  weeklyPct:68 },
  { name:'Camille Torres', level:'Intermediate', workouts:38,  streak:5,  weeklyPct:65 },
  { name:'Jordan Vela',    level:'Intermediate', workouts:34,  streak:4,  weeklyPct:60 },
  { name:'Mia Ocampo',     level:'Intermediate', workouts:29,  streak:3,  weeklyPct:55 },
  { name:'Lucas Bautista', level:'Intermediate', workouts:25,  streak:2,  weeklyPct:50 },
]

const LEVEL_BONUS = { Beginner:0, Intermediate:150, Advanced:350, Expert:600, Elite:1000 }
const LEVEL_COLOR = { Beginner:'#fb923c', Intermediate:'#f5c842', Advanced:'#4ade80', Expert:'#42a5f5', Elite:'#c084fc' }
const LEVEL_ICON  = { Beginner:'🥊', Intermediate:'⚡', Advanced:'🔥', Expert:'💎', Elite:'👑' }
function calcScore(u){ return (u.workouts*10)+(u.streak*5)+(LEVEL_BONUS[u.level]||0)+Math.round(u.weeklyPct*1.5) }

const GYM_AVG_SCORE = Math.round(MOCK_USERS.reduce((a,u)=>a+calcScore(u),0)/MOCK_USERS.length)
const MAX_SCORE = calcScore(MOCK_USERS[0])

// Gym average stats
const GYM_AVG = {
  workouts: Math.round(MOCK_USERS.reduce((a,u)=>a+u.workouts,0)/MOCK_USERS.length),
  streak:   Math.round(MOCK_USERS.reduce((a,u)=>a+u.streak,0)/MOCK_USERS.length),
  weeklyPct:Math.round(MOCK_USERS.reduce((a,u)=>a+u.weeklyPct,0)/MOCK_USERS.length),
  score:    GYM_AVG_SCORE,
}

// Radar
const CX=130,CY=120,R=95
const RADAR_LABELS=['Workouts','Streak','Weekly%','Score','Level']

function radarPt(i,count,val,maxVal){
  const a=(Math.PI*2*i)/count-Math.PI/2
  const r=(Math.min(val,maxVal)/maxVal)*R
  return{x:CX+r*Math.cos(a),y:CY+r*Math.sin(a)}
}
function gridPt(i,count,frac){
  const a=(Math.PI*2*i)/count-Math.PI/2
  return{x:CX+R*frac*Math.cos(a),y:CY+R*frac*Math.sin(a)}
}
function toPath(pts){return pts.map((p,i)=>`${i===0?'M':'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')+'Z'}

// ── MAIN ─────────────────────────────────────────────
export default function Stats() {
  const canvasRef=useRef(null)
  const [mounted,setMounted]=useState(false)
  const [radarIn,setRadarIn]=useState(false)

  // Read from both profile + stats
  const profile = (() => {
    try {
      const p = JSON.parse(localStorage.getItem('hittrack_profile')||'{}')
      const s = JSON.parse(localStorage.getItem('hittrack_stats')||'{}')
      return {...p,...s}
    } catch { return {} }
  })()

  const totalWorkouts = profile.totalWorkouts || 0
  const streak        = profile.streak        || 0
  const weeklyPct     = profile.weeklyPct     || 0
  const currentLevel  = profile.currentLevel  || profile.experience || 'Beginner'
  const levelBonus    = LEVEL_BONUS[currentLevel] || 0
  const myScore       = calcScore({ workouts:totalWorkouts, streak, weeklyPct, level:currentLevel })

  const bmi = profile.bmi || (profile.height && profile.weight
    ? parseFloat((profile.weight/((profile.height/100)**2)).toFixed(1))
    : null)
  const bmiLabel = !bmi?'—':bmi<18.5?'Underweight':bmi<25?'Normal':bmi<30?'Overweight':'Obese'
  const bmiColor = !bmi?'#555':bmi<18.5?'#42a5f5':bmi<25?'#4ade80':bmi<30?'#f5c842':'#e84a2f'

  // Leaderboard rank
  const allScored = [...MOCK_USERS, {name:profile.name||'You',level:currentLevel,workouts:totalWorkouts,streak,weeklyPct}]
    .map(u=>({...u,score:calcScore(u)}))
    .sort((a,b)=>b.score-a.score)
  const myRank = allScored.findIndex(u=>u.name===(profile.name||'You'))+1

  // Radar data — me vs gym avg
  const MAXVALS = [100, 30, 100, MAX_SCORE, 1000]
  const myVals  = [
    Math.min(totalWorkouts, 100),
    Math.min(streak, 30),
    weeklyPct,
    myScore,
    levelBonus,
  ]
  const avgVals = [
    Math.min(GYM_AVG.workouts, 100),
    Math.min(GYM_AVG.streak, 30),
    GYM_AVG.weeklyPct,
    GYM_AVG.score,
    200, // avg level bonus
  ]

  const myPts  = RADAR_LABELS.map((_,i)=>radarPt(i,RADAR_LABELS.length,myVals[i],MAXVALS[i]))
  const avgPts = RADAR_LABELS.map((_,i)=>radarPt(i,RADAR_LABELS.length,avgVals[i],MAXVALS[i]))
  const lblPts = RADAR_LABELS.map((_,i)=>{ const a=(Math.PI*2*i)/RADAR_LABELS.length-Math.PI/2; return{x:CX+(R+34)*Math.cos(a),y:CY+(R+34)*Math.sin(a)} })

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
              <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.1em',marginTop:3}}>GYM RANK</div>
            </div>
          </div>
        </div>

        {/* MAIN GRID */}
        <div style={{display:'grid',gridTemplateColumns:'1.2fr 1fr 1fr',gap:18}}>

          {/* YOU VS GYM AVERAGE — RADAR */}
          <div style={glass()}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid rgba(245,200,66,0.08)'}}>
              <div style={{fontSize:14,fontWeight:700}}>You vs Gym Average</div>
              <div style={{fontSize:11,color:'#555',marginTop:2}}>Based on gym leaderboard data</div>
            </div>
            <div style={{padding:'16px',display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
              <svg width="280" height="250" viewBox="0 0 280 250" style={{overflow:'visible'}}>
                <defs>
                  <radialGradient id="myGrad" cx="50%" cy="50%" r="50%">
                    <stop offset="0%" stopColor="#f5c842" stopOpacity="0.25"/>
                    <stop offset="100%" stopColor="#f5c842" stopOpacity="0"/>
                  </radialGradient>
                  <filter id="glow3"><feGaussianBlur stdDeviation="3" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
                </defs>

                {[0.25,0.5,0.75,1].map((frac,fi)=>{
                  const pts=RADAR_LABELS.map((_,i)=>gridPt(i,RADAR_LABELS.length,frac))
                  return<polygon key={fi} points={pts.map(p=>`${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')}
                    fill="none" stroke={frac===1?'rgba(255,255,255,0.1)':'rgba(255,255,255,0.04)'} strokeWidth={frac===1?1:0.5}/>
                })}

                {RADAR_LABELS.map((_,i)=>{
                  const end=gridPt(i,RADAR_LABELS.length,1)
                  return<line key={i} x1={CX} y1={CY} x2={end.x} y2={end.y} stroke="rgba(255,255,255,0.06)" strokeWidth="1"/>
                })}

                {/* Gym avg — dashed blue */}
                <polygon points={toPath(avgPts).replace('Z','')}
                  fill="rgba(66,165,245,0.07)" stroke="rgba(66,165,245,0.45)" strokeWidth="1.5" strokeDasharray="5,3"/>

                {/* Me — gold */}
                <polygon
                  points={radarIn ? toPath(myPts).replace('Z','') : RADAR_LABELS.map(()=>`${CX},${CY}`).join(' ')}
                  fill="url(#myGrad)" stroke="#f5c842" strokeWidth="2.5" filter="url(#glow3)"
                  style={{transition:'all 1.2s cubic-bezier(0.4,0,0.2,1)'}}/>

                {myPts.map((p,i)=>(
                  <circle key={i}
                    cx={radarIn?p.x:CX} cy={radarIn?p.y:CY} r="4"
                    fill={lc} filter="url(#glow3)"
                    style={{transition:`cx 1.2s ease ${i*0.1}s,cy 1.2s ease ${i*0.1}s`}}/>
                ))}

                {lblPts.map((p,i)=>(
                  <text key={i} x={p.x} y={p.y} textAnchor="middle" dominantBaseline="middle"
                    fontSize="9" fontWeight="700" fontFamily="Montserrat,sans-serif"
                    fill="#7a7570" letterSpacing="0.06em">
                    {RADAR_LABELS[i].toUpperCase()}
                  </text>
                ))}

                <text x={CX} y={CY-8} textAnchor="middle" fontSize="20" fontWeight="700"
                  fontFamily="'Bebas Neue',sans-serif" fill="#f5c842">{myScore}</text>
                <text x={CX} y={CY+9} textAnchor="middle" fontSize="8"
                  fontFamily="Montserrat,sans-serif" fill="#555" fontWeight="600" letterSpacing="0.08em">MY SCORE</text>
              </svg>

              {/* Legend */}
              <div style={{display:'flex',gap:20}}>
                <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#7a7570'}}>
                  <div style={{width:16,height:2,background:'#f5c842',borderRadius:1,boxShadow:'0 0 4px rgba(245,200,66,0.6)'}}/>You
                </div>
                <div style={{display:'flex',alignItems:'center',gap:6,fontSize:11,color:'#7a7570'}}>
                  <div style={{width:16,height:2,background:'rgba(66,165,245,0.6)',borderRadius:1}}/>Gym Avg
                </div>
              </div>

              {/* Stat comparison rows */}
              <div style={{width:'100%',display:'flex',flexDirection:'column',gap:8,marginTop:4}}>
                {[
                  {label:'Workouts', mine:totalWorkouts, avg:GYM_AVG.workouts, max:100},
                  {label:'Streak',   mine:streak,         avg:GYM_AVG.streak,   max:30},
                  {label:'Weekly %', mine:weeklyPct,       avg:GYM_AVG.weeklyPct,max:100},
                ].map((row,i)=>{
                  const diff=row.mine-row.avg
                  return(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:8,fontSize:10}}>
                      <span style={{color:'#555',width:60,flexShrink:0}}>{row.label}</span>
                      <div style={{flex:1,height:5,background:'rgba(255,255,255,0.05)',borderRadius:50,overflow:'hidden',position:'relative'}}>
                        <div style={{position:'absolute',left:'50%',top:0,bottom:0,width:1,background:'rgba(255,255,255,0.12)'}}/>
                        {row.mine>0&&<div style={{
                          position:'absolute',height:'100%',borderRadius:50,
                          background:diff>=0?'#4ade80':'#e84a2f',
                          left:diff>=0?'50%':'auto',right:diff<0?'50%':'auto',
                          width:`${Math.abs(diff/row.max)*50}%`,
                          boxShadow:`0 0 6px ${diff>=0?'rgba(74,222,128,0.5)':'rgba(232,74,47,0.5)'}`,
                        }}/>}
                      </div>
                      <span style={{color:row.mine===0?'#444':diff>=0?'#4ade80':'#e84a2f',fontWeight:700,minWidth:36,textAlign:'right'}}>
                        {row.mine===0?'—':`${diff>=0?'+':''}${diff}`}
                      </span>
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

          {/* PUNCH ANALYTICS — MediaPipe Placeholder */}
          <div style={glass()}>
            <div style={{padding:'18px 22px 14px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontSize:14,fontWeight:700}}>Punch Analytics</div>
                <div style={{fontSize:11,color:'#555',marginTop:2}}>Powered by AI Pose Detection</div>
              </div>
              <div style={{fontSize:9,fontWeight:700,color:'#c084fc',background:'rgba(192,132,252,0.1)',border:'1px solid rgba(192,132,252,0.25)',borderRadius:50,padding:'3px 10px',letterSpacing:'0.08em'}}>MEDIAPIPE</div>
            </div>
            <div style={{padding:'20px',display:'flex',flexDirection:'column',gap:14}}>

              {/* MediaPipe waiting state */}
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

              {/* Placeholder stat cards — ready for real data */}
              {[
                {icon:'⚡',label:'Punch Speed',   val:'—',  sub:'Start a live session', color:'#f5c842', meter:0},
                {icon:'💥',label:'Power Output',  val:'—',  sub:'Start a live session', color:'#e84a2f', meter:0},
                {icon:'🎯',label:'Accuracy',      val:'—',  sub:'Start a live session', color:'#4ade80', meter:0},
                {icon:'🔄',label:'Combo Flow',    val:'—',  sub:'Start a live session', color:'#42a5f5', meter:0},
              ].map((p,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 12px',background:'rgba(255,255,255,0.02)',borderRadius:12,border:'1px solid rgba(255,255,255,0.04)'}}>
                  <span style={{fontSize:20,opacity:0.5}}>{p.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                      <span style={{fontSize:11,fontWeight:700,color:'#555'}}>{p.label}</span>
                      <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:'#333'}}>{p.val}</span>
                    </div>
                    <div style={{height:5,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden'}}>
                      <div style={{height:'100%',borderRadius:50,background:`${p.color}33`,width:'100%'}}/>
                    </div>
                  </div>
                </div>
              ))}

              <div style={{fontSize:10,color:'#555',textAlign:'center',lineHeight:1.6,marginTop:4}}>
                📌 Data populates automatically after completing a live boxing session on the mobile app
              </div>
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

      </div>
    </>
  )
}

// TODO: full pose data pipeline in progress on mobile —
// falls back to trainingRecordings session summaries until
// stats/{uid}/poseSessions is populated.
//
// Shared UI for member Stats, coach member-view, and admin
// View Member drawer. Pass `compact` for the dashboard embeds
// (hides the recent-sessions strip).

import { useEffect, useState } from 'react'
import { loadPunchAnalytics } from '../lib/punchAnalytics'

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

const METRIC_DEFS = [
  { key:'punchSpeed',  icon:'⚡', label:'Punch Speed',   color:'#f5c842', poseUnit:'ppm', recUnit:'rpm', max:120 },
  { key:'powerOutput', icon:'💥', label:'Power Output',  color:'#e84a2f', poseUnit:'%',   recUnit:'%',   max:100 },
  { key:'accuracy',    icon:'🎯', label:'Form Accuracy', color:'#4ade80', poseUnit:'%',   recUnit:'%',   max:100 },
  { key:'comboFlow',   icon:'🔄', label:'Combo Flow',    color:'#42a5f5', poseUnit:'%',   recUnit:'%',   max:100 },
]

export default function PunchAnalyticsCard({ uid, compact=false }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(false)
    if (!uid) { setData(null); setLoading(false); return }
    let cancelled = false
    setLoading(true)
    loadPunchAnalytics(uid).then(d => {
      if (cancelled) return
      setData(d)
      setLoading(false)
    })
    const t = setTimeout(() => setMounted(true), 80)
    return () => { cancelled = true; clearTimeout(t) }
  }, [uid])

  const source = data?.source || 'none'
  const isPose = source === 'pose'
  const isRec  = source === 'recordings'

  return (
    <div style={glass()}>
      <div style={{padding:'18px 22px 14px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
        <div>
          <div style={{fontSize:14,fontWeight:700}}>Punch Analytics</div>
          <div style={{fontSize:11,color:'#555',marginTop:2}}>Powered by AI Pose Detection</div>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {isPose && (
            <span style={{fontSize:8,fontWeight:700,color:'#4ade80',background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.25)',borderRadius:50,padding:'3px 8px',letterSpacing:'0.08em'}}>LIVE</span>
          )}
          {isRec && (
            <span title="Derived from coach-submitted training reports. Live per-frame metrics arrive with the full pose pipeline."
              style={{fontSize:8,fontWeight:700,color:'#f5c842',background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.25)',borderRadius:50,padding:'3px 8px',letterSpacing:'0.08em'}}>SESSION SUMMARY</span>
          )}
          <div style={{fontSize:9,fontWeight:700,color:'#c084fc',background:'rgba(192,132,252,0.1)',border:'1px solid rgba(192,132,252,0.25)',borderRadius:50,padding:'3px 10px',letterSpacing:'0.08em'}}>TENSORFLOW</div>
        </div>
      </div>
      <div style={{padding:'20px',display:'flex',flexDirection:'column',gap:14}}>

        {loading ? (
          <div style={{textAlign:'center',padding:'20px',color:'#555',fontSize:11}}>Loading pose data...</div>
        ) : source === 'none' ? (
          <>
            <div style={{background:'rgba(192,132,252,0.06)',border:'1px dashed rgba(192,132,252,0.25)',borderRadius:16,padding:'20px',textAlign:'center',display:'flex',flexDirection:'column',gap:8}}>
              <div style={{fontSize:32}}>📱</div>
              <div style={{fontSize:13,fontWeight:700,color:'#c084fc'}}>Live Punch Detection</div>
              <div style={{fontSize:11,color:'#7a7570',lineHeight:1.7}}>
                Punch data is captured in real-time through the <strong style={{color:'#c084fc'}}>mobile app</strong> using TensorFlow pose detection. Complete a live training session to populate analytics.
              </div>
              <div style={{background:'rgba(192,132,252,0.08)',border:'1px solid rgba(192,132,252,0.15)',borderRadius:10,padding:'10px 14px',marginTop:4,fontSize:11,color:'#7a7570',display:'flex',alignItems:'center',gap:8,justifyContent:'center'}}>
                <span>🔴</span><span>No training sessions yet — awaiting first session</span>
              </div>
            </div>
            {METRIC_DEFS.map((p,i)=>(
              <div key={p.key} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 12px',background:'rgba(255,255,255,0.02)',borderRadius:12,border:'1px solid rgba(255,255,255,0.04)'}}>
                <span style={{fontSize:20,opacity:0.4}}>{p.icon}</span>
                <div style={{flex:1}}>
                  <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                    <span style={{fontSize:11,fontWeight:700,color:'#555'}}>{p.label}</span>
                    <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:'#333'}}>—</span>
                  </div>
                  <div style={{height:5,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden'}}>
                    <div style={{height:'100%',borderRadius:50,background:`${p.color}22`,width:'100%'}}/>
                  </div>
                </div>
              </div>
            ))}
          </>
        ) : (
          <>
            <div style={{background:'rgba(74,222,128,0.05)',border:'1px solid rgba(74,222,128,0.15)',borderRadius:14,padding:'12px 16px',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{width:8,height:8,borderRadius:'50%',background:'#4ade80',boxShadow:'0 0 8px rgba(74,222,128,0.6)'}}/>
                <span style={{fontSize:11,fontWeight:700,color:'#4ade80'}}>
                  {data.totalSessions} {isPose ? 'pose session' : 'session'}{data.totalSessions!==1?'s':''} recorded
                </span>
              </div>
              {data.lastSessionAt && (
                <span style={{fontSize:10,color:'#666'}}>Last: {data.lastSessionAt.toLocaleDateString('en-US',{month:'short',day:'numeric'})}</span>
              )}
            </div>

            {METRIC_DEFS.map((p,i)=>{
              const raw = data.metrics[p.key]
              const isMissing = raw === null || raw === undefined
              const unit = isPose ? p.poseUnit : p.recUnit
              const pct = isMissing ? 0 : (p.key === 'punchSpeed' ? Math.min(raw / p.max * 100, 100) : Math.min(raw, 100))
              return (
                <div key={p.key} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:`${p.color}08`,borderRadius:12,border:`1px solid ${p.color}20`,transition:'all 0.3s',opacity:mounted?1:0,transform:mounted?'translateX(0)':'translateX(-8px)'}}>
                  <span style={{fontSize:22, opacity: isMissing ? 0.4 : 1}}>{p.icon}</span>
                  <div style={{flex:1}}>
                    <div style={{display:'flex',justifyContent:'space-between',marginBottom:6}}>
                      <span style={{fontSize:11,fontWeight:700,color: isMissing ? '#555' : '#aaa'}}>{p.label}</span>
                      {isMissing ? (
                        <span title="Coming soon — captured by full pose pipeline"
                          style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#444',cursor:'help'}}>—</span>
                      ) : (
                        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:p.color}}>
                          <AnimNum target={parseFloat(raw)}/>
                          <span style={{fontSize:10,color:'#666',fontFamily:'Montserrat,sans-serif',marginLeft:2}}>{unit}</span>
                        </span>
                      )}
                    </div>
                    <div style={{height:6,background:'rgba(255,255,255,0.06)',borderRadius:50,overflow:'hidden'}}>
                      {isMissing
                        ? <div style={{height:'100%',width:'100%',background:'rgba(255,255,255,0.04)',borderRadius:50}}/>
                        : <Bar value={pct} max={100} color={p.color} delay={i*80}/>}
                    </div>
                    {isMissing && (
                      <div style={{fontSize:9,color:'#555',marginTop:5,fontStyle:'italic'}}>Coming soon — captured by full pose pipeline</div>
                    )}
                  </div>
                </div>
              )
            })}

            {/* Form Breakdown — pose-only; hidden in recordings mode (we don't fake per-punch scores). */}
            {isPose && data.formBreakdown && (
              <div style={{marginTop:4}}>
                <div style={{fontSize:10,fontWeight:700,color:'#888',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:10}}>Form Breakdown by Punch</div>
                <div style={{display:'flex',flexDirection:'column',gap:8}}>
                  {Object.entries(data.formBreakdown).map(([punch, score],i)=>{
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

            {!compact && data.recentSessions.length > 0 && (
              <div style={{marginTop:6}}>
                <div style={{fontSize:10,fontWeight:700,color:'#888',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:10}}>Recent Sessions</div>
                <div style={{display:'flex',flexDirection:'column',gap:6}}>
                  {data.recentSessions.map((s)=>(
                    <div key={s.id} style={{display:'flex',alignItems:'center',gap:10,padding:'9px 12px',background:'rgba(255,255,255,0.02)',borderRadius:10,border:'1px solid rgba(255,255,255,0.04)'}}>
                      <div style={{width:32,height:32,borderRadius:8,background:'linear-gradient(135deg,#c084fc22,#42a5f522)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,flexShrink:0}}>🥊</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontSize:11,fontWeight:700,color:'#bbb'}}>
                          {s.date ? s.date.toLocaleDateString('en-US',{weekday:'short',month:'short',day:'numeric'}) : '—'}
                        </div>
                        <div style={{fontSize:9,color:'#555',marginTop:1}}>{Math.round((s.duration||0)/60)}min · {s.totalPunches||0} {isPose ? 'punches' : 'reps'}</div>
                      </div>
                      <div style={{textAlign:'right'}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:s.accuracy>=80?'#4ade80':s.accuracy>=60?'#f5c842':'#e84a2f'}}>{s.accuracy||0}%</div>
                        <div style={{fontSize:8,color:'#555',fontWeight:600}}>ACCURACY</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

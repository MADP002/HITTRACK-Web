import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, getDoc, addDoc, deleteDoc, setDoc, updateDoc, serverTimestamp, query, where, orderBy, onSnapshot, writeBatch, arrayUnion } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../firebase'
import { buildSchedule } from '../lib/scheduleBuilder'
import { logActivity, ACTIVITY_TYPES } from '../lib/activityLog'
import { isClassActive, isClassPassed, getClassStartTime, endClass, autoEndPastClasses, getClassDayLabel, isClassToday } from '../lib/classLifecycle'
import InboxView from '../components/InboxView'

const glass=(e={})=>({background:'linear-gradient(135deg,rgba(22,20,20,0.97),rgba(14,12,12,0.99))',borderRadius:16,border:'1px solid rgba(255,255,255,0.07)',boxShadow:'0 4px 24px rgba(0,0,0,0.4)',...e})
const LEVEL_COLOR={Beginner:'#fb923c',Intermediate:'#f5c842',Advanced:'#4ade80'}
const LEVEL_ICON={Beginner:'🥊',Intermediate:'⚡',Advanced:'🔥'}
const LEVEL_BONUS={Beginner:0,Intermediate:150,Advanced:350}
const DIVISIONS=['Beginner','Intermediate','Advanced']
const DAYS=['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const TIMES=['6:00 AM','7:00 AM','8:00 AM','9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM','8:00 PM']
const LEVELS=['Beginner','Intermediate','Advanced']
const LEVEL_DIVS=['All Levels','Beginner','Intermediate','Advanced']
const GOAL_DIVS=['All Goals','Learn Boxing','Lose Weight','Build Strength','Compete']
const RANK_COLORS=['#f5c842','#c8d6e5','#cd7f32']

function calcScore(u){return((u.totalWorkouts||0)*10)+((u.streak||0)*5)+(LEVEL_BONUS[u.experience||'Beginner']||0)+Math.round((u.weeklyPct||0)*1.5)}

// ── Cinematic stat card (Session 3A) ────────────────
function StatCard({icon,label,value,trend,subtext,color='gold'}){
  const COLORS={
    gold:    {accent:'#f5c842',glow:'rgba(245,200,66,0.25)',border:'rgba(245,200,66,0.3)'},
    success: {accent:'#22c55e',glow:'rgba(34,197,94,0.25)',border:'rgba(34,197,94,0.3)'},
    info:    {accent:'#42a5f5',glow:'rgba(66,165,245,0.25)',border:'rgba(66,165,245,0.3)'},
    danger:  {accent:'#e84a2f',glow:'rgba(232,74,47,0.25)',border:'rgba(232,74,47,0.3)'},
    purple:  {accent:'#c084fc',glow:'rgba(192,132,252,0.25)',border:'rgba(192,132,252,0.3)'},
  }
  const c=COLORS[color]||COLORS.gold
  const [hover,setHover]=useState(false)
  return(
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{
        position:'relative',overflow:'hidden',cursor:'default',
        background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',
        borderRadius:18,padding:'26px 24px',
        border:`1px solid ${hover?c.border:'rgba(255,255,255,0.06)'}`,
        transform:hover?'translateY(-6px)':'translateY(0)',
        boxShadow:hover?`0 16px 40px rgba(0,0,0,0.6),0 0 30px ${c.glow}`:'0 4px 16px rgba(0,0,0,0.4)',
        transition:'all 0.5s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
      {/* glow burst */}
      <div style={{position:'absolute',inset:0,opacity:hover?1:0,transition:'opacity 0.4s ease',background:`radial-gradient(circle at top right,${c.glow} 0%,transparent 60%)`,pointerEvents:'none'}}/>
      {/* left accent bar */}
      <div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:`linear-gradient(180deg,${c.accent},transparent)`,transform:hover?'scaleY(1)':'scaleY(0)',transformOrigin:'top',transition:'transform 0.4s cubic-bezier(0.65,0,0.35,1)'}}/>
      {/* giant background icon */}
      <div style={{position:'absolute',right:-12,top:-8,fontSize:78,opacity:hover?0.10:0.04,transform:hover?'rotate(-8deg) scale(1.1)':'rotate(0) scale(1)',transition:'all 0.5s ease',pointerEvents:'none'}}>{icon}</div>
      {/* label */}
      <div style={{position:'relative',fontSize:10,fontWeight:700,letterSpacing:'0.18em',textTransform:'uppercase',color:c.accent,marginBottom:14,display:'flex',alignItems:'center',gap:8}}>
        <span style={{display:'inline-block',width:hover?40:24,height:2,background:c.accent,transition:'width 0.4s ease'}}/>
        {label}
      </div>
      {/* value */}
      <div style={{position:'relative',fontFamily:"'Bebas Neue',sans-serif",fontSize:58,lineHeight:0.95,color:'#f0ece8',marginBottom:8,textShadow:'0 2px 20px rgba(0,0,0,0.4)'}}>{value}</div>
      {/* meta */}
      {(trend||subtext)&&(
        <div style={{position:'relative',display:'flex',alignItems:'center',gap:8,fontSize:10,color:'#666',fontWeight:600,letterSpacing:'0.05em',flexWrap:'wrap'}}>
          {trend&&<span style={{background:`${c.accent}26`,color:c.accent,padding:'2px 9px',borderRadius:50,fontWeight:700}}>{trend}</span>}
          {subtext&&<span>{subtext}</span>}
        </div>
      )}
    </div>
  )
}

function ConfirmModal({title,message,onConfirm,onCancel,danger=true}){
  return(
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{...glass(),padding:'32px 36px',maxWidth:380,width:'90%',textAlign:'center',border:`1px solid ${danger?'rgba(232,74,47,0.3)':'rgba(245,200,66,0.3)'}`}}>
        <div style={{fontSize:36,marginBottom:10}}>{danger?'⚠️':'❓'}</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:'#f0ece8',marginBottom:8}}>{title}</div>
        <div style={{fontSize:12,color:'#7a7570',lineHeight:1.7,marginBottom:22}}>{message}</div>
        <div style={{display:'flex',gap:10,justifyContent:'center'}}>
          <button onClick={onCancel} style={{background:'transparent',color:'#555',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'9px 22px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Cancel</button>
          <button onClick={onConfirm} style={{background:danger?'linear-gradient(135deg,#e84a2f,#c93820)':'linear-gradient(135deg,#4ade80,#22c55e)',color:danger?'#fff':'#000',border:'none',borderRadius:50,padding:'9px 22px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

// Leaderboard row component
function LBRow({user,maxScore,idx}){
  const [show,setShow]=useState(false)
  const [barW,setBarW]=useState(0)
  useEffect(()=>{
    const t1=setTimeout(()=>setShow(true),idx*35)
    const t2=setTimeout(()=>setBarW(maxScore>0?(user.score/maxScore)*100:0),idx*35+350)
    return()=>{clearTimeout(t1);clearTimeout(t2)}
  },[])
  const lc=LEVEL_COLOR[user.experience]||'#f5c842'
  const lvIc=LEVEL_ICON[user.experience]||'🥊'
  const rc=user.rank<=3?RANK_COLORS[user.rank-1]:lc
  const medals={1:'🥇',2:'🥈',3:'🥉'}
  return(
    <div style={{display:'flex',alignItems:'center',padding:'12px 20px',
      background:user.rank<=3?`linear-gradient(90deg,${RANK_COLORS[user.rank-1]}10,transparent)`:'transparent',
      borderBottom:'1px solid rgba(255,255,255,0.04)',
      borderLeft:user.rank<=3?`3px solid ${RANK_COLORS[user.rank-1]}`:'3px solid transparent',
      opacity:show?1:0,transform:show?'none':'translateX(-16px)',transition:`all 0.35s ease ${idx*35}ms`,cursor:'default'}}
      onMouseEnter={e=>{e.currentTarget.style.background=user.rank<=3?`linear-gradient(90deg,${RANK_COLORS[user.rank-1]}20,transparent)`:'rgba(255,255,255,0.025)'}}
      onMouseLeave={e=>{e.currentTarget.style.background=user.rank<=3?`linear-gradient(90deg,${RANK_COLORS[user.rank-1]}10,transparent)`:'transparent'}}>
      <div style={{width:46,flexShrink:0,textAlign:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:user.rank<=3?20:14,color:user.rank<=3?rc:'#666',letterSpacing:'0.05em'}}>
        {medals[user.rank]||`#${user.rank}`}
      </div>
      <div style={{position:'relative',flexShrink:0,marginRight:12}}>
        <div style={{width:36,height:36,borderRadius:'50%',background:`linear-gradient(135deg,${lc},${lc}aa)`,color:'#000',border:`2px solid ${lc}66`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:14,boxShadow:`0 2px 8px ${lc}30`}}>
          {(user.name||'?')[0].toUpperCase()}
        </div>
        <div style={{position:'absolute',bottom:-2,right:-4,width:14,height:14,borderRadius:'50%',background:'#0e0a0a',border:`1.5px solid ${lc}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:7}}>{lvIc}</div>
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:12,fontWeight:700,color:'#f0ece8',marginBottom:2}}>{user.name}</div>
        <div style={{fontSize:9,color:'#666',letterSpacing:'0.04em'}}>{user.goal||'—'}</div>
      </div>
      <div style={{width:50,flexShrink:0,fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:'#f0ece8'}}>{user.totalWorkouts||0}<span style={{fontSize:11,marginLeft:2}}>🥊</span></div>
      <div style={{width:60,flexShrink:0,fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color:(user.streak||0)>0?'#e84a2f':'#333'}}>🔥{user.streak||0}d</div>
      <div style={{width:140,flexShrink:0,display:'flex',alignItems:'center',gap:10}}>
        <div style={{flex:1,height:6,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden',border:'1px solid rgba(255,255,255,0.04)'}}>
          <div style={{height:'100%',borderRadius:50,background:`linear-gradient(90deg,${rc},${rc}dd)`,width:`${barW}%`,transition:'width 1s ease',boxShadow:`0 0 8px ${rc}88`}}/>
        </div>
        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:rc,minWidth:42,textAlign:'right',textShadow:`0 0 10px ${rc}66`}}>{user.score}</span>
      </div>
    </div>
  )
}

/** Firestore stores maps with numeric string keys; member Home uses object keyed by schedule idx. */
function pickDayMap(map, idx) {
  if (!map || typeof map !== 'object') return undefined
  return map[idx] ?? map[String(idx)]
}

/** Same merged "session" the client sees: template schedule + generated override + booked extras. */
function buildCoachWorkoutRows(wData, memberSchedule) {
  if (!memberSchedule?.length) return []
  const rawGen = wData?.generatedWorkouts
  const byIdx = {}
  if (Array.isArray(rawGen)) rawGen.forEach((w, i) => { if (w) byIdx[i] = w })
  else if (rawGen && typeof rawGen === 'object') Object.assign(byIdx, rawGen)

  const checked = wData?.dayChecked || {}
  const extrasRoot = wData?.bookedExtras || {}
  const rows = []
  for (const slot of memberSchedule) {
    const idx = slot.idx
    const ow = pickDayMap(byIdx, idx)
    const merged = ow || slot.workout
    if (!merged) continue
    const baseEx = (merged.exercises || []).map(e => (typeof e === 'string' ? e : (e?.name || String(e))))
    const extras = pickDayMap(extrasRoot, idx) || []
    const extraNames = (extras || []).map(e => (typeof e === 'string' ? e : (e?.name || String(e))))
    const exercises = [...baseEx, ...extraNames]
    const ch = pickDayMap(checked, idx) || []
    const done = exercises.length > 0 && ch.length >= exercises.length && ch.slice(0, exercises.length).every(Boolean)
    const label = idx === 0 ? 'Today' : `${slot.dayName} · ${slot.dateStr}`
    const title = merged.title || merged.day || slot.workout?.title || `Session ${idx + 1}`
    rows.push({ idx, slot, merged, done, label, title, exercises, duration: merged.duration || '' })
  }
  return rows
}


// ── MEMBER PANEL ──────────────────────────────────────
function MemberPanel({ selMember, setSelMember, setMsgTarget, setMsgThread, coachWorkoutRows, selWorkoutDay, setSelWorkoutDay, fbText, setFbText, fbRating, setFbRating, postFeedback, feedbackMap, editingFb, setEditingFb, saveEditFeedback, deleteFeedback, setConfirm, setLevelTarget }) {
  const lc = { Beginner:'#fb923c', Intermediate:'#f5c842', Advanced:'#22c55e' }[selMember.experience] || '#f5c842'
  const lvIcon = { Beginner:'🥊', Intermediate:'⚡', Advanced:'🔥' }[selMember.experience] || '🥊'
  const fbList = feedbackMap[selMember.uid] || []
  const todayRow = coachWorkoutRows.find(r => r.idx === 0)
  const selRow = selWorkoutDay !== null && selWorkoutDay !== undefined ? coachWorkoutRows.find(r => r.idx === selWorkoutDay) : null
  const dayLabel = selRow ? `${selRow.label} — ${selRow.title}` : null
  const memberRankPts = ((selMember.totalWorkouts||0)*10) + ((selMember.streak||0)*5) + ({Beginner:0,Intermediate:150,Advanced:350}[selMember.experience||'Beginner']||0) + Math.round((selMember.weeklyPct||0)*1.5)

  // Parse a row label like "Mon · May 4" into separated day/date
  function parseDayBadge(label){
    if(!label) return {day:'?',mon:''}
    if(label.toLowerCase().includes('today')) return {day:'★',mon:'NOW',isStar:true}
    const parts=label.split(/[·•|]/).map(s=>s.trim())
    if(parts.length>=2){
      const dayName=parts[0].slice(0,3).toUpperCase()
      const dateMatch=parts[1].match(/(\d+)/)
      const dateNum=dateMatch ? dateMatch[1].padStart(2,'0') : '--'
      return {day:dateNum,mon:dayName}
    }
    return {day:label.slice(0,3).toUpperCase(),mon:''}
  }

  return (
    <div style={{display:'flex', flexDirection:'column', gap:14}}>

      {/* ═════════════════════════════════════════════ */}
      {/* MEMBER FIGHT CARD — Header                  */}
      {/* ═════════════════════════════════════════════ */}
      <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:`1px solid ${lc}30`,boxShadow:`0 12px 40px rgba(0,0,0,0.5),0 0 30px ${lc}15`}}>
        {/* Glow burst behind avatar */}
        <div style={{position:'absolute',left:-20,top:-20,width:180,height:180,borderRadius:'50%',background:`radial-gradient(circle,${lc}30,transparent 70%)`,pointerEvents:'none'}}/>
        {/* Left accent stripe */}
        <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:`linear-gradient(180deg,${lc},#e84a2f,transparent)`}}/>

        <div style={{position:'relative',padding:'22px 24px',display:'flex',gap:18,alignItems:'center'}}>
          {/* Avatar with glow ring */}
          <div style={{position:'relative',flexShrink:0}}>
            <div style={{width:64,height:64,borderRadius:'50%',background:`linear-gradient(135deg,${lc},#e84a2f)`,display:'flex',alignItems:'center',justifyContent:'center',color:'#000',fontFamily:"'Bebas Neue',sans-serif",fontSize:28,border:`3px solid ${lc}66`,boxShadow:`0 6px 20px ${lc}50,inset 0 2px 8px rgba(255,255,255,0.15)`}}>
              {(selMember.name || '?')[0].toUpperCase()}
            </div>
          </div>
          {/* Name + tags */}
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:18,fontWeight:800,color:'#f0ece8',marginBottom:6,letterSpacing:'-0.01em'}}>{selMember.name}</div>
            <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
              <span style={{fontSize:9,fontWeight:700,padding:'3px 9px',borderRadius:50,textTransform:'uppercase',letterSpacing:'0.08em',background:`${lc}22`,color:lc,border:`1px solid ${lc}44`}}>
                {lvIcon} {selMember.experience||'Beginner'}
              </span>
              <span style={{fontSize:9,fontWeight:700,padding:'3px 9px',borderRadius:50,textTransform:'uppercase',letterSpacing:'0.08em',background:'rgba(232,74,47,0.15)',color:'#e84a2f',border:'1px solid rgba(232,74,47,0.3)'}}>
                🔥 {selMember.streak||0}d streak
              </span>
              <span style={{fontSize:9,fontWeight:700,padding:'3px 9px',borderRadius:50,textTransform:'uppercase',letterSpacing:'0.08em',background:'rgba(245,200,66,0.12)',color:'#f5c842',border:'1px solid rgba(245,200,66,0.3)'}}>
                🎯 {selMember.goal||'Learn Boxing'}
              </span>
            </div>
          </div>
          {/* Rank pts pill */}
          <div style={{textAlign:'right',padding:'10px 16px',background:'rgba(0,0,0,0.3)',borderRadius:12,border:'1px solid rgba(245,200,66,0.18)'}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:'#f5c842',lineHeight:1,textShadow:'0 0 12px rgba(245,200,66,0.4)'}}>{memberRankPts}</div>
            <div style={{fontSize:8,color:'#888',letterSpacing:'0.15em',fontWeight:700,marginTop:2}}>RANK PTS</div>
          </div>
          {/* Actions */}
          <div style={{display:'flex',flexDirection:'column',gap:6}}>
            <button onClick={() => setLevelTarget(selMember)}
              title="Promote / Demote"
              style={{background:'linear-gradient(135deg,rgba(192,132,252,0.2),rgba(192,132,252,0.08))',color:'#c084fc',border:'1px solid rgba(192,132,252,0.4)',borderRadius:10,padding:'7px 14px',fontSize:11,cursor:'pointer',fontWeight:700,whiteSpace:'nowrap',transition:'all 0.2s'}}
              onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 4px 12px rgba(192,132,252,0.3)'}}
              onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='none'}}>
              🎚 Level
            </button>
            <button onClick={() => { setMsgTarget(selMember); setMsgThread([]) }}
              style={{background:'linear-gradient(135deg,rgba(66,165,245,0.2),rgba(66,165,245,0.08))',color:'#42a5f5',border:'1px solid rgba(66,165,245,0.4)',borderRadius:10,padding:'7px 14px',fontSize:11,cursor:'pointer',fontWeight:700,whiteSpace:'nowrap',transition:'all 0.2s'}}
              onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 4px 12px rgba(66,165,245,0.3)'}}
              onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='none'}}>
              💬 Message
            </button>
            <button onClick={() => setSelMember(null)}
              style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',color:'#666',borderRadius:10,padding:'4px',fontSize:14,cursor:'pointer',fontWeight:700}}>
              ✕
            </button>
          </div>
        </div>

        {/* Stats strip */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',borderTop:`1px solid ${lc}20`,background:'rgba(0,0,0,0.25)'}}>
          {[
            {icon:'🥊', label:'Workouts', val:selMember.totalWorkouts || 0, color:'#f5c842'},
            {icon:'🔥', label:'Streak',   val:(selMember.streak || 0) + 'd', color:'#e84a2f'},
            {icon:'📅', label:'Weekly',   val:(selMember.weeklyPct || 0) + '%', color:'#22c55e'},
          ].map((st, i) => (
            <div key={i} style={{padding:'14px 12px', textAlign:'center', borderRight: i < 2 ? '1px solid rgba(255,255,255,0.05)' : 'none', cursor:'default',transition:'background 0.2s'}}
              onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.03)'}
              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
              <div style={{fontSize:18,marginBottom:2}}>{st.icon}</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif", fontSize:24, color:st.color, lineHeight:1}}>{st.val}</div>
              <div style={{fontSize:8, color:'#666', fontWeight:700, letterSpacing:'0.1em', textTransform:'uppercase',marginTop:4}}>{st.label}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ═════════════════════════════════════════════ */}
      {/* POST SESSION FEEDBACK CARD                   */}
      {/* ═════════════════════════════════════════════ */}
      <div style={{position:'relative',overflow:'hidden',borderRadius:20,background:'linear-gradient(135deg,rgba(20,15,15,0.95),rgba(10,7,7,0.98))',border:'1px solid rgba(245,200,66,0.12)',boxShadow:'0 20px 50px rgba(0,0,0,0.5)'}}>
        {/* Header with red→gold stripe */}
        <div style={{position:'relative',padding:'18px 24px',background:'linear-gradient(135deg,rgba(232,74,47,0.12) 0%,transparent 60%)',borderBottom:'1px solid rgba(245,200,66,0.1)',display:'flex',justifyContent:'space-between',alignItems:'center',gap:16}}>
          <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#f5c842)'}}/>
          <div style={{display:'flex',alignItems:'center',gap:14}}>
            <div style={{width:44,height:44,borderRadius:12,background:'linear-gradient(135deg,#e84a2f,#c93820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 6px 20px rgba(232,74,47,0.4)'}}>📝</div>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#f0ece8'}}>POST SESSION FEEDBACK</div>
              <div style={{fontSize:10,color:'#777',letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600,marginTop:1}}>Coach Notes · Real-time</div>
            </div>
          </div>
          {fbList.length>0 && (
            <div style={{textAlign:'right'}}>
              <div style={{fontSize:10,color:'#22c55e',fontWeight:700,display:'flex',alignItems:'center',justifyContent:'flex-end',gap:6}}>
                <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#22c55e',animation:'pulseDot 1.6s ease-in-out infinite'}}/>
                {fbList.length} sent
              </div>
            </div>
          )}
        </div>

        <div style={{padding:'18px 24px 24px',display:'flex',flexDirection:'column',gap:14}}>

          {/* Today's workout context (if any) */}
          {todayRow ? (
            <div style={{background:'linear-gradient(135deg,rgba(232,74,47,0.08),rgba(232,74,47,0.02))',border:'1px solid rgba(232,74,47,0.25)',borderRadius:12,padding:'12px 14px'}}>
              <div style={{fontSize:9,fontWeight:700,color:'#e84a2f',letterSpacing:'0.12em',marginBottom:6,textTransform:'uppercase',display:'flex',alignItems:'center',gap:6}}>
                <span style={{display:'inline-block',width:14,height:2,background:'#e84a2f'}}/>
                {'Today\u2019s workout (member view)'}
              </div>
              <div style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{todayRow.title}{todayRow.duration ? <span style={{color:'#666',fontWeight:600,fontSize:10,marginLeft:8}}>· {todayRow.duration}</span> : null}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6,marginTop:8}}>
                {todayRow.exercises.map((ex, j) => (
                  <span key={j} style={{fontSize:10,padding:'3px 9px',borderRadius:50,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.06)'}}>{ex}</span>
                ))}
              </div>
            </div>
          ) : (
            <div style={{background:'rgba(255,255,255,0.02)', borderRadius:10, padding:'10px 14px', fontSize:11, color:'#666', textAlign:'center', border:'1px dashed rgba(255,255,255,0.06)'}}>
              📅 No session scheduled for today for this member.
            </div>
          )}

          {/* Workout selector — calendar cards */}
          {coachWorkoutRows.length === 0 ? (
            <div style={{background:'rgba(255,255,255,0.02)',borderRadius:12,padding:'18px',fontSize:11,color:'#666',textAlign:'center',border:'1px dashed rgba(255,255,255,0.06)'}}>
              📋 No workout days in this member{"'"}s plan.<br/>Check profile (days/week, goal, level).
            </div>
          ) : (
            <div>
              <div style={{fontSize:10,fontWeight:700,color:'#666',letterSpacing:'0.18em',marginBottom:10,textTransform:'uppercase',display:'flex',alignItems:'center',gap:10}}>
                <span style={{display:'inline-block',width:18,height:2,background:'#f5c842'}}/>
                Pick a workout to comment on
              </div>

              {/* Legend */}
              <div style={{display:'flex',gap:18,alignItems:'center',padding:'8px 14px',background:'rgba(245,200,66,0.04)',border:'1px solid rgba(245,200,66,0.12)',borderRadius:10,marginBottom:10,fontSize:9,color:'#888',fontWeight:600,letterSpacing:'0.06em'}}>
                <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:'#22c55e'}}/>COMPLETED</div>
                <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:'#f5c842'}}/>TODAY</div>
                <div style={{display:'flex',alignItems:'center',gap:6}}><span style={{width:8,height:8,borderRadius:'50%',background:'#555'}}/>UPCOMING</div>
              </div>

              <div style={{display:'flex',flexDirection:'column',gap:8,maxHeight:340,overflowY:'auto',paddingRight:4}}>

                {/* General feedback card */}
                <div onClick={() => setSelWorkoutDay(null)}
                  style={{position:'relative',background:selWorkoutDay===null?'linear-gradient(135deg,rgba(245,200,66,0.12),rgba(232,74,47,0.06))':'linear-gradient(135deg,rgba(40,30,28,0.5),rgba(20,15,14,0.7))',border:`1px solid ${selWorkoutDay===null?'rgba(245,200,66,0.45)':'rgba(255,255,255,0.06)'}`,borderRadius:14,padding:'14px 16px',display:'flex',alignItems:'center',gap:14,cursor:'pointer',transform:selWorkoutDay===null?'translateX(4px)':'translateX(0)',boxShadow:selWorkoutDay===null?'0 8px 24px rgba(245,200,66,0.15)':'none',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',minHeight:74}}
                  onMouseEnter={e=>{if(selWorkoutDay!==null){e.currentTarget.style.transform='translateX(4px)';e.currentTarget.style.borderColor='rgba(245,200,66,0.3)'}}}
                  onMouseLeave={e=>{if(selWorkoutDay!==null){e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.borderColor='rgba(255,255,255,0.06)'}}}>
                  <div style={{position:'absolute',left:0,top:0,bottom:0,width:selWorkoutDay===null?5:0,background:'linear-gradient(180deg,#f5c842,transparent)',transition:'width 0.3s ease',borderRadius:'14px 0 0 14px'}}/>
                  <div style={{width:46,height:46,borderRadius:12,background:'linear-gradient(135deg,#f5c842,#e08820)',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#000',flexShrink:0,boxShadow:'0 4px 12px rgba(245,200,66,0.3)'}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,lineHeight:1}}>★</div>
                    <div style={{fontSize:7,fontWeight:800,letterSpacing:'0.1em',marginTop:1}}>ALL</div>
                  </div>
                  <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',justifyContent:'center',gap:4}}>
                    <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                      <span style={{fontSize:13,fontWeight:700,color:selWorkoutDay===null?'#f5c842':'#f0ece8'}}>General Feedback</span>
                      {selWorkoutDay===null && <span style={{fontSize:8,fontWeight:800,letterSpacing:'0.1em',padding:'2px 7px',borderRadius:50,background:'rgba(245,200,66,0.2)',color:'#f5c842',flexShrink:0}}>SELECTED</span>}
                    </div>
                    <div style={{fontSize:10,color:'#777'}}>Not tied to a specific day</div>
                  </div>
                  <div style={{width:24,height:24,borderRadius:'50%',border:`1.5px solid ${selWorkoutDay===null?'#f5c842':'rgba(255,255,255,0.15)'}`,display:'flex',alignItems:'center',justifyContent:'center',background:selWorkoutDay===null?'linear-gradient(135deg,#f5c842,#e08820)':'transparent',color:'#000',fontWeight:700,fontSize:12,transform:selWorkoutDay===null?'scale(1.1)':'scale(1)',transition:'all 0.3s ease',flexShrink:0}}>
                    {selWorkoutDay===null?'✓':''}
                  </div>
                </div>

                {/* Each workout day */}
                {coachWorkoutRows.map(row => {
                  const sel = selWorkoutDay === row.idx
                  const exList = row.exercises.slice(0, 4).join(' · ')
                  const dayBadge = parseDayBadge(row.label)
                  const isToday = row.idx === 0
                  const accent = row.done ? '#22c55e' : isToday ? '#f5c842' : '#666'
                  const dim = !row.done && !isToday
                  return (
                    <div key={row.idx} onClick={() => setSelWorkoutDay(row.idx)}
                      style={{position:'relative',background:sel?'linear-gradient(135deg,rgba(66,165,245,0.10),rgba(66,165,245,0.03))':row.done?'linear-gradient(135deg,rgba(34,197,94,0.05),rgba(20,15,14,0.7))':'linear-gradient(135deg,rgba(40,30,28,0.5),rgba(20,15,14,0.7))',border:`1px solid ${sel?'rgba(66,165,245,0.45)':row.done?'rgba(34,197,94,0.18)':'rgba(255,255,255,0.06)'}`,borderRadius:14,padding:'14px 16px',display:'flex',alignItems:'center',gap:14,cursor:'pointer',opacity:dim?0.7:1,transform:sel?'translateX(4px)':'translateX(0)',boxShadow:sel?'0 8px 24px rgba(66,165,245,0.15)':'none',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',minHeight:74}}
                      onMouseEnter={e=>{if(!sel){e.currentTarget.style.transform='translateX(4px)';e.currentTarget.style.opacity='1';e.currentTarget.style.borderColor=`${accent}55`}}}
                      onMouseLeave={e=>{if(!sel){e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.opacity=dim?'0.7':'1';e.currentTarget.style.borderColor=row.done?'rgba(34,197,94,0.18)':'rgba(255,255,255,0.06)'}}}>
                      <div style={{position:'absolute',left:0,top:0,bottom:0,width:sel?5:0,background:`linear-gradient(180deg,${accent},transparent)`,transition:'width 0.3s ease',borderRadius:'14px 0 0 14px'}}/>
                      {/* Date badge */}
                      <div style={{width:46,height:46,borderRadius:12,background:row.done?'linear-gradient(135deg,rgba(34,197,94,0.25),rgba(34,197,94,0.05))':isToday?'linear-gradient(135deg,rgba(245,200,66,0.2),rgba(245,200,66,0.05))':'rgba(255,255,255,0.04)',border:`1px solid ${row.done?'rgba(34,197,94,0.4)':isToday?'rgba(245,200,66,0.4)':'rgba(255,255,255,0.06)'}`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',flexShrink:0}}>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,lineHeight:1,color:row.done?'#22c55e':isToday?'#f5c842':'#f0ece8'}}>{dayBadge.day}</div>
                        <div style={{fontSize:7,color:'#888',letterSpacing:'0.1em',fontWeight:700,marginTop:2}}>{dayBadge.mon}</div>
                      </div>
                      <div style={{flex:1,minWidth:0,display:'flex',flexDirection:'column',justifyContent:'center',gap:4}}>
                        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
                          <span style={{fontSize:13,fontWeight:700,color:sel?'#42a5f5':row.done?'#22c55e':isToday?'#f5c842':'#f0ece8',lineHeight:1.3}}>{row.title}</span>
                          {/* Show only the most relevant pill — hierarchy: SELECTED > TODAY > DONE */}
                          {sel ? (
                            <span style={{fontSize:8,fontWeight:800,letterSpacing:'0.1em',padding:'2px 7px',borderRadius:50,background:'rgba(66,165,245,0.18)',color:'#42a5f5',flexShrink:0}}>SELECTED</span>
                          ) : isToday ? (
                            <span style={{fontSize:8,fontWeight:800,letterSpacing:'0.1em',padding:'2px 7px',borderRadius:50,background:'rgba(245,200,66,0.18)',color:'#f5c842',flexShrink:0}}>TODAY</span>
                          ) : row.done ? (
                            <span style={{fontSize:8,fontWeight:800,letterSpacing:'0.1em',padding:'2px 7px',borderRadius:50,background:'rgba(34,197,94,0.18)',color:'#22c55e',flexShrink:0}}>DONE</span>
                          ) : null}
                        </div>
                        {exList && <div style={{fontSize:10,color:'#777',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',lineHeight:1.4}}>{exList}{row.exercises.length>4?' · …':''}</div>}
                      </div>
                      <div style={{width:24,height:24,borderRadius:'50%',border:`1.5px solid ${sel?'#42a5f5':'rgba(255,255,255,0.15)'}`,display:'flex',alignItems:'center',justifyContent:'center',background:sel?'#42a5f5':'transparent',color:'#fff',fontWeight:700,fontSize:12,transform:sel?'scale(1.1)':'scale(1)',transition:'all 0.3s ease',flexShrink:0}}>
                        {sel?'✓':''}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Full workload preview when a day is selected */}
          {selRow && selRow.exercises.length > 0 && (
            <div style={{background:'linear-gradient(135deg,rgba(66,165,245,0.08),rgba(66,165,245,0.02))',border:'1px solid rgba(66,165,245,0.25)',borderRadius:12,padding:'12px 14px'}}>
              <div style={{fontSize:9,fontWeight:700,color:'#42a5f5',letterSpacing:'0.12em',marginBottom:6,textTransform:'uppercase',display:'flex',alignItems:'center',gap:6}}>
                <span style={{display:'inline-block',width:14,height:2,background:'#42a5f5'}}/>
                Full workload for this comment
              </div>
              <div style={{fontSize:12,fontWeight:700,color:'#f0ece8',marginBottom:6}}>{selRow.title}</div>
              <div style={{display:'flex',flexWrap:'wrap',gap:6}}>
                {selRow.exercises.map((ex, j) => (
                  <span key={j} style={{fontSize:10,padding:'3px 9px',borderRadius:50,background:'rgba(66,165,245,0.08)',color:'#aaa',border:'1px solid rgba(66,165,245,0.18)'}}>{ex}</span>
                ))}
              </div>
            </div>
          )}

          {/* Rating */}
          <div>
            <div style={{fontSize:10,fontWeight:700,color:'#666',letterSpacing:'0.18em',marginBottom:8,textTransform:'uppercase',display:'flex',alignItems:'center',gap:10}}>
              <span style={{display:'inline-block',width:18,height:2,background:'#f5c842'}}/>
              Rating
            </div>
            <div style={{display:'flex', gap:8}}>
              {[1,2,3,4,5].map(s => (
                <span key={s} onClick={() => setFbRating(s)}
                  style={{fontSize:28, cursor:'pointer', opacity: s <= fbRating ? 1 : 0.2, transition:'all 0.2s cubic-bezier(0.34,1.56,0.64,1)',
                    filter: s <= fbRating ? 'drop-shadow(0 0 8px rgba(245,200,66,0.7))' : 'none',
                    transform: s <= fbRating ? 'scale(1.1)':'scale(1)'}}
                  onMouseEnter={e=>e.currentTarget.style.transform='scale(1.25)'}
                  onMouseLeave={e=>e.currentTarget.style.transform=s<=fbRating?'scale(1.1)':'scale(1)'}>
                  ⭐
                </span>
              ))}
            </div>
          </div>

          {/* Message textarea */}
          <div>
            <div style={{fontSize:10,fontWeight:700,color:'#666',letterSpacing:'0.18em',marginBottom:8,textTransform:'uppercase',display:'flex',alignItems:'center',gap:10}}>
              <span style={{display:'inline-block',width:18,height:2,background:'#f5c842'}}/>
              Your message
            </div>
            <div style={{position:'relative'}}>
              <textarea
                value={fbText}
                onChange={e => setFbText(e.target.value)}
                rows={4}
                maxLength={500}
                placeholder={dayLabel ? `Tell ${selMember.name?.split(' ')[0]||'them'} how they crushed ${selRow?.title}...` : `Encourage ${selMember.name?.split(' ')[0]||'them'}, share a coaching tip, or push their next goal...`}
                style={{width:'100%',resize:'vertical',minHeight:110,background:'linear-gradient(135deg,rgba(20,15,14,0.8),rgba(15,10,10,0.9))',border:'1px solid rgba(255,255,255,0.08)',borderRadius:14,padding:'14px 16px',color:'#f0ece8',fontFamily:'Montserrat,sans-serif',fontSize:13,lineHeight:1.6,outline:'none',boxSizing:'border-box',transition:'all 0.25s ease'}}
                onFocus={e=>{e.target.style.borderColor='rgba(245,200,66,0.4)';e.target.style.boxShadow='0 0 0 3px rgba(245,200,66,0.08), inset 0 1px 0 rgba(245,200,66,0.05)'}}
                onBlur={e=>{e.target.style.borderColor='rgba(255,255,255,0.08)';e.target.style.boxShadow='none'}}
              />
              <div style={{position:'absolute',bottom:10,right:14,fontSize:9,color:fbText.length>=480?'#e84a2f':'#555',fontWeight:700,background:'rgba(0,0,0,0.5)',padding:'2px 8px',borderRadius:50}}>
                {fbText.length} / 500
              </div>
            </div>
          </div>

          {/* POWER SEND button */}
          <button onClick={postFeedback} disabled={!fbText.trim() || fbRating === 0}
            style={{
              position:'relative',overflow:'hidden',
              background: fbText.trim() && fbRating > 0 ? 'linear-gradient(135deg,#e84a2f,#c93820)' : 'rgba(255,255,255,0.04)',
              color: fbText.trim() && fbRating > 0 ? '#fff' : '#444',
              border:'none', borderRadius:50, padding:'14px 24px', fontSize:13, fontWeight:800,
              letterSpacing:'0.06em',textTransform:'uppercase',
              cursor: fbText.trim() && fbRating > 0 ? 'pointer' : 'not-allowed',
              boxShadow: fbText.trim() && fbRating > 0 ? '0 6px 20px rgba(232,74,47,0.4),inset 0 1px 0 rgba(255,255,255,0.15)' : 'none',
              transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',
            }}
            onMouseEnter={e=>{if(fbText.trim()&&fbRating>0){e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 10px 30px rgba(232,74,47,0.55),inset 0 1px 0 rgba(255,255,255,0.2)'}}}
            onMouseLeave={e=>{if(fbText.trim()&&fbRating>0){e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 6px 20px rgba(232,74,47,0.4),inset 0 1px 0 rgba(255,255,255,0.15)'}}}>
            🥊 Send Feedback {dayLabel ? '— ' + (selRow?.title||'') : '(General)'} →
          </button>
        </div>

        {/* Past feedback */}
        {fbList.length > 0 && (
          <div style={{borderTop:'1px solid rgba(255,255,255,0.06)',padding:'18px 24px',display:'flex',flexDirection:'column',gap:10,background:'rgba(0,0,0,0.2)'}}>
            <div style={{fontSize:10,fontWeight:700,color:'#666',letterSpacing:'0.18em',textTransform:'uppercase',display:'flex',alignItems:'center',gap:10}}>
              <span style={{display:'inline-block',width:18,height:2,background:'#f5c842'}}/>
              Past Feedback ({fbList.length})
            </div>
            {fbList.map((fb, i) => (
              <div key={fb.id || i} style={{background:'linear-gradient(135deg,rgba(40,30,28,0.5),rgba(20,15,14,0.7))', border:'1px solid rgba(255,255,255,0.07)', borderRadius:12, overflow:'hidden',transition:'all 0.2s ease'}}
                onMouseEnter={e=>e.currentTarget.style.borderColor='rgba(232,74,47,0.25)'}
                onMouseLeave={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.07)'}>
                <div style={{padding:'10px 14px', background:'rgba(0,0,0,0.2)', display:'flex', alignItems:'center', justifyContent:'space-between', gap:8,borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                  <div style={{display:'flex', alignItems:'center', gap:8, flex:1, minWidth:0}}>
                    <span style={{fontSize:11, color:'#e84a2f', fontWeight:800,letterSpacing:'0.05em'}}>{fb.coachName || 'Coach'}</span>
                    {fb.workoutDayLabel && fb.workoutDayLabel !== 'General' && (
                      <span style={{fontSize:9, background:'rgba(66,165,245,0.15)', color:'#42a5f5', borderRadius:50, padding:'2px 8px', fontWeight:700,letterSpacing:'0.05em'}}>{fb.workoutDayLabel}</span>
                    )}
                  </div>
                  <div style={{display:'flex', alignItems:'center', gap:6}}>
                    <span style={{fontSize:11,color:'#f5c842',letterSpacing:'0.1em'}}>
                      {[1,2,3,4,5].map(j => j <= fb.rating ? '★' : '☆').join('')}
                    </span>
                    <button onClick={() => setEditingFb({id:fb.id, text:fb.text, rating:fb.rating})}
                      style={{background:'rgba(245,200,66,0.1)', border:'1px solid rgba(245,200,66,0.25)', borderRadius:7, padding:'3px 8px', fontSize:11, color:'#f5c842', cursor:'pointer'}}>✏️</button>
                    <button onClick={() => setConfirm({title:'Delete?', message:'Remove this feedback?', danger:true, onConfirm:() => deleteFeedback(fb.id, selMember.uid)})}
                      style={{background:'rgba(232,74,47,0.1)', border:'1px solid rgba(232,74,47,0.25)', borderRadius:7, padding:'3px 8px', fontSize:11, color:'#e84a2f', cursor:'pointer'}}>🗑</button>
                  </div>
                </div>
                <div style={{padding:'12px 14px'}}>
                  {editingFb && editingFb.id === fb.id ? (
                    <div style={{display:'flex', flexDirection:'column', gap:10}}>
                      <div style={{display:'flex', gap:6}}>
                        {[1,2,3,4,5].map(s => (
                          <span key={s} onClick={() => setEditingFb(p => ({...p, rating:s}))}
                            style={{fontSize:20, cursor:'pointer', opacity: s <= editingFb.rating ? 1 : 0.25,transition:'all 0.2s'}}>⭐</span>
                        ))}
                      </div>
                      <textarea value={editingFb.text} onChange={e => setEditingFb(p => ({...p, text:e.target.value}))} rows={3}
                        style={{background:'rgba(20,15,14,0.8)', border:'1px solid rgba(255,255,255,0.12)', borderRadius:10, padding:'10px 14px', color:'#f0ece8', fontSize:12, fontFamily:'Montserrat,sans-serif', outline:'none', width:'100%', boxSizing:'border-box', resize:'vertical'}}/>
                      <div style={{display:'flex', gap:8}}>
                        <button onClick={saveEditFeedback} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)', color:'#fff', border:'none', borderRadius:50, padding:'8px 18px', fontSize:11, fontWeight:700, cursor:'pointer'}}>Save</button>
                        <button onClick={() => setEditingFb(null)} style={{background:'transparent', color:'#666', border:'1px solid rgba(255,255,255,0.1)', borderRadius:50, padding:'8px 16px', fontSize:11, fontWeight:700, cursor:'pointer'}}>Cancel</button>
                      </div>
                    </div>
                  ) : (
                    <div style={{fontSize:12, color:'#b0ada8', lineHeight:1.7}}>{fb.text}</div>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}


export default function CoachDashboard(){
  const navigate=useNavigate()
  const canvasRef=useRef(null)
  const msgEndRef=useRef(null)
  const [tab,setTab]=useState('members')
  const [members,setMembers]=useState([])
  const [classes,setClasses]=useState([])
  const [feedbackMap,setFeedbackMap]=useState({})
  const [selMember,setSelMember]=useState(null)
  const [fbText,setFbText]=useState('')
  const [fbRating,setFbRating]=useState(0)
  const [searchQ,setSearchQ]=useState('')
  const [loading,setLoading]=useState(true)
  const [toast,setToast]=useState({msg:'',type:'success'})
  const [confirm,setConfirm]=useState(null)
  const [showNewClass,setShowNewClass]=useState(false)
  const [newClass,setNewClass]=useState({name:'',date:new Date().toISOString().slice(0,10),time:'6:00 AM',spots:'12',level:'Beginner'})
  const [deleteClassId,setDeleteClassId]=useState(null)
  const [logoutConfirm,setLogoutConfirm]=useState(false)
  const [coachProfile,setCoachProfile]=useState({name:'Coach'})
  const [progLevel,setProgLevel]=useState('All Levels')
  const [progGoal,setProgGoal]=useState('All Goals')
  const [lbLevel,setLbLevel]=useState('All Levels')
  const [lbGoal,setLbGoal]=useState('All Goals')
  const [notifs,setNotifs]=useState([])
  const [dismissedNotifs,setDismissedNotifs]=useState([])  // per-coach personal hides
  const [activity,setActivity]=useState([])
  const [notifSubTab,setNotifSubTab]=useState('announcements') // 'announcements' | 'activity'
  const [showNotif,setShowNotif]=useState(false)
  const [notifForm,setNotifForm]=useState({title:'',message:'',audience:'all'})
  const [msgTarget,setMsgTarget]=useState(null)
  const [msgThread,setMsgThread]=useState([])
  const [levelTarget,setLevelTarget]=useState(null) // member object for Level Control modal
  const [msgText,setMsgText]=useState('')
  const [sendingMsg,setSendingMsg]=useState(false)

  function showToast(msg,type='success'){setToast({msg,type});setTimeout(()=>setToast({msg:'',type:'success'}),3000)}

  // Relative time formatter for activity feed timestamps
  function formatRelativeTime(date) {
    const now = new Date()
    const diff = (now - date) / 1000
    if (diff < 60)     return 'just now'
    if (diff < 3600)   return Math.floor(diff/60) + 'm ago'
    if (diff < 86400)  return Math.floor(diff/3600) + 'h ago'
    if (diff < 604800) return Math.floor(diff/86400) + 'd ago'
    return date.toLocaleDateString('en-US', { month:'short', day:'numeric' })
  }

  // Delete a single activity event
  async function deleteActivityEvent(eventId) {
    try {
      await deleteDoc(doc(db, 'activity', eventId))
    } catch(e) {
      console.error('Delete activity failed:', e)
      showToast('❌ Failed: ' + (e.message||'unknown'), 'error')
    }
  }

  // Clear ALL activity — batched delete
  const [clearActivityConfirm, setClearActivityConfirm] = useState(false)
  const [clearingActivity, setClearingActivity] = useState(false)
  async function clearAllActivity() {
    if (activity.length === 0) return
    setClearingActivity(true)
    try {
      const chunks = []
      for (let i = 0; i < activity.length; i += 500) chunks.push(activity.slice(i, i+500))
      for (const chunk of chunks) {
        const batch = writeBatch(db)
        chunk.forEach(ev => batch.delete(doc(db, 'activity', ev.id)))
        await batch.commit()
      }
      showToast(`🧹 Cleared ${activity.length} activity event${activity.length===1?'':'s'}`)
      setClearActivityConfirm(false)
    } catch(e) {
      console.error('Clear activity failed:', e)
      showToast('❌ Failed: ' + (e.message||'unknown'), 'error')
    } finally {
      setClearingActivity(false)
    }
  }

  // ════════════════════════════════════════════════════════
  //  ANNOUNCEMENTS — Delete handlers (coach can only delete their own)
  // ════════════════════════════════════════════════════════
  // ════════════════════════════════════════════════════════
  //  ANNOUNCEMENTS — Filter out legacy system events
  //
  //  Older notifications were created with type='level_change',
  //  'booking_created', etc. — those should NEVER appear in the
  //  Announcements tab. They're now handled by the Activity Feed.
  //  We filter them out at the render layer so legacy DB rows don't
  //  pollute the UI, while still letting the member-side level
  //  celebration popup read its targeted notification.
  // ════════════════════════════════════════════════════════
  const SYSTEM_EVENT_TYPES = [
    'booking_created', 'booking_cancelled',
    'class_created',   'class_deleted',   'class_ended',   'class_thanks',
    'level_change',
    'member_signup',   'member_deactivated', 'member_reactivated', 'member_deleted',
  ]
  // Real, manually-posted gym announcements only
  const realAnnouncements = notifs.filter(n => !n.type || !SYSTEM_EVENT_TYPES.includes(n.type))

  // ════════════════════════════════════════════════════════
  //  ANNOUNCEMENTS — Per-user dismissal (Gmail Archive pattern)
  //
  //  Coaches don't globally delete announcements. They DISMISS from
  //  THEIR OWN view by adding the notif ID to their user doc's
  //  `dismissedNotifs` array. Other coaches/admin still see them.
  //
  //  This makes the gym a true multi-user environment where each
  //  coach manages their own inbox without affecting anyone else.
  // ════════════════════════════════════════════════════════

  // Visible to THIS coach (excludes ones they've personally dismissed)
  const visibleAnnouncements = realAnnouncements.filter(n => !dismissedNotifs.includes(n.id))

  // True if THIS coach is the author (for the "YOURS" pill)
  function isOwnAnnouncement(n) {
    const myUid = auth.currentUser?.uid
    return !!myUid && n.fromUid === myUid
  }

  // Dismiss ONE announcement from THIS coach's view (not global)
  async function dismissAnnouncement(notifId) {
    const me = auth.currentUser
    if (!me) return
    try {
      await updateDoc(doc(db, 'users', me.uid), {
        dismissedNotifs: arrayUnion(notifId),
      })
      showToast('👁 Hidden from your view')
    } catch(e) {
      console.error('Dismiss announcement failed:', e)
      showToast('❌ Failed: ' + (e.message||'unknown'), 'error')
    }
  }

  // "Clear All" — dismiss all currently-visible announcements from THIS coach's view
  const [clearMyPostsConfirm, setClearMyPostsConfirm] = useState(false)
  const [clearingMyPosts, setClearingMyPosts] = useState(false)
  async function dismissAllVisible() {
    const me = auth.currentUser
    if (!me) return
    if (visibleAnnouncements.length === 0) return
    setClearingMyPosts(true)
    try {
      const ids = visibleAnnouncements.map(n => n.id)
      // arrayUnion takes spread args, so cast the array
      await updateDoc(doc(db, 'users', me.uid), {
        dismissedNotifs: arrayUnion(...ids),
      })
      showToast(`👁 Hidden ${ids.length} announcement${ids.length===1?'':'s'} from your view`)
      setClearMyPostsConfirm(false)
    } catch(e) {
      console.error('Clear announcements failed:', e)
      showToast('❌ Failed: ' + (e.message||'unknown'), 'error')
    } finally {
      setClearingMyPosts(false)
    }
  }

  useEffect(()=>{
    const user=auth.currentUser
    if(!user)return
    // Subscribe to own user doc — gets dismissedNotifs in real time
    // (so dismissals sync across tabs/devices for the same coach)
    const unsub = onSnapshot(doc(db,'users',user.uid), (s)=>{
      if(!s.exists())return
      const d = s.data()
      setCoachProfile(d)
      setDismissedNotifs(Array.isArray(d.dismissedNotifs) ? d.dismissedNotifs : [])
    }, (e)=>console.error('User doc listener:', e))
    return () => unsub()
  },[])

  // Load notifications real-time
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,'notifications'),(snap)=>{
      const ns=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
      setNotifs(ns)
    },(e)=>console.error(e))
    return()=>unsub()
  },[])

  // Load activity feed real-time (system event log)
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,'activity'),(snap)=>{
      const items=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
      setActivity(items)
    },(e)=>console.error('Activity listener:',e))
    return()=>unsub()
  },[])

  // Real-time messages
  useEffect(()=>{
    if(!msgTarget)return
    const coachUid=auth.currentUser?.uid
    if(!coachUid)return
    const q=query(collection(db,'messages'),where('participants','array-contains',coachUid),orderBy('createdAt','asc'))
    const unsub=onSnapshot(q,(snap)=>{
      const all=snap.docs.map(d=>({id:d.id,...d.data()}))
      const thread=all.filter(m=>m.participants.includes(msgTarget.uid))
      setMsgThread(thread)
      setTimeout(()=>msgEndRef.current?.scrollIntoView({behavior:'smooth'}),100)
    },(e)=>console.error(e))
    return()=>unsub()
  },[msgTarget])

  async function loadMembers(){
    try{
      const snap=await getDocs(collection(db,'users'))
      const mems=[]
      for(const d of snap.docs){
        const data=d.data()
        if(data.role==='member'||!data.role){
          let stats={}
          try{const ss=await getDoc(doc(db,'stats',d.id));if(ss.exists())stats=ss.data()}catch(e){}
          mems.push({uid:d.id,...data,...stats})
        }
      }
      setMembers(mems)
    }catch(e){console.error(e)}
    setLoading(false)
  }

  async function loadClasses(){
    try{
      const snap=await getDocs(collection(db,'classes'))
      const all = snap.docs.map(d=>({id:d.id,...d.data()}))
      setClasses(all)
      // Background: auto-end any class whose time has passed.
      // Fire-and-forget — non-blocking, throttled to 5min per session.
      autoEndPastClasses(all).catch(e=>console.warn('Auto-end scan failed:',e.message))
    }catch(e){console.error(e)}
  }

  // ════════════════════════════════════════════════════════
  //  CLASS LIFECYCLE — Manual "Mark as Done" handler
  //
  //  Triggered by the coach clicking ✓ MARK AS DONE on a class card.
  //  Ends the class, thanks all participants, fires activity event.
  // ════════════════════════════════════════════════════════
  const [endClassTarget, setEndClassTarget] = useState(null)  // class object to confirm ending
  const [endingClass, setEndingClass] = useState(false)
  async function confirmEndClass(){
    if (!endClassTarget || endingClass) return
    setEndingClass(true)
    try {
      const r = await endClass(endClassTarget, { isAuto: false, actorName: coachProfile.name || 'Coach' })
      if (r.ended) {
        showToast(`🏁 Class ended · ${r.notified} member${r.notified===1?'':'s'} thanked`)
      } else {
        showToast('⚠ Class was already ended', 'error')
      }
      setEndClassTarget(null)
      loadClasses()
    } catch(e) {
      console.error('End class failed:', e)
      showToast('❌ Failed: ' + (e.message||'unknown'), 'error')
    } finally {
      setEndingClass(false)
    }
  }

  // Active = not ended AND not past scheduled time
  const visibleClasses = classes.filter(isClassActive)

  // Realtime bookings stream — used for accurate per-class enrollment count
  // (self-healing: even if cls.enrolled gets out of sync, we recount from here)
  const [bookings, setBookings] = useState([])
  useEffect(()=>{
    const unsub = onSnapshot(collection(db,'bookings'), (snap)=>{
      setBookings(snap.docs.map(d=>({id:d.id,...d.data()})))
    }, (err)=>console.warn('Bookings stream:', err))
    return ()=>unsub()
  },[])

  const [memberWorkouts,setMemberWorkouts]=useState({}) // uid -> workout doc
  const [selWorkoutDay,setSelWorkoutDay]=useState(null)   // selected schedule index (same as member Home idx), or null = general
  const [editingFb,setEditingFb]=useState(null)           // {id, text, rating}

  const memberSchedule = useMemo(() => (selMember ? buildSchedule(selMember, new Date()) : []), [selMember])
  const coachWorkoutRows = useMemo(() => {
    if (!selMember) return []
    const wData = memberWorkouts[selMember.uid]
    return buildCoachWorkoutRows(wData, memberSchedule)
  }, [selMember, memberWorkouts, memberSchedule])

  async function loadFeedback(uid){
    try{
      const q=query(collection(db,'feedback'),where('memberId','==',uid))
      const snap=await getDocs(q)
      const fbs=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
      setFeedbackMap(prev=>({...prev,[uid]:fbs}))
    }catch(e){console.error(e)}
  }

  async function loadMemberWorkouts(uid){
    try{
      const wSnap=await getDoc(doc(db,'workouts',uid))
      if(wSnap.exists()) setMemberWorkouts(prev=>({...prev,[uid]:wSnap.data()}))
    }catch(e){console.error('Workout load:',e)}
  }

  async function deleteFeedback(fbId,memberId){
    try{
      await deleteDoc(doc(db,'feedback',fbId))
      loadFeedback(memberId)
      showToast('🗑 Feedback deleted')
    }catch(e){showToast('❌ Could not delete','error')}
  }

  async function saveEditFeedback(){
    if(!editingFb||!editingFb.text.trim())return
    try{
      await updateDoc(doc(db,'feedback',editingFb.id),{
        text:editingFb.text.trim(),rating:editingFb.rating,
        editedAt:serverTimestamp(),
      })
      setEditingFb(null)
      if(selMember)loadFeedback(selMember.uid)
      showToast('✅ Feedback updated!')
    }catch(e){showToast('❌ Could not update','error')}
  }

  useEffect(()=>{
    loadMembers();loadClasses()
    const t=setInterval(()=>{loadMembers();loadClasses()},15000)
    return()=>clearInterval(t)
  },[])

  useEffect(()=>{
    if(selMember){
      loadFeedback(selMember.uid)
      loadMemberWorkouts(selMember.uid)
      setSelWorkoutDay(null)
      setEditingFb(null)
      setFbText('')
      setFbRating(0)
    }
  },[selMember])

  async function postFeedback(){
    if(!selMember||!fbText.trim()||fbRating===0)return
    const row = selWorkoutDay !== null && selWorkoutDay !== undefined ? coachWorkoutRows.find(r => r.idx === selWorkoutDay) : null
    try{
      await addDoc(collection(db,'feedback'),{
        memberId:selMember.uid,memberName:selMember.name||'Member',
        coachId:auth.currentUser?.uid,coachName:coachProfile.name||'Coach',
        text:fbText.trim(),rating:fbRating,
        workoutDayIndex:selWorkoutDay,
        workoutDayLabel:row ? `${row.title} — ${row.label}` : 'General',
        workoutExercises:row?.exercises || [],
        createdAt:serverTimestamp(),
      })
      setFbText('');setFbRating(0);setSelWorkoutDay(null)
      loadFeedback(selMember.uid)
      showToast('✅ Feedback posted!')
    }catch(e){showToast('❌ Failed to post','error')}
  }

  // ════════════════════════════════════════════════════════
  //  CHANGE MEMBER LEVEL — Coach Level Control
  //  Updates users/{uid}.experience and stats/{uid}.experience,
  //  fires a notification to the member, and logs an audit trail
  //  to levelChanges/{id}.
  // ════════════════════════════════════════════════════════
  async function changeMemberLevel(member, newLevel){
    if (!member?.uid || !newLevel) return
    const oldLevel = member.experience || 'Beginner'
    if (oldLevel === newLevel) { showToast('Already at that level', 'error'); return }
    try {
      const me = auth.currentUser
      // 1. Update users doc
      await updateDoc(doc(db,'users',member.uid), { experience: newLevel })
      // 2. Update stats doc (used by leaderboard for division filtering)
      try {
        await setDoc(doc(db,'stats',member.uid), { experience: newLevel }, { merge: true })
      } catch(_) { /* stats may not exist yet — non-fatal */ }
      // 3. Notify the member directly
      await addDoc(collection(db,'notifications'), {
        title: `🎚 Level Updated: ${newLevel}`,
        message: `Coach ${coachProfile.name||'Rafael'} ${LEVELS.indexOf(newLevel) > LEVELS.indexOf(oldLevel) ? 'promoted' : 'moved'} you to ${newLevel}. Your training plan and leaderboard division have been updated.`,
        audience: 'member',
        targetUserId: member.uid,
        type: 'level_change',
        oldLevel,
        newLevel,
        from: coachProfile.name || 'Coach',
        createdAt: serverTimestamp(),
      })
      // 4. Audit log entry
      await addDoc(collection(db,'levelChanges'), {
        memberId: member.uid,
        memberName: member.name || 'Member',
        oldLevel,
        newLevel,
        changedBy: me?.uid || '',
        changedByName: coachProfile.name || 'Coach',
        changedByRole: 'coach',
        createdAt: serverTimestamp(),
      })
      // 5. Activity log (visible to coach/admin in their dashboard activity feed)
      const isPromote = LEVELS.indexOf(newLevel) > LEVELS.indexOf(oldLevel)
      logActivity({
        type: 'level_change',
        actorId: me?.uid || '',
        actorName: coachProfile.name || 'Coach',
        actorRole: 'coach',
        payload: { memberId: member.uid, memberName: member.name || 'Member', oldLevel, newLevel, isPromote },
      })
      // 6. Update local UI state immediately (don't wait for snapshot)
      setMembers(ms => ms.map(m => m.uid === member.uid ? { ...m, experience: newLevel } : m))
      if (selMember?.uid === member.uid) setSelMember(s => ({ ...s, experience: newLevel }))
      setLevelTarget(null)
      showToast(`${isPromote?'⬆️ Promoted':'⬇️ Moved'} to ${newLevel}!`)
    } catch(e) {
      console.error('Level change failed:', e)
      showToast('❌ ' + (e.message || 'Failed to change level'), 'error')
    }
  }

  async function createClass(){
    if(!newClass.name.trim()){showToast('❌ Enter a class name','error');return}
    if(!newClass.date){showToast('❌ Please select a date','error');return}
    try{
      const DAYS_FROM_DATE = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
      const dateObj = new Date(newClass.date + 'T00:00:00')
      const dayName = DAYS_FROM_DATE[dateObj.getDay()]
      const ref = await addDoc(collection(db,'classes'),{
        ...newClass,day:dayName,spots:parseInt(newClass.spots)||12,enrolled:0,
        coach:coachProfile.name||'Coach',createdAt:serverTimestamp(),
      })
      logActivity({
        type:'class_created',
        actorId: auth.currentUser?.uid || '',
        actorName: coachProfile.name || 'Coach',
        actorRole: 'coach',
        payload: { classId: ref.id, className: newClass.name.trim(), classDay: dayName, classDate: newClass.date, classTime: newClass.time, level: newClass.level },
      })
      setNewClass({name:'',date:new Date().toISOString().slice(0,10),time:'6:00 AM',spots:'12',level:'Beginner'})
      setShowNewClass(false);loadClasses();showToast('✅ Class created!')
    }catch(e){showToast('❌ Failed','error')}
  }

  async function deleteClassConfirmed(){
    if(!deleteClassId)return
    const cls = classes.find(c => c.id === deleteClassId)
    const idToDelete = deleteClassId

    // ════════════════════════════════════════════════════
    //  CLASS CASCADE — same pattern as admin's delete:
    //  Cancel all bookings + notify affected members BEFORE
    //  the class doc itself is deleted. Prevents orphan
    //  bookings showing on member schedules.
    // ════════════════════════════════════════════════════
    try {
      // Find all bookings for this class
      let bookingsToCancel = []
      try {
        const snap = await getDocs(query(collection(db, 'bookings'), where('classId', '==', idToDelete)))
        bookingsToCancel = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      } catch (e) {
        console.warn('Bookings query failed:', e.message)
      }

      // Notify each affected member + delete their booking
      for (const bk of bookingsToCancel) {
        try {
          if (bk.userId) {
            await addDoc(collection(db, 'notifications'), {
              type:         'class_cancelled',
              title:        '⚠ Class Cancelled',
              message:      `Your booking for "${cls?.name || 'a class'}" on ${cls?.date ? getClassDayLabel(cls) : (cls?.day || '')} at ${cls?.time || ''} has been cancelled by the coach. We apologize for any disruption to your schedule.`,
              audience:     'member',
              targetUserId: bk.userId,
              from:         coachProfile.name || 'Coach',
              fromUid:      auth.currentUser?.uid || '',
              createdAt:    serverTimestamp(),
            })
          }
          await deleteDoc(doc(db, 'bookings', bk.id))
        } catch (e) {
          console.warn(`Cascade failed for booking ${bk.id}:`, e.message)
        }
      }

      // Now delete the class itself
      await deleteDoc(doc(db,'classes',idToDelete))

      if (cls) {
        logActivity({
          type:'class_deleted',
          actorId: auth.currentUser?.uid || '',
          actorName: coachProfile.name || 'Coach',
          actorRole: 'coach',
          payload: { classId: cls.id, className: cls.name, classDay: cls.day, classTime: cls.time, bookingsCancelled: bookingsToCancel.length },
        })
      }

      setDeleteClassId(null)
      loadClasses()
      showToast(`🗑 Class deleted${bookingsToCancel.length ? ` · ${bookingsToCancel.length} member${bookingsToCancel.length===1?'':'s'} notified` : ''}`)
    } catch(e){
      console.error('Delete class failed:', e)
      showToast('❌ Delete failed','error')
    }
  }

  async function postNotification(){
    if(!notifForm.title.trim()||!notifForm.message.trim()){showToast('❌ Fill in title and message','error');return}
    try{
      const notifRef=doc(collection(db,'notifications'))
      await setDoc(notifRef,{
        id:notifRef.id,title:notifForm.title.trim(),message:notifForm.message.trim(),
        // Audience is locked to 'all' on the coach side — coaches cannot
        // announce to other coaches. Admin retains audience control.
        audience:'all',from:coachProfile.name||'Coach',
        fromUid:auth.currentUser?.uid||'',createdAt:serverTimestamp(),
      })
      setNotifForm({title:'',message:'',audience:'all'})
      setShowNotif(false)
      showToast('📢 Announcement sent to members!')
    }catch(e){showToast('❌ Permission denied — check Firestore rules','error')}
  }

  async function sendMessage(){
    if(!msgText.trim()||!msgTarget||sendingMsg)return
    setSendingMsg(true)
    const coachUid=auth.currentUser?.uid
    try{
      await addDoc(collection(db,'messages'),{
        participants:[coachUid,msgTarget.uid],
        from:coachUid,fromName:coachProfile.name||'Coach',
        to:msgTarget.uid,toName:msgTarget.name||'Member',
        text:msgText.trim(),createdAt:serverTimestamp(),
      })
      setMsgText('')
    }catch(e){showToast('❌ Failed to send. Check Firestore rules.','error')}
    setSendingMsg(false)
  }

  async function handleLogout(){await signOut(auth);localStorage.clear();navigate('/login')}

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return
    const ctx=canvas.getContext('2d');let animId,t=0
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight}
    resize();window.addEventListener('resize',resize)
    const draw=()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height);t+=0.004
      ctx.strokeStyle='rgba(66,165,245,0.015)';ctx.lineWidth=1
      const g=80
      for(let x=0;x<canvas.width+g;x+=g){const o=(t*12)%g;ctx.beginPath();ctx.moveTo(x-o,0);ctx.lineTo(x-o,canvas.height);ctx.stroke()}
      for(let y=0;y<canvas.height+g;y+=g){const o=(t*7)%g;ctx.beginPath();ctx.moveTo(0,y-o);ctx.lineTo(canvas.width,y-o);ctx.stroke()}
      animId=requestAnimationFrame(draw)
    }
    draw();return()=>{cancelAnimationFrame(animId);window.removeEventListener('resize',resize)}
  },[])

  const filteredMembers=members.filter(m=>m.name?.toLowerCase().includes(searchQ.toLowerCase()))
  const progressFiltered=[...members].filter(m=>{
    if(progLevel!=='All Levels'&&(m.experience||'Beginner')!==progLevel)return false
    if(progGoal!=='All Goals'&&m.goal!==progGoal)return false
    return true
  }).sort((a,b)=>(b.totalWorkouts||0)-(a.totalWorkouts||0))

  // Leaderboard scoring — exclude deactivated accounts (Issue 1 fix)
  const scored=[...members].filter(m=>m.status!=='inactive').map(m=>({...m,score:calcScore(m)})).sort((a,b)=>b.score-a.score).map((m,i)=>({...m,rank:i+1}))
  const maxScore=scored[0]?.score||1
  const lbFiltered=scored.filter(m=>{
    if(lbLevel!=='All Levels'&&(m.experience||'Beginner')!==lbLevel)return false
    if(lbGoal!=='All Goals'&&m.goal!==lbGoal)return false
    return true
  })

  const inp={background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,padding:'10px 14px',color:'#f0ece8',fontSize:13,fontFamily:'Montserrat,sans-serif',outline:'none',width:'100%',boxSizing:'border-box',transition:'border-color 0.2s'}
  const selStyle={...inp,cursor:'pointer',appearance:'none',WebkitAppearance:'none',backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%23555'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`,backgroundRepeat:'no-repeat',backgroundPosition:'right 12px center',paddingRight:32}

  const tabs=[{id:'members',label:'👥 Members'},{id:'inbox',label:'💬 Inbox'},{id:'classes',label:'📋 Classes'},{id:'progress',label:'📈 Progress'},{id:'leaderboard',label:'🏆 Leaderboard'},{id:'notifications',label:'📢 Announcements'}]

  return(
    <div style={{minHeight:'100vh',background:'#0c0a0a',fontFamily:'Montserrat,sans-serif',position:'relative'}}>
      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',zIndex:0,pointerEvents:'none'}}/>

      {toast.msg&&<div style={{position:'fixed',top:20,right:20,zIndex:3000,background:toast.type==='error'?'rgba(232,74,47,0.15)':'rgba(22,20,20,0.97)',border:`1px solid ${toast.type==='error'?'rgba(232,74,47,0.4)':'rgba(74,222,128,0.4)'}`,borderRadius:12,padding:'12px 20px',fontSize:13,fontWeight:700,color:toast.type==='error'?'#e84a2f':'#4ade80',backdropFilter:'blur(12px)'}}>{toast.msg}</div>}

      {logoutConfirm&&<ConfirmModal title="Log Out?" message="Sign out of Coach Portal?" onConfirm={handleLogout} onCancel={()=>setLogoutConfirm(false)} danger={false}/>}
      {/* ════════════════════════════════════════════════════ */}
      {/*  MARK CLASS AS DONE — Confirmation                    */}
      {/* ════════════════════════════════════════════════════ */}
      {endClassTarget && (
        <div onClick={()=>!endingClass && setEndClassTarget(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'2px solid rgba(34,197,94,0.4)',maxWidth:480,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.8),0 0 50px rgba(34,197,94,0.25)'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#22c55e,#16a34a)'}}/>
            <div style={{padding:'22px 26px',display:'flex',flexDirection:'column',gap:16,position:'relative'}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:48,height:48,borderRadius:12,background:'linear-gradient(135deg,#22c55e,#16a34a)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,boxShadow:'0 4px 14px rgba(34,197,94,0.5)'}}>🏁</div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#22c55e'}}>MARK CLASS AS DONE?</div>
                  <div style={{fontSize:10,color:'#888',letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:700,marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{endClassTarget.name} · {endClassTarget.day} · {endClassTarget.time}</div>
                </div>
              </div>
              <div style={{padding:'14px 16px',background:'rgba(34,197,94,0.06)',border:'1px solid rgba(34,197,94,0.2)',borderRadius:12,fontSize:12,color:'#bbb',lineHeight:1.65}}>
                <div style={{marginBottom:8}}>This will:</div>
                <div style={{display:'flex',flexDirection:'column',gap:5,fontSize:11,color:'#999'}}>
                  <div>✓ End the class — it disappears from the schedule</div>
                  <div>✓ Send a <strong style={{color:'#22c55e'}}>thank-you message</strong> to every booked member (from {endClassTarget.coach||'you'})</div>
                  <div>✓ Notify admin via Activity Feed</div>
                </div>
                <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid rgba(255,255,255,0.06)',fontSize:11,color:'#888'}}>
                  <strong style={{color:'#22c55e'}}>{(bookings.filter(b=>b.classId===endClassTarget.id)).length}</strong> participant{(bookings.filter(b=>b.classId===endClassTarget.id)).length===1?'':'s'} will be thanked
                </div>
              </div>
              <div style={{display:'flex',gap:10}}>
                <button onClick={()=>setEndClassTarget(null)} disabled={endingClass}
                  style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:endingClass?'not-allowed':'pointer',opacity:endingClass?0.5:1}}>
                  CANCEL
                </button>
                <button onClick={confirmEndClass} disabled={endingClass}
                  style={{flex:1.3,background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'#fff',border:'none',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:endingClass?'not-allowed':'pointer',boxShadow:'0 4px 14px rgba(34,197,94,0.4)',opacity:endingClass?0.7:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                  {endingClass ? (<>
                    <span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                    ENDING...
                  </>) : '🏁 END CLASS'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {deleteClassId&&<ConfirmModal title="Delete Class?" message="This will permanently remove the class." onConfirm={deleteClassConfirmed} onCancel={()=>setDeleteClassId(null)}/>}
      {confirm&&<ConfirmModal title={confirm.title} message={confirm.message} onConfirm={()=>{confirm.onConfirm();setConfirm(null)}} onCancel={()=>setConfirm(null)} danger={confirm.danger!==false}/>}

      {/* ════════════════════════════════════════════════════ */}
      {/*  LEVEL CONTROL MODAL — Coach unilaterally promotes /  */}
      {/*  demotes members. Member is notified on next visit.   */}
      {/* ════════════════════════════════════════════════════ */}
      {levelTarget && (() => {
        const currentLevel = levelTarget.experience || 'Beginner'
        const lc = LEVEL_COLOR[currentLevel] || '#f5c842'
        return (
          <div onClick={()=>setLevelTarget(null)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'1px solid rgba(192,132,252,0.3)',maxWidth:520,width:'100%',overflow:'hidden',boxShadow:'0 24px 60px rgba(0,0,0,0.7),0 0 40px rgba(192,132,252,0.15)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#c084fc,#42a5f5)'}}/>
              {/* Header */}
              <div style={{padding:'20px 26px',borderBottom:'1px solid rgba(192,132,252,0.15)',background:'linear-gradient(135deg,rgba(192,132,252,0.08) 0%,transparent 60%)',display:'flex',alignItems:'center',gap:14}}>
                <div style={{width:46,height:46,borderRadius:12,background:'linear-gradient(135deg,#c084fc,#7b1fa2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(192,132,252,0.4)'}}>🎚</div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:'0.06em',color:'#f0ece8'}}>LEVEL CONTROL</div>
                  <div style={{fontSize:9,color:'#9d8ec0',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>Promote or demote {levelTarget.name?.split(' ')[0] || 'member'}</div>
                </div>
                <button onClick={()=>setLevelTarget(null)}
                  style={{width:32,height:32,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:9,color:'#888',fontSize:16,cursor:'pointer'}}>✕</button>
              </div>
              {/* Body */}
              <div style={{padding:'24px 26px',display:'flex',flexDirection:'column',gap:18}}>
                {/* Current level card */}
                <div style={{padding:'14px 16px',background:`linear-gradient(135deg,${lc}10,rgba(20,15,14,0.6))`,border:`1px solid ${lc}30`,borderRadius:14,display:'flex',alignItems:'center',gap:14}}>
                  <div style={{position:'relative',flexShrink:0}}>
                    <div style={{width:48,height:48,borderRadius:'50%',background:`linear-gradient(135deg,${lc},${lc}aa)`,color:'#000',border:`2px solid ${lc}66`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:22,boxShadow:`0 4px 14px ${lc}40`}}>
                      {(levelTarget.name||'?')[0].toUpperCase()}
                    </div>
                    <div style={{position:'absolute',bottom:-2,right:-3,width:18,height:18,borderRadius:'50%',background:'#0e0a0a',border:`1.5px solid ${lc}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10}}>{LEVEL_ICON[currentLevel]||'🥊'}</div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:3}}>{levelTarget.name}</div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:9,color:'#666',letterSpacing:'0.1em',fontWeight:700,textTransform:'uppercase'}}>Currently:</span>
                      <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:`${lc}22`,color:lc,border:`1px solid ${lc}44`,letterSpacing:'0.08em',textTransform:'uppercase'}}>{LEVEL_ICON[currentLevel]||'🥊'} {currentLevel}</span>
                    </div>
                  </div>
                </div>

                {/* Stats helper */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  {[
                    {icon:'🥊',label:'Workouts',val:levelTarget.totalWorkouts||0,color:'#f5c842'},
                    {icon:'🔥',label:'Streak',val:(levelTarget.streak||0)+'d',color:'#e84a2f'},
                    {icon:'📅',label:'Weekly',val:(levelTarget.weeklyPct||0)+'%',color:'#22c55e'},
                  ].map((s,i)=>(
                    <div key={i} style={{padding:'10px 12px',background:`${s.color}08`,border:`1px solid ${s.color}25`,borderRadius:10,textAlign:'center'}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:s.color,lineHeight:1}}>{s.val}</div>
                      <div style={{fontSize:7,color:'#666',fontWeight:700,letterSpacing:'0.12em',marginTop:3}}>{s.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>

                {/* Level options */}
                <div>
                  <div style={{fontSize:9,fontWeight:800,color:'#9d8ec0',letterSpacing:'0.16em',textTransform:'uppercase',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                    <span style={{display:'inline-block',width:14,height:2,background:'#c084fc'}}/>
                    Move To Level
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {LEVELS.map(level=>{
                      const targetColor=LEVEL_COLOR[level]||'#f5c842'
                      const isCurrent=level===currentLevel
                      const isPromote=LEVELS.indexOf(level)>LEVELS.indexOf(currentLevel)
                      const isDemote=LEVELS.indexOf(level)<LEVELS.indexOf(currentLevel)
                      return(
                        <button key={level}
                          disabled={isCurrent}
                          onClick={()=>changeMemberLevel(levelTarget,level)}
                          style={{position:'relative',display:'flex',alignItems:'center',gap:14,padding:'14px 16px',background:isCurrent?'rgba(255,255,255,0.025)':`linear-gradient(135deg,${targetColor}12,${targetColor}06)`,border:`1.5px solid ${isCurrent?'rgba(255,255,255,0.06)':targetColor+'35'}`,borderRadius:12,cursor:isCurrent?'default':'pointer',opacity:isCurrent?0.5:1,transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',textAlign:'left'}}
                          onMouseEnter={e=>{if(!isCurrent){e.currentTarget.style.transform='translateX(4px)';e.currentTarget.style.borderColor=targetColor+'66';e.currentTarget.style.boxShadow=`0 6px 20px ${targetColor}25`}}}
                          onMouseLeave={e=>{if(!isCurrent){e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.borderColor=targetColor+'35';e.currentTarget.style.boxShadow='none'}}}>
                          <div style={{width:40,height:40,borderRadius:11,background:`linear-gradient(135deg,${targetColor},${targetColor}aa)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0,boxShadow:`0 4px 12px ${targetColor}40`}}>{LEVEL_ICON[level]||'🥊'}</div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13,fontWeight:800,color:isCurrent?'#666':targetColor,letterSpacing:'0.04em'}}>{level}</div>
                            <div style={{fontSize:10,color:'#666',marginTop:2}}>
                              {isCurrent?'Currently here':isPromote?'⬆ Promote — harder workouts unlocked':'⬇ Move down — lighter workouts'}
                            </div>
                          </div>
                          {!isCurrent && (
                            <div style={{fontSize:11,fontWeight:800,color:targetColor,padding:'6px 10px',borderRadius:50,background:`${targetColor}22`,border:`1px solid ${targetColor}44`,letterSpacing:'0.05em'}}>
                              {isPromote?'PROMOTE →':'MOVE →'}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>

                {/* Footer note */}
                <div style={{padding:'10px 14px',background:'rgba(192,132,252,0.06)',border:'1px solid rgba(192,132,252,0.2)',borderRadius:10,fontSize:10,color:'#9d8ec0',lineHeight:1.6}}>
                  <strong style={{color:'#c084fc'}}>What happens:</strong> Member's training plan regenerates for the new level. They move to the matching leaderboard division. They get a notification with you as the source. Action is logged in <code style={{background:'rgba(0,0,0,0.4)',padding:'1px 4px',borderRadius:4,fontFamily:'monospace'}}>levelChanges</code> for audit.
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      <div style={{position:'relative',zIndex:1,maxWidth:1400,margin:'0 auto',padding:'20px 32px 60px',display:'flex',flexDirection:'column',gap:16}}>

        {/* NAV */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',paddingBottom:4}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.06em',color:'#f0ece8'}}>HIT<span style={{color:'#e84a2f'}}>TRACK</span></div>
            <div style={{fontSize:10,fontWeight:700,color:'#42a5f5',background:'rgba(66,165,245,0.12)',border:'1px solid rgba(66,165,245,0.3)',borderRadius:50,padding:'4px 14px',letterSpacing:'0.1em'}}>COACH PORTAL</div>
          </div>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:12,color:'#555'}}>Welcome, <strong style={{color:'#f0ece8'}}>{coachProfile.name||'Coach'}</strong></span>
            <button onClick={()=>setShowNotif(true)} style={{background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.25)',borderRadius:50,padding:'7px 14px',fontSize:11,fontWeight:700,color:'#f5c842',cursor:'pointer'}}>📢 Announce</button>
            <button onClick={()=>setLogoutConfirm(true)} style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:50,padding:'7px 14px',fontSize:11,fontWeight:700,color:'#e84a2f',cursor:'pointer'}}>Logout →</button>
          </div>
        </div>

        {/* OVERVIEW — Session 3A cinematic stat cards */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16}}>
          <StatCard
            icon="👥" label="Total Members" value={members.length}
            color="gold"
            trend={members.length>0?`${members.length} active`:'No members'}
            subtext="In your gym"/>
          <StatCard
            icon="⚡" label="Active Today" value={members.filter(m=>(m.totalWorkouts||0)>0).length}
            color="success"
            trend={members.length>0?`${Math.round((members.filter(m=>(m.totalWorkouts||0)>0).length/members.length)*100)}% engagement`:'—'}
            subtext="Have logged a workout"/>
          <StatCard
            icon="📋" label="Classes" value={visibleClasses.length}
            color="info"
            trend={visibleClasses.length>0?`${visibleClasses.reduce((s,c)=>s+(parseInt(c.spots)||0)-(c.enrolled||0),0)} spots open`:'None scheduled'}/>
          <StatCard
            icon="⚠️" label="Need Attention" value={members.filter(m=>!(m.totalWorkouts||0)).length}
            color="danger"
            subtext="No workouts yet"/>
        </div>

        {/* TABS */}
        <div style={{display:'flex',gap:3,background:'rgba(255,255,255,0.03)',borderRadius:12,padding:4,border:'1px solid rgba(255,255,255,0.06)',flexWrap:'wrap'}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{background:tab===t.id?'rgba(66,165,245,0.18)':'transparent',color:tab===t.id?'#42a5f5':'#555',border:tab===t.id?'1px solid rgba(66,165,245,0.3)':'1px solid transparent',borderRadius:10,padding:'8px 16px',fontSize:11,fontWeight:700,cursor:'pointer',transition:'all 0.2s',whiteSpace:'nowrap'}}>
              {t.label}
            </button>
          ))}
        </div>

        {/* MEMBERS */}
        {tab==='members'&&(
          <div style={{display:'grid',gridTemplateColumns:selMember?'380px 1fr':'1fr',gap:16,alignItems:'start'}}>
            {/* Left — member list, sticky, cinematic restyle */}
            <div style={{position:'sticky',top:20,overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.12)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
              {/* Header */}
              <div style={{padding:'14px 16px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'linear-gradient(135deg,rgba(245,200,66,0.06) 0%,transparent 60%)',position:'relative'}}>
                <div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:'linear-gradient(180deg,#f5c842,#e84a2f)'}}/>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:10,paddingLeft:6}}>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8'}}>👥 ROSTER</span>
                  <span style={{fontSize:9,fontWeight:800,padding:'2px 8px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em'}}>{filteredMembers.length}</span>
                </div>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:11,top:'50%',transform:'translateY(-50%)',fontSize:12,color:'#666'}}>🔍</span>
                  <input placeholder="Search members…" value={searchQ} onChange={e=>setSearchQ(e.target.value)}
                    style={{width:'100%',background:'rgba(20,15,14,0.6)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:50,padding:'8px 14px 8px 32px',color:'#f0ece8',fontFamily:'Montserrat,sans-serif',fontSize:11,outline:'none',boxSizing:'border-box',transition:'all 0.25s ease'}}
                    onFocus={e=>{e.target.style.borderColor='rgba(245,200,66,0.4)';e.target.style.boxShadow='0 0 0 3px rgba(245,200,66,0.08)'}}
                    onBlur={e=>{e.target.style.borderColor='rgba(255,255,255,0.08)';e.target.style.boxShadow='none'}}/>
                </div>
              </div>
              {loading
                ?<div style={{padding:40,textAlign:'center',color:'#555'}}>Loading...</div>
                :filteredMembers.length===0
                  ?<div style={{padding:40,textAlign:'center',color:'#555',fontSize:13}}>No members found.</div>
                  :<div style={{display:'flex',flexDirection:'column',maxHeight:'70vh',overflowY:'auto'}}>
                    {filteredMembers.map(m=>{
                      const lc=LEVEL_COLOR[m.experience]||'#f5c842'
                      const lvIc=LEVEL_ICON[m.experience]||'🥊'
                      const isSelected=selMember?.uid===m.uid
                      return(
                        <div key={m.uid} onClick={()=>setSelMember(isSelected?null:m)}
                          style={{position:'relative',display:'flex',alignItems:'center',gap:12,padding:'13px 16px',cursor:'pointer',
                            background:isSelected?`linear-gradient(135deg,${lc}15,${lc}05)`:'transparent',
                            borderBottom:'1px solid rgba(255,255,255,0.04)',
                            transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',
                            transform:isSelected?'translateX(2px)':'translateX(0)'}}
                          onMouseEnter={e=>{if(!isSelected){e.currentTarget.style.background='rgba(255,255,255,0.025)';e.currentTarget.style.transform='translateX(2px)'}}}
                          onMouseLeave={e=>{if(!isSelected){e.currentTarget.style.background='transparent';e.currentTarget.style.transform='translateX(0)'}}}>
                          {/* Left accent stripe */}
                          <div style={{position:'absolute',left:0,top:0,bottom:0,width:isSelected?4:0,background:`linear-gradient(180deg,${lc},transparent)`,transition:'width 0.25s ease'}}/>
                          {/* Avatar with glow ring */}
                          <div style={{position:'relative',flexShrink:0}}>
                            <div style={{width:38,height:38,borderRadius:'50%',background:`linear-gradient(135deg,${lc},${lc}aa)`,color:'#000',border:`2px solid ${lc}66`,boxShadow:isSelected?`0 0 16px ${lc}55`:`0 2px 8px ${lc}30`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:16,transition:'all 0.3s ease'}}>
                              {(m.name||'?')[0].toUpperCase()}
                            </div>
                            {/* Level icon badge */}
                            <div style={{position:'absolute',bottom:-2,right:-4,width:16,height:16,borderRadius:'50%',background:'#0e0a0a',border:`1.5px solid ${lc}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:8}}>{lvIc}</div>
                          </div>
                          {/* Info */}
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:12,fontWeight:700,color:isSelected?lc:'#f0ece8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:3}}>{m.name||'Unknown'}</div>
                            <div style={{display:'flex',gap:5,alignItems:'center',flexWrap:'wrap'}}>
                              <span style={{fontSize:8,fontWeight:700,padding:'1px 6px',borderRadius:50,background:`${lc}15`,color:lc,letterSpacing:'0.06em',textTransform:'uppercase'}}>{m.experience||'Beginner'}</span>
                              <span style={{fontSize:9,color:'#666',display:'inline-flex',alignItems:'center',gap:2}}>🥊<strong style={{color:'#999'}}>{m.totalWorkouts||0}</strong></span>
                              <span style={{fontSize:9,color:'#666',display:'inline-flex',alignItems:'center',gap:2}}>🔥<strong style={{color:'#999'}}>{m.streak||0}d</strong></span>
                            </div>
                          </div>
                          {/* Quick message */}
                          <button onClick={e=>{e.stopPropagation();setMsgTarget(m);setMsgThread([])}}
                            title="Quick message"
                            style={{width:30,height:30,background:'rgba(66,165,245,0.1)',color:'#42a5f5',border:'1px solid rgba(66,165,245,0.25)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,cursor:'pointer',flexShrink:0,transition:'all 0.2s ease'}}
                            onMouseEnter={e=>{e.currentTarget.style.background='rgba(66,165,245,0.2)';e.currentTarget.style.transform='scale(1.08)'}}
                            onMouseLeave={e=>{e.currentTarget.style.background='rgba(66,165,245,0.1)';e.currentTarget.style.transform='scale(1)'}}>💬</button>
                        </div>
                      )
                    })}
                  </div>
              }
            </div>

            {/* Right — member detail panel, scrollable */}
            {selMember&&(
              <div style={{overflowY:'auto',maxHeight:'90vh',paddingRight:4}}>
                <MemberPanel
                  selMember={selMember}
                  setSelMember={setSelMember}
                  setMsgTarget={setMsgTarget}
                  setMsgThread={setMsgThread}
                  coachWorkoutRows={coachWorkoutRows}
                  selWorkoutDay={selWorkoutDay}
                  setSelWorkoutDay={setSelWorkoutDay}
                  fbText={fbText}
                  setFbText={setFbText}
                  fbRating={fbRating}
                  setFbRating={setFbRating}
                  postFeedback={postFeedback}
                  feedbackMap={feedbackMap}
                  editingFb={editingFb}
                  setEditingFb={setEditingFb}
                  saveEditFeedback={saveEditFeedback}
                  deleteFeedback={deleteFeedback}
                  setConfirm={setConfirm}
                  setLevelTarget={setLevelTarget}
                />
              </div>
            )}
          </div>
        )}

        {/* INBOX */}
        {tab==='inbox'&&(
          <InboxView
            currentUid={auth.currentUser?.uid}
            currentName={coachProfile.name||'Coach'}
            currentRole="coach"
            embedded={true}
          />
        )}

        {/* CLASSES */}
        {tab==='classes'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Header strip */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.06em',color:'#f0ece8'}}>📋 GYM SCHEDULE</div>
                <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em'}}>{visibleClasses.length} ACTIVE</span>
              </div>
              <button onClick={()=>setShowNewClass(v=>!v)}
                style={{background:showNewClass?'rgba(255,255,255,0.06)':'linear-gradient(135deg,#e84a2f,#c93820)',color:showNewClass?'#888':'#fff',border:showNewClass?'1px solid rgba(255,255,255,0.1)':'none',borderRadius:50,padding:'10px 22px',fontSize:12,fontWeight:800,letterSpacing:'0.05em',cursor:'pointer',boxShadow:showNewClass?'none':'0 6px 20px rgba(232,74,47,0.4)',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                onMouseEnter={e=>{if(!showNewClass){e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 10px 28px rgba(232,74,47,0.55)'}}}
                onMouseLeave={e=>{if(!showNewClass){e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 6px 20px rgba(232,74,47,0.4)'}}}>
                {showNewClass?'✕ CANCEL':'+ CREATE CLASS'}
              </button>
            </div>

            {/* New class form */}
            {showNewClass&&(
              <div style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:'1px solid rgba(232,74,47,0.3)',padding:'24px 26px',boxShadow:'0 12px 40px rgba(0,0,0,0.5),0 0 30px rgba(232,74,47,0.1)'}}>
                <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#f5c842)',borderRadius:'18px 0 0 18px'}}/>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8',marginBottom:4}}>🥊 CREATE NEW CLASS</div>
                <div style={{fontSize:10,color:'#777',letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600,marginBottom:18}}>Schedule a session for your members</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:16}}>
                  <div>
                    <label style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',display:'block',marginBottom:6}}>Class Name *</label>
                    <input placeholder="e.g. Heavy Bag Basics" value={newClass.name} onChange={e=>setNewClass(p=>({...p,name:e.target.value}))} style={{...inp,background:'rgba(20,15,14,0.8)'}}
                      onFocus={e=>{e.target.style.borderColor='#e84a2f';e.target.style.boxShadow='0 0 0 3px rgba(232,74,47,0.1)'}}
                      onBlur={e=>{e.target.style.borderColor='rgba(255,255,255,0.12)';e.target.style.boxShadow='none'}}/>
                  </div>
                  <div>
                    <label style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',display:'block',marginBottom:6}}>Date *</label>
                    <input type="date" value={newClass.date} onChange={e=>setNewClass(p=>({...p,date:e.target.value}))}
                      min={new Date().toISOString().slice(0,10)}
                      style={{...inp,background:'rgba(20,15,14,0.8)',colorScheme:'dark'}}
                      onFocus={e=>e.target.style.borderColor='#e84a2f'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.12)'}/>
                  </div>
                  {[{key:'time',label:'Time',opts:TIMES},{key:'level',label:'Level',opts:LEVELS},{key:'spots',label:'Max Spots',opts:['6','8','10','12','15','20','25','30']}].map(f=>(
                    <div key={f.key}>
                      <label style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',display:'block',marginBottom:6}}>{f.label}</label>
                      <select value={newClass[f.key]} onChange={e=>setNewClass(p=>({...p,[f.key]:e.target.value}))} style={{...selStyle,background:'rgba(20,15,14,0.8)'}}
                        onFocus={e=>e.target.style.borderColor='#e84a2f'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.12)'}>
                        {f.opts.map(o=><option key={o} value={o} style={{background:'#1a1818',color:'#f0ece8'}}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <button onClick={createClass}
                  style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'12px 28px',fontSize:12,fontWeight:800,letterSpacing:'0.06em',cursor:'pointer',boxShadow:'0 6px 20px rgba(232,74,47,0.4),inset 0 1px 0 rgba(255,255,255,0.15)',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 10px 28px rgba(232,74,47,0.55),inset 0 1px 0 rgba(255,255,255,0.2)'}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 6px 20px rgba(232,74,47,0.4),inset 0 1px 0 rgba(255,255,255,0.15)'}}>
                  ✓ CREATE CLASS
                </button>
              </div>
            )}

            {/* Class grid */}
            {visibleClasses.length===0?(
              <div style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:'1px dashed rgba(255,255,255,0.08)',padding:'60px 30px',textAlign:'center'}}>
                <div style={{fontSize:56,marginBottom:14,opacity:0.4}}>📋</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#f0ece8',letterSpacing:'0.06em',marginBottom:6}}>NO ACTIVE CLASSES</div>
                <div style={{fontSize:11,color:'#666',letterSpacing:'0.05em'}}>{classes.length>0?`${classes.length} class${classes.length===1?'':'es'} ended — schedule new ones 🥊`:'Schedule your first class to fill the gym 🥊'}</div>
              </div>
            ):(
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:14}}>
                {visibleClasses.map(cls=>{
                  // SELF-HEALING ENROLLMENT — count from bookings collection,
                  // not the cls.enrolled field (which can drift if writes fail).
                  const classBookings = bookings.filter(b=>b.classId===cls.id)
                  const enrolledCount = classBookings.length
                  const pct=cls.spots>0?Math.round((enrolledCount/cls.spots)*100):0
                  const fillColor=pct>=90?'#e84a2f':pct>=60?'#f5c842':'#22c55e'
                  const lc=LEVEL_COLOR[cls.level]||'#f5c842'
                  const lvIc=LEVEL_ICON[cls.level]||'🥊'
                  const dayLabel=getClassDayLabel(cls)
                  const dayShort=cls.date ? dayLabel : (cls.day||'').slice(0,3).toUpperCase()
                  const isTodayCls=isClassToday(cls)
                  return(
                    <div key={cls.id}
                      style={{position:'relative',overflow:'hidden',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:isTodayCls?'1px solid rgba(74,222,128,0.35)':`1px solid ${lc}25`,padding:'20px 22px',cursor:'default',transition:'all 0.4s cubic-bezier(0.34,1.56,0.64,1)',boxShadow:isTodayCls?'0 4px 16px rgba(74,222,128,0.12)':'0 4px 16px rgba(0,0,0,0.4)'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-4px)';e.currentTarget.style.borderColor=`${lc}55`;e.currentTarget.style.boxShadow=`0 16px 40px rgba(0,0,0,0.6),0 0 30px ${lc}22`}}
                      onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.borderColor=`${lc}25`;e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.4)'}}>
                      {/* Glow burst */}
                      <div style={{position:'absolute',right:-30,top:-30,width:160,height:160,borderRadius:'50%',background:`radial-gradient(circle,${lc}25,transparent 70%)`,pointerEvents:'none'}}/>
                      {/* Left accent stripe */}
                      <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:`linear-gradient(180deg,${lc},#e84a2f)`}}/>

                      {/* Action buttons (top right) */}
                      <div style={{position:'absolute',top:14,right:14,display:'flex',gap:6,zIndex:2}}>
                        <button onClick={()=>setEndClassTarget(cls)} title="Mark as Done — ends the class, thanks participants"
                          style={{height:30,padding:'0 11px',background:'rgba(34,197,94,0.1)',border:'1px solid rgba(34,197,94,0.3)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',gap:5,fontSize:10,fontWeight:800,letterSpacing:'0.08em',color:'#22c55e',cursor:'pointer',transition:'all 0.2s ease'}}
                          onMouseEnter={e=>{e.currentTarget.style.background='rgba(34,197,94,0.2)';e.currentTarget.style.transform='scale(1.04)';e.currentTarget.style.boxShadow='0 4px 12px rgba(34,197,94,0.3)'}}
                          onMouseLeave={e=>{e.currentTarget.style.background='rgba(34,197,94,0.1)';e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}>
                          🏁 DONE
                        </button>
                        <button onClick={()=>setDeleteClassId(cls.id)} title="Delete (no participant notifications)"
                          style={{width:30,height:30,background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,color:'#e84a2f',cursor:'pointer',transition:'all 0.2s ease'}}
                          onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.transform='scale(1.08)'}}
                          onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.1)';e.currentTarget.style.transform='scale(1)'}}>🗑</button>
                      </div>

                      {/* Top: day badge + name */}
                      <div style={{position:'relative',display:'flex',gap:14,alignItems:'flex-start',marginBottom:18,paddingRight:120}}>
                        {/* Day badge */}
                        <div style={{width:64,height:64,borderRadius:14,background:`linear-gradient(135deg,${lc},${lc}aa)`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#000',flexShrink:0,boxShadow:`0 6px 18px ${lc}50`,border:isTodayCls?'2px solid #4ade80':`2px solid ${lc}66`}}>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:cls.date?14:22,lineHeight:1,textAlign:'center',padding:'0 3px'}}>{dayShort}</div>
                          <div style={{fontSize:8,fontWeight:800,letterSpacing:'0.08em',marginTop:2,opacity:0.85}}>{cls.time}</div>
                        </div>
                        {/* Name + level */}
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:'0.04em',color:'#f0ece8',lineHeight:1.1}}>{cls.name}</div>
                            {isTodayCls && <span style={{fontSize:7,fontWeight:800,padding:'2px 7px',borderRadius:50,background:'rgba(74,222,128,0.15)',color:'#4ade80',border:'1px solid rgba(74,222,128,0.3)',letterSpacing:'0.1em'}}>TODAY</span>}
                          </div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:`${lc}22`,color:lc,border:`1px solid ${lc}44`,letterSpacing:'0.08em',textTransform:'uppercase'}}>{lvIc} {cls.level}</span>
                            {cls.coach && <span style={{fontSize:9,fontWeight:700,padding:'3px 9px',borderRadius:50,background:'rgba(255,255,255,0.05)',color:'#888',letterSpacing:'0.05em'}}>👨‍🏫 {cls.coach}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Enrollment progress */}
                      <div style={{position:'relative'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
                          <span style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase'}}>Enrollment</span>
                          <span style={{display:'flex',alignItems:'baseline',gap:4}}>
                            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:fillColor,lineHeight:1}}>{enrolledCount}</span>
                            <span style={{fontSize:11,color:'#555',fontWeight:700}}>/ {cls.spots}</span>
                            <span style={{fontSize:9,color:fillColor,fontWeight:700,marginLeft:4,padding:'2px 7px',borderRadius:50,background:`${fillColor}18`}}>{pct}%</span>
                          </span>
                        </div>
                        <div style={{height:8,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden',border:'1px solid rgba(255,255,255,0.04)'}}>
                          <div style={{height:'100%',borderRadius:50,background:`linear-gradient(90deg,${fillColor},${fillColor}dd)`,width:`${pct}%`,boxShadow:`0 0 12px ${fillColor}88`,transition:'width 0.6s ease'}}/>
                        </div>
                        {pct>=90 && <div style={{marginTop:6,fontSize:9,color:'#e84a2f',fontWeight:700,letterSpacing:'0.05em'}}>🔥 ALMOST FULL</div>}
                        {/* Booked members preview */}
                        {classBookings.length>0 && (
                          <div style={{marginTop:12,paddingTop:12,borderTop:'1px solid rgba(255,255,255,0.05)'}}>
                            <div style={{fontSize:8,fontWeight:800,color:'#666',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>
                              👥 Booked ({classBookings.length})
                            </div>
                            <div style={{display:'flex',flexWrap:'wrap',gap:5}}>
                              {classBookings.slice(0,8).map(b=>(
                                <span key={b.id} style={{fontSize:9,padding:'3px 8px',borderRadius:50,background:'rgba(66,165,245,0.1)',color:'#42a5f5',border:'1px solid rgba(66,165,245,0.2)',fontWeight:600}}>
                                  {b.userName||'Member'}
                                </span>
                              ))}
                              {classBookings.length>8 && (
                                <span style={{fontSize:9,padding:'3px 8px',borderRadius:50,background:'rgba(255,255,255,0.04)',color:'#666',fontWeight:600}}>
                                  +{classBookings.length-8} more
                                </span>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* PROGRESS */}
        {tab==='progress'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Filter pills */}
            <div style={{display:'flex',flexDirection:'column',gap:10,padding:'14px 16px',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:14,border:'1px solid rgba(255,255,255,0.06)'}}>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{fontSize:9,fontWeight:800,color:'#666',letterSpacing:'0.18em',textTransform:'uppercase',minWidth:50,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'inline-block',width:14,height:2,background:'#f5c842'}}/>Level
                </span>
                {LEVEL_DIVS.map(d=>{const lc=LEVEL_COLOR[d]||'#42a5f5';const active=progLevel===d;return<button key={d} onClick={()=>setProgLevel(d)} style={{background:active?`${lc}22`:'rgba(255,255,255,0.03)',color:active?lc:'#666',border:active?`1px solid ${lc}66`:'1px solid rgba(255,255,255,0.06)',borderRadius:50,padding:'6px 14px',fontSize:10,fontWeight:700,cursor:'pointer',transition:'all 0.2s',display:'flex',alignItems:'center',gap:5,boxShadow:active?`0 4px 12px ${lc}33`:'none'}}
                  onMouseEnter={e=>{if(!active){e.currentTarget.style.borderColor=`${lc}33`;e.currentTarget.style.color=lc}}}
                  onMouseLeave={e=>{if(!active){e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';e.currentTarget.style.color='#666'}}}>{d!=='All Levels'&&LEVEL_ICON[d]+' '}{d}</button>})}
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{fontSize:9,fontWeight:800,color:'#666',letterSpacing:'0.18em',textTransform:'uppercase',minWidth:50,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'inline-block',width:14,height:2,background:'#f5c842'}}/>Goal
                </span>
                {GOAL_DIVS.map((d,i)=>{const colors=['#f5c842','#42a5f5','#e84a2f','#22c55e','#c084fc'];const active=progGoal===d;const color=colors[i]||'#f5c842';return<button key={d} onClick={()=>setProgGoal(d)} style={{background:active?`${color}22`:'rgba(255,255,255,0.03)',color:active?color:'#666',border:active?`1px solid ${color}66`:'1px solid rgba(255,255,255,0.06)',borderRadius:50,padding:'6px 14px',fontSize:10,fontWeight:700,cursor:'pointer',transition:'all 0.2s',boxShadow:active?`0 4px 12px ${color}33`:'none'}}
                  onMouseEnter={e=>{if(!active){e.currentTarget.style.borderColor=`${color}33`;e.currentTarget.style.color=color}}}
                  onMouseLeave={e=>{if(!active){e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';e.currentTarget.style.color='#666'}}}>{d}</button>})}
              </div>
            </div>

            {/* Progress list */}
            <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.12)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#f5c842,#e84a2f)'}}/>
              <div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',justifyContent:'space-between',alignItems:'center',background:'linear-gradient(135deg,rgba(245,200,66,0.05) 0%,transparent 60%)'}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8'}}>📈 MEMBER PROGRESS</span>
                  <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em'}}>{progressFiltered.length}/{members.length}</span>
                </div>
              </div>
              {members.length===0?<div style={{padding:50,textAlign:'center',color:'#555',fontSize:12}}>No members yet.</div>:(
                <div style={{padding:'14px',display:'flex',flexDirection:'column',gap:8}}>
                  {progressFiltered.map((m,i)=>{
                    const lc=LEVEL_COLOR[m.experience]||'#f5c842'
                    const lvIc=LEVEL_ICON[m.experience]||'🥊'
                    const max=Math.max(...members.map(mm=>mm.totalWorkouts||0),1)
                    const pct=((m.totalWorkouts||0)/max)*100
                    const wkColor=(m.weeklyPct||0)>=70?'#22c55e':(m.weeklyPct||0)>=40?'#f5c842':'#666'
                    return(
                      <div key={m.uid}
                        style={{position:'relative',display:'flex',alignItems:'center',gap:12,padding:'12px 14px',borderRadius:12,background:'linear-gradient(135deg,rgba(40,30,28,0.5),rgba(20,15,14,0.7))',border:'1px solid rgba(255,255,255,0.05)',cursor:'default',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                        onMouseEnter={e=>{e.currentTarget.style.transform='translateX(4px)';e.currentTarget.style.borderColor=`${lc}33`;e.currentTarget.style.boxShadow=`0 8px 20px ${lc}15`}}
                        onMouseLeave={e=>{e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.borderColor='rgba(255,255,255,0.05)';e.currentTarget.style.boxShadow='none'}}>
                        {/* Rank */}
                        <div style={{width:30,fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:i<3?'#f5c842':'#555',textAlign:'center',flexShrink:0,letterSpacing:'0.05em'}}>#{i+1}</div>
                        {/* Avatar */}
                        <div style={{position:'relative',flexShrink:0}}>
                          <div style={{width:38,height:38,borderRadius:'50%',background:`linear-gradient(135deg,${lc},${lc}aa)`,color:'#000',border:`2px solid ${lc}66`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:16,boxShadow:`0 2px 8px ${lc}30`}}>
                            {(m.name||'?')[0].toUpperCase()}
                          </div>
                          <div style={{position:'absolute',bottom:-2,right:-4,width:16,height:16,borderRadius:'50%',background:'#0e0a0a',border:`1.5px solid ${lc}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:8}}>{lvIc}</div>
                        </div>
                        {/* Name + level */}
                        <div style={{width:160,flexShrink:0,minWidth:0}}>
                          <div style={{fontSize:12,fontWeight:700,color:'#f0ece8',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:3}}>{m.name||'Member'}</div>
                          <span style={{fontSize:8,fontWeight:700,padding:'2px 7px',borderRadius:50,background:`${lc}15`,color:lc,letterSpacing:'0.06em',textTransform:'uppercase'}}>{m.experience||'Beginner'}</span>
                        </div>
                        {/* Progress bar */}
                        <div style={{flex:1,display:'flex',flexDirection:'column',gap:4,minWidth:0}}>
                          <div style={{display:'flex',justifyContent:'space-between',fontSize:9,fontWeight:700}}>
                            <span style={{color:'#666',letterSpacing:'0.08em',textTransform:'uppercase'}}>Workouts</span>
                            <span style={{color:'#f5c842'}}>{m.totalWorkouts||0}</span>
                          </div>
                          <div style={{height:6,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden',border:'1px solid rgba(255,255,255,0.04)'}}>
                            <div style={{height:'100%',borderRadius:50,background:`linear-gradient(90deg,${lc},${lc}dd)`,width:`${pct}%`,boxShadow:`0 0 8px ${lc}88`,transition:'width 0.6s ease'}}/>
                          </div>
                        </div>
                        {/* Streak */}
                        <div style={{width:54,textAlign:'center',flexShrink:0}}>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:(m.streak||0)>0?'#e84a2f':'#444',lineHeight:1}}>🔥{m.streak||0}d</div>
                          <div style={{fontSize:7,color:'#555',fontWeight:700,letterSpacing:'0.1em',marginTop:2}}>STREAK</div>
                        </div>
                        {/* Weekly */}
                        <div style={{width:60,textAlign:'right',flexShrink:0}}>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:wkColor,lineHeight:1}}>{m.weeklyPct||0}%</div>
                          <div style={{fontSize:7,color:'#555',fontWeight:700,letterSpacing:'0.1em',marginTop:2}}>WEEKLY</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* LEADERBOARD */}
        {tab==='leaderboard'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Filters */}
            <div style={{display:'flex',flexDirection:'column',gap:10,padding:'14px 16px',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:14,border:'1px solid rgba(255,255,255,0.06)'}}>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{fontSize:9,fontWeight:800,color:'#666',letterSpacing:'0.18em',textTransform:'uppercase',minWidth:50,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'inline-block',width:14,height:2,background:'#f5c842'}}/>Level
                </span>
                {LEVEL_DIVS.map(d=>{const lc=LEVEL_COLOR[d]||'#42a5f5';const active=lbLevel===d;return<button key={d} onClick={()=>setLbLevel(d)} style={{background:active?`${lc}22`:'rgba(255,255,255,0.03)',color:active?lc:'#666',border:active?`1px solid ${lc}66`:'1px solid rgba(255,255,255,0.06)',borderRadius:50,padding:'6px 14px',fontSize:10,fontWeight:700,cursor:'pointer',transition:'all 0.2s',boxShadow:active?`0 4px 12px ${lc}33`:'none'}}
                  onMouseEnter={e=>{if(!active){e.currentTarget.style.borderColor=`${lc}33`;e.currentTarget.style.color=lc}}}
                  onMouseLeave={e=>{if(!active){e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';e.currentTarget.style.color='#666'}}}>{d!=='All Levels'&&LEVEL_ICON[d]+' '}{d}</button>})}
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{fontSize:9,fontWeight:800,color:'#666',letterSpacing:'0.18em',textTransform:'uppercase',minWidth:50,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'inline-block',width:14,height:2,background:'#f5c842'}}/>Goal
                </span>
                {GOAL_DIVS.map((d,i)=>{const colors=['#f5c842','#42a5f5','#e84a2f','#22c55e','#c084fc'];const active=lbGoal===d;const color=colors[i]||'#f5c842';return<button key={d} onClick={()=>setLbGoal(d)} style={{background:active?`${color}22`:'rgba(255,255,255,0.03)',color:active?color:'#666',border:active?`1px solid ${color}66`:'1px solid rgba(255,255,255,0.06)',borderRadius:50,padding:'6px 14px',fontSize:10,fontWeight:700,cursor:'pointer',transition:'all 0.2s',boxShadow:active?`0 4px 12px ${color}33`:'none'}}
                  onMouseEnter={e=>{if(!active){e.currentTarget.style.borderColor=`${color}33`;e.currentTarget.style.color=color}}}
                  onMouseLeave={e=>{if(!active){e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';e.currentTarget.style.color='#666'}}}>{d}</button>})}
              </div>
            </div>

            {/* PODIUM — top 3 if we have them */}
            {lbFiltered.length>=3 && (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1.15fr 1fr',gap:14,alignItems:'end'}}>
                {[lbFiltered[1],lbFiltered[0],lbFiltered[2]].map((u,podiumIdx)=>{
                  const realRank=podiumIdx===1?1:podiumIdx===0?2:3
                  const lc=LEVEL_COLOR[u.experience]||'#f5c842'
                  const podiumColors=['#c0c0c0','#f5c842','#cd7f32']
                  const podiumColor=podiumColors[realRank-1]
                  const medals=['🥈','🥇','🥉']
                  const heights=[170,200,160]
                  return(
                    <div key={u.uid} style={{position:'relative',overflow:'hidden',background:`linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)`,borderRadius:18,border:`2px solid ${podiumColor}55`,padding:'18px 16px',textAlign:'center',minHeight:heights[podiumIdx],display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',boxShadow:`0 12px 30px rgba(0,0,0,0.5),0 0 30px ${podiumColor}22`,transform:realRank===1?'translateY(-10px)':'translateY(0)',transition:'all 0.4s cubic-bezier(0.34,1.56,0.64,1)'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform=realRank===1?'translateY(-14px) scale(1.02)':'translateY(-4px) scale(1.02)';e.currentTarget.style.boxShadow=`0 16px 40px rgba(0,0,0,0.6),0 0 40px ${podiumColor}44`}}
                      onMouseLeave={e=>{e.currentTarget.style.transform=realRank===1?'translateY(-10px) scale(1)':'translateY(0) scale(1)';e.currentTarget.style.boxShadow=`0 12px 30px rgba(0,0,0,0.5),0 0 30px ${podiumColor}22`}}>
                      <div style={{position:'absolute',top:-30,left:'50%',transform:'translateX(-50%)',width:120,height:120,borderRadius:'50%',background:`radial-gradient(circle,${podiumColor}30,transparent 70%)`,pointerEvents:'none'}}/>
                      <div style={{position:'relative',fontSize:30,marginBottom:6}}>{medals[realRank-1]}</div>
                      <div style={{position:'relative',fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:podiumColor,letterSpacing:'0.1em',marginBottom:10}}>#{realRank}</div>
                      <div style={{position:'relative',width:realRank===1?70:58,height:realRank===1?70:58,borderRadius:'50%',background:`linear-gradient(135deg,${lc},${lc}aa)`,color:'#000',border:`3px solid ${podiumColor}`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:realRank===1?28:22,marginBottom:10,boxShadow:`0 6px 18px ${podiumColor}55`}}>
                        {(u.name||'?')[0].toUpperCase()}
                      </div>
                      <div style={{position:'relative',fontSize:realRank===1?13:12,fontWeight:700,color:'#f0ece8',marginBottom:3,maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',padding:'0 4px'}}>{u.name||'Member'}</div>
                      <div style={{position:'relative',fontSize:9,color:'#666',marginBottom:10}}>{u.goal||'Compete'}</div>
                      <div style={{position:'relative',fontFamily:"'Bebas Neue',sans-serif",fontSize:realRank===1?32:26,color:podiumColor,lineHeight:1,textShadow:`0 0 12px ${podiumColor}88`}}>{u.score||0}</div>
                      <div style={{position:'relative',fontSize:8,color:'#666',fontWeight:700,letterSpacing:'0.15em',marginTop:3}}>POINTS</div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Full list */}
            <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.12)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#f5c842,#e84a2f)'}}/>
              <div style={{padding:'16px 20px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',gap:10,background:'linear-gradient(135deg,rgba(245,200,66,0.05) 0%,transparent 60%)'}}>
                <span style={{fontSize:22}}>🏆</span>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:'#f0ece8',letterSpacing:'0.06em'}}>GYM LEADERBOARD</div>
                <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em'}}>{lbFiltered.length}/{scored.length}</span>
              </div>
              <div style={{display:'flex',padding:'10px 20px',borderBottom:'1px solid rgba(255,255,255,0.04)',background:'rgba(0,0,0,0.2)'}}>
                {[{label:'RANK',w:46},{label:'MEMBER',flex:1},{label:'WKT',w:50},{label:'STREAK',w:60},{label:'SCORE',w:140}].map((h,i)=>(
                  <div key={i} style={{width:h.w,flex:h.flex,fontSize:8,fontWeight:800,color:'#666',letterSpacing:'0.15em'}}>{h.label}</div>
                ))}
              </div>
              {lbFiltered.length===0?<div style={{padding:40,textAlign:'center',color:'#555',fontSize:12}}>No members match filter</div>:lbFiltered.map((m,i)=><LBRow key={m.uid} user={m} maxScore={maxScore} idx={i}/>)}
            </div>
          </div>
        )}

        {/* ANNOUNCEMENTS */}
        {tab==='notifications'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Tab switcher */}
            <div style={{display:'flex',gap:6,padding:6,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:14,border:'1px solid rgba(255,255,255,0.06)'}}>
              {[
                {id:'announcements', icon:'📢', label:'ANNOUNCEMENTS', count:visibleAnnouncements.length, color:'#f5c842', sub:'Manual gym news'},
                {id:'activity',      icon:'⚡', label:'ACTIVITY FEED', count:activity.length, color:'#42a5f5', sub:'System events'},
              ].map(t => {
                const active = notifSubTab === t.id
                return (
                  <button key={t.id} onClick={()=>setNotifSubTab(t.id)}
                    style={{flex:1,position:'relative',display:'flex',alignItems:'center',justifyContent:'center',gap:10,background:active?`linear-gradient(135deg,${t.color}20,${t.color}08)`:'transparent',color:active?t.color:'#777',border:active?`1px solid ${t.color}40`:'1px solid transparent',borderRadius:10,padding:'12px 18px',fontSize:13,fontWeight:800,letterSpacing:'0.06em',cursor:'pointer',transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',boxShadow:active?`0 4px 14px ${t.color}25`:'none'}}
                    onMouseEnter={e=>{if(!active){e.currentTarget.style.background='rgba(255,255,255,0.03)';e.currentTarget.style.color='#aaa'}}}
                    onMouseLeave={e=>{if(!active){e.currentTarget.style.background='transparent';e.currentTarget.style.color='#777'}}}>
                    <span style={{fontSize:18}}>{t.icon}</span>
                    <div style={{textAlign:'left'}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:'0.06em',lineHeight:1}}>{t.label}</div>
                      <div style={{fontSize:8,color:active?t.color:'#555',marginTop:3,letterSpacing:'0.1em',opacity:0.7}}>{t.sub}</div>
                    </div>
                    <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:active?`${t.color}30`:'rgba(255,255,255,0.04)',color:active?t.color:'#666',letterSpacing:'0.05em'}}>{t.count}</span>
                  </button>
                )
              })}
            </div>

            {/* ANNOUNCEMENTS TAB */}
            {notifSubTab==='announcements' && (<>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.06em',color:'#f0ece8'}}>📢 ANNOUNCEMENTS</div>
                <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em'}}>{visibleAnnouncements.length} SHOWING</span>
                {dismissedNotifs.length > 0 && (
                  <span title="Announcements you've hidden from your view (still visible to other coaches)" style={{fontSize:9,fontWeight:700,padding:'3px 9px',borderRadius:50,background:'rgba(120,113,108,0.15)',color:'#888',letterSpacing:'0.08em'}}>👁‍🗨 {dismissedNotifs.length} HIDDEN</span>
                )}
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                {visibleAnnouncements.length > 0 && (
                  <button onClick={()=>setClearMyPostsConfirm(true)}
                    title="Hide all announcements from your view (does not affect other coaches)"
                    style={{background:'rgba(232,74,47,0.1)',color:'#e84a2f',border:'1px solid rgba(232,74,47,0.3)',borderRadius:50,padding:'9px 14px',fontSize:10,fontWeight:800,letterSpacing:'0.08em',cursor:'pointer',display:'flex',alignItems:'center',gap:6,transition:'all 0.25s'}}
                    onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 4px 12px rgba(232,74,47,0.25)'}}
                    onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.1)';e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='none'}}>
                    🧹 CLEAR ALL
                  </button>
                )}
                <button onClick={()=>setShowNotif(true)}
                  style={{background:'linear-gradient(135deg,#f5c842,#e08820)',color:'#000',border:'none',borderRadius:50,padding:'10px 22px',fontSize:12,fontWeight:800,letterSpacing:'0.05em',cursor:'pointer',boxShadow:'0 6px 20px rgba(245,200,66,0.4)',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 10px 28px rgba(245,200,66,0.55)'}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 6px 20px rgba(245,200,66,0.4)'}}>
                  📢 POST ANNOUNCEMENT
                </button>
              </div>
            </div>

            {visibleAnnouncements.length===0?(
              <div style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:'1px dashed rgba(255,255,255,0.08)',padding:'60px 30px',textAlign:'center'}}>
                <div style={{fontSize:56,marginBottom:14,opacity:0.4}}>{realAnnouncements.length > 0 ? '👁‍🗨' : '📭'}</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#f0ece8',letterSpacing:'0.06em',marginBottom:6}}>{realAnnouncements.length > 0 ? 'ALL HIDDEN FROM YOUR VIEW' : 'NO ANNOUNCEMENTS YET'}</div>
                <div style={{fontSize:11,color:'#666',letterSpacing:'0.05em'}}>{realAnnouncements.length > 0 ? `${realAnnouncements.length} announcement${realAnnouncements.length===1?'':'s'} still exist for other coaches` : 'Rally your gym 🥊 — post your first announcement'}</div>
              </div>
            ):(
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {visibleAnnouncements.map(n=>{
                  const isAll=n.audience==='all'
                  const ac=isAll?'#f5c842':'#42a5f5'
                  const isMine=isOwnAnnouncement(n)
                  return(
                    <div key={n.id}
                      style={{position:'relative',overflow:'hidden',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:14,border:`1px solid ${ac}25`,padding:'16px 20px',display:'flex',gap:14,alignItems:'flex-start',cursor:'default',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform='translateX(4px)';e.currentTarget.style.borderColor=`${ac}55`;e.currentTarget.style.boxShadow=`0 8px 24px ${ac}15`;const btn=e.currentTarget.querySelector('.ann-del');if(btn)btn.style.opacity='1'}}
                      onMouseLeave={e=>{e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.borderColor=`${ac}25`;e.currentTarget.style.boxShadow='none';const btn=e.currentTarget.querySelector('.ann-del');if(btn)btn.style.opacity='0'}}>
                      <div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:`linear-gradient(180deg,${ac},transparent)`}}/>
                      <div style={{width:44,height:44,borderRadius:12,background:`linear-gradient(135deg,${ac},${ac}aa)`,color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0,boxShadow:`0 4px 14px ${ac}50`,border:`1px solid ${ac}66`}}>
                        {isAll?'📢':'🥊'}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:'0.04em',color:'#f0ece8'}}>{n.title}</span>
                          <span style={{fontSize:8,fontWeight:800,padding:'3px 9px',borderRadius:50,background:`${ac}22`,color:ac,border:`1px solid ${ac}44`,letterSpacing:'0.08em',textTransform:'uppercase'}}>{isAll?'All Members':'Coaches Only'}</span>
                          {isMine && <span style={{fontSize:8,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(34,197,94,0.15)',color:'#22c55e',border:'1px solid rgba(34,197,94,0.3)',letterSpacing:'0.08em',textTransform:'uppercase'}}>YOURS</span>}
                        </div>
                        <div style={{fontSize:12,color:'#aaa',lineHeight:1.65,marginBottom:8}}>{n.message}</div>
                        <div style={{fontSize:9,color:'#555',fontWeight:600,letterSpacing:'0.05em'}}>By <strong style={{color:'#777'}}>{n.from}</strong></div>
                      </div>
                      <button className="ann-del" onClick={()=>dismissAnnouncement(n.id)} title="Hide from your view (other coaches still see it)"
                        style={{opacity:0,width:32,height:32,background:'rgba(120,113,108,0.12)',color:'#a8a29e',border:'1px solid rgba(120,113,108,0.3)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,cursor:'pointer',flexShrink:0,transition:'all 0.25s',padding:0,alignSelf:'flex-start'}}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.color='#e84a2f';e.currentTarget.style.borderColor='rgba(232,74,47,0.4)';e.currentTarget.style.transform='scale(1.1)';e.currentTarget.style.boxShadow='0 4px 12px rgba(232,74,47,0.25)'}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(120,113,108,0.12)';e.currentTarget.style.color='#a8a29e';e.currentTarget.style.borderColor='rgba(120,113,108,0.3)';e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}>👁‍🗨</button>
                    </div>
                  )
                })}
              </div>
            )}
            </>)}

            {/* ACTIVITY TAB */}
            {notifSubTab==='activity' && (<>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.06em',color:'#f0ece8'}}>⚡ LIVE ACTIVITY</div>
                <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(66,165,245,0.15)',color:'#42a5f5',letterSpacing:'0.08em'}}>{activity.length} EVENTS</span>
              </div>
              <div style={{display:'flex',alignItems:'center',gap:8}}>
                <span style={{display:'flex',alignItems:'center',gap:7,fontSize:10,fontWeight:700,color:'#22c55e',padding:'6px 14px',background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.25)',borderRadius:50,letterSpacing:'0.06em'}}>
                  <span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:'#22c55e',animation:'pulseDot 1.6s ease-in-out infinite'}}/>
                  LIVE
                </span>
                {activity.length > 0 && (
                  <button onClick={()=>setClearActivityConfirm(true)}
                    style={{background:'rgba(232,74,47,0.1)',color:'#e84a2f',border:'1px solid rgba(232,74,47,0.3)',borderRadius:50,padding:'6px 14px',fontSize:10,fontWeight:800,letterSpacing:'0.08em',cursor:'pointer',display:'flex',alignItems:'center',gap:6,transition:'all 0.25s'}}
                    onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 4px 12px rgba(232,74,47,0.25)'}}
                    onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.1)';e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='none'}}>
                    🧹 CLEAR ALL
                  </button>
                )}
              </div>
            </div>
            {activity.length===0 ? (
              <div style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:'1px dashed rgba(255,255,255,0.08)',padding:'60px 30px',textAlign:'center'}}>
                <div style={{fontSize:56,marginBottom:14,opacity:0.4}}>⚡</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#f0ece8',letterSpacing:'0.06em',marginBottom:6}}>NO ACTIVITY YET</div>
                <div style={{fontSize:11,color:'#666',letterSpacing:'0.05em'}}>System events will appear here as members book classes, levels change, etc.</div>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {activity.map(ev => {
                  const t = ACTIVITY_TYPES[ev.type] || { icon:'⚡', color:'#888', label:'Event' }
                  const ts = ev.createdAt?.seconds ? new Date(ev.createdAt.seconds*1000) : null
                  return (
                    <div key={ev.id}
                      style={{position:'relative',overflow:'hidden',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:12,border:`1px solid ${t.color}22`,padding:'12px 16px',display:'flex',gap:12,alignItems:'center',cursor:'default',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform='translateX(3px)';e.currentTarget.style.borderColor=`${t.color}55`;e.currentTarget.style.boxShadow=`0 6px 18px ${t.color}15`;const btn=e.currentTarget.querySelector('.act-del');if(btn)btn.style.opacity='1'}}
                      onMouseLeave={e=>{e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.borderColor=`${t.color}22`;e.currentTarget.style.boxShadow='none';const btn=e.currentTarget.querySelector('.act-del');if(btn)btn.style.opacity='0'}}>
                      <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:`linear-gradient(180deg,${t.color},transparent)`}}/>
                      <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${t.color}30,${t.color}10)`,color:t.color,border:`1px solid ${t.color}40`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0,boxShadow:`0 4px 10px ${t.color}20`}}>{t.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:3,flexWrap:'wrap'}}>
                          <span style={{fontSize:9,fontWeight:800,color:t.color,letterSpacing:'0.12em',textTransform:'uppercase'}}>{t.label}</span>
                          {ev.actorRole && <span style={{fontSize:8,fontWeight:700,padding:'1px 7px',borderRadius:50,background:'rgba(255,255,255,0.04)',color:'#777',letterSpacing:'0.08em',textTransform:'uppercase',border:'1px solid rgba(255,255,255,0.06)'}}>{ev.actorRole}</span>}
                        </div>
                        <div style={{fontSize:12,color:'#cdc8c2',lineHeight:1.55}}>{ev.description}</div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,flexShrink:0}}>
                        <span style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.04em',whiteSpace:'nowrap'}}>
                          {ts ? formatRelativeTime(ts) : '—'}
                        </span>
                        {ev.actorName && <span style={{fontSize:8,color:'#555',fontStyle:'italic',letterSpacing:'0.04em',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>by {ev.actorName}</span>}
                      </div>
                      <button className="act-del" onClick={()=>deleteActivityEvent(ev.id)} title="Delete this event"
                        style={{opacity:0,width:30,height:30,background:'rgba(232,74,47,0.12)',color:'#e84a2f',border:'1px solid rgba(232,74,47,0.3)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,cursor:'pointer',flexShrink:0,transition:'all 0.25s',padding:0}}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.25)';e.currentTarget.style.transform='scale(1.1)';e.currentTarget.style.boxShadow='0 4px 12px rgba(232,74,47,0.35)'}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.12)';e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}>🗑</button>
                    </div>
                  )
                })}
              </div>
            )}
            </>)}
          </div>
        )}

        {/* CLEAR ALL ACTIVITY — Confirmation modal */}
        {clearActivityConfirm && (
          <div onClick={()=>!clearingActivity && setClearActivityConfirm(false)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'2px solid rgba(232,74,47,0.4)',maxWidth:440,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.8),0 0 50px rgba(232,74,47,0.25)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#c93820)'}}/>
              <div style={{padding:'22px 26px',display:'flex',flexDirection:'column',gap:16,position:'relative'}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:44,height:44,borderRadius:12,background:'linear-gradient(135deg,#e84a2f,#c93820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(232,74,47,0.5)'}}>🧹</div>
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#e84a2f'}}>CLEAR ALL ACTIVITY?</div>
                    <div style={{fontSize:9,color:'#888',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>This wipes the activity feed for everyone</div>
                  </div>
                </div>
                <div style={{padding:'14px 16px',background:'rgba(232,74,47,0.06)',border:'1px solid rgba(232,74,47,0.2)',borderRadius:12,fontSize:12,color:'#bbb',lineHeight:1.6}}>
                  <strong style={{color:'#e84a2f'}}>{activity.length}</strong> activity event{activity.length===1?'':'s'} will be permanently deleted. Announcements are NOT affected.
                </div>
                <div style={{display:'flex',gap:10}}>
                  <button onClick={()=>setClearActivityConfirm(false)} disabled={clearingActivity}
                    style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:clearingActivity?'not-allowed':'pointer',opacity:clearingActivity?0.5:1}}>
                    KEEP THEM
                  </button>
                  <button onClick={clearAllActivity} disabled={clearingActivity}
                    style={{flex:1.3,background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:clearingActivity?'not-allowed':'pointer',boxShadow:'0 4px 14px rgba(232,74,47,0.4)',opacity:clearingActivity?0.7:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                    {clearingActivity ? (<>
                      <span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                      CLEARING...
                    </>) : `🧹 CLEAR ${activity.length}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* CLEAR MY ANNOUNCEMENTS — Confirmation modal */}
        {clearMyPostsConfirm && (
          <div onClick={()=>!clearingMyPosts && setClearMyPostsConfirm(false)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'2px solid rgba(120,113,108,0.4)',maxWidth:460,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.8),0 0 50px rgba(120,113,108,0.25)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#a8a29e,#78716c)'}}/>
              <div style={{padding:'22px 26px',display:'flex',flexDirection:'column',gap:16,position:'relative'}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:44,height:44,borderRadius:12,background:'linear-gradient(135deg,#a8a29e,#78716c)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(120,113,108,0.5)'}}>👁‍🗨</div>
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#f0ece8'}}>HIDE ALL FROM VIEW?</div>
                    <div style={{fontSize:9,color:'#888',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>Only affects YOUR portal — other coaches keep seeing them</div>
                  </div>
                </div>
                <div style={{padding:'14px 16px',background:'rgba(120,113,108,0.06)',border:'1px solid rgba(120,113,108,0.2)',borderRadius:12,fontSize:12,color:'#bbb',lineHeight:1.6}}>
                  <strong style={{color:'#f0ece8'}}>{visibleAnnouncements.length}</strong> announcement{visibleAnnouncements.length===1?'':'s'} will be hidden from your view only. The announcements remain visible to other coaches and admins — nothing is deleted.
                </div>
                <div style={{display:'flex',gap:10}}>
                  <button onClick={()=>setClearMyPostsConfirm(false)} disabled={clearingMyPosts}
                    style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:clearingMyPosts?'not-allowed':'pointer',opacity:clearingMyPosts?0.5:1}}>
                    KEEP THEM
                  </button>
                  <button onClick={dismissAllVisible} disabled={clearingMyPosts}
                    style={{flex:1.3,background:'linear-gradient(135deg,#a8a29e,#78716c)',color:'#fff',border:'none',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:clearingMyPosts?'not-allowed':'pointer',boxShadow:'0 4px 14px rgba(120,113,108,0.4)',opacity:clearingMyPosts?0.7:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                    {clearingMyPosts ? (<>
                      <span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                      HIDING...
                    </>) : `👁‍🗨 HIDE ${visibleAnnouncements.length}`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* MESSAGE MODAL */}
      {msgTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...glass(),width:'100%',maxWidth:480,maxHeight:'85vh',display:'flex',flexDirection:'column',border:'1px solid rgba(66,165,245,0.25)'}}>
            <div style={{padding:'14px 18px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',alignItems:'center',gap:10}}>
              <div style={{width:36,height:36,borderRadius:'50%',background:'rgba(66,165,245,0.15)',border:'1.5px solid rgba(66,165,245,0.35)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:'#42a5f5'}}>
                {(msgTarget.name||'?')[0].toUpperCase()}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{msgTarget.name}</div>
                <div style={{fontSize:9,color:'#555',textTransform:'capitalize'}}>{msgTarget.role||'Member'} · {msgTarget.experience||'Beginner'}</div>
              </div>
              <button onClick={()=>{setMsgTarget(null);setMsgThread([])}} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'5px 9px',color:'#555',cursor:'pointer',fontSize:14,fontWeight:700}}>✕</button>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'12px',display:'flex',flexDirection:'column',gap:8,minHeight:220,maxHeight:380}}>
              {msgThread.length===0?(
                <div style={{textAlign:'center',color:'#555',fontSize:11,marginTop:50}}>
                  <div style={{fontSize:28,marginBottom:8}}>💬</div>
                  Start a conversation with {msgTarget.name?.split(' ')[0]}
                </div>
              ):msgThread.map((msg,i)=>{
                const isMe=msg.from===auth.currentUser?.uid
                return(
                  <div key={i} style={{display:'flex',justifyContent:isMe?'flex-end':'flex-start'}}>
                    <div style={{background:isMe?'rgba(66,165,245,0.15)':'rgba(255,255,255,0.06)',borderRadius:10,padding:'9px 12px',maxWidth:'76%',border:`1px solid ${isMe?'rgba(66,165,245,0.25)':'rgba(255,255,255,0.08)'}`}}>
                      <div style={{fontSize:12,color:'#f0ece8',lineHeight:1.6}}>{msg.text}</div>
                      <div style={{fontSize:8,color:'#555',marginTop:3,textAlign:isMe?'right':'left'}}>{isMe?'You':msg.fromName}</div>
                    </div>
                  </div>
                )
              })}
              <div ref={msgEndRef}/>
            </div>
            <div style={{padding:'10px 12px',borderTop:'1px solid rgba(255,255,255,0.05)',display:'flex',gap:8,alignItems:'center'}}>
              <input value={msgText} onChange={e=>setMsgText(e.target.value)}
                placeholder={`Message ${msgTarget.name?.split(' ')[0]}...`}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}}}
                style={{flex:1,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:9,padding:'10px 13px',color:'#f0ece8',fontSize:12,fontFamily:'Montserrat,sans-serif',outline:'none'}}
                onFocus={e=>e.target.style.borderColor='rgba(66,165,245,0.4)'}
                onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'}/>
              <button onClick={()=>sendMessage()} disabled={!msgText.trim()||sendingMsg}
                style={{background:msgText.trim()&&!sendingMsg?'linear-gradient(135deg,#42a5f5,#1565c0)':'rgba(255,255,255,0.05)',color:msgText.trim()&&!sendingMsg?'#fff':'#444',border:'none',borderRadius:9,padding:'10px 16px',fontSize:12,fontWeight:700,cursor:msgText.trim()&&!sendingMsg?'pointer':'not-allowed',transition:'all 0.2s',flexShrink:0}}>
                {sendingMsg?'..':'Send →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* NOTIFICATION MODAL */}
      {showNotif&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...glass(),padding:'32px 36px',width:'100%',maxWidth:480,border:'1px solid rgba(245,200,66,0.2)'}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#f0ece8',marginBottom:4,letterSpacing:'0.06em'}}>📢 POST ANNOUNCEMENT</div>
            <div style={{fontSize:11,color:'#555',marginBottom:18}}>Send a notification to all members</div>
            {/* Audience is locked to All Members for coaches.
                Admin retains full audience control in their portal. */}
            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:16,padding:'10px 14px',background:'rgba(245,200,66,0.06)',border:'1px solid rgba(245,200,66,0.22)',borderRadius:10}}>
              <div style={{width:26,height:26,borderRadius:8,background:'linear-gradient(135deg,#f5c842,#e08820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0}}>📢</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:11,fontWeight:700,color:'#f5c842',letterSpacing:'0.04em'}}>Audience: All Members</div>
                <div style={{fontSize:9,color:'#777',marginTop:1,letterSpacing:'0.03em'}}>Coaches can only announce to members. Admin handles coach-only announcements.</div>
              </div>
              <span style={{fontSize:10,color:'#555'}}>🔒</span>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:10}}>
              <input placeholder="Announcement title..." value={notifForm.title} onChange={e=>setNotifForm(p=>({...p,title:e.target.value}))} style={inp}
                onFocus={e=>e.target.style.borderColor='#f5c842'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.12)'}/>
              <textarea placeholder="Write your message..." value={notifForm.message} onChange={e=>setNotifForm(p=>({...p,message:e.target.value}))} rows={4}
                style={{...inp,resize:'vertical'}} onFocus={e=>e.target.style.borderColor='#f5c842'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.12)'}/>
            </div>
            <div style={{display:'flex',gap:8,marginTop:14}}>
              <button onClick={postNotification} style={{background:'linear-gradient(135deg,#f5c842,#e08820)',color:'#000',border:'none',borderRadius:50,padding:'11px 24px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Send 📢</button>
              <button onClick={()=>setShowNotif(false)} style={{background:'transparent',color:'#555',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'11px 20px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        select option{background:#1a1818 !important;color:#f0ece8 !important}
        @keyframes pulseDot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:0.6}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
      `}</style>
    </div>
  )
}

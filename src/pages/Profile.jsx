import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut } from 'firebase/auth'
import { doc, updateDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'
import Navbar from '../components/Navbar'

const LEVEL_COLOR = { Beginner:'#fb923c', Intermediate:'#f5c842', Advanced:'#4ade80', Expert:'#42a5f5', Elite:'#c084fc' }
const LEVEL_ICON  = { Beginner:'🥊', Intermediate:'⚡', Advanced:'🔥', Expert:'💎', Elite:'👑' }
const LEVEL_BONUS = { Beginner:0, Intermediate:150, Advanced:350 }

// ════════════════════════════════════════════════════════
//  EDIT CONSTRAINTS — Balanced model
//  Editable here: nickname, phone, height, weight, injuries
//  Locked here:   name, email, dob, age (computed), stance, goal,
//                 experience, daysPerWeek
//  Bounds mirror Signup + ProgramBuilder for consistency.
// ════════════════════════════════════════════════════════
const MIN_HEIGHT_CM = 100
const MAX_HEIGHT_CM = 220
const MIN_WEIGHT_KG = 30
const MAX_WEIGHT_KG = 200
const PHONE_RE = /^(\+?\d{10,15}|0\d{10})$/

// Compute age from a YYYY-MM-DD string; null if invalid/missing
function computeAge(dobStr) {
  if (!dobStr) return null
  const dob = new Date(dobStr)
  if (isNaN(dob.getTime())) return null
  const today = new Date()
  let a = today.getFullYear() - dob.getFullYear()
  const m = today.getMonth() - dob.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) a--
  return a
}

// Pretty-print a YYYY-MM-DD as "Jan 15, 2003"
function fmtDOB(dobStr) {
  if (!dobStr) return '—'
  const d = new Date(dobStr)
  if (isNaN(d.getTime())) return dobStr
  return d.toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' })
}

const glass=(e={})=>({
  background:'linear-gradient(135deg,rgba(30,28,28,0.97),rgba(18,16,16,0.99))',
  borderRadius:20,border:'1px solid rgba(245,200,66,0.15)',
  boxShadow:'0 8px 40px rgba(0,0,0,0.5),inset 0 1px 0 rgba(245,200,66,0.08)',
  overflow:'hidden',...e,
})

function StatCard({icon,label,value,sub,color='#f5c842',big=false}){
  return(
    <div style={{background:`${color}0c`,border:`1px solid ${color}22`,borderRadius:16,padding:'16px 18px',display:'flex',flexDirection:'column',gap:6,position:'relative',overflow:'hidden',transition:'all 0.2s'}}
      onMouseEnter={e=>e.currentTarget.style.transform='translateY(-2px)'}
      onMouseLeave={e=>e.currentTarget.style.transform='translateY(0)'}>
      <div style={{position:'absolute',top:-6,right:-6,fontSize:36,opacity:0.08}}>{icon}</div>
      <div style={{fontSize:10,fontWeight:700,color:'#555',letterSpacing:'0.1em',textTransform:'uppercase'}}>{label}</div>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:big?42:28,color,lineHeight:1,textShadow:`0 0 16px ${color}44`}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:'#555',fontWeight:600}}>{sub}</div>}
    </div>
  )
}

function AnimBar({value,max=100,color,label,delay=0}){
  const [w,setW]=useState(0)
  useEffect(()=>{const t=setTimeout(()=>setW((value/max)*100),delay+200);return()=>clearTimeout(t)},[value])
  return(
    <div style={{display:'flex',flexDirection:'column',gap:5}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10}}>
        <span style={{color:'#555',fontWeight:600}}>{label}</span>
        <span style={{color,fontWeight:700}}>{value}</span>
      </div>
      <div style={{height:6,background:'rgba(255,255,255,0.05)',borderRadius:50,overflow:'hidden'}}>
        <div style={{height:'100%',borderRadius:50,background:color,width:`${w}%`,transition:'width 1.2s cubic-bezier(0.4,0,0.2,1)',boxShadow:`0 0 8px ${color}66`}}/>
      </div>
    </div>
  )
}

export default function Profile(){
  const navigate=useNavigate()
  const [profile,setProfile]=useState(()=>{try{return JSON.parse(localStorage.getItem('hittrack_profile')||'{}')}catch{return{}}})
  const [stats,setStats]=useState(()=>{try{return JSON.parse(localStorage.getItem('hittrack_stats')||'{}')}catch{return{}}})
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState({})
  const [toast,setToast]=useState('')
  const [resetWarning,setResetWarning]=useState(false)
  const [saving,setSaving]=useState(false)
  const [logoutConfirm,setLogoutConfirm]=useState(false)
  const [mounted,setMounted]=useState(false)

  useEffect(()=>{
    const user=auth.currentUser
    if(!user)return
    getDoc(doc(db,'users',user.uid)).then(snap=>{
      if(snap.exists()){const data=snap.data();setProfile(data);localStorage.setItem('hittrack_profile',JSON.stringify(data))}
    }).catch(console.error)
    getDoc(doc(db,'stats',user.uid)).then(snap=>{
      if(snap.exists())setStats(snap.data())
    }).catch(()=>{})
    setTimeout(()=>setMounted(true),100)
  },[])

  const bmi=profile.bmi||(profile.height&&profile.weight?parseFloat((profile.weight/((profile.height/100)**2)).toFixed(1)):null)
  const bmiLabel=!bmi?'—':bmi<18.5?'Underweight':bmi<25?'Normal':bmi<30?'Overweight':'Obese'
  const bmiColor=!bmi?'#555':bmi<18.5?'#42a5f5':bmi<25?'#4ade80':bmi<30?'#f5c842':'#e84a2f'

  const totalWorkouts=stats.totalWorkouts||0
  const streak=stats.streak||0
  const weeklyPct=stats.weeklyPct||0
  const currentLevel=stats.currentLevel||profile.experience||'Beginner'
  const lc=LEVEL_COLOR[currentLevel]||'#f5c842'
  const li=LEVEL_ICON[currentLevel]||'🥊'
  const score=((totalWorkouts)*10)+((streak)*5)+(LEVEL_BONUS[currentLevel]||0)+Math.round(weeklyPct*1.5)

  // Ideal weight range based on height
  const idealMin=profile.height?Math.round(18.5*((profile.height/100)**2)):null

  // Age is now derived from DOB. Falls back to legacy stored age for pre-DOB users.
  const computedAge = computeAge(profile.dob)
  const displayAge  = computedAge !== null ? computedAge : (profile.age || null)
  const idealMax=profile.height?Math.round(24.9*((profile.height/100)**2)):null

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(''),3000)}

  // ════════════════════════════════════════════════════════
  //  EDIT MODE — Balanced model
  //  Only nickname, phone, height, weight, injuries are editable.
  //  Age is computed from DOB (locked); name/email/dob/days are locked.
  // ════════════════════════════════════════════════════════
  function handleEdit() {
    setDraft({
      nickname: profile.nickname || '',
      phone:    profile.phone    || '',
      height:   profile.height   || '',
      weight:   profile.weight   || '',
      injuries: profile.injuries || '',
    })
    setEditing(true)
  }

  async function handleSave() {
    // ── Client-side validation ─────────────────────────────
    if (draft.phone && draft.phone.trim() && !PHONE_RE.test(draft.phone.trim())) {
      showToast('❌ Invalid phone number')
      return
    }
    if (draft.height !== '') {
      const h = parseFloat(draft.height)
      if (Number.isNaN(h) || h < MIN_HEIGHT_CM || h > MAX_HEIGHT_CM) {
        showToast(`❌ Height must be ${MIN_HEIGHT_CM}-${MAX_HEIGHT_CM} cm`)
        return
      }
    }
    if (draft.weight !== '') {
      const w = parseFloat(draft.weight)
      if (Number.isNaN(w) || w < MIN_WEIGHT_KG || w > MAX_WEIGHT_KG) {
        showToast(`❌ Weight must be ${MIN_WEIGHT_KG}-${MAX_WEIGHT_KG} kg`)
        return
      }
    }

    setSaving(true)
    const updated = {
      ...profile,
      nickname: (draft.nickname || '').trim(),
      phone:    (draft.phone    || '').trim(),
      height:   draft.height ? parseFloat(draft.height) : profile.height,
      weight:   draft.weight ? parseFloat(draft.weight) : profile.weight,
      injuries: (draft.injuries || '').trim(),
    }
    if (updated.height && updated.weight) {
      updated.bmi = parseFloat((updated.weight / ((updated.height/100)**2)).toFixed(1))
    }
    setProfile(updated)
    localStorage.setItem('hittrack_profile', JSON.stringify(updated))
    try {
      const user = auth.currentUser
      if (user) {
        await updateDoc(doc(db, 'users', user.uid), {
          nickname: updated.nickname,
          phone:    updated.phone,
          height:   updated.height,
          weight:   updated.weight,
          injuries: updated.injuries,
          bmi:      updated.bmi,
          updatedAt: serverTimestamp(),
        })
      }
    } catch(e) {
      console.error(e)
      showToast('⚠ Saved locally, sync failed')
      setSaving(false)
      setEditing(false)
      return
    }
    setEditing(false)
    setSaving(false)
    showToast('✅ Profile updated!')
  }

  async function handleLogout(){
    await signOut(auth);localStorage.clear();navigate('/login')
  }

  async function handleRedoProgram(){
    try{
      const user=auth.currentUser
      if(user) await updateDoc(doc(db,'users',user.uid),{programSetupDone:false})
      const p=JSON.parse(localStorage.getItem('hittrack_profile')||'{}')
      p.programSetupDone=false
      localStorage.setItem('hittrack_profile',JSON.stringify(p))
    }catch(e){}
    navigate('/program-builder')
  }

  const inp={background:'rgba(255,255,255,0.04)',border:'1.5px solid rgba(255,255,255,0.08)',borderRadius:12,padding:'11px 14px',color:'#f0ece8',fontSize:13,fontFamily:'Montserrat,sans-serif',outline:'none',transition:'border-color 0.2s',width:'100%',boxSizing:'border-box'}

  return(
    <>
      <Navbar user={{name:profile.name||'Athlete'}}/>

      {toast&&<div style={{position:'fixed',top:20,right:20,zIndex:2000,background:'rgba(74,222,128,0.15)',border:'1px solid rgba(74,222,128,0.4)',borderRadius:12,padding:'12px 20px',fontSize:13,fontWeight:700,color:'#4ade80'}}>{toast}</div>}

      {/* Logout confirm */}
      {logoutConfirm&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...glass(),padding:'36px 40px',maxWidth:380,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:40,marginBottom:12}}>👋</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:'#f0ece8',marginBottom:8}}>LOG OUT?</div>
            <div style={{fontSize:13,color:'#7a7570',lineHeight:1.7,marginBottom:24}}>Are you sure you want to sign out of HITTRACK?</div>
            <div style={{display:'flex',gap:12,justifyContent:'center'}}>
              <button onClick={()=>setLogoutConfirm(false)} style={{background:'transparent',color:'#555',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Cancel</button>
              <button onClick={handleLogout} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Yes, Logout</button>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirm */}
      {resetWarning&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...glass(),padding:'36px 40px',maxWidth:400,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:'#e84a2f',marginBottom:8}}>Reset Program?</div>
            <div style={{fontSize:13,color:'#7a7570',lineHeight:1.7,marginBottom:24}}>This unlocks your stance, level, and goal so you can redo the Program Builder. Your workout history stays safe.</div>
            <div style={{display:'flex',gap:12,justifyContent:'center'}}>
              <button onClick={()=>setResetWarning(false)} style={{background:'transparent',color:'#555',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Cancel</button>
              <button onClick={handleRedoProgram} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Yes, Reset</button>
            </div>
          </div>
        </div>
      )}

      <div style={{maxWidth:1100,margin:'0 auto',padding:'24px 40px 60px',display:'flex',flexDirection:'column',gap:20,fontFamily:'Montserrat,sans-serif'}}>

        {/* ── HERO MINI PROFILE CARD ── */}
        <div style={{...glass({borderRadius:24}),padding:'0',overflow:'hidden',position:'relative'}}>
          {/* Banner gradient */}
          <div style={{height:100,background:`linear-gradient(135deg,${lc}33,rgba(232,74,47,0.2),rgba(14,12,12,0.95))`,position:'relative'}}>
            <div style={{position:'absolute',inset:0,backgroundImage:'repeating-linear-gradient(45deg,transparent,transparent 20px,rgba(255,255,255,0.01) 20px,rgba(255,255,255,0.01) 21px)',pointerEvents:'none'}}/>
            <div style={{position:'absolute',top:16,right:24,display:'flex',gap:8}}>
              <div style={{fontSize:9,fontWeight:700,color:lc,background:`${lc}18`,border:`1px solid ${lc}30`,borderRadius:50,padding:'4px 12px',letterSpacing:'0.1em',textTransform:'uppercase'}}>
                {li} {currentLevel}
              </div>
              {profile.stance&&<div style={{fontSize:9,fontWeight:700,color:'#f5c842',background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.2)',borderRadius:50,padding:'4px 12px',textTransform:'uppercase'}}>🥊 {profile.stance}</div>}
            </div>
          </div>

          <div style={{padding:'0 36px 28px',marginTop:-48,position:'relative'}}>
            <div style={{display:'grid',gridTemplateColumns:'auto 1fr auto',gap:24,alignItems:'flex-end'}}>
              {/* Big avatar */}
              <div style={{width:96,height:96,borderRadius:'50%',border:`4px solid ${lc}`,background:`linear-gradient(135deg,${lc}33,${lc}11)`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:40,color:lc,boxShadow:`0 0 30px ${lc}44,0 8px 24px rgba(0,0,0,0.5)`,flexShrink:0,position:'relative',zIndex:1}}>
                {(profile.name||'A')[0].toUpperCase()}
              </div>

              {/* Name + info */}
              <div style={{paddingTop:48}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,color:'#f0ece8',letterSpacing:'0.04em',lineHeight:1}}>{profile.name||'Athlete'}</div>
                  {profile.nickname&&<div style={{fontSize:13,color:'#e84a2f',fontStyle:'italic'}}>"{profile.nickname}"</div>}
                </div>
                <div style={{fontSize:11,color:'#555',marginBottom:10}}>{profile.email||auth.currentUser?.email||''}</div>
                {/* Quick tags */}
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {profile.goal&&<div style={{fontSize:10,fontWeight:700,color:'#42a5f5',background:'rgba(66,165,245,0.1)',border:'1px solid rgba(66,165,245,0.2)',borderRadius:50,padding:'3px 10px'}}>🎯 {profile.goal}</div>}
                  {profile.daysPerWeek&&<div style={{fontSize:10,fontWeight:700,color:'#4ade80',background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:50,padding:'3px 10px'}}>📅 {profile.daysPerWeek}x/week</div>}
                  {displayAge&&<div style={{fontSize:10,fontWeight:700,color:'#c084fc',background:'rgba(192,132,252,0.1)',border:'1px solid rgba(192,132,252,0.2)',borderRadius:50,padding:'3px 10px'}}>🎂 {displayAge} yrs</div>}
                  {profile.injuries&&profile.injuries!=='None'&&<div style={{fontSize:10,fontWeight:700,color:'#f5c842',background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.2)',borderRadius:50,padding:'3px 10px'}}>⚠️ {profile.injuries}</div>}
                </div>
              </div>

              {/* Score + actions */}
              <div style={{paddingTop:48,display:'flex',flexDirection:'column',gap:10,alignItems:'flex-end'}}>
                <div style={{background:`${lc}0e`,border:`1px solid ${lc}22`,borderRadius:14,padding:'12px 18px',textAlign:'center'}}>
                  <div style={{fontSize:9,fontWeight:700,color:'#555',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:2}}>Leaderboard Score</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:lc,lineHeight:1}}>{score.toLocaleString()}</div>
                  <div style={{fontSize:9,color:'#555',marginTop:2}}>pts</div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  {!editing
                    ?<button onClick={handleEdit} style={{background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.25)',borderRadius:50,padding:'7px 16px',fontSize:11,fontWeight:700,color:'#f5c842',cursor:'pointer'}}>✏️ Edit</button>
                    :<><button onClick={handleSave} disabled={saving} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'7px 16px',fontSize:11,fontWeight:700,cursor:'pointer'}}>{saving?'Saving...':'✓ Save'}</button>
                      <button onClick={()=>setEditing(false)} style={{background:'transparent',color:'#555',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'7px 14px',fontSize:11,fontWeight:700,cursor:'pointer'}}>✕</button></>
                  }
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── PERFORMANCE STATS ROW ── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:14,
          opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(16px)',transition:'all 0.5s ease'}}>
          <StatCard icon="🥊" label="Total Workouts" value={totalWorkouts} sub="sessions completed" color="#f5c842" big/>
          <StatCard icon="🔥" label="Current Streak" value={`${streak}d`} sub={streak>=7?'🔥 On fire!':'Keep going!'} color="#e84a2f" big/>
          <StatCard icon="📅" label="Weekly Completion" value={`${weeklyPct}%`} sub="this week" color="#4ade80" big/>
          <StatCard icon="⭐" label="Current Level" value={currentLevel} sub={`${li} ${LEVEL_BONUS[currentLevel]||0} bonus pts`} color={lc} big/>
        </div>

        {/* ── BODY METRICS + BMI ── */}
        <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>

          {/* BMI + Body Card */}
          <div style={glass()}>
            <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{fontSize:14,fontWeight:700}}>⚖️ Body Metrics</div>
              <div style={{fontSize:10,color:'#555'}}>From Program Builder</div>
            </div>
            <div style={{padding:'22px'}}>
              {/* BMI Hero */}
              {bmi?(
                <div style={{display:'flex',gap:20,alignItems:'center',marginBottom:20,padding:'18px',background:`${bmiColor}0c`,border:`1px solid ${bmiColor}22`,borderRadius:16}}>
                  <div style={{textAlign:'center',flexShrink:0}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:56,color:bmiColor,lineHeight:1,textShadow:`0 0 20px ${bmiColor}55`}}>{bmi}</div>
                    <div style={{fontSize:9,fontWeight:700,color:'#555',letterSpacing:'0.1em',textTransform:'uppercase',marginTop:2}}>BMI</div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:15,fontWeight:700,color:bmiColor,marginBottom:8}}>{bmiLabel}</div>
                    {/* BMI scale bar */}
                    <div style={{height:8,borderRadius:50,overflow:'hidden',background:'linear-gradient(90deg,#42a5f5 0%,#4ade80 25%,#f5c842 60%,#e84a2f 100%)',marginBottom:6,position:'relative'}}>
                      <div style={{position:'absolute',left:`${Math.min(Math.max(((bmi-10)/35)*100,0),100)}%`,top:'50%',transform:'translate(-50%,-50%)',width:14,height:14,borderRadius:'50%',background:'#fff',border:'2px solid #000',boxShadow:'0 0 8px rgba(0,0,0,0.5)'}}/>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:8,color:'#555'}}>
                      {['Underweight','Normal','Overweight','Obese'].map(l=><span key={l}>{l}</span>)}
                    </div>
                    {idealMin&&<div style={{fontSize:10,color:'#555',marginTop:8}}>Ideal weight: <strong style={{color:'#4ade80'}}>{idealMin}–{idealMax} kg</strong></div>}
                  </div>
                </div>
              ):(
                <div style={{background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:12,padding:'16px',textAlign:'center',marginBottom:16,fontSize:11,color:'#555'}}>
                  Complete Program Builder to see your BMI
                </div>
              )}

              {/* Body stats grid */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
                {[
                  {icon:'📏',label:'Height',val:profile.height?`${profile.height} cm`:'—',color:'#42a5f5'},
                  {icon:'⚖️',label:'Weight',val:profile.weight?`${profile.weight} kg`:'—',color:'#c084fc'},
                  {icon:'🎂',label:'Age',    val:displayAge?`${displayAge} years`:'—',color:'#fb923c'},
                  {icon:'🥊',label:'Stance', val:profile.stance||'—',color:'#f5c842'},
                ].map((m,i)=>(
                  <div key={i} style={{background:'rgba(255,255,255,0.03)',border:`1px solid ${m.color}18`,borderRadius:12,padding:'12px 14px',display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:32,height:32,borderRadius:10,background:`${m.color}15`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>{m.icon}</div>
                    <div>
                      <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:2}}>{m.label}</div>
                      <div style={{fontSize:14,fontWeight:700,color:m.color}}>{m.val}</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Progress + Achievements */}
          <div style={{display:'flex',flexDirection:'column',gap:14}}>

            {/* Level progress */}
            <div style={glass()}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid rgba(245,200,66,0.08)',fontSize:13,fontWeight:700}}>📈 Level Progress</div>
              <div style={{padding:'18px 20px',display:'flex',flexDirection:'column',gap:14}}>
                {/* Current level display */}
                <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px',background:`${lc}0c`,border:`1px solid ${lc}22`,borderRadius:14}}>
                  <div style={{fontSize:36}}>{li}</div>
                  <div style={{flex:1}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:lc}}>{currentLevel.toUpperCase()}</div>
                    <div style={{fontSize:10,color:'#555',marginTop:2}}>{totalWorkouts} workouts completed</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:lc}}>{score}</div>
                    <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.08em'}}>SCORE</div>
                  </div>
                </div>

                {/* Score breakdown */}
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  <AnimBar value={totalWorkouts*10} max={Math.max(totalWorkouts*10+200,300)} color="#f5c842" label={`🥊 Workouts ×10 = ${totalWorkouts*10} pts`} delay={0}/>
                  <AnimBar value={streak*5} max={Math.max(streak*5+50,100)} color="#e84a2f" label={`🔥 Streak ×5 = ${streak*5} pts`} delay={100}/>
                  <AnimBar value={LEVEL_BONUS[currentLevel]||0} max={350} color={lc} label={`⭐ Level bonus = ${LEVEL_BONUS[currentLevel]||0} pts`} delay={200}/>
                  <AnimBar value={Math.round(weeklyPct*1.5)} max={150} color="#4ade80" label={`📅 Weekly = ${Math.round(weeklyPct*1.5)} pts`} delay={300}/>
                </div>
              </div>
            </div>

            {/* Locked program fields */}
            <div style={glass()}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:13,fontWeight:700}}>🔒 Program Settings</div>
                <button onClick={()=>setResetWarning(true)} style={{background:'transparent',border:'1px dashed rgba(232,74,47,0.3)',borderRadius:50,padding:'5px 12px',fontSize:10,color:'#e84a2f',cursor:'pointer',fontWeight:600}}>↺ Re-do Program</button>
              </div>
              <div style={{padding:'16px 20px',display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:12}}>
                {[
                  {label:'Experience',val:profile.experience||'—',icon:'⭐'},
                  {label:'Goal',      val:profile.goal||'—',      icon:'🎯'},
                  {label:'Stance',    val:profile.stance||'—',    icon:'🥊'},
                ].map((f,i)=>(
                  <div key={i} style={{background:'rgba(255,255,255,0.02)',borderRadius:10,padding:'10px 12px',border:'1px solid rgba(245,200,66,0.08)'}}>
                    <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:4}}>{f.icon} {f.label}</div>
                    <div style={{fontSize:12,fontWeight:700,color:'#f0ece8'}}>{f.val}</div>
                    <div style={{fontSize:9,color:'#444',marginTop:2}}>🔒 locked</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── EDITABLE INFO ── */}
        <div style={glass()}>
          <div style={{padding:'16px 22px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontSize:14,fontWeight:700}}>👤 Personal Information</div>
            {!editing
              ?<button onClick={handleEdit} style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:50,padding:'8px 18px',fontSize:12,fontWeight:700,color:'#e84a2f',cursor:'pointer'}}>✏️ Edit Profile</button>
              :<div style={{display:'flex',gap:8}}>
                <button onClick={handleSave} disabled={saving} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer'}}>{saving?'Saving...':'✓ Save Changes'}</button>
                <button onClick={()=>setEditing(false)} style={{background:'transparent',color:'#555',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer'}}>✕ Cancel</button>
              </div>
            }
          </div>
          <div style={{padding:'22px',display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:18}}>
            {(() => {
              // Field config: editable per Balanced model
              const FIELDS = [
                { field:'name',        label:'Full Name',        editable:false, val:profile.name||'—' },
                { field:'nickname',    label:'Nickname',         editable:true,  type:'text', placeholder:'e.g. Low' },
                { field:'email',       label:'Email',            editable:false, val:auth.currentUser?.email||profile.email||'—' },
                { field:'dob',         label:'Date of Birth',    editable:false, val:fmtDOB(profile.dob) },
                { field:'age',         label:'Age (from DOB)',   editable:false, val:displayAge?`${displayAge} years`:'—' },
                { field:'phone',       label:'Phone Number',     editable:true,  type:'tel', placeholder:'09171234567' },
                { field:'height',      label:'Height (cm)',      editable:true,  type:'number', min:MIN_HEIGHT_CM, max:MAX_HEIGHT_CM, step:1 },
                { field:'weight',      label:'Weight (kg)',      editable:true,  type:'number', min:MIN_WEIGHT_KG, max:MAX_WEIGHT_KG, step:0.5 },
                { field:'injuries',    label:'Injuries',         editable:true,  type:'text', placeholder:'e.g. none, lower back' },
                { field:'daysPerWeek', label:'Training Days/Wk', editable:false, val:profile.daysPerWeek||'—' },
              ]
              return FIELDS.map(f => {
                const isLocked = !f.editable
                const value = f.val !== undefined ? f.val : (profile[f.field] || '—')
                return (
                  <div key={f.field}>
                    <label style={{fontSize:10,fontWeight:700,color:'#555',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:7,display:'flex',alignItems:'center',gap:5}}>
                      {f.label}
                      {isLocked && <span title="Locked field" style={{fontSize:9,color:'#444'}}>🔒</span>}
                    </label>
                    {editing && f.editable ? (
                      <input
                        type={f.type}
                        value={draft[f.field] ?? ''}
                        placeholder={f.placeholder||''}
                        min={f.min} max={f.max} step={f.step}
                        onChange={e=>setDraft(d=>({...d,[f.field]:e.target.value}))}
                        style={inp}
                        onFocus={e=>e.target.style.borderColor='rgba(245,200,66,0.4)'}
                        onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'}
                      />
                    ) : (
                      <div style={{
                        fontSize:14,fontWeight:600,
                        color:isLocked?'#888':'#f0ece8',
                        padding:'11px 0',
                        borderBottom:`1px solid rgba(255,255,255,${isLocked?0.03:0.05})`
                      }}>
                        {value || '—'}
                      </div>
                    )}
                  </div>
                )
              })
            })()}
          </div>
          {/* Edit-mode helper text */}
          {editing && (
            <div style={{padding:'0 22px 18px',marginTop:-4}}>
              <div style={{padding:'10px 14px',background:'rgba(245,200,66,0.06)',border:'1px solid rgba(245,200,66,0.18)',borderRadius:10,fontSize:11,color:'#888',lineHeight:1.55}}>
                🔒 <strong style={{color:'#aaa'}}>Locked fields</strong> (name, email, date of birth, training days, experience, stance, goal) can only be changed by your coach or admin. Need a change? Send a message.
              </div>
            </div>
          )}
        </div>

        {/* ── ACCOUNT SETTINGS ── */}
        <div style={{...glass({borderRadius:16}),border:'1px solid rgba(232,74,47,0.15)'}}>
          <div style={{padding:'16px 22px',borderBottom:'1px solid rgba(232,74,47,0.08)',fontSize:14,fontWeight:700}}>⚙️ Account Settings</div>
          <div style={{padding:'14px 22px',display:'flex',flexDirection:'column',gap:0}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 0',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:'#f0ece8',marginBottom:2}}>Logout</div>
                <div style={{fontSize:11,color:'#555'}}>Sign out of your HITTRACK account</div>
              </div>
              <button onClick={()=>setLogoutConfirm(true)} style={{background:'rgba(255,255,255,0.04)',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'8px 20px',fontSize:12,fontWeight:700,color:'#f0ece8',cursor:'pointer',transition:'all 0.2s'}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(232,74,47,0.4)';e.currentTarget.style.color='#e84a2f'}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='rgba(255,255,255,0.1)';e.currentTarget.style.color='#f0ece8'}}>
                Logout →
              </button>
            </div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 0'}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:'#e84a2f',marginBottom:2}}>Delete Account</div>
                <div style={{fontSize:11,color:'#555'}}>Permanently delete your account and all data</div>
              </div>
              <button style={{background:'rgba(232,74,47,0.1)',border:'1.5px solid rgba(232,74,47,0.3)',borderRadius:50,padding:'8px 20px',fontSize:12,fontWeight:700,color:'#e84a2f',cursor:'pointer'}}>Delete</button>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

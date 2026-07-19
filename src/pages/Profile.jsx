import { useState, useRef, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { signOut, deleteUser, EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth'
import { doc, updateDoc, getDoc, deleteDoc, setDoc, getDocs, collection, query, where, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'
import Navbar from '../components/Navbar'
import MedicalCertUpload from '../components/MedicalCertUpload'
import { useIsMobile } from '../lib/useIsMobile'
import { computeMembershipState, daysRemaining, fmtExpiry, fmtRemaining, getStatusLabel, getStatusColor, getStatusIcon, STATUS } from '../lib/membership'
import { getMemberLevel, levelScore, LEVEL_BONUS } from '../lib/memberLevel'
import { clearAppStorageKeepTheme } from '../lib/theme'

const LEVEL_COLOR = { Beginner:'#fb923c', Intermediate:'#f5c842', Advanced:'#4ade80', Expert:'#42a5f5', Elite:'#c084fc' }
const LEVEL_ICON  = { Beginner:'🥊', Intermediate:'⚡', Advanced:'🔥', Expert:'💎', Elite:'👑' }

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
// Phone validation — Issue #12. Same rule as Signup.jsx: 10–11 raw digits
// (PH landline w/ area code or mobile 09XXXXXXXXX). Strips non-digits before counting.
const PHONE_MIN_DIGITS = 10
const PHONE_MAX_DIGITS = 11
const rawPhoneDigits = (s) => String(s || '').replace(/\D/g, '')
function isValidPhone(s) {
  const d = rawPhoneDigits(s)
  return d.length >= PHONE_MIN_DIGITS && d.length <= PHONE_MAX_DIGITS
}

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
  background:'linear-gradient(135deg,var(--t-card),var(--t-card2))',
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
      <div style={{fontSize:10,fontWeight:700,color:'var(--t-dim3)',letterSpacing:'0.1em',textTransform:'uppercase'}}>{label}</div>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:big?42:28,color,lineHeight:1,textShadow:`0 0 16px ${color}44`}}>{value}</div>
      {sub&&<div style={{fontSize:10,color:'var(--t-dim3)',fontWeight:600}}>{sub}</div>}
    </div>
  )
}

function AnimBar({value,max=100,color,label,delay=0}){
  const [w,setW]=useState(0)
  useEffect(()=>{const t=setTimeout(()=>setW((value/max)*100),delay+200);return()=>clearTimeout(t)},[value])
  return(
    <div style={{display:'flex',flexDirection:'column',gap:5}}>
      <div style={{display:'flex',justifyContent:'space-between',fontSize:10}}>
        <span style={{color:'var(--t-dim3)',fontWeight:600}}>{label}</span>
        <span style={{color,fontWeight:700}}>{value}</span>
      </div>
      <div style={{height:6,background:'var(--t-s05)',borderRadius:50,overflow:'hidden'}}>
        <div style={{height:'100%',borderRadius:50,background:color,width:`${w}%`,transition:'width 1.2s cubic-bezier(0.4,0,0.2,1)',boxShadow:`0 0 8px ${color}66`}}/>
      </div>
    </div>
  )
}

export default function Profile(){
  const navigate=useNavigate()
  const isMobile=useIsMobile()
  const [profile,setProfile]=useState(()=>{try{return JSON.parse(localStorage.getItem('hittrack_profile')||'{}')}catch{return{}}})
  const [stats,setStats]=useState(()=>{try{return JSON.parse(localStorage.getItem('hittrack_stats')||'{}')}catch{return{}}})
  const [editing,setEditing]=useState(false)
  const [draft,setDraft]=useState({})
  const [toast,setToast]=useState('')
  const [resetWarning,setResetWarning]=useState(false)
  const [saving,setSaving]=useState(false)
  const [logoutConfirm,setLogoutConfirm]=useState(false)
  const [deleteConfirm,setDeleteConfirm]=useState(false)
  const [deleting,setDeleting]=useState(false)
  const [deleteCounts,setDeleteCounts]=useState(null)
  const [deletePassword,setDeletePassword]=useState('')   // re-auth before Firebase Auth deleteUser
  const [deleteError,setDeleteError]=useState('')         // inline error in modal
  // Payment history drawer
  const [showPayments,setShowPayments] = useState(false)
  const [payments,setPayments] = useState(null)  // null = not loaded yet, [] = loaded empty, [...] = data
  const [mounted,setMounted]=useState(false)

  useEffect(()=>{
    const user=auth.currentUser
    if(!user)return
    getDoc(doc(db,'users',user.uid)).then(snap=>{
      if(snap.exists()){const data=snap.data();setProfile(data);localStorage.setItem('hittrack_profile',JSON.stringify(data))}
    }).catch(console.error)
    getDoc(doc(db,'stats',user.uid)).then(snap=>{
      if(snap.exists()){
        const data=snap.data()
        setStats(data)
        // Mirror the users/{uid} pattern above: cache the freshest stats so the
        // next paint of Profile (or Stats) doesn't flash 0/0/0 from a stale
        // localStorage before Firestore lands.
        localStorage.setItem('hittrack_stats',JSON.stringify(data))
      }
    }).catch(()=>{})
    setTimeout(()=>setMounted(true),100)
  },[])

  const bmi=profile.bmi||(profile.height&&profile.weight?parseFloat((profile.weight/((profile.height/100)**2)).toFixed(1)):null)
  const bmiLabel=!bmi?'—':bmi<18.5?'Underweight':bmi<25?'Normal':bmi<30?'Overweight':'Obese'
  const bmiColor=!bmi?'var(--t-dim3)':bmi<18.5?'#42a5f5':bmi<25?'#4ade80':bmi<30?'#f5c842':'#e84a2f'

  const totalWorkouts=stats.totalWorkouts||0
  const streak=stats.streak||0
  const weeklyPct=stats.weeklyPct||0
  // Canonical level via the shared helper (admin experience > mobile
  // trainingLevel > legacy currentLevel, normalized + clamped to 3 divisions).
  const levelSrc = { experience: profile.experience, trainingLevel: stats.trainingLevel, currentLevel: stats.currentLevel }
  const currentLevel = getMemberLevel(levelSrc)
  const lc=LEVEL_COLOR[currentLevel]||'#f5c842'
  const li=LEVEL_ICON[currentLevel]||'🥊'
  const score=levelScore({ totalWorkouts, streak, weeklyPct, ...levelSrc })

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
    if (draft.phone && draft.phone.trim() && !isValidPhone(draft.phone.trim())) {
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
    await signOut(auth);clearAppStorageKeepTheme();navigate('/login')
  }

  // Load this member's own payment history on demand
  async function openPaymentHistory() {
    setShowPayments(true)
    if (payments !== null) return  // already loaded
    const me = auth.currentUser
    if (!me) return
    try {
      // Avoid composite-index requirement by dropping orderBy + sorting client-side
      const snap = await getDocs(query(
        collection(db,'payments'),
        where('memberId','==',me.uid)
      ))
      const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }))
        .sort((a, b) => {
          const aMs = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
          const bMs = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
          return bMs - aMs
        })
      setPayments(rows)
    } catch (e) {
      console.warn('Payment history load failed:', e.message)
      setPayments([])
    }
  }

  // ════════════════════════════════════════════════════════
  //  CASCADE SELF-DELETE — mirrors admin's permanentlyDeleteMember
  //
  //  Wipes ALL of the member's footprints to prevent orphaned data:
  //   1. Audit entry → deletions/{uid}  (DPA 2012 compliance + login lockout)
  //   2. Bookings (decrement each class's enrolled count first)
  //   3. Feedback (where memberId == uid)
  //   4. Messages (where participants array contains uid)
  //   5. Notifications (where targetUserId == uid OR fromUid == uid)
  //   6. Forum posts (where authorUid == uid)
  //   7. Adaptive decisions (where userId == uid)
  //   8. Level changes audit (where memberId == uid)
  //   9. Activity events authored by user (best-effort)
  //  10. Stats doc, 11. Workouts doc, 12. User doc (LAST)
  //
  //  Note: Firebase Auth account NOT deleted here (requires recent
  //  re-auth or a Cloud Function). The deletions/{uid} entry paired
  //  with App.jsx's useAuth hook signs the user out and blocks re-entry.
  // ════════════════════════════════════════════════════════
  async function handleDeleteAccount(){
    const me = auth.currentUser
    if (!me) return
    const uid = me.uid

    // ── STEP 0: Re-authenticate ──────────────────────────
    // Firebase Auth requires recent authentication to delete a user.
    // We ask for the password as both a safety confirmation AND to satisfy
    // Firebase's recent-login requirement. If this fails, we abort BEFORE
    // touching any data — no half-deleted state.
    setDeleteError('')
    if (!deletePassword.trim()) {
      setDeleteError('Please enter your password to confirm')
      return
    }
    setDeleting(true)
    try {
      const credential = EmailAuthProvider.credential(me.email, deletePassword)
      await reauthenticateWithCredential(me, credential)
    } catch (e) {
      console.error('Re-auth failed:', e)
      const msg = e.code === 'auth/wrong-password' || e.code === 'auth/invalid-credential'
        ? 'Wrong password'
        : e.code === 'auth/too-many-requests'
        ? 'Too many attempts — try again later'
        : 'Authentication failed: ' + (e.message || 'unknown')
      setDeleteError(msg)
      setDeleting(false)
      return
    }

    // ── STEPS 1-12: Firestore cascade ────────────────────
    const counts = { bookings:0, feedback:0, messages:0, notifications:0, forum:0, adaptive:0, levelChanges:0, activity:0 }
    const failed = []
    setDeleteCounts(counts)

    // Helper: run a step, log failure, but never throw
    const safeStep = async (label, fn) => {
      try { await fn() } catch (e) {
        console.warn(`Cascade step "${label}" failed:`, e.message || e)
        failed.push(label)
      }
    }

    // 1. Audit entry FIRST — written BEFORE anything is deleted.
    //    The deletions/{uid} doc is what locks the user out on next login.
    await safeStep('deletions audit', async () => {
      await setDoc(doc(db,'deletions',uid), {
        memberId:      uid,
        memberName:    profile.name || 'Unknown',
        memberEmail:   me.email || profile.email || '',
        memberRole:    profile.role || 'member',
        deletedBy:     uid,
        deletedByName: profile.name || 'Self',
        deletedAt:     serverTimestamp(),
        reason:        'Self-deletion via Profile page',
      })
    })

    // 2. Bookings (with class.enrolled decrement)
    await safeStep('bookings', async () => {
      const bookingsSnap = await getDocs(query(collection(db,'bookings'), where('userId','==',uid)))
      for (const d of bookingsSnap.docs) {
        try {
          const classRef = doc(db,'classes', d.data().classId)
          const classSnap = await getDoc(classRef)
          if (classSnap.exists() && (classSnap.data().enrolled||0) > 0) {
            await updateDoc(classRef, { enrolled: (classSnap.data().enrolled||1) - 1 })
          }
        } catch(_) {}
        try { await deleteDoc(d.ref); counts.bookings++ } catch(_) {}
        setDeleteCounts({...counts})
      }
    })

    // 3. Feedback
    await safeStep('feedback', async () => {
      const fSnap = await getDocs(query(collection(db,'feedback'), where('memberId','==',uid)))
      for (const d of fSnap.docs) {
        try { await deleteDoc(d.ref); counts.feedback++ } catch(_) {}
      }
      setDeleteCounts({...counts})
    })

    // 4. Messages
    await safeStep('messages', async () => {
      const mSnap = await getDocs(query(collection(db,'messages'), where('participants','array-contains',uid)))
      for (const d of mSnap.docs) {
        try { await deleteDoc(d.ref); counts.messages++ } catch(_) {}
      }
      setDeleteCounts({...counts})
    })

    // 5. Notifications (targeted + authored)
    await safeStep('notifications targeted', async () => {
      const nSnap = await getDocs(query(collection(db,'notifications'), where('targetUserId','==',uid)))
      for (const d of nSnap.docs) {
        try { await deleteDoc(d.ref); counts.notifications++ } catch(_) {}
      }
    })
    await safeStep('notifications authored', async () => {
      const nSnap = await getDocs(query(collection(db,'notifications'), where('fromUid','==',uid)))
      for (const d of nSnap.docs) {
        try { await deleteDoc(d.ref); counts.notifications++ } catch(_) {}
      }
      setDeleteCounts({...counts})
    })

    // 6. Forum posts
    await safeStep('forum posts', async () => {
      const fSnap = await getDocs(query(collection(db,'forum'), where('authorUid','==',uid)))
      for (const d of fSnap.docs) {
        try { await deleteDoc(d.ref); counts.forum++ } catch(_) {}
      }
      setDeleteCounts({...counts})
    })

    // 7. Adaptive decisions
    await safeStep('adaptive decisions', async () => {
      const aSnap = await getDocs(query(collection(db,'adaptiveDecisions'), where('userId','==',uid)))
      for (const d of aSnap.docs) {
        try { await deleteDoc(d.ref); counts.adaptive++ } catch(_) {}
      }
    })

    // 8. Level changes
    await safeStep('level changes', async () => {
      const lSnap = await getDocs(query(collection(db,'levelChanges'), where('memberId','==',uid)))
      for (const d of lSnap.docs) {
        try { await deleteDoc(d.ref); counts.levelChanges++ } catch(_) {}
      }
    })

    // 9. Activity events
    await safeStep('activity events', async () => {
      const actSnap = await getDocs(query(collection(db,'activity'), where('actorId','==',uid)))
      for (const d of actSnap.docs) {
        try { await deleteDoc(d.ref); counts.activity++ } catch(_) {}
      }
    })

    // 10–11. Stats + workouts docs (best-effort)
    await safeStep('stats doc', async () => { await deleteDoc(doc(db,'stats',uid)) })
    await safeStep('workouts doc', async () => { await deleteDoc(doc(db,'workouts',uid)) })

    // 12. User doc LAST — critical for the lockout path
    let userDocDeleted = false
    await safeStep('user doc', async () => {
      await deleteDoc(doc(db,'users',uid))
      userDocDeleted = true
    })

    if (!userDocDeleted) {
      console.error('Cascade FAILED — user doc could not be deleted. Failed steps:', failed)
      setDeleteError('Account deletion incomplete — contact admin')
      setDeleting(false)
      setDeleteCounts(null)
      return
    }

    if (failed.length > 0) {
      console.warn('Cascade completed with some skipped steps:', failed)
    }

    // ── STEP 13: Delete Firebase Auth account ────────────
    // This is the step that frees up the email for re-registration.
    // We do this AFTER the Firestore cascade because once the auth account
    // is gone, we have no more permission to write to Firestore.
    try {
      await deleteUser(me)
      console.log('[delete] Firebase Auth account removed — email is free to re-use')
    } catch (e) {
      // If this fails, the user is "soft-deleted" — data is gone but auth lingers.
      // The deletions/{uid} doc still locks them out via App.jsx useAuth.
      // Email won't be reusable until admin clears the auth account from
      // Firebase Console, or we set up a Cloud Function to handle it.
      console.error('Firebase Auth deleteUser failed:', e)
    }

    // Clear local state + sign out + redirect
    clearAppStorageKeepTheme()
    try { await signOut(auth) } catch(_) {}
    navigate('/login?deleted=1')
  }

  async function handleRedoProgram(){
    // Navigate to the wizard without flipping programSetupDone.
    // ProgramBuilder reads localStorage.programSetupDone === true to set
    // isRedo and surface the cancel button — flipping it here would force
    // the user through the wizard with no escape. App.jsx routing already
    // allows visiting /program-builder when programSetupDone is true.
    //
    // On wizard completion, handleNext() regenerates the workouts/{uid}
    // doc with the new stance/goal/experience so mobile and web stay in
    // sync. On cancel mid-wizard, nothing was written and the existing
    // program stays intact.
    navigate('/program-builder')
  }

  const inp={background:'var(--t-s04)',border:'1.5px solid var(--t-s08)',borderRadius:12,padding:'11px 14px',color:'var(--t-text)',fontSize:13,fontFamily:'Montserrat,sans-serif',outline:'none',transition:'border-color 0.2s',width:'100%',boxSizing:'border-box'}

  return(
    <>
      <Navbar user={{name:profile.name||'Athlete'}}/>

      {toast&&<div style={{position:'fixed',top:20,right:20,zIndex:2000,background:'rgba(74,222,128,0.15)',border:'1px solid rgba(74,222,128,0.4)',borderRadius:12,padding:'12px 20px',fontSize:13,fontWeight:700,color:'var(--a-green2)'}}>{toast}</div>}

      {/* Logout confirm */}
      {logoutConfirm&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...glass(),padding:'36px 40px',maxWidth:380,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:40,marginBottom:12}}>👋</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:'var(--t-text)',marginBottom:8}}>LOG OUT?</div>
            <div style={{fontSize:13,color:'var(--t-muted)',lineHeight:1.7,marginBottom:24}}>Are you sure you want to sign out of HITTRACK?</div>
            <div style={{display:'flex',gap:12,justifyContent:'center'}}>
              <button onClick={()=>setLogoutConfirm(false)} style={{background:'transparent',color:'var(--t-dim3)',border:'1.5px solid var(--t-s10)',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Cancel</button>
              <button onClick={handleLogout} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Yes, Logout</button>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/*  PAYMENT HISTORY DRAWER                               */}
      {/* ════════════════════════════════════════════════════ */}
      {showPayments && (
        <div onClick={()=>setShowPayments(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(10px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:'linear-gradient(135deg,var(--t-card) 0%,var(--t-card2) 100%)',borderRadius:20,border:'2px solid rgba(66,165,245,0.35)',maxWidth:520,width:'100%',maxHeight:'85vh',overflow:'hidden',display:'flex',flexDirection:'column',boxShadow:'0 30px 80px rgba(0,0,0,0.8)'}}>
            <div style={{padding:'18px 24px',borderBottom:'1px solid var(--t-s06)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'var(--a-blue)'}}>📜 PAYMENT HISTORY</div>
                <div style={{fontSize:10,color:'var(--t-dim2)',letterSpacing:'0.08em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>Your past renewals</div>
              </div>
              <button onClick={()=>setShowPayments(false)}
                style={{background:'var(--t-s04)',border:'1px solid var(--t-s10)',borderRadius:50,width:34,height:34,color:'var(--t-dim2)',fontSize:14,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'16px 24px'}}>
              {payments === null ? (
                <div style={{textAlign:'center',color:'var(--t-dim3)',fontSize:12,padding:30,display:'flex',flexDirection:'column',alignItems:'center',gap:12}}>
                  <span style={{display:'inline-block',width:18,height:18,border:'2px solid rgba(66,165,245,0.2)',borderTopColor:'#42a5f5',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                  Loading…
                </div>
              ) : payments.length === 0 ? (
                <div style={{textAlign:'center',color:'var(--t-dim3)',fontSize:12,padding:40,lineHeight:1.7}}>
                  No payments recorded yet.<br/>
                  <span style={{fontSize:11,color:'var(--t-dim3)'}}>Your first payment will appear here.</span>
                </div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {payments.map(p => {
                    const dt = p.createdAt?.toDate ? p.createdAt.toDate() : null
                    return (
                      <div key={p.id} style={{padding:'14px 16px',background:'var(--t-s03)',border:'1px solid var(--t-s06)',borderRadius:12}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'var(--a-green2)',letterSpacing:'0.04em'}}>
                            ₱{(p.amount||0).toLocaleString()}
                          </div>
                          <span style={{fontSize:9,padding:'2px 8px',background:'rgba(66,165,245,0.12)',color:'var(--a-blue)',border:'1px solid rgba(66,165,245,0.3)',borderRadius:50,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>
                            {p.paymentMethod || 'cash'}
                          </span>
                        </div>
                        {p.planLabel && (
                          <div style={{fontSize:11,color:'var(--a-gold)',fontWeight:600,marginBottom:4}}>🥊 {p.planLabel}</div>
                        )}
                        <div style={{fontSize:11,color:'var(--t-dim2)',display:'flex',gap:10,flexWrap:'wrap'}}>
                          {p.kind === 'dropin'
                            ? <span style={{color:'var(--a-gold)'}}>Drop-in session</span>
                            : <>
                                <span>{p.durationDays} days</span>
                                {p.startsAt && <span>· {fmtExpiry({expiresAt:p.startsAt})}–{fmtExpiry({expiresAt:p.expiresAt})}</span>}
                              </>}
                        </div>
                        {p.referenceNumber && (
                          <div style={{fontSize:10,color:'var(--t-dim3)',marginTop:4,fontFamily:'monospace'}}>Ref: {p.referenceNumber}</div>
                        )}
                        {p.notes && (
                          <div style={{fontSize:11,color:'var(--t-dim1)',marginTop:6,fontStyle:'italic'}}>"{p.notes}"</div>
                        )}
                        <div style={{fontSize:9,color:'var(--t-dim3)',marginTop:8,paddingTop:6,borderTop:'1px solid var(--t-s04)',letterSpacing:'0.04em'}}>
                          Recorded by {p.receivedByName || 'Admin'}{dt ? ` · ${dt.toLocaleDateString()} ${dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}` : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Delete account confirm — Cascade self-delete */}
      {deleteConfirm&&(
        <div onClick={()=>!deleting && setDeleteConfirm(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',backdropFilter:'blur(10px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{position:'relative',background:'linear-gradient(135deg,var(--t-card) 0%,var(--t-card2) 100%)',borderRadius:20,border:'2px solid rgba(232,74,47,0.5)',maxWidth:500,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.85),0 0 60px rgba(232,74,47,0.3)'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#c93820)'}}/>
            <div style={{padding:'24px 28px',display:'flex',flexDirection:'column',gap:16,position:'relative'}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:50,height:50,borderRadius:14,background:'linear-gradient(135deg,#e84a2f,#c93820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:26,boxShadow:'0 4px 16px rgba(232,74,47,0.5)'}}>⚠</div>
                <div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:'0.05em',color:'var(--a-red)'}}>DELETE ACCOUNT?</div>
                  <div style={{fontSize:10,color:'var(--t-dim2)',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>This action cannot be undone</div>
                </div>
              </div>
              <div style={{padding:'14px 16px',background:'rgba(232,74,47,0.07)',border:'1px solid rgba(232,74,47,0.22)',borderRadius:12,fontSize:12,color:'var(--t-dim1)',lineHeight:1.65,textAlign:'left'}}>
                <div style={{marginBottom:8,fontWeight:700,color:'var(--t-text)'}}>The following will be permanently deleted:</div>
                <div style={{display:'flex',flexDirection:'column',gap:4,fontSize:11,color:'#999'}}>
                  <div>✗ Your profile, workouts, and stats</div>
                  <div>✗ All your class bookings (slots freed up)</div>
                  <div>✗ All coach feedback addressed to you</div>
                  <div>✗ Your message threads</div>
                  <div>✗ Your notifications + adaptive AI history</div>
                  <div>✗ Forum posts you authored</div>
                  <div>✗ Your training level audit trail</div>
                </div>
                <div style={{marginTop:10,paddingTop:10,borderTop:'1px solid var(--t-s06)',fontSize:11,color:'var(--t-dim2)'}}>
                  📝 An audit entry will be saved to <code style={{background:'rgba(0,0,0,0.4)',padding:'1px 5px',borderRadius:4,fontFamily:'monospace',color:'var(--a-red)'}}>deletions/</code> for DPA 2012 compliance.
                </div>
              </div>

              {/* Password re-auth — required to delete Firebase Auth account
                  (so the email can be reused for new signups) */}
              <div style={{display:'flex',flexDirection:'column',gap:6}}>
                <label style={{fontSize:10,fontWeight:800,letterSpacing:'0.1em',textTransform:'uppercase',color:'var(--t-dim2)'}}>
                  🔐 Enter your password to confirm
                </label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={e=>{setDeletePassword(e.target.value); setDeleteError('')}}
                  placeholder="Your current password"
                  disabled={deleting}
                  autoComplete="current-password"
                  style={{background:'var(--t-s04)',border:`1.5px solid ${deleteError?'rgba(232,74,47,0.5)':'var(--t-s10)'}`,borderRadius:12,padding:'12px 14px',color:'var(--t-text)',fontSize:13,fontFamily:'Montserrat,sans-serif',outline:'none',width:'100%',boxSizing:'border-box',transition:'border-color 0.2s'}}
                  onFocus={e=>e.target.style.borderColor=deleteError?'rgba(232,74,47,0.7)':'#e84a2f'}
                  onBlur={e=>e.target.style.borderColor=deleteError?'rgba(232,74,47,0.5)':'var(--t-s10)'}
                />
                {deleteError && (
                  <div style={{fontSize:11,color:'var(--a-red)',fontWeight:600,marginTop:2,display:'flex',alignItems:'center',gap:6}}>
                    <span>⚠</span><span>{deleteError}</span>
                  </div>
                )}
              </div>

              {deleting && deleteCounts && (
                <div style={{padding:'12px 14px',background:'rgba(66,165,245,0.05)',border:'1px solid rgba(66,165,245,0.18)',borderRadius:10,fontSize:11,color:'var(--a-blue)',lineHeight:1.5,textAlign:'left'}}>
                  <div style={{fontWeight:700,marginBottom:4,letterSpacing:'0.04em'}}>🗑 Cascade in progress…</div>
                  <div style={{fontSize:10,color:'var(--t-dim2)'}}>
                    {deleteCounts.bookings} bookings · {deleteCounts.feedback} feedback · {deleteCounts.messages} messages · {deleteCounts.notifications} notifications · {deleteCounts.forum} forum posts
                  </div>
                </div>
              )}
              <div style={{display:'flex',gap:10}}>
                <button onClick={()=>{setDeleteConfirm(false); setDeletePassword(''); setDeleteError('')}} disabled={deleting}
                  style={{flex:1,background:'var(--t-s04)',color:'var(--t-dim1)',border:'1px solid var(--t-s10)',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:deleting?'not-allowed':'pointer',opacity:deleting?0.5:1}}>
                  KEEP MY ACCOUNT
                </button>
                <button onClick={handleDeleteAccount} disabled={deleting || !deletePassword.trim()}
                  style={{flex:1.3,background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:(deleting||!deletePassword.trim())?'not-allowed':'pointer',boxShadow:'0 4px 14px rgba(232,74,47,0.45)',opacity:(deleting||!deletePassword.trim())?0.5:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                  {deleting ? (<>
                    <span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                    DELETING…
                  </>) : '🗑 DELETE FOREVER'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Reset confirm */}
      {resetWarning&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:1000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...glass(),padding:'36px 40px',maxWidth:400,width:'90%',textAlign:'center'}}>
            <div style={{fontSize:36,marginBottom:12}}>⚠️</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:'var(--a-red)',marginBottom:8}}>Reset Program?</div>
            <div style={{fontSize:13,color:'var(--t-muted)',lineHeight:1.7,marginBottom:24}}>This unlocks your stance, level, and goal so you can redo the Program Builder. Your workout history stays safe.</div>
            <div style={{display:'flex',gap:12,justifyContent:'center'}}>
              <button onClick={()=>setResetWarning(false)} style={{background:'transparent',color:'var(--t-dim3)',border:'1.5px solid var(--t-s10)',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Cancel</button>
              <button onClick={handleRedoProgram} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Yes, Reset</button>
            </div>
          </div>
        </div>
      )}

      <div style={{maxWidth:1100,margin:'0 auto',padding:isMobile?'14px 12px 40px':'24px 40px 60px',display:'flex',flexDirection:'column',gap:isMobile?14:20,fontFamily:'Montserrat,sans-serif'}}>

        {/* ── HERO MINI PROFILE CARD ── */}
        <div style={{...glass({borderRadius:24}),padding:'0',overflow:'hidden',position:'relative'}}>
          {/* Banner gradient */}
          <div style={{height:100,background:`linear-gradient(135deg,${lc}33,rgba(232,74,47,0.2),var(--t-card2))`,position:'relative'}}>
            <div style={{position:'absolute',inset:0,backgroundImage:'repeating-linear-gradient(45deg,transparent,transparent 20px,rgba(255,255,255,0.01) 20px,rgba(255,255,255,0.01) 21px)',pointerEvents:'none'}}/>
            <div style={{position:'absolute',top:16,right:24,display:'flex',gap:8}}>
              <div style={{fontSize:9,fontWeight:700,color:lc,background:`${lc}18`,border:`1px solid ${lc}30`,borderRadius:50,padding:'4px 12px',letterSpacing:'0.1em',textTransform:'uppercase'}}>
                {li} {currentLevel}
              </div>
              {profile.stance&&<div style={{fontSize:9,fontWeight:700,color:'var(--a-gold)',background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.2)',borderRadius:50,padding:'4px 12px',textTransform:'uppercase'}}>🥊 {profile.stance}</div>}
            </div>
          </div>

          <div style={{padding:isMobile?'0 18px 22px':'0 36px 28px',marginTop:isMobile?-30:-48,position:'relative'}}>
            <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'auto 1fr auto',gap:isMobile?14:24,alignItems:isMobile?'center':'flex-end',justifyItems:isMobile?'center':'stretch',textAlign:isMobile?'center':'left'}}>
              {/* Big avatar */}
              <div style={{width:96,height:96,borderRadius:'50%',border:`4px solid ${lc}`,background:`linear-gradient(135deg,${lc}33,${lc}11)`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:40,color:lc,boxShadow:`0 0 30px ${lc}44,0 8px 24px rgba(0,0,0,0.5)`,flexShrink:0,position:'relative',zIndex:1}}>
                {(profile.name||'A')[0].toUpperCase()}
              </div>

              {/* Name + info */}
              <div style={{paddingTop:48}}>
                <div style={{display:'flex',alignItems:'center',gap:10,marginBottom:4}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,color:'var(--t-text)',letterSpacing:'0.04em',lineHeight:1}}>{profile.name||'Athlete'}</div>
                  {profile.nickname&&<div style={{fontSize:13,color:'var(--a-red)',fontStyle:'italic'}}>"{profile.nickname}"</div>}
                </div>
                <div style={{fontSize:11,color:'var(--t-dim3)',marginBottom:10}}>{profile.email||auth.currentUser?.email||''}</div>
                {/* Quick tags */}
                <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                  {profile.goal&&<div style={{fontSize:10,fontWeight:700,color:'var(--a-blue)',background:'rgba(66,165,245,0.1)',border:'1px solid rgba(66,165,245,0.2)',borderRadius:50,padding:'3px 10px'}}>🎯 {profile.goal}</div>}
                  {profile.daysPerWeek&&<div style={{fontSize:10,fontWeight:700,color:'var(--a-green2)',background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.2)',borderRadius:50,padding:'3px 10px'}}>📅 {profile.daysPerWeek}x/week</div>}
                  {displayAge&&<div style={{fontSize:10,fontWeight:700,color:'var(--a-purple)',background:'rgba(192,132,252,0.1)',border:'1px solid rgba(192,132,252,0.2)',borderRadius:50,padding:'3px 10px'}}>🎂 {displayAge} yrs</div>}
                  {profile.injuries&&profile.injuries!=='None'&&<div style={{fontSize:10,fontWeight:700,color:'var(--a-gold)',background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.2)',borderRadius:50,padding:'3px 10px'}}>⚠️ {profile.injuries}</div>}
                </div>
              </div>

              {/* Score + actions */}
              <div style={{paddingTop:48,display:'flex',flexDirection:'column',gap:10,alignItems:'flex-end'}}>
                <div style={{background:`${lc}0e`,border:`1px solid ${lc}22`,borderRadius:14,padding:'12px 18px',textAlign:'center'}}>
                  <div style={{fontSize:9,fontWeight:700,color:'var(--t-dim3)',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:2}}>Leaderboard Score</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:lc,lineHeight:1}}>{score.toLocaleString()}</div>
                  <div style={{fontSize:9,color:'var(--t-dim3)',marginTop:2}}>pts</div>
                </div>
                <div style={{display:'flex',gap:8}}>
                  {!editing
                    ?<button onClick={handleEdit} style={{background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.25)',borderRadius:50,padding:'7px 16px',fontSize:11,fontWeight:700,color:'var(--a-gold)',cursor:'pointer'}}>✏️ Edit</button>
                    :<><button onClick={handleSave} disabled={saving} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'7px 16px',fontSize:11,fontWeight:700,cursor:'pointer'}}>{saving?'Saving...':'✓ Save'}</button>
                      <button onClick={()=>setEditing(false)} style={{background:'transparent',color:'var(--t-dim3)',border:'1.5px solid var(--t-s10)',borderRadius:50,padding:'7px 14px',fontSize:11,fontWeight:700,cursor:'pointer'}}>✕</button></>
                  }
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ── PERFORMANCE STATS ROW ── */}
        <div style={{display:'grid',gridTemplateColumns:isMobile?'repeat(2,1fr)':'repeat(4,1fr)',gap:isMobile?10:14,
          opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(16px)',transition:'all 0.5s ease'}}>
          <StatCard icon="🥊" label="Total Workouts" value={totalWorkouts} sub="sessions completed" color="#f5c842" big/>
          <StatCard icon="🔥" label="Current Streak" value={`${streak}d`} sub={streak>=7?'🔥 On fire!':'Keep going!'} color="#e84a2f" big/>
          <StatCard icon="📅" label="Weekly Completion" value={`${weeklyPct}%`} sub="this week" color="#4ade80" big/>
          <StatCard icon="⭐" label="Current Level" value={currentLevel} sub={`${li} ${LEVEL_BONUS[currentLevel]||0} bonus pts`} color={lc} big/>
        </div>

        {/* ════════════════════════════════════════════════════ */}
        {/*  MEMBERSHIP CARD                                       */}
        {/*  LEGACY members collapse to NONE rendering here — the  */}
        {/*  state machine (membership.js) is unchanged, so they   */}
        {/*  retain canBook(LEGACY) === true booking access. Only  */}
        {/*  this card swaps "Legacy Member / Grandfathered" for   */}
        {/*  the standard "No active plan — contact admin" copy,   */}
        {/*  nudging grandfathered members toward a paid plan.     */}
        {/* ════════════════════════════════════════════════════ */}
        {(() => {
          const m = profile.membership
          const realState = computeMembershipState(m)
          const state = realState === STATUS.LEGACY ? STATUS.NONE : realState
          const color = getStatusColor(state)
          const icon  = getStatusIcon(state)
          const label = getStatusLabel(state)
          const remaining = fmtRemaining(m)
          const days = daysRemaining(m)
          const expiringSoon = (state === STATUS.ACTIVE || state === STATUS.TRIAL) && days !== null && days <= 7 && days >= 0

          return (
            <div style={{...glass(), border:`1px solid ${color}30`, position:'relative', overflow:'hidden'}}>
              {/* Accent stripe */}
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:`linear-gradient(180deg,${color},${color}77)`}}/>
              <div style={{padding:isMobile?'16px 18px 16px 22px':'20px 24px 20px 28px'}}>
                <div style={{display:'flex',alignItems:isMobile?'flex-start':'center',justifyContent:'space-between',gap:14,flexDirection:isMobile?'column':'row'}}>
                  <div style={{display:'flex',alignItems:'center',gap:14,minWidth:0,flex:1}}>
                    <div style={{width:50,height:50,borderRadius:14,background:`${color}15`,border:`1.5px solid ${color}40`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:24,flexShrink:0}}>
                      {icon}
                    </div>
                    <div style={{minWidth:0,flex:1}}>
                      <div style={{fontSize:9,fontWeight:800,letterSpacing:'0.14em',color:'var(--t-dim3)',textTransform:'uppercase',marginBottom:3}}>
                        Membership Status
                      </div>
                      <div style={{display:'flex',alignItems:'center',gap:10,flexWrap:'wrap'}}>
                        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:'0.04em',color, lineHeight:1}}>{label}</span>
                        {state === STATUS.TRIAL && (
                          <span style={{fontSize:9,padding:'2px 7px',background:'rgba(66,165,245,0.15)',color:'var(--a-blue)',border:'1px solid rgba(66,165,245,0.35)',borderRadius:50,fontWeight:700,letterSpacing:'0.08em'}}>FREE</span>
                        )}
                        {m?.planLabel && (state === STATUS.ACTIVE || state === STATUS.PAUSED) && (
                          <span style={{fontSize:9,padding:'3px 9px',background:'rgba(245,200,66,0.12)',color:'var(--a-gold)',border:'1px solid rgba(245,200,66,0.3)',borderRadius:50,fontWeight:700,letterSpacing:'0.06em'}}>🥊 {m.planLabel}</span>
                        )}
                      </div>
                      <div style={{fontSize:11,color:'var(--t-dim2)',marginTop:4}}>
                        {state === STATUS.EXPIRED && '🔒 Bookings locked. See admin to renew.'}
                        {state === STATUS.PAUSED  && '⏸ Paused — timer is held. See admin to resume.'}
                        {state === STATUS.TRIAL   && `${remaining} · Trial`}
                        {state === STATUS.ACTIVE  && remaining}
                        {state === STATUS.NONE    && 'No active plan — contact admin to subscribe'}
                      </div>
                    </div>
                  </div>
                  <div style={{textAlign:isMobile?'left':'right',flexShrink:0}}>
                    <div style={{fontSize:9,color:'var(--t-dim3)',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:2}}>
                      {state === STATUS.PAUSED ? 'Paused Since' : state === STATUS.EXPIRED ? 'Expired On' : 'Expires'}
                    </div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:'var(--t-text)',letterSpacing:'0.03em'}}>
                      {fmtExpiry(m)}
                    </div>
                  </div>
                </div>

                {/* Renewal warning bar — only when active/trial and < 7 days */}
                {expiringSoon && (
                  <div style={{marginTop:14,padding:'10px 14px',background:'rgba(245,200,66,0.08)',border:'1px solid rgba(245,200,66,0.3)',borderRadius:10,display:'flex',alignItems:'center',gap:10,fontSize:11,color:'var(--a-gold)',lineHeight:1.5}}>
                    <span style={{fontSize:14}}>⚠</span>
                    <span><strong>Membership expiring soon</strong> — speak with the gym admin to renew before your access is locked.</span>
                  </div>
                )}

                {/* View payment history — only shown when the member has paid at least once */}
                {m?.startedAt && (
                  <div style={{marginTop:14,paddingTop:14,borderTop:'1px solid var(--t-s05)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:10}}>
                    <div style={{fontSize:11,color:'var(--t-dim3)'}}>
                      💳 Want to see your payment receipts?
                    </div>
                    <button onClick={openPaymentHistory}
                      style={{background:'rgba(66,165,245,0.1)',border:'1px solid rgba(66,165,245,0.3)',borderRadius:50,padding:'7px 14px',fontSize:10,fontWeight:700,color:'var(--a-blue)',cursor:'pointer',letterSpacing:'0.06em',whiteSpace:'nowrap'}}>
                      📜 VIEW HISTORY
                    </button>
                  </div>
                )}
              </div>
            </div>
          )
        })()}

        {/* ── BODY METRICS + BMI ── */}
        <div style={{display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr',gap:16}}>

          {/* BMI + Body Card */}
          <div style={glass()}>
            <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div style={{fontSize:14,fontWeight:700}}>⚖️ Body Metrics</div>
              <div style={{fontSize:10,color:'var(--t-dim3)'}}>From Program Builder</div>
            </div>
            <div style={{padding:'22px'}}>
              {/* BMI Hero */}
              {bmi?(
                <div style={{display:'flex',gap:20,alignItems:'center',marginBottom:20,padding:'18px',background:`${bmiColor}0c`,border:`1px solid ${bmiColor}22`,borderRadius:16}}>
                  <div style={{textAlign:'center',flexShrink:0}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:56,color:bmiColor,lineHeight:1,textShadow:`0 0 20px ${bmiColor}55`}}>{bmi}</div>
                    <div style={{fontSize:9,fontWeight:700,color:'var(--t-dim3)',letterSpacing:'0.1em',textTransform:'uppercase',marginTop:2}}>BMI</div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:15,fontWeight:700,color:bmiColor,marginBottom:8}}>{bmiLabel}</div>
                    {/* BMI scale bar */}
                    <div style={{height:8,borderRadius:50,overflow:'hidden',background:'linear-gradient(90deg,#42a5f5 0%,#4ade80 25%,#f5c842 60%,#e84a2f 100%)',marginBottom:6,position:'relative'}}>
                      <div style={{position:'absolute',left:`${Math.min(Math.max(((bmi-10)/35)*100,0),100)}%`,top:'50%',transform:'translate(-50%,-50%)',width:14,height:14,borderRadius:'50%',background:'#fff',border:'2px solid #000',boxShadow:'0 0 8px rgba(0,0,0,0.5)'}}/>
                    </div>
                    <div style={{display:'flex',justifyContent:'space-between',fontSize:8,color:'var(--t-dim3)'}}>
                      {['Underweight','Normal','Overweight','Obese'].map(l=><span key={l}>{l}</span>)}
                    </div>
                    {idealMin&&<div style={{fontSize:10,color:'var(--t-dim3)',marginTop:8}}>Ideal weight: <strong style={{color:'var(--a-green2)'}}>{idealMin}–{idealMax} kg</strong></div>}
                  </div>
                </div>
              ):(
                <div style={{background:'var(--t-s02)',border:'1px solid var(--t-s06)',borderRadius:12,padding:'16px',textAlign:'center',marginBottom:16,fontSize:11,color:'var(--t-dim3)'}}>
                  Complete Program Builder to see your BMI
                </div>
              )}

              {/* Body stats grid */}
              <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:isMobile?8:10}}>
                {[
                  {icon:'📏',label:'Height',val:profile.height?`${profile.height} cm`:'—',color:'var(--a-blue)'},
                  {icon:'⚖️',label:'Weight',val:profile.weight?`${profile.weight} kg`:'—',color:'var(--a-purple)'},
                  {icon:'🎂',label:'Age',    val:displayAge?`${displayAge} years`:'—',color:'var(--a-orange)'},
                  {icon:'🥊',label:'Stance', val:profile.stance||'—',color:'var(--a-gold)'},
                ].map((m,i)=>(
                  <div key={i} style={{background:'var(--t-s03)',border:`1px solid ${m.color}18`,borderRadius:12,padding:'12px 14px',display:'flex',alignItems:'center',gap:10}}>
                    <div style={{width:32,height:32,borderRadius:10,background:`${m.color}15`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>{m.icon}</div>
                    <div>
                      <div style={{fontSize:9,color:'var(--t-dim3)',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:2}}>{m.label}</div>
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
                    <div style={{fontSize:10,color:'var(--t-dim3)',marginTop:2}}>{totalWorkouts} workouts completed</div>
                  </div>
                  <div style={{textAlign:'right'}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:lc}}>{score}</div>
                    <div style={{fontSize:9,color:'var(--t-dim3)',fontWeight:700,letterSpacing:'0.08em'}}>SCORE</div>
                  </div>
                </div>

                {/* Score breakdown */}
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  <AnimBar value={totalWorkouts*10} max={Math.max(totalWorkouts*10+200,300)} color="#f5c842" label={`🥊 Workouts ×10 = ${totalWorkouts*10} pts`} delay={0}/>
                  <AnimBar value={streak*5} max={Math.max(streak*5+50,100)} color="#e84a2f" label={`🔥 Streak ×5 = ${streak*5} pts`} delay={100}/>
                  <AnimBar value={LEVEL_BONUS[currentLevel]||0} max={350} color={lc} label={`⭐ Division bonus (${currentLevel}) = ${LEVEL_BONUS[currentLevel]||0} pts`} delay={200}/>
                  <AnimBar value={Math.round(weeklyPct*1.5)} max={150} color="#4ade80" label={`📅 Weekly = ${Math.round(weeklyPct*1.5)} pts`} delay={300}/>
                </div>
              </div>
            </div>

            {/* Locked program fields */}
            <div style={glass()}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:13,fontWeight:700}}>🔒 Program Settings</div>
                <button onClick={()=>setResetWarning(true)} style={{background:'transparent',border:'1px dashed rgba(232,74,47,0.3)',borderRadius:50,padding:'5px 12px',fontSize:10,color:'var(--a-red)',cursor:'pointer',fontWeight:600}}>↺ Re-do Program</button>
              </div>
              <div style={{padding:isMobile?'14px 16px':'16px 20px',display:'grid',gridTemplateColumns:isMobile?'1fr':'1fr 1fr 1fr',gap:isMobile?10:12}}>
                {[
                  {label:'Experience',val:profile.experience||'—',icon:'⭐'},
                  {label:'Goal',      val:profile.goal||'—',      icon:'🎯'},
                  {label:'Stance',    val:profile.stance||'—',    icon:'🥊'},
                ].map((f,i)=>(
                  <div key={i} style={{background:'var(--t-s02)',borderRadius:10,padding:'10px 12px',border:'1px solid rgba(245,200,66,0.08)'}}>
                    <div style={{fontSize:9,color:'var(--t-dim3)',fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase',marginBottom:4}}>{f.icon} {f.label}</div>
                    <div style={{fontSize:12,fontWeight:700,color:'var(--t-text)'}}>{f.val}</div>
                    <div style={{fontSize:9,color:'var(--t-dim4)',marginTop:2}}>🔒 locked</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* ── MEDICAL CERTIFICATE UPLOAD — member-facing upload + replace ── */}
        <MedicalCertUpload
          member={profile}
          onUploaded={(cert)=>{
            const next={...profile,medicalCert:cert}
            setProfile(next)
            try{localStorage.setItem('hittrack_profile',JSON.stringify(next))}catch{}
          }}
        />

        {/* ── EDITABLE INFO ── */}
        <div style={glass()}>
          <div style={{padding:'16px 22px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
            <div style={{fontSize:14,fontWeight:700}}>👤 Personal Information</div>
            {!editing
              ?<button onClick={handleEdit} style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:50,padding:'8px 18px',fontSize:12,fontWeight:700,color:'var(--a-red)',cursor:'pointer'}}>✏️ Edit Profile</button>
              :<div style={{display:'flex',gap:8}}>
                <button onClick={handleSave} disabled={saving} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer'}}>{saving?'Saving...':'✓ Save Changes'}</button>
                <button onClick={()=>setEditing(false)} style={{background:'transparent',color:'var(--t-dim3)',border:'1.5px solid var(--t-s10)',borderRadius:50,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer'}}>✕ Cancel</button>
              </div>
            }
          </div>
          <div style={{padding:isMobile?'16px':'22px',display:'grid',gridTemplateColumns:isMobile?'1fr':'repeat(3,1fr)',gap:isMobile?14:18}}>
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
                    <label style={{fontSize:10,fontWeight:700,color:'var(--t-dim3)',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:7,display:'flex',alignItems:'center',gap:5}}>
                      {f.label}
                      {isLocked && <span title="Locked field" style={{fontSize:9,color:'var(--t-dim4)'}}>🔒</span>}
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
                        onBlur={e=>e.target.style.borderColor='var(--t-s08)'}
                      />
                    ) : (
                      <div style={{
                        fontSize:14,fontWeight:600,
                        color:isLocked?'var(--t-dim2)':'var(--t-text)',
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
              <div style={{padding:'10px 14px',background:'rgba(245,200,66,0.06)',border:'1px solid rgba(245,200,66,0.18)',borderRadius:10,fontSize:11,color:'var(--t-dim2)',lineHeight:1.55}}>
                🔒 <strong style={{color:'var(--t-dim1)'}}>Locked fields</strong> (name, email, date of birth, training days, experience, stance, goal) can only be changed by your coach or admin. Need a change? Send a message.
              </div>
            </div>
          )}
        </div>

        {/* ── ACCOUNT SETTINGS ── */}
        <div style={{...glass({borderRadius:16}),border:'1px solid rgba(232,74,47,0.15)'}}>
          <div style={{padding:'16px 22px',borderBottom:'1px solid rgba(232,74,47,0.08)',fontSize:14,fontWeight:700}}>⚙️ Account Settings</div>
          <div style={{padding:'14px 22px',display:'flex',flexDirection:'column',gap:0}}>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 0',borderBottom:'1px solid var(--t-s04)'}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:'var(--t-text)',marginBottom:2}}>Logout</div>
                <div style={{fontSize:11,color:'var(--t-dim3)'}}>Sign out of your HITTRACK account</div>
              </div>
              <button onClick={()=>setLogoutConfirm(true)} style={{background:'var(--t-s04)',border:'1.5px solid var(--t-s10)',borderRadius:50,padding:'8px 20px',fontSize:12,fontWeight:700,color:'var(--t-text)',cursor:'pointer',transition:'all 0.2s'}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor='rgba(232,74,47,0.4)';e.currentTarget.style.color='#e84a2f'}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor='var(--t-s10)';e.currentTarget.style.color='var(--t-text)'}}>
                Logout →
              </button>
            </div>
            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',padding:'14px 0'}}>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:'var(--a-red)',marginBottom:2}}>Delete Account</div>
                <div style={{fontSize:11,color:'var(--t-dim3)'}}>Permanently delete your account and all data</div>
              </div>
              <button onClick={()=>setDeleteConfirm(true)} style={{background:'rgba(232,74,47,0.1)',border:'1.5px solid rgba(232,74,47,0.3)',borderRadius:50,padding:'8px 20px',fontSize:12,fontWeight:700,color:'var(--a-red)',cursor:'pointer',transition:'all 0.2s'}}
                onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.transform='scale(1.04)'}}
                onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.1)';e.currentTarget.style.transform='scale(1)'}}>Delete</button>
            </div>
          </div>
        </div>

      </div>
    </>
  )
}

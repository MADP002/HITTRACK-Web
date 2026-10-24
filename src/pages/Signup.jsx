import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword, sendEmailVerification } from 'firebase/auth'
import { doc, setDoc, getDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useIsMobile } from '../lib/useIsMobile'

function CornerChevs({ pos }) {
  const isTop  = pos.startsWith('top')
  const isLeft = pos.endsWith('left')
  const baseRot = isTop && isLeft ? -45 : isTop && !isLeft ? 225 : !isTop && isLeft ? 135 : 315
  return (
    <div style={{ position:'fixed', top:isTop?28:'auto', bottom:!isTop?28:'auto', left:isLeft?28:'auto', right:!isLeft?28:'auto', display:'flex', flexDirection:'column', gap:6, zIndex:10 }}>
      {Array.from({length:4},(_,r)=>(
        <div key={r} style={{display:'flex',gap:6,flexDirection:isLeft?'row':'row-reverse'}}>
          {Array.from({length:3},(_,c)=>(
            <div key={c} style={{width:13,height:13,borderRight:'2.5px solid #e84a2f',borderBottom:'2.5px solid #e84a2f',transform:`rotate(${baseRot}deg)`,animation:`chevPulse ${1.4+c*0.25}s ease-in-out infinite ${(r*3+c)*0.07}s`,opacity:0.3}}/>
          ))}
        </div>
      ))}
    </div>
  )
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// Phone validation — Issue #12. Matches mobile signup.jsx pattern: count raw digits,
// require 10 (landline w/ area code like 28123456 + 2-digit code) to 11 (PH mobile 09XXXXXXXXX).
// Strips spaces, dashes, parens, dots, leading + before counting.
const PHONE_MIN_DIGITS = 10
const PHONE_MAX_DIGITS = 11
const rawDigits = (s) => String(s || '').replace(/\D/g, '')
function validatePhone(s) {
  const d = rawDigits(s)
  if (d.length < PHONE_MIN_DIGITS) return `Phone must be at least ${PHONE_MIN_DIGITS} digits.`
  if (d.length > PHONE_MAX_DIGITS) return `Phone must be at most ${PHONE_MAX_DIGITS} digits.`
  return ''
}

// Password policy: min 8 chars, ≥1 uppercase, ≥1 digit, ≥1 special character.
// Returns an error string, or '' if the password satisfies every rule.
function validatePassword(pw) {
  if (!pw) return 'Password is required.'
  if (pw.length < 8)            return 'Must be at least 8 characters.'
  if (!/[A-Z]/.test(pw))        return 'Add at least 1 uppercase letter.'
  if (!/[0-9]/.test(pw))        return 'Add at least 1 number.'
  if (!/[^A-Za-z0-9]/.test(pw)) return 'Add at least 1 special character (e.g. !@#$).'
  return ''
}

function getPasswordStrength(pw) {
  if (!pw) return { score: 0, label: '', color: 'transparent' }
  let score = 0
  if (pw.length >= 6) score++
  if (pw.length >= 10) score++
  if (/[A-Z]/.test(pw)) score++
  if (/[0-9]/.test(pw)) score++
  if (/[^A-Za-z0-9]/.test(pw)) score++

  if (score <= 1) return { score: 1, label: 'Weak', color: '#e84a2f' }
  if (score === 2) return { score: 2, label: 'Fair', color: '#f5a623' }
  if (score === 3) return { score: 3, label: 'Good', color: '#f5c842' }
  if (score >= 4) return { score: Math.min(score, 5), label: 'Strong', color: '#22c55e' }
  return { score: 0, label: '', color: 'transparent' }
}

function firebaseErrorMessage(code) {
  const map = {
    'auth/email-already-in-use': 'This email is already registered. Try signing in instead.',
    'auth/invalid-email': 'Please enter a valid email address.',
    'auth/weak-password': 'Password is too weak. Use 8+ characters with an uppercase letter, a number, and a special character.',
    'auth/operation-not-allowed': 'Email/password signup is currently disabled. Contact the gym admin.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/network-request-failed': 'Network error. Check your internet connection and try again.',
  }
  return map[code] || 'Signup failed. Please try again.'
}

// Seconds the member must wait between verification emails. Firebase throttles
// rapid resends (auth/too-many-requests), so we pace the button instead.
const RESEND_COOLDOWN_S = 60

function resendErrorMessage(err) {
  const map = {
    'auth/too-many-requests': 'Too many requests — a verification email was already sent. Check your inbox and spam folder, then wait a few minutes before resending.',
    'auth/network-request-failed': 'Network error. Check your internet connection and try again.',
  }
  return map[err.code] || `Could not resend (${err.code || err.message || 'unknown error'}). Check your inbox first — the original link may still work.`
}

export default function Signup() {
  const navigate  = useNavigate()
  const canvasRef = useRef(null)
  const isMobile  = useIsMobile()
  // Public signup is MEMBERS ONLY. Coach accounts are created by an admin from
  // the admin dashboard (Coaches tab) so not just anyone can become a coach.
  const [form, setForm]       = useState({ name:'', email:'', password:'', confirm:'', phone:'', dob:'' })
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

  // ── "Check your email" panel ──
  // After signup we stay here instead of jumping to Login, so a member whose
  // link never arrived can resend it right away — before, the resend button
  // only appeared after they tried (and failed) to log in unverified.
  const [verifyEmail, setVerifyEmail] = useState('')   // set once the account exists
  const [verifySent, setVerifySent]   = useState(false) // did the signup-time email go out?
  const [resending, setResending]     = useState(false)
  const [resendMsg, setResendMsg]     = useState('')
  const [cooldown, setCooldown]       = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const t = setTimeout(() => setCooldown(c => c - 1), 1000)
    return () => clearTimeout(t)
  }, [cooldown])

  // ════════════════════════════════════════════════════════
  //  AGE GATE — Min 13, Max 100. Aligns with Philippine DPA
  //  2012 (RA 10173) which requires parental consent for minors.
  //  Members aged 13-17 see a parental-consent reminder.
  // ════════════════════════════════════════════════════════
  const MIN_AGE = 13
  const MAX_AGE = 100
  // Compute date input bounds from MIN/MAX age
  const today    = new Date()
  const maxDOB   = new Date(today.getFullYear() - MIN_AGE, today.getMonth(), today.getDate())  // latest birthdate allowed
  const minDOB   = new Date(today.getFullYear() - MAX_AGE, today.getMonth(), today.getDate())  // earliest birthdate allowed
  const fmtDate  = (d) => d.toISOString().split('T')[0]
  const maxDOBStr = fmtDate(maxDOB)
  const minDOBStr = fmtDate(minDOB)

  function computeAge(dobStr) {
    if (!dobStr) return null
    const dob = new Date(dobStr)
    if (isNaN(dob.getTime())) return null
    let age = today.getFullYear() - dob.getFullYear()
    const m = today.getMonth() - dob.getMonth()
    if (m < 0 || (m === 0 && today.getDate() < dob.getDate())) age--
    return age
  }
  const currentAge = computeAge(form.dob)
  const isMinor    = currentAge !== null && currentAge >= MIN_AGE && currentAge < 18

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); let animId, t = 0
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize(); window.addEventListener('resize', resize)
    const particles = Array.from({length:20},()=>({x:Math.random(),y:Math.random(),vx:(Math.random()-.5)*.0002,vy:(Math.random()-.5)*.0002,r:Math.random()*1.5+.5,warm:Math.random()>.5}))
    const draw = () => {
      ctx.clearRect(0,0,canvas.width,canvas.height); t+=.01
      particles.forEach(p=>{
        p.x=(p.x+p.vx+1)%1; p.y=(p.y+p.vy+1)%1
        const a=.12+Math.sin(t+p.x*8)*.06
        ctx.beginPath(); ctx.arc(p.x*canvas.width,p.y*canvas.height,p.r,0,Math.PI*2)
        ctx.fillStyle=p.warm?`rgba(232,74,47,${a})`:`rgba(245,180,66,${a})`; ctx.fill()
      })
      animId=requestAnimationFrame(draw)
    }
    draw(); return()=>{cancelAnimationFrame(animId);window.removeEventListener('resize',resize)}
  },[])

  function update(field, val) {
    setForm(f=>({...f,[field]:val}))
    if (fieldErrors[field]) setFieldErrors(fe => ({ ...fe, [field]: '' }))
  }

  function handleBlur(field) {
    setTouched(t => ({ ...t, [field]: true }))
    validateField(field, form[field])
  }

  function validateField(field, value) {
    let err = ''
    switch (field) {
      case 'name':
        if (touched.name && !value.trim()) err = 'Full name is required.'
        break
      case 'email':
        if (!value.trim()) err = 'Email is required.'
        else if (!EMAIL_RE.test(value.trim())) err = 'Enter a valid email (e.g. you@example.com).'
        break
      case 'phone':
        if (value.trim()) err = validatePhone(value)
        break
      case 'dob': {
        if (!value) {
          err = 'Date of birth is required.'
        } else {
          const age = computeAge(value)
          if (age === null) err = 'Enter a valid date.'
          else if (age < MIN_AGE) err = `You must be at least ${MIN_AGE} years old to register.`
          else if (age > MAX_AGE) err = 'Please enter a realistic birthdate.'
        }
        break
      }
      case 'password':
        if (value) err = validatePassword(value)
        if (form.confirm && value !== form.confirm) {
          setFieldErrors(fe => ({ ...fe, confirm: 'Passwords do not match.' }))
        } else if (form.confirm) {
          setFieldErrors(fe => ({ ...fe, confirm: '' }))
        }
        break
      case 'confirm':
        if (value && value !== form.password) err = 'Passwords do not match.'
        break
      default: break
    }
    setFieldErrors(fe => ({ ...fe, [field]: err }))
    return err
  }

  function validateAll() {
    const errs = {}
    if (!form.name.trim()) errs.name = 'Full name is required.'
    if (!form.email.trim()) errs.email = 'Email is required.'
    else if (!EMAIL_RE.test(form.email.trim())) errs.email = 'Enter a valid email (e.g. you@example.com).'
    // ── DOB age gate ──
    if (!form.dob) {
      errs.dob = 'Date of birth is required.'
    } else {
      const age = computeAge(form.dob)
      if (age === null) errs.dob = 'Enter a valid date.'
      else if (age < MIN_AGE) errs.dob = `You must be at least ${MIN_AGE} years old to register.`
      else if (age > MAX_AGE) errs.dob = 'Please enter a realistic birthdate.'
    }
    if (form.phone.trim()) { const pe = validatePhone(form.phone); if (pe) errs.phone = pe }
    { const pe = validatePassword(form.password); if (pe) errs.password = pe }
    if (!form.confirm) errs.confirm = 'Please confirm your password.'
    else if (form.password !== form.confirm) errs.confirm = 'Passwords do not match.'
    setFieldErrors(errs)
    setTouched({ name:true, email:true, dob:true, phone:true, password:true, confirm:true })
    return Object.values(errs).every(v => !v)
  }

  async function handleSignup(e) {
    e.preventDefault()
    if (!validateAll()) return
    setLoading(true); setError('')
    try {
      const normalizedEmail = form.email.trim().toLowerCase()
      const cred = await createUserWithEmailAndPassword(auth, normalizedEmail, form.password)

      // Email verification — send the link right after account creation.
      let sent = false
      try { await sendEmailVerification(cred.user); sent = true } catch (_) {}

      const userData = {
        uid: cred.user.uid, name: form.name.trim(), email: normalizedEmail,
        dob: form.dob,                              // YYYY-MM-DD string
        ageAtSignup: computeAge(form.dob),          // snapshot — convenient for analytics
        // Login is gated until the email is verified. Only NEW accounts get this
        // flag, so existing users (no flag) are never locked out.
        requiresEmailVerification: true,
        createdAt: serverTimestamp(),
      }
      if (form.phone.trim()) userData.phone = form.phone.trim()

      {
        // ════════════════════════════════════════════════════
        //  TRIAL ABUSE PROTECTION
        //  Each email gets ONE free trial. If they signed up
        //  before (and later self-deleted or whatever), they
        //  must pay to activate — no second trial.
        //
        //  We track claimed-trial emails in /trialUsage/{email}
        //  which is immutable once written. The doc survives
        //  even if the user deletes their account.
        // ════════════════════════════════════════════════════
        const trialDocRef = doc(db, 'trialUsage', normalizedEmail)
        let trialAlreadyClaimed = false
        try {
          const trialDoc = await getDoc(trialDocRef)
          trialAlreadyClaimed = trialDoc.exists()
        } catch (e) {
          // If we can't read, fail closed — no trial (safer)
          console.warn('Trial-usage check failed:', e.message)
          trialAlreadyClaimed = true
        }

        const TRIAL_DAYS = 7
        const trialEnd = new Date(Date.now() + TRIAL_DAYS * 86400000)

        if (!trialAlreadyClaimed) {
          // Mark this email as having claimed its trial — write BEFORE creating
          // the user so a failed user create doesn't release the trial slot.
          try {
            await setDoc(trialDocRef, {
              email:     normalizedEmail,
              claimedAt: serverTimestamp(),
              claimedByName: form.name.trim(),  // for audit
            })
          } catch (e) {
            console.warn('Could not stamp trial usage:', e.message)
          }
        }

        await setDoc(doc(db, 'users', cred.user.uid), {
          ...userData,
          role: 'member', status: 'active', programSetupDone: false,
          membership: trialAlreadyClaimed ? {
            // No trial — must pay before any access. Banner will show
            // "No active membership" + bookings/leaderboard/stats are locked.
            trialStartedAt:    null,
            trialEndsAt:       null,
            trialUsed:         true,
            startedAt:         null,
            expiresAt:         null,
            pausedAt:          null,
            totalPauseDays:    0,
            lastRenewedAt:     null,
            lastRenewedBy:     null,
            lastRenewedByName: null,
            previouslyClaimedTrial: true,  // flag for admin awareness
          } : {
            trialStartedAt:    serverTimestamp(),
            trialEndsAt:       trialEnd,
            trialUsed:         true,
            startedAt:         null,
            expiresAt:         trialEnd,
            pausedAt:          null,
            totalPauseDays:    0,
            lastRenewedAt:     null,
            lastRenewedBy:     null,
            lastRenewedByName: null,
          },
        })
        await auth.signOut()
        setVerifySent(sent)
        setCooldown(sent ? RESEND_COOLDOWN_S : 0)  // if the first send failed, allow an immediate retry
        setVerifyEmail(normalizedEmail)
        setLoading(false)
      }
    } catch (err) {
      setError(firebaseErrorMessage(err.code))
      setLoading(false)
    }
  }

  // Resend the verification link. The member is signed out (login is gated on
  // verification), so — like Login.jsx — sign in briefly with the password they
  // just typed, send, and sign straight back out.
  async function handleResend() {
    if (resending || cooldown > 0) return
    setResending(true); setResendMsg('')
    try {
      const cred = await signInWithEmailAndPassword(auth, verifyEmail, form.password)
      await sendEmailVerification(cred.user)
      await auth.signOut()
      setVerifySent(true)
      setCooldown(RESEND_COOLDOWN_S)
      setResendMsg('success:A new verification link was sent to ' + verifyEmail + '.')
    } catch (err) {
      console.error('[resendVerification] failed:', err)
      auth.signOut().catch(() => {})
      setResendMsg('error:' + resendErrorMessage(err))
    } finally { setResending(false) }
  }

  const strength = getPasswordStrength(form.password)

  const fields = [
    { field:'name',     label:'Full Name',        type:'text',     ph:'e.g. Lowell Aguinaldo' },
    { field:'email',    label:'Email Address',     type:'email',    ph:'your@email.com' },
    { field:'dob',      label:'Date of Birth',     type:'date',     ph:'YYYY-MM-DD' },
    { field:'phone',    label:'Phone Number',      type:'tel',      ph:'e.g. 09171234567', optional:true },
    { field:'password', label:'Password',          type:'password', ph:'8+ chars, 1 capital, 1 number, 1 symbol' },
    { field:'confirm',  label:'Confirm Password',  type:'password', ph:'Repeat password' },
  ]

  return (
    <div style={{minHeight:'100vh',background:'#0f0d0d',display:'flex',position:'relative',overflow:'hidden',fontFamily:"'Montserrat',sans-serif"}}>
      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',zIndex:0,pointerEvents:'none'}}/>
      <CornerChevs pos="top-left"/><CornerChevs pos="top-right"/>
      <CornerChevs pos="bottom-left"/><CornerChevs pos="bottom-right"/>

      {/* LEFT — Branding (hidden on mobile) */}
      {!isMobile && (
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',position:'relative',zIndex:2,padding:'60px 40px'}}>
          <div style={{position:'absolute',width:500,height:500,borderRadius:'50%',background:'radial-gradient(circle,rgba(232,74,47,0.1),transparent 68%)',pointerEvents:'none'}}/>
          <div style={{position:'relative',zIndex:1,textAlign:'center'}}>
            <div style={{fontSize:72,marginBottom:16,animation:'gloveFloat 3s ease-in-out infinite'}}>🥊</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:72,letterSpacing:'0.04em',lineHeight:1,color:'#f0ece8',textShadow:'0 0 80px rgba(232,74,47,0.25)'}}>
              HIT<span style={{color:'#e84a2f',textShadow:'0 0 50px rgba(232,74,47,0.7)'}}>TRACK</span>
            </div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.25em',color:'#e84a2f',marginTop:10,fontStyle:'italic'}}>Join the Fight</div>
            <div style={{display:'flex',alignItems:'center',gap:14,margin:'24px auto',maxWidth:280}}>
              <div style={{flex:1,height:1,background:'linear-gradient(90deg,transparent,rgba(232,74,47,0.6))'}}/>
              <div style={{width:8,height:8,borderRadius:'50%',background:'#e84a2f',boxShadow:'0 0 12px rgba(232,74,47,0.8)'}}/>
              <div style={{flex:1,height:1,background:'linear-gradient(90deg,rgba(232,74,47,0.6),transparent)'}}/>
            </div>
            <div style={{fontSize:11,color:'#555',letterSpacing:'0.14em',textTransform:'uppercase',marginBottom:28}}>Wild Bout Boxing Gym · Create Account</div>
            <div style={{display:'flex',flexDirection:'column',gap:10,textAlign:'left',maxWidth:280,margin:'0 auto'}}>
              {['🏆 Personalized workout program','📊 Track your progress & stats','🥊 Real-time leaderboard','💬 Connect with your coach'].map((item,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:10,fontSize:12,color:'#7a7570'}}>
                  <div style={{width:6,height:6,borderRadius:'50%',background:'#e84a2f',flexShrink:0}}/>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* RIGHT — Form (full width on mobile) */}
      <div style={{flex:isMobile?'1':'0 0 520px',display:'flex',alignItems:'center',justifyContent:'center',padding:isMobile?'24px 14px':'40px 56px',position:'relative',zIndex:2}}>
        <div style={{width:'100%',maxWidth:isMobile?440:'none'}}>
          {/* Mobile-only mini logo header */}
          {isMobile && (
            <div style={{textAlign:'center',marginBottom:18}}>
              <div style={{fontSize:36,marginBottom:4}}>🥊</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,letterSpacing:'0.04em',color:'#f0ece8',lineHeight:1}}>
                HIT<span style={{color:'#e84a2f'}}>TRACK</span>
              </div>
            </div>
          )}
          <div style={{background:'rgba(20,17,17,0.92)',borderRadius:20,border:'1px solid rgba(255,255,255,0.08)',boxShadow:'0 32px 80px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.05)',padding:isMobile?'28px 22px':'40px 36px',backdropFilter:'blur(16px)'}}>

            {verifyEmail ? (
              <CheckEmailPanel
                email={verifyEmail} sent={verifySent} cooldown={cooldown}
                resending={resending} resendMsg={resendMsg}
                onResend={handleResend} onLogin={() => navigate('/login?registered=1')}/>
            ) : (<>
            <div style={{marginBottom:24}}>
              <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:6}}>Create Account</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:'#f0ece8',letterSpacing:'0.06em',lineHeight:1}}>JOIN WILD BOUT GYM</div>
            </div>

            {/* Coaching staff are onboarded by an admin, not through public signup. */}
            <div style={{background:'rgba(66,165,245,0.08)',border:'1px solid rgba(66,165,245,0.2)',borderRadius:10,padding:'10px 14px',fontSize:11,color:'#42a5f5',marginBottom:16,lineHeight:1.7}}>
              ℹ️ Applying as a <strong>coach</strong>? Coach accounts are created by the gym admin — please speak with the front desk.
            </div>

            {error &&<div style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#e84a2f',fontWeight:600,marginBottom:16}}>⚠ {error}</div>}

            <form onSubmit={handleSignup} style={{display:'flex',flexDirection:'column',gap:14}}>
              {fields.map(f => {
                const hasErr = touched[f.field] && fieldErrors[f.field]
                const borderColor = hasErr ? '#e84a2f' : 'rgba(255,255,255,0.08)'
                return (
                  <div key={f.field}>
                    <label style={{fontSize:10,fontWeight:700,color:'#555',letterSpacing:'0.1em',textTransform:'uppercase',display:'flex',alignItems:'center',gap:6,marginBottom:6}}>
                      {f.label}
                      {f.optional && <span style={{fontSize:9,fontWeight:500,color:'#444',letterSpacing:'0.04em',textTransform:'none'}}>(optional)</span>}
                    </label>
                    <div style={{display:'flex',alignItems:'center',background:'rgba(255,255,255,0.04)',border:`1.5px solid ${borderColor}`,borderRadius:10,padding:'11px 14px',transition:'border-color 0.2s',gap:8}}
                      onFocus={e => { if (!hasErr) e.currentTarget.style.borderColor='#e84a2f' }}
                      onBlur={e => { e.currentTarget.style.borderColor = (touched[f.field] && fieldErrors[f.field]) ? '#e84a2f' : 'rgba(255,255,255,0.08)' }}>
                      <input type={f.field==='password'?(showPw?'text':'password'):f.field==='confirm'?(showConfirm?'text':'password'):f.type} placeholder={f.ph} value={form[f.field]}
                        {...(f.field === 'dob' ? { min: minDOBStr, max: maxDOBStr } : {})}
                        onChange={e => update(f.field, e.target.value)}
                        onBlur={() => handleBlur(f.field)}
                        style={{flex:1,background:'none',border:'none',outline:'none',color:'#f0ece8',fontSize:13,fontFamily:"'Montserrat',sans-serif",colorScheme:'dark'}}/>
                      {(f.field==='password'||f.field==='confirm') && (
                        <button type="button" tabIndex={-1}
                          onClick={()=>f.field==='password'?setShowPw(v=>!v):setShowConfirm(v=>!v)}
                          style={{background:'none',border:'none',cursor:'pointer',fontSize:15,opacity:0.4,flexShrink:0,padding:0,lineHeight:1,transition:'opacity 0.2s'}}
                          onMouseEnter={e=>e.currentTarget.style.opacity='0.8'}
                          onMouseLeave={e=>e.currentTarget.style.opacity='0.4'}>
                          {(f.field==='password'?showPw:showConfirm)?'🙈':'👁'}
                        </button>
                      )}
                    </div>
                    {hasErr && (
                      <div style={{fontSize:11,color:'#e84a2f',marginTop:5,paddingLeft:2,display:'flex',alignItems:'center',gap:4}}>
                        <span style={{fontSize:12}}>⚠</span> {fieldErrors[f.field]}
                      </div>
                    )}

                    {/* Phone digit counter — Issue #12, matches mobile UX */}
                    {f.field === 'phone' && form.phone && (() => {
                      const n = rawDigits(form.phone).length
                      const ok = n >= PHONE_MIN_DIGITS && n <= PHONE_MAX_DIGITS
                      const color = !form.phone ? '#555' : ok ? '#22c55e' : (n > PHONE_MAX_DIGITS ? '#e84a2f' : '#888')
                      return (
                        <div style={{fontSize:10,color,marginTop:5,paddingLeft:2,letterSpacing:'0.02em'}}>
                          {n}/{PHONE_MAX_DIGITS} digits
                        </div>
                      )
                    })()}

                    {/* Minor warning — members only (Issue #11). The parent/guardian
                        training-waiver rule does not apply to coach signups. */}
                    {f.field === 'dob' && isMinor && !hasErr && (
                      <div style={{
                        marginTop:8,padding:'10px 12px',
                        background:'rgba(245,200,66,0.08)',
                        border:'1px solid rgba(245,200,66,0.3)',
                        borderRadius:8,fontSize:11,color:'#f5c842',lineHeight:1.55
                      }}>
                        <strong>⚠ You're {currentAge} — under 18.</strong> A parent
                        or guardian must sign a consent waiver at the gym before
                        your first training session.
                      </div>
                    )}

                    {/* Password strength meter */}
                    {f.field === 'password' && form.password && (
                      <div style={{marginTop:8}}>
                        <div style={{display:'flex',gap:4,marginBottom:4}}>
                          {[1,2,3,4,5].map(i => (
                            <div key={i} style={{
                              flex:1, height:4, borderRadius:2,
                              background: i <= strength.score ? strength.color : 'rgba(255,255,255,0.06)',
                              transition:'background 0.3s ease',
                            }}/>
                          ))}
                        </div>
                        <div style={{fontSize:10,color:strength.color,fontWeight:600,letterSpacing:'0.06em',transition:'color 0.3s ease'}}>
                          {strength.label}
                          {strength.score <= 2 && <span style={{color:'#555',fontWeight:400,marginLeft:6}}>— try adding uppercase, numbers, or symbols</span>}
                        </div>
                        {/* Live requirements checklist */}
                        <div style={{display:'flex',flexWrap:'wrap',gap:'4px 12px',marginTop:6}}>
                          {[
                            { ok: form.password.length >= 8,             text: '8+ characters' },
                            { ok: /[A-Z]/.test(form.password),           text: '1 uppercase' },
                            { ok: /[0-9]/.test(form.password),           text: '1 number' },
                            { ok: /[^A-Za-z0-9]/.test(form.password),    text: '1 special character' },
                          ].map((r,i) => (
                            <span key={i} style={{fontSize:10,fontWeight:600,color: r.ok ? '#22c55e' : '#777',transition:'color 0.2s'}}>
                              {r.ok ? '✓' : '○'} {r.text}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}

              <button type="submit" disabled={loading}
                style={{background:'#e84a2f',color:'#fff',border:'none',borderRadius:10,padding:'14px',fontSize:14,fontWeight:700,cursor:'pointer',letterSpacing:'0.04em',boxShadow:'0 6px 24px rgba(232,74,47,0.4)',opacity:loading?0.7:1,transition:'all 0.2s',marginTop:6}}
                onMouseEnter={e=>{if(!loading)e.target.style.background='#d43d24'}}
                onMouseLeave={e=>e.target.style.background='#e84a2f'}>
                {loading?'Creating Account...':'Create Member Account'}
              </button>
            </form>

            <div style={{textAlign:'center',marginTop:18,fontSize:12,color:'#555'}}>
              Already have an account?{' '}
              <span style={{color:'#e84a2f',fontWeight:700,cursor:'pointer'}} onClick={()=>navigate('/login')}>Sign In</span>
            </div>
            </>)}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes gloveFloat{0%,100%{transform:translateY(0) rotate(-8deg)}50%{transform:translateY(-14px) rotate(8deg)}}
        @keyframes chevPulse{0%,100%{opacity:0.18}50%{opacity:0.5}}
        input::placeholder{color:#444}
      `}</style>
    </div>
  )
}

// Shown in place of the form once the account exists: where the link went, how
// to find it, and a paced Resend button for when it never arrives.
function CheckEmailPanel({ email, sent, cooldown, resending, resendMsg, onResend, onLogin }) {
  const isGmail   = /@(gmail|googlemail)\.com$/i.test(email)
  const canResend = !resending && cooldown <= 0
  const ok        = resendMsg.startsWith('success')
  return (
    <div>
      <div style={{textAlign:'center',marginBottom:22}}>
        <div style={{fontSize:44,marginBottom:10}}>📧</div>
        <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:6}}>Account Created · One Last Step</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:'#f0ece8',letterSpacing:'0.06em',lineHeight:1}}>VERIFY YOUR EMAIL</div>
        <div style={{fontSize:12,color:'#8a847f',marginTop:12,lineHeight:1.7}}>
          {sent ? 'We sent a verification link to' : 'Your account is ready, but the verification email could not be sent to'}
          <div style={{color:'#f0ece8',fontWeight:700,fontSize:13,marginTop:2,wordBreak:'break-all'}}>{email}</div>
        </div>
      </div>

      {!sent && !resendMsg && (
        <div style={{background:'rgba(245,200,66,0.08)',border:'1px solid rgba(245,200,66,0.3)',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#f5c842',fontWeight:600,marginBottom:16,lineHeight:1.6}}>
          ⚠ Tap <strong>Resend verification email</strong> below to get your link.
        </div>
      )}

      <div style={{display:'flex',flexDirection:'column',gap:10,marginBottom:18}}>
        {['Open your email inbox', 'Click the verification link in the email', 'Come back here and sign in'].map((t, i) => (
          <div key={i} style={{display:'flex',alignItems:'center',gap:12,fontSize:12,color:'#c9c3bd'}}>
            <div style={{width:24,height:24,borderRadius:'50%',background:'rgba(232,74,47,0.12)',border:'1px solid rgba(232,74,47,0.35)',color:'#e84a2f',fontSize:11,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',flexShrink:0}}>{i + 1}</div>
            {t}
          </div>
        ))}
      </div>

      {isGmail && (
        <a href="https://mail.google.com/" target="_blank" rel="noopener noreferrer"
          style={{display:'block',textAlign:'center',background:'rgba(255,255,255,0.04)',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'12px',fontSize:13,fontWeight:700,color:'#f0ece8',textDecoration:'none',marginBottom:16}}>
          Open Gmail ↗
        </a>
      )}

      <div style={{background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.07)',borderRadius:12,padding:'12px 14px',marginBottom:16}}>
        <div style={{fontSize:10,fontWeight:700,color:'#777',letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:8}}>Didn't get it?</div>
        {[
          'Check your Spam and Promotions folders',
          'Search your inbox for “verify”',
          'Give it a minute or two to arrive',
          'Wrong email address? Ask the front desk to fix it',
        ].map((t, i) => (
          <div key={i} style={{fontSize:11,color:'#8a847f',lineHeight:1.8}}>• {t}</div>
        ))}
      </div>

      {resendMsg && (
        <div style={{background:ok?'rgba(74,222,128,0.1)':'rgba(232,74,47,0.1)',border:`1px solid ${ok?'rgba(74,222,128,0.25)':'rgba(232,74,47,0.25)'}`,borderRadius:10,padding:'10px 14px',fontSize:12,fontWeight:600,marginBottom:14,lineHeight:1.6,color:ok?'#4ade80':'#e84a2f'}}>
          {ok ? '✅' : '⚠'} {resendMsg.split(':').slice(1).join(':')}
        </div>
      )}

      <div style={{display:'flex',flexDirection:'column',gap:10}}>
        <button type="button" onClick={onResend} disabled={!canResend}
          style={{background:'rgba(66,165,245,0.08)',border:'1px solid rgba(66,165,245,0.3)',borderRadius:10,padding:'12px 14px',fontSize:13,color:'#42a5f5',fontWeight:700,cursor:canResend?'pointer':'default',opacity:canResend?1:0.55,transition:'all 0.2s'}}>
          {resending ? 'Sending...' : cooldown > 0 ? `Resend available in ${cooldown}s` : '📧 Resend verification email'}
        </button>
        <button type="button" onClick={onLogin}
          style={{background:'#e84a2f',color:'#fff',border:'none',borderRadius:10,padding:'14px',fontSize:14,fontWeight:700,cursor:'pointer',letterSpacing:'0.04em',boxShadow:'0 6px 24px rgba(232,74,47,0.4)'}}>
          I've Verified — Go to Login
        </button>
      </div>
    </div>
  )
}

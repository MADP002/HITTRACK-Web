import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword } from 'firebase/auth'
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
const PHONE_RE = /^(\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}$/

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
    'auth/weak-password': 'Password is too weak. Use at least 6 characters with a mix of letters and numbers.',
    'auth/operation-not-allowed': 'Email/password signup is currently disabled. Contact the gym admin.',
    'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
    'auth/network-request-failed': 'Network error. Check your internet connection and try again.',
  }
  return map[code] || 'Signup failed. Please try again.'
}

export default function Signup() {
  const navigate  = useNavigate()
  const canvasRef = useRef(null)
  const isMobile  = useIsMobile()
  const [form, setForm]       = useState({ name:'', email:'', password:'', confirm:'', phone:'', dob:'' })
  const [role, setRole]       = useState('member')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [touched, setTouched] = useState({})
  const [showPw, setShowPw] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)

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
        if (value.trim() && !PHONE_RE.test(value.trim())) err = 'Enter a valid phone number (e.g. 09171234567).'
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
        if (value && value.length < 6) err = 'Must be at least 6 characters.'
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
    if (form.phone.trim() && !PHONE_RE.test(form.phone.trim())) errs.phone = 'Enter a valid phone number.'
    if (!form.password) errs.password = 'Password is required.'
    else if (form.password.length < 6) errs.password = 'Must be at least 6 characters.'
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

      const userData = {
        uid: cred.user.uid, name: form.name.trim(), email: normalizedEmail,
        dob: form.dob,                              // YYYY-MM-DD string
        ageAtSignup: computeAge(form.dob),          // snapshot — convenient for analytics
        createdAt: serverTimestamp(),
      }
      if (form.phone.trim()) userData.phone = form.phone.trim()

      if (role === 'coach') {
        await setDoc(doc(db, 'users', cred.user.uid), {
          ...userData,
          role: 'coach_pending',
          approved: false, programSetupDone: true,
          // Coaches don't have memberships — they're staff, not paying members.
        })
        await auth.signOut()
        navigate('/login?pending=1')
      } else {
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
        navigate('/login?registered=1')
      }
    } catch (err) {
      setError(firebaseErrorMessage(err.code))
      setLoading(false)
    }
  }

  const strength = getPasswordStrength(form.password)

  const fields = [
    { field:'name',     label:'Full Name',        type:'text',     ph:'e.g. Lowell Aguinaldo' },
    { field:'email',    label:'Email Address',     type:'email',    ph:'your@email.com' },
    { field:'dob',      label:'Date of Birth',     type:'date',     ph:'YYYY-MM-DD' },
    { field:'phone',    label:'Phone Number',      type:'tel',      ph:'e.g. 09171234567', optional:true },
    { field:'password', label:'Password',          type:'password', ph:'Min. 6 characters' },
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

            <div style={{marginBottom:24}}>
              <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:6}}>Create Account</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:'#f0ece8',letterSpacing:'0.06em',lineHeight:1}}>JOIN WILD BOUT GYM</div>
            </div>

            {/* Role selector */}
            <div style={{display:'flex',gap:8,marginBottom:20,background:'rgba(255,255,255,0.03)',borderRadius:12,padding:4,border:'1px solid rgba(255,255,255,0.06)'}}>
              {[{id:'member',label:'👊 Member'},{id:'coach',label:'🥊 Coach'}].map(r=>(
                <button key={r.id} type="button" onClick={()=>setRole(r.id)}
                  style={{flex:1,padding:'10px',borderRadius:10,border:'none',fontSize:12,fontWeight:700,cursor:'pointer',transition:'all 0.2s',letterSpacing:'0.04em',
                    background:role===r.id?'#e84a2f':'transparent',
                    color:role===r.id?'#fff':'#555',
                    boxShadow:role===r.id?'0 4px 12px rgba(232,74,47,0.4)':'none'}}>
                  {r.label}
                </button>
              ))}
            </div>

            {role==='coach'&&(
              <div style={{background:'rgba(66,165,245,0.08)',border:'1px solid rgba(66,165,245,0.2)',borderRadius:10,padding:'10px 14px',fontSize:11,color:'#42a5f5',marginBottom:16,lineHeight:1.7}}>
                ℹ️ Coach accounts require <strong>admin approval</strong> before you can log in. You'll be notified once approved.
              </div>
            )}

            {error && <div style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:10,padding:'10px 14px',fontSize:12,color:'#e84a2f',fontWeight:600,marginBottom:16}}>⚠ {error}</div>}

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

                    {/* Minor warning — shown when DOB is valid but member is 13-17 */}
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
                      </div>
                    )}
                  </div>
                )
              })}

              <button type="submit" disabled={loading}
                style={{background:'#e84a2f',color:'#fff',border:'none',borderRadius:10,padding:'14px',fontSize:14,fontWeight:700,cursor:'pointer',letterSpacing:'0.04em',boxShadow:'0 6px 24px rgba(232,74,47,0.4)',opacity:loading?0.7:1,transition:'all 0.2s',marginTop:6}}
                onMouseEnter={e=>{if(!loading)e.target.style.background='#d43d24'}}
                onMouseLeave={e=>e.target.style.background='#e84a2f'}>
                {loading?'Creating Account...':`Create ${role==='coach'?'Coach':'Member'} Account`}
              </button>
            </form>

            <div style={{textAlign:'center',marginTop:18,fontSize:12,color:'#555'}}>
              Already have an account?{' '}
              <span style={{color:'#e84a2f',fontWeight:700,cursor:'pointer'}} onClick={()=>navigate('/login')}>Sign In</span>
            </div>
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

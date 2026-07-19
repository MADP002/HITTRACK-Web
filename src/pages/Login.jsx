import { useState, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { signInWithEmailAndPassword, signOut, sendPasswordResetEmail, sendEmailVerification } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useIsMobile } from '../lib/useIsMobile'
import { clearAppStorageKeepTheme } from '../lib/theme'

export default function Login() {
  const navigate   = useNavigate()
  const [params]   = useSearchParams()
  const canvasRef  = useRef(null)
  const isMobile   = useIsMobile()
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [success,  setSuccess]  = useState(params.get('registered') === '1')
  const [pending]              = useState(params.get('pending') === '1')
  const [showPw, setShowPw]         = useState(false)
  // Email-verification state (holds creds so we can resend after a blocked login)
  const [unverifiedCreds, setUnverifiedCreds] = useState(null)
  const [resendMsg, setResendMsg] = useState('')
  const [showReset, setShowReset]   = useState(false)
  const [resetEmail, setResetEmail] = useState('')
  const [resetStatus, setResetStatus] = useState('')
  const [resetLoading, setResetLoading] = useState(false)

  async function handlePasswordReset(e) {
    e.preventDefault()
    const trimmed = resetEmail.trim().toLowerCase()
    if (!trimmed) { setResetStatus('error:Please enter your email address.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setResetStatus('error:Please enter a valid email address.'); return }
    setResetLoading(true); setResetStatus('')
    try {
      await sendPasswordResetEmail(auth, trimmed)
      setResetStatus('success:Reset link sent! Check your inbox (and spam folder).')
      setResetLoading(false)
    } catch (err) {
      const msgs = {
        'auth/user-not-found': 'No account found with this email.',
        'auth/invalid-email': 'Please enter a valid email address.',
        'auth/too-many-requests': 'Too many requests. Please wait a few minutes and try again.',
        'auth/network-request-failed': 'Network error. Check your connection and try again.',
      }
      setResetStatus('error:' + (msgs[err.code] || 'Something went wrong. Please try again.'))
      setResetLoading(false)
    }
  }

  // Resend the email-verification link. We re-authenticate briefly to get a
  // fresh user object, send the link, then sign back out.
  async function handleResendVerification() {
    if (!unverifiedCreds) return
    setLoading(true); setResendMsg('')
    try {
      const cred = await signInWithEmailAndPassword(auth, unverifiedCreds.email, unverifiedCreds.password)
      await sendEmailVerification(cred.user)
      await signOut(auth)
      setResendMsg('success:A new verification link was sent to ' + unverifiedCreds.email + '. Open it, then log in.')
    } catch (err) {
      setResendMsg('error:Could not resend right now. Please try logging in again to resend the verification email.')
    } finally { setLoading(false) }
  }

  useEffect(() => { signOut(auth).catch(() => {}); clearAppStorageKeepTheme() }, [])

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); let animId, t = 0
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize(); window.addEventListener('resize', resize)
    const particles = Array.from({ length: 25 }, () => ({
      x: Math.random(), y: Math.random(),
      vx: (Math.random() - 0.5) * 0.0002, vy: (Math.random() - 0.5) * 0.0002,
      r: Math.random() * 1.5 + 0.5,
      warm: Math.random() > 0.5,
    }))
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); t += 0.01
      particles.forEach(p => {
        p.x = (p.x + p.vx + 1) % 1; p.y = (p.y + p.vy + 1) % 1
        const a = 0.15 + Math.sin(t + p.x * 8) * 0.08
        ctx.beginPath()
        ctx.arc(p.x * canvas.width, p.y * canvas.height, p.r, 0, Math.PI * 2)
        ctx.fillStyle = p.warm ? `rgba(232,74,47,${a})` : `rgba(245,180,66,${a})`
        ctx.fill()
      })
      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [])

  async function handleLogin(e) {
    e.preventDefault()
    if (!email || !password) { setError('Please fill in all fields.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) { setError('Please enter a valid email address.'); return }
    setLoading(true); setError('')
    try {
      const cred = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password)
      const snap = await getDoc(doc(db, 'users', cred.user.uid))
      if (!snap.exists()) { setError('Account not found.'); setLoading(false); return }
      const data = snap.data()

      // ── Email verification gate — enforced ONLY for accounts flagged at signup
      // (existing users have no flag, so they're never locked out). ──
      if (data.requiresEmailVerification && !cred.user.emailVerified) {
        setUnverifiedCreds({ email: email.trim().toLowerCase(), password })
        await signOut(auth)
        setError('Please verify your email before logging in — check your inbox (and spam) for the verification link.')
        setLoading(false); return
      }
      setUnverifiedCreds(null)

      if (data.role === 'admin') { navigate('/admin'); return }
      if (data.role === 'coach') { navigate('/coach'); return }
      if (data.role === 'coach_pending') {
        await signOut(auth)
        setError('Your coach application is still pending admin approval. You\'ll be able to log in once approved.')
        setLoading(false); return
      }
      if (data.role === 'coach_rejected') {
        await signOut(auth)
        setError('Your coach application was not approved. Please contact the gym admin for more info.')
        setLoading(false); return
      }

      // Create initial stats doc if missing — so member appears on leaderboard
      if (data.role !== 'coach' && data.role !== 'admin' && data.name) {
        try {
          const { setDoc, doc: fsDoc, getDoc: fsGetDoc } = await import('firebase/firestore')
          const statsRef = fsDoc(db, 'stats', cred.user.uid)
          const statsSnap = await fsGetDoc(statsRef)
          if (!statsSnap.exists()) {
            await setDoc(statsRef, {
              uid:          cred.user.uid,
              name:         data.name,
              goal:         data.goal || 'Learn Boxing',
              experience:   data.experience || 'Beginner',
              currentLevel: data.experience || 'Beginner',
              totalWorkouts: 0,
              streak:        0,
              weeklyPct:     0,
              updatedAt:     new Date().toISOString(),
            })
          }
        } catch(e) { console.warn('Stats init skipped:', e.message) }
      }

      navigate(data.programSetupDone ? '/home' : '/program-builder')
    } catch (err) {
      const messages = {
        'auth/invalid-credential': 'Invalid email or password. Please double-check and try again.',
        'auth/wrong-password': 'Incorrect password. Please try again or reset your password.',
        'auth/user-not-found': 'No account found with this email. Need to sign up first?',
        'auth/user-disabled': 'This account has been disabled. Contact the gym admin for help.',
        'auth/too-many-requests': 'Too many failed attempts. Please wait a few minutes before trying again.',
        'auth/network-request-failed': 'Network error. Check your internet connection and try again.',
        'auth/invalid-email': 'Please enter a valid email address.',
      }
      setError(messages[err.code] || 'Login failed. Please try again.'); setLoading(false)
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:'#0f0d0d', display:'flex', position:'relative', overflow:'hidden', fontFamily:"'Montserrat',sans-serif" }}>
      <canvas ref={canvasRef} style={{ position:'fixed', inset:0, width:'100%', height:'100%', zIndex:0, pointerEvents:'none' }}/>

      {/* Corner Chevrons */}
      <CornerChevs pos="top-left"/>
      <CornerChevs pos="top-right"/>
      <CornerChevs pos="bottom-left"/>
      <CornerChevs pos="bottom-right"/>

      {/* ── LEFT PANEL — Form ── */}
      <div style={{
        flex: isMobile ? '1' : '0 0 560px',
        display:'flex', alignItems:'center', justifyContent:'center',
        padding: isMobile ? '24px 14px' : '60px 80px',
        position:'relative', zIndex:2,
      }}>
        <div style={{ width:'100%', maxWidth: isMobile ? 440 : 'none' }}>

          {/* Mobile-only mini logo header */}
          {isMobile && (
            <div style={{textAlign:'center',marginBottom:18}}>
              <div style={{fontSize:36,marginBottom:4}}>🥊</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:30,letterSpacing:'0.04em',color:'#f0ece8',lineHeight:1}}>
                HIT<span style={{color:'#e84a2f'}}>TRACK</span>
              </div>
            </div>
          )}

          {/* Big form card */}
          <div style={{
            background:'rgba(20,17,17,0.92)',
            borderRadius:20,
            border:'1px solid rgba(255,255,255,0.08)',
            boxShadow:'0 32px 80px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.05)',
            padding: isMobile ? '28px 22px' : '44px 40px',
            backdropFilter:'blur(16px)',
          }}>
            {/* Card title */}
            <div style={{ marginBottom:32 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#e84a2f', letterSpacing:'0.15em', textTransform:'uppercase', marginBottom:6 }}>Welcome Back</div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:32, color:'#f0ece8', letterSpacing:'0.06em', lineHeight:1 }}>SIGN IN TO CONTINUE</div>
            </div>

            {success && (
              <div style={{ background:'rgba(74,222,128,0.1)', border:'1px solid rgba(74,222,128,0.25)', borderRadius:10, padding:'10px 14px', fontSize:12, color:'#4ade80', fontWeight:600, marginBottom:18, lineHeight:1.7 }}>
                ✅ Account created! We sent a verification link to your email — open it, then sign in.
              </div>
            )}
            {pending && (
              <div style={{ background:'rgba(66,165,245,0.08)', border:'1px solid rgba(66,165,245,0.2)', borderRadius:10, padding:'10px 14px', fontSize:12, color:'#42a5f5', fontWeight:600, marginBottom:18, lineHeight:1.7 }}>
                ℹ️ Coach account submitted! An admin will review and approve your application. You'll be able to log in once approved.
              </div>
            )}
            {error && (
              <div style={{ background:'rgba(232,74,47,0.1)', border:'1px solid rgba(232,74,47,0.25)', borderRadius:10, padding:'10px 14px', fontSize:12, color:'#e84a2f', fontWeight:600, marginBottom:18 }}>
                ⚠ {error}
              </div>
            )}
            {unverifiedCreds && (
              <button type="button" onClick={handleResendVerification} disabled={loading}
                style={{ width:'100%', display:'flex', alignItems:'center', justifyContent:'center', gap:8, background:'rgba(66,165,245,0.08)', border:'1px solid rgba(66,165,245,0.3)', borderRadius:10, padding:'11px 14px', fontSize:12, color:'#42a5f5', fontWeight:700, cursor:loading?'default':'pointer', marginBottom:14, opacity:loading?0.7:1, transition:'all 0.2s' }}
                onMouseEnter={e => { if(!loading) e.currentTarget.style.background='rgba(66,165,245,0.14)' }}
                onMouseLeave={e => e.currentTarget.style.background='rgba(66,165,245,0.08)'}>
                📧 Resend verification email
              </button>
            )}
            {resendMsg && (
              <div style={{
                background: resendMsg.startsWith('success') ? 'rgba(74,222,128,0.1)' : 'rgba(232,74,47,0.1)',
                border: `1px solid ${resendMsg.startsWith('success') ? 'rgba(74,222,128,0.25)' : 'rgba(232,74,47,0.25)'}`,
                borderRadius:10, padding:'10px 14px', fontSize:12, fontWeight:600, marginBottom:18, lineHeight:1.6,
                color: resendMsg.startsWith('success') ? '#4ade80' : '#e84a2f',
              }}>
                {resendMsg.startsWith('success') ? '✅' : '⚠'} {resendMsg.split(':').slice(1).join(':')}
              </div>
            )}

            <form onSubmit={handleLogin} style={{ display:'flex', flexDirection:'column', gap:16 }}>
              {/* Email */}
              <div>
                <label style={{ fontSize:10, fontWeight:700, color:'#555', letterSpacing:'0.1em', textTransform:'uppercase', display:'block', marginBottom:8 }}>Email / Username</label>
                <div style={s.fieldRow}>
                  <input style={s.field} type="email" placeholder="your@email.com"
                    value={email} onChange={e => setEmail(e.target.value)}
                    onFocus={e => e.target.closest('div').style.borderColor='#e84a2f'}
                    onBlur={e  => e.target.closest('div').style.borderColor='rgba(255,255,255,0.08)'}/>
                  <span style={s.fieldIcon}>👤</span>
                </div>
              </div>

              {/* Password */}
              <div>
                <label style={{ fontSize:10, fontWeight:700, color:'#555', letterSpacing:'0.1em', textTransform:'uppercase', display:'block', marginBottom:8 }}>Password</label>
                <div style={s.fieldRow}>
                  <input style={s.field} type={showPw ? 'text' : 'password'} placeholder="••••••••"
                    value={password} onChange={e => setPassword(e.target.value)}
                    onFocus={e => e.target.closest('div').style.borderColor='#e84a2f'}
                    onBlur={e  => e.target.closest('div').style.borderColor='rgba(255,255,255,0.08)'}/>
                  <button type="button" onClick={() => setShowPw(v => !v)} tabIndex={-1}
                    style={{ background:'none', border:'none', cursor:'pointer', fontSize:16, opacity:0.4, flexShrink:0, padding:0, lineHeight:1, transition:'opacity 0.2s' }}
                    onMouseEnter={e => e.currentTarget.style.opacity='0.8'}
                    onMouseLeave={e => e.currentTarget.style.opacity='0.4'}>
                    {showPw ? '🙈' : '👁'}
                  </button>
                </div>
              </div>

              <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:8 }}>
                <button type="submit" disabled={loading}
                  style={{ background:'#e84a2f', color:'#fff', border:'none', borderRadius:12, padding:'16px', fontSize:15, fontWeight:700, cursor:'pointer', letterSpacing:'0.04em', boxShadow:'0 6px 24px rgba(232,74,47,0.45)', opacity:loading?0.7:1, transition:'all 0.2s' }}
                  onMouseEnter={e => { if(!loading) e.target.style.background='#d43d24' }}
                  onMouseLeave={e => e.target.style.background='#e84a2f'}>
                  {loading ? 'Signing in...' : 'Login'}
                </button>

                <button type="button" onClick={() => navigate('/signup')}
                  style={{ background:'transparent', color:'#e84a2f', border:'2px solid #e84a2f', borderRadius:12, padding:'14px', fontSize:15, fontWeight:700, cursor:'pointer', letterSpacing:'0.04em', transition:'all 0.2s' }}
                  onMouseEnter={e => e.target.style.background='rgba(232,74,47,0.08)'}
                  onMouseLeave={e => e.target.style.background='transparent'}>
                  Signup
                </button>
              </div>
            </form>

            <div style={{ textAlign:'center', marginTop:20, fontSize:12, color:'#444', cursor:'pointer', letterSpacing:'0.02em' }}
              onClick={() => { setShowReset(true); setResetEmail(email); setResetStatus('') }}>
              Forgot Password?
            </div>
          </div>
        </div>
      </div>

      {/* ── RIGHT PANEL — Branding (hidden on mobile) ── */}
      {!isMobile && (
        <div style={{
          flex:1, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center',
          position:'relative', zIndex:2, padding:'60px 40px',
        }}>
        {/* Background glow */}
        <div style={{ position:'absolute', width:500, height:500, borderRadius:'50%', background:'radial-gradient(circle,rgba(232,74,47,0.1),transparent 68%)', pointerEvents:'none' }}/>

        <div style={{ position:'relative', zIndex:1, textAlign:'center' }}>
          {/* Main title */}
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:88, letterSpacing:'0.04em', lineHeight:1, color:'#f0ece8', textShadow:'0 0 80px rgba(232,74,47,0.25)' }}>
            HIT<span style={{ color:'#e84a2f', textShadow:'0 0 50px rgba(232,74,47,0.7)' }}>TRACK</span>
          </div>

          {/* Tagline */}
          <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:18, letterSpacing:'0.25em', color:'#e84a2f', marginTop:10, fontStyle:'italic', opacity:0.9 }}>
            Be an Inspiration
          </div>

          {/* Divider */}
          <div style={{ display:'flex', alignItems:'center', gap:14, margin:'28px auto', maxWidth:280 }}>
            <div style={{ flex:1, height:1, background:'linear-gradient(90deg,transparent,rgba(232,74,47,0.6))' }}/>
            <div style={{ width:8, height:8, borderRadius:'50%', background:'#e84a2f', boxShadow:'0 0 12px rgba(232,74,47,0.8)' }}/>
            <div style={{ flex:1, height:1, background:'linear-gradient(90deg,rgba(232,74,47,0.6),transparent)' }}/>
          </div>

          <div style={{ fontSize:11, color:'#555', letterSpacing:'0.14em', textTransform:'uppercase', marginBottom:32 }}>
            Wild Bout Boxing Gym · Member Portal
          </div>

          {/* Stats */}
          <div style={{ display:'flex', gap:14, justifyContent:'center' }}>
            {[{val:'40+',label:'Members'},{val:'2',label:'Coaches'},{val:'10+',label:'Classes'}].map((st,i) => (
              <div key={i} style={{ background:'rgba(232,74,47,0.07)', border:'1px solid rgba(232,74,47,0.2)', borderRadius:14, padding:'14px 20px', textAlign:'center', backdropFilter:'blur(8px)' }}>
                <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:30, color:'#e84a2f', lineHeight:1, textShadow:'0 0 16px rgba(232,74,47,0.4)' }}>{st.val}</div>
                <div style={{ fontSize:9, color:'#555', fontWeight:700, letterSpacing:'0.1em', marginTop:4, textTransform:'uppercase' }}>{st.label}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}

      {/* ── PASSWORD RESET MODAL ── */}
      {showReset && (
        <div style={{ position:'fixed', inset:0, zIndex:100, display:'flex', alignItems:'center', justifyContent:'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setShowReset(false); setResetStatus('') } }}>
          <div style={{ position:'absolute', inset:0, background:'rgba(0,0,0,0.7)', backdropFilter:'blur(6px)' }}/>
          <div style={{ position:'relative', width:420, background:'rgba(20,17,17,0.97)', borderRadius:20, border:'1px solid rgba(255,255,255,0.08)', boxShadow:'0 32px 80px rgba(0,0,0,0.7), inset 0 1px 0 rgba(255,255,255,0.05)', padding:'36px 32px', backdropFilter:'blur(16px)' }}>

            <button onClick={() => { setShowReset(false); setResetStatus('') }}
              style={{ position:'absolute', top:14, right:16, background:'none', border:'none', color:'#555', fontSize:20, cursor:'pointer', padding:4, lineHeight:1 }}
              onMouseEnter={e => e.currentTarget.style.color='#e84a2f'}
              onMouseLeave={e => e.currentTarget.style.color='#555'}>✕</button>

            <div style={{ marginBottom:24 }}>
              <div style={{ fontSize:11, fontWeight:700, color:'#e84a2f', letterSpacing:'0.15em', textTransform:'uppercase', marginBottom:6 }}>Account Recovery</div>
              <div style={{ fontFamily:"'Bebas Neue',sans-serif", fontSize:26, color:'#f0ece8', letterSpacing:'0.06em', lineHeight:1 }}>RESET YOUR PASSWORD</div>
              <div style={{ fontSize:12, color:'#555', marginTop:10, lineHeight:1.6 }}>
                Enter the email you signed up with. We'll send a link to reset your password.
              </div>
            </div>

            {resetStatus && (
              <div style={{
                background: resetStatus.startsWith('success') ? 'rgba(74,222,128,0.1)' : 'rgba(232,74,47,0.1)',
                border: `1px solid ${resetStatus.startsWith('success') ? 'rgba(74,222,128,0.25)' : 'rgba(232,74,47,0.25)'}`,
                borderRadius:10, padding:'10px 14px', fontSize:12, fontWeight:600, marginBottom:16, lineHeight:1.6,
                color: resetStatus.startsWith('success') ? '#4ade80' : '#e84a2f',
              }}>
                {resetStatus.startsWith('success') ? '✅' : '⚠'} {resetStatus.split(':').slice(1).join(':')}
              </div>
            )}

            <form onSubmit={handlePasswordReset} style={{ display:'flex', flexDirection:'column', gap:14 }}>
              <div>
                <label style={{ fontSize:10, fontWeight:700, color:'#555', letterSpacing:'0.1em', textTransform:'uppercase', display:'block', marginBottom:8 }}>Email Address</label>
                <div style={s.fieldRow}>
                  <input style={s.field} type="email" placeholder="your@email.com"
                    value={resetEmail} onChange={e => setResetEmail(e.target.value)}
                    onFocus={e => e.target.closest('div').style.borderColor='#e84a2f'}
                    onBlur={e => e.target.closest('div').style.borderColor='rgba(255,255,255,0.08)'}
                    autoFocus/>
                  <span style={s.fieldIcon}>📧</span>
                </div>
              </div>

              <button type="submit" disabled={resetLoading}
                style={{ background:'#e84a2f', color:'#fff', border:'none', borderRadius:12, padding:'14px', fontSize:14, fontWeight:700, cursor:'pointer', letterSpacing:'0.04em', boxShadow:'0 6px 24px rgba(232,74,47,0.4)', opacity:resetLoading?0.7:1, transition:'all 0.2s' }}
                onMouseEnter={e => { if(!resetLoading) e.target.style.background='#d43d24' }}
                onMouseLeave={e => e.target.style.background='#e84a2f'}>
                {resetLoading ? 'Sending...' : 'Send Reset Link'}
              </button>
            </form>

            <div style={{ textAlign:'center', marginTop:16, fontSize:12, color:'#555' }}>
              Remember your password?{' '}
              <span style={{ color:'#e84a2f', fontWeight:700, cursor:'pointer' }} onClick={() => { setShowReset(false); setResetStatus('') }}>Back to Login</span>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes chevPulse { 0%,100%{opacity:0.18} 50%{opacity:0.5} }
        input::placeholder { color: #444; }
      `}</style>
    </div>
  )
}

function CornerChevs({ pos }) {
  const isTop    = pos.startsWith('top')
  const isLeft   = pos.endsWith('left')
  const rows = 4, cols = 3

  const chevStyle = {
    width:13, height:13,
    borderRight:'2.5px solid #e84a2f',
    borderBottom:'2.5px solid #e84a2f',
  }

  // Base rotation: chevron ">" points down-right at 45deg rotation
  // Each corner needs different rotation
  const baseRot = isTop && isLeft  ? -45  // ↘
                : isTop && !isLeft  ? 225 // ↙ (flip horizontally = -45 + 90*3)
                : !isTop && isLeft  ? 135 // ↗
                :                    315 // ↖

  return (
    <div style={{
      position:'fixed',
      top:    isTop    ? 28  : 'auto',
      bottom: !isTop   ? 28  : 'auto',
      left:   isLeft   ? 28  : 'auto',
      right:  !isLeft  ? 28  : 'auto',
      display:'flex', flexDirection:'column', gap:6, zIndex:10,
    }}>
      {Array.from({ length:rows }, (_, r) => (
        <div key={r} style={{ display:'flex', gap:6, flexDirection: isLeft ? 'row' : 'row-reverse' }}>
          {Array.from({ length:cols }, (_, c) => (
            <div key={c} style={{
              ...chevStyle,
              transform:`rotate(${baseRot}deg)`,
              animation:`chevPulse ${1.4+c*0.25}s ease-in-out infinite ${(r*cols+c)*0.07}s`,
            }}/>
          ))}
        </div>
      ))}
    </div>
  )
}

const s = {
  fieldRow:  { display:'flex', alignItems:'center', background:'rgba(255,255,255,0.04)', border:'1.5px solid rgba(255,255,255,0.08)', borderRadius:12, padding:'13px 16px', transition:'border-color 0.2s', gap:10 },
  field:     { flex:1, background:'none', border:'none', outline:'none', color:'#f0ece8', fontSize:14, fontFamily:"'Montserrat',sans-serif" },
  fieldIcon: { fontSize:16, opacity:0.35, flexShrink:0 },
}


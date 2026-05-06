import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { createUserWithEmailAndPassword } from 'firebase/auth'
import { doc, setDoc, serverTimestamp } from 'firebase/firestore'
import { auth, db } from '../firebase'

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

export default function Signup() {
  const navigate  = useNavigate()
  const canvasRef = useRef(null)
  const [form, setForm]       = useState({ name:'', email:'', password:'', confirm:'' })
  const [role, setRole]       = useState('member')
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState('')

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

  function update(field, val) { setForm(f=>({...f,[field]:val})) }

  async function handleSignup(e) {
    e.preventDefault()
    if (!form.name||!form.email||!form.password) { setError('Please fill in all fields'); return }
    if (form.password !== form.confirm) { setError('Passwords do not match'); return }
    if (form.password.length < 6) { setError('Password must be at least 6 characters'); return }
    setLoading(true); setError('')
    try {
      const cred = await createUserWithEmailAndPassword(auth, form.email, form.password)

      if (role === 'coach') {
        // Coach signup — needs admin approval
        await setDoc(doc(db, 'users', cred.user.uid), {
          uid: cred.user.uid, name: form.name.trim(), email: form.email.trim(),
          role: 'coach_pending', // pending until admin approves
          approved: false, programSetupDone: true,
          createdAt: serverTimestamp(),
        })
        await auth.signOut()
        navigate('/login?pending=1')
      } else {
        // Member signup
        await setDoc(doc(db, 'users', cred.user.uid), {
          uid: cred.user.uid, name: form.name.trim(), email: form.email.trim(),
          role: 'member', status: 'active', programSetupDone: false,
          createdAt: serverTimestamp(),
        })
        await auth.signOut()
        navigate('/login?registered=1')
      }
    } catch (err) {
      if (err.code==='auth/email-already-in-use') setError('This email is already registered.')
      else if (err.code==='auth/invalid-email') setError('Invalid email address.')
      else setError('Signup failed. Please try again.')
      setLoading(false)
    }
  }

  return (
    <div style={{minHeight:'100vh',background:'#0f0d0d',display:'flex',position:'relative',overflow:'hidden',fontFamily:"'Montserrat',sans-serif"}}>
      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',zIndex:0,pointerEvents:'none'}}/>
      <CornerChevs pos="top-left"/><CornerChevs pos="top-right"/>
      <CornerChevs pos="bottom-left"/><CornerChevs pos="bottom-right"/>

      {/* LEFT — Branding */}
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
          {/* Perks */}
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

      {/* RIGHT — Form */}
      <div style={{flex:'0 0 520px',display:'flex',alignItems:'center',justifyContent:'center',padding:'40px 56px',position:'relative',zIndex:2}}>
        <div style={{width:'100%'}}>
          <div style={{background:'rgba(20,17,17,0.92)',borderRadius:20,border:'1px solid rgba(255,255,255,0.08)',boxShadow:'0 32px 80px rgba(0,0,0,0.6),inset 0 1px 0 rgba(255,255,255,0.05)',padding:'40px 36px',backdropFilter:'blur(16px)'}}>

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
              {[
                {field:'name',    label:'Full Name',        type:'text',     ph:'e.g. Lowell Aguinaldo'},
                {field:'email',   label:'Email Address',    type:'email',    ph:'your@email.com'},
                {field:'password',label:'Password',         type:'password', ph:'Min. 6 characters'},
                {field:'confirm', label:'Confirm Password', type:'password', ph:'Repeat password'},
              ].map(f=>(
                <div key={f.field}>
                  <label style={{fontSize:10,fontWeight:700,color:'#555',letterSpacing:'0.1em',textTransform:'uppercase',display:'block',marginBottom:6}}>{f.label}</label>
                  <div style={{display:'flex',alignItems:'center',background:'rgba(255,255,255,0.04)',border:'1.5px solid rgba(255,255,255,0.08)',borderRadius:10,padding:'11px 14px',transition:'border-color 0.2s',gap:8}}
                    onFocus={e=>e.currentTarget.style.borderColor='#e84a2f'}
                    onBlur={e=>e.currentTarget.style.borderColor='rgba(255,255,255,0.08)'}>
                    <input type={f.type} placeholder={f.ph} value={form[f.field]} onChange={e=>update(f.field,e.target.value)}
                      style={{flex:1,background:'none',border:'none',outline:'none',color:'#f0ece8',fontSize:13,fontFamily:"'Montserrat',sans-serif"}}/>
                  </div>
                </div>
              ))}

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

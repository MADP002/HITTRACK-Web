import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, onSnapshot, addDoc, serverTimestamp } from 'firebase/firestore'
import { db } from '../firebase'
import Navbar from '../components/Navbar'

const glass = (extra={}) => ({
  background:'linear-gradient(135deg,rgba(30,28,28,0.97),rgba(18,16,16,0.99))',
  borderRadius:20, border:'1px solid rgba(245,200,66,0.15)',
  boxShadow:'0 8px 40px rgba(0,0,0,0.5),inset 0 1px 0 rgba(245,200,66,0.08)',
  overflow:'hidden', ...extra,
})

function AnimNum({ target, suffix='', duration=1200 }) {
  const [val,setVal]=useState(0)
  const num = parseInt(target, 10)
  useEffect(()=>{
    if(isNaN(num))return
    let frame; const start=Date.now()
    const tick=()=>{
      const p=Math.min((Date.now()-start)/duration,1)
      setVal(Math.round(num*(1-Math.pow(1-p,3))))
      if(p<1) frame=requestAnimationFrame(tick)
    }
    frame=requestAnimationFrame(tick)
    return()=>cancelAnimationFrame(frame)
  },[num])
  return isNaN(num)?<>{target}</>:<>{val}{suffix}</>
}

function EmptyBlock({ icon, title, hint }) {
  return (
    <div style={{...glass({borderRadius:18}),padding:'36px 28px',textAlign:'center'}}>
      <div style={{fontSize:36,marginBottom:10,opacity:0.35}}>{icon}</div>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#888',letterSpacing:'0.06em',marginBottom:6}}>{title}</div>
      <div style={{fontSize:11,color:'#555',lineHeight:1.6}}>{hint}</div>
    </div>
  )
}

export default function AboutUs() {
  const canvasRef = useRef(null)
  const navigate = useNavigate()
  const [mounted, setMounted] = useState(false)
  const profile = (() => { try{return JSON.parse(localStorage.getItem('hittrack_profile')||'{}')}catch{return{}} })()

  const [gymConfig, setGymConfig] = useState(null)
  const [configLoading, setConfigLoading] = useState(true)
  const [coachProfiles, setCoachProfiles] = useState([])
  const [statsLoading, setStatsLoading] = useState(true)
  const [statCounts, setStatCounts] = useState({ members:null, coaches:null, classes:null })
  const [contactForm, setContactForm] = useState({ name:'', email:'', message:'' })
  const [contactStatus, setContactStatus] = useState('idle')

  useEffect(()=>{ const t=setTimeout(()=>setMounted(true),100); return()=>clearTimeout(t) },[])

  // Live gym config from Firestore (About page content + contact info)
  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'gymConfig', 'main'),
      (snap) => {
        setGymConfig(snap.exists() ? snap.data() : null)
        setConfigLoading(false)
      },
      (e) => {
        console.warn('gymConfig listener:', e)
        setConfigLoading(false)
      }
    )
    return () => unsub()
  }, [])

  // Live counts: members, coaches, classes
  useEffect(() => {
    let cancelled = false
    async function loadCounts() {
      try {
        const usersSnap = await getDocs(collection(db, 'users'))
        const all = usersSnap.docs.map(d => ({ uid:d.id, ...d.data() }))
        const coaches = all.filter(u => u.role === 'coach')
        if (!cancelled) {
          setCoachProfiles(coaches)
          setStatCounts(p => ({
            ...p,
            members: all.filter(u => u.role === 'member' && u.status !== 'inactive').length,
            coaches: coaches.length,
          }))
        }
      } catch (e) {
        console.warn('users load:', e)
      }

      try {
        const clsSnap = await getDocs(collection(db, 'classes'))
        if (!cancelled) setStatCounts(p => ({ ...p, classes: clsSnap.size }))
      } catch (e) {
        console.warn('classes load:', e)
      }

      if (!cancelled) setStatsLoading(false)
    }
    loadCounts()
    return () => { cancelled = true }
  }, [])

  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas)return
    const ctx=canvas.getContext('2d'); let animId,t=0
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight}
    resize(); window.addEventListener('resize',resize)
    const draw=()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height); t+=0.004
      ctx.strokeStyle='rgba(245,200,66,0.025)'; ctx.lineWidth=1
      const g=80
      for(let x=0;x<canvas.width+g;x+=g){const o=(t*12)%g;ctx.beginPath();ctx.moveTo(x-o,0);ctx.lineTo(x-o,canvas.height);ctx.stroke()}
      for(let y=0;y<canvas.height+g;y+=g){const o=(t*7)%g;ctx.beginPath();ctx.moveTo(0,y-o);ctx.lineTo(canvas.width,y-o);ctx.stroke()}
      const orbs=[
        {x:canvas.width*0.05,y:canvas.height*0.1, r:300,c:'rgba(232,74,47,0.05)'},
        {x:canvas.width*0.95,y:canvas.height*0.4, r:280,c:'rgba(245,200,66,0.04)'},
        {x:canvas.width*0.5, y:canvas.height*0.9, r:260,c:'rgba(192,132,252,0.03)'},
      ]
      orbs.forEach(o=>{
        const grd=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r)
        grd.addColorStop(0,o.c);grd.addColorStop(1,'transparent')
        ctx.fillStyle=grd;ctx.beginPath();ctx.arc(o.x,o.y,o.r,0,Math.PI*2);ctx.fill()
      })
      animId=requestAnimationFrame(draw)
    }
    draw()
    return()=>{cancelAnimationFrame(animId);window.removeEventListener('resize',resize)}
  },[])

  async function handleContactSubmit() {
    if (!contactForm.name.trim() || !contactForm.email.trim() || !contactForm.message.trim()) return
    if (contactStatus === 'sending') return
    setContactStatus('sending')
    try {
      await addDoc(collection(db, 'contactMessages'), {
        name: contactForm.name.trim(),
        email: contactForm.email.trim(),
        message: contactForm.message.trim(),
        createdAt: serverTimestamp(),
        status: 'unread',
      })
      setContactStatus('success')
      setContactForm({ name:'', email:'', message:'' })
      setTimeout(() => setContactStatus('idle'), 4000)
    } catch(e) {
      console.error('Contact form submit:', e)
      setContactStatus('error')
      setTimeout(() => setContactStatus('idle'), 4000)
    }
  }

  const cfg = gymConfig || {}
  const gymName = cfg.gymName?.trim() || ''
  const foundingYear = cfg.foundingYear ? Number(cfg.foundingYear) : null
  const yearsRunning = foundingYear ? new Date().getFullYear() - foundingYear : null

  const heroLine1 = cfg.heroLine1?.trim() || (gymName ? gymName.split(' ').slice(0, 2).join(' ').toUpperCase() : '')
  const heroLine2 = cfg.heroLine2?.trim() || (gymName ? gymName.split(' ').slice(2).join(' ').toUpperCase() : '')
  const tagline = cfg.tagline?.trim() || ''
  const heroDescription = cfg.heroDescription?.trim() || cfg.aboutDescription?.trim() || ''

  const storyTitle = cfg.storyTitle?.trim() || ''
  const storyParagraphs = Array.isArray(cfg.storyParagraphs)
    ? cfg.storyParagraphs.filter(p => typeof p === 'string' && p.trim())
    : []

  const services = Array.isArray(cfg.services)
    ? cfg.services.filter(s => typeof s === 'string' && s.trim())
    : []

  const values = Array.isArray(cfg.values)
    ? cfg.values.filter(v => v && (v.title || v.desc))
    : []

  const liveStats = [
    { val: yearsRunning, suffix: '+', label:'Years Running', icon:'📅', loading: configLoading },
    { val: statCounts.members, suffix: '', label:'Active Members', icon:'👊', loading: statsLoading },
    { val: statCounts.coaches, suffix: '', label:'Expert Coaches', icon:'🥊', loading: statsLoading },
    { val: statCounts.classes, suffix: '', label:'Scheduled Classes', icon:'📋', loading: statsLoading },
  ]

  const contactFields = [
    { icon:'📍', label:'Location', val: cfg.address?.trim() },
    { icon:'📞', label:'Phone', val: cfg.phone?.trim() },
    { icon:'📧', label:'Email', val: cfg.email?.trim() },
    { icon:'🕐', label:'Hours', val: cfg.hours?.trim() },
  ].filter(c => c.val)

  const contactHeadline = cfg.contactHeadline?.trim() || 'Ready to Start\nYour Journey?'
  const contactSubhead = cfg.contactSubhead?.trim() || 'Get In Touch'

  const inputStyle = {
    background:'rgba(255,255,255,0.04)',
    border:'1px solid rgba(255,255,255,0.08)',
    borderRadius:12, padding:'13px 16px',
    color:'#f0ece8', fontSize:13,
    fontFamily:'Montserrat,sans-serif',
    outline:'none', transition:'border-color 0.2s',
    width:'100%', boxSizing:'border-box',
  }

  return(
    <>
      <Navbar user={{name:profile.name||'Athlete'}}/>
      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',zIndex:0,pointerEvents:'none'}}/>

      <div style={{position:'relative',zIndex:1,maxWidth:1200,margin:'0 auto',padding:'0 40px 60px',display:'flex',flexDirection:'column',gap:0,fontFamily:'Montserrat,sans-serif'}}>

        {/* HERO */}
        <div style={{minHeight:'60vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:'60px 20px',position:'relative'}}>
          {configLoading ? (
            <div style={{fontSize:13,color:'#666',letterSpacing:'0.12em'}}>Loading gym info...</div>
          ) : (
            <>
              <div style={{fontSize:14,fontWeight:700,color:'#e84a2f',letterSpacing:'0.2em',textTransform:'uppercase',marginBottom:16,
                opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(20px)',transition:'all 0.6s ease'}}>
                {foundingYear ? `Est. ${foundingYear}` : 'Established'}{gymName ? ` · ${gymName}` : ''}
              </div>
              {heroLine1 || heroLine2 ? (
                <h1 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'clamp(52px,8vw,96px)',letterSpacing:'0.04em',color:'#f0ece8',lineHeight:1,margin:0,
                  opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(30px)',transition:'all 0.7s ease 0.1s',
                  textShadow:'0 0 80px rgba(232,74,47,0.3)'}}>
                  {heroLine1}{heroLine2 ? <><br/><span style={{color:'#e84a2f',WebkitTextStroke:'2px #e84a2f',WebkitTextFillColor:'transparent'}}>{heroLine2}</span></> : null}
                </h1>
              ) : gymName ? (
                <h1 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'clamp(40px,6vw,72px)',letterSpacing:'0.04em',color:'#f0ece8',lineHeight:1.1,margin:0,
                  opacity:mounted?1:0,transition:'all 0.7s ease 0.1s'}}>{gymName}</h1>
              ) : null}
              {(tagline || heroDescription) && (
                <p style={{fontSize:16,color:'#7a7570',maxWidth:560,lineHeight:1.8,marginTop:20,
                  opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(20px)',transition:'all 0.7s ease 0.2s'}}>
                  {tagline}{tagline && heroDescription ? ' ' : ''}{heroDescription}
                </p>
              )}
              {!gymName && !tagline && !heroDescription && (
                <p style={{fontSize:14,color:'#666',marginTop:12}}>Gym profile not configured yet. Ask your admin to set up Gym Settings.</p>
              )}
            </>
          )}

          <div style={{display:'flex',gap:12,marginTop:32,
            opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(20px)',transition:'all 0.7s ease 0.3s'}}>
            <button type="button" onClick={()=>navigate('/home')}
              style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'14px 32px',fontSize:14,fontWeight:700,boxShadow:'0 8px 30px rgba(232,74,47,0.4)',cursor:'pointer'}}>
              Start Training
            </button>
            <button type="button" onClick={()=>navigate('/home')}
              style={{background:'rgba(255,255,255,0.04)',color:'#f0ece8',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'14px 32px',fontSize:14,fontWeight:700,cursor:'pointer'}}>
              View Classes
            </button>
          </div>

          <div style={{position:'absolute',bottom:20,left:'50%',transform:'translateX(-50%)',display:'flex',flexDirection:'column',alignItems:'center',gap:4,animation:'bounce 2s ease infinite',opacity:0.4}}>
            <div style={{width:1,height:40,background:'linear-gradient(180deg,transparent,#555)'}}/>
            <div style={{fontSize:10,color:'#555',fontWeight:600,letterSpacing:'0.1em'}}>SCROLL</div>
          </div>
        </div>

        {/* LIVE STATS */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(160px,1fr))',gap:16,marginBottom:24}}>
          {liveStats.map((st,i)=>(
            <div key={i} style={{...glass({borderRadius:18}),padding:'28px 20px',textAlign:'center',
              opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(20px)',
              transition:`all 0.6s ease ${0.4+i*0.1}s`}}>
              <div style={{fontSize:32,marginBottom:10}}>{st.icon}</div>
              {st.loading || st.val == null ? (
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:'#555',lineHeight:1}}>—</div>
              ) : (
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:48,color:'#e84a2f',lineHeight:1,textShadow:'0 0 20px rgba(232,74,47,0.4)'}}>
                  <AnimNum target={st.val} suffix={st.suffix}/>
                </div>
              )}
              <div style={{fontSize:11,fontWeight:700,color:'#7a7570',letterSpacing:'0.08em',textTransform:'uppercase',marginTop:8}}>{st.label}</div>
            </div>
          ))}
        </div>

        {/* OUR STORY + SERVICES */}
        {(storyTitle || storyParagraphs.length > 0 || services.length > 0) ? (
          <div style={{...glass({borderRadius:24}),padding:'48px 52px',marginBottom:24,position:'relative',overflow:'hidden'}}>
            <div style={{position:'absolute',right:-20,top:'50%',transform:'translateY(-50%)',fontSize:180,opacity:0.03,userSelect:'none'}}>🥊</div>
            <div style={{display:'grid',gridTemplateColumns: services.length > 0 ? '1fr 1fr' : '1fr',gap:48,position:'relative',zIndex:1}}>
              <div>
                <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Our Story</div>
                {storyTitle && (
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,color:'#f0ece8',lineHeight:1.2,marginBottom:20,whiteSpace:'pre-line'}}>
                    {storyTitle}
                  </div>
                )}
                {storyParagraphs.map((para, i) => (
                  <p key={i} style={{fontSize:13,color:'#7a7570',lineHeight:1.9,marginBottom:i < storyParagraphs.length - 1 ? 16 : 0}}>
                    {para}
                  </p>
                ))}
              </div>
              {services.length > 0 && (
                <div style={{display:'flex',flexDirection:'column',gap:16}}>
                  <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>What We Offer</div>
                  {services.map((item,i)=>(
                    <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',background:'rgba(255,255,255,0.03)',borderRadius:12,border:'1px solid rgba(232,74,47,0.1)'}}>
                      <div style={{width:8,height:8,borderRadius:'50%',background:'#e84a2f',flexShrink:0,boxShadow:'0 0 8px rgba(232,74,47,0.6)'}}/>
                      <span style={{fontSize:13,color:'#f0ece8',fontWeight:500}}>{item}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : !configLoading && (
          <div style={{marginBottom:24}}>
            <EmptyBlock icon="📖" title="STORY NOT CONFIGURED" hint="Add storyTitle, storyParagraphs, and services in Firestore gymConfig/main (via Admin Gym Settings)." />
          </div>
        )}

        {/* COACHES */}
        <div style={{marginBottom:24}}>
          <div style={{textAlign:'center',marginBottom:28}}>
            <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>Meet The Team</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:40,color:'#f0ece8'}}>Our Coaches</div>
          </div>

          {statsLoading ? (
            <div style={{...glass({borderRadius:20}),padding:'40px',textAlign:'center',fontSize:12,color:'#666'}}>Loading coaches...</div>
          ) : coachProfiles.length === 0 ? (
            <EmptyBlock icon="🥊" title="NO COACHES YET" hint="Coaches appear here automatically when coach accounts are added in the system." />
          ) : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(340px,1fr))',gap:20}}>
              {coachProfiles.map((coach,i)=>{
                const color = i % 2 === 0 ? '#e84a2f' : '#f5c842'
                const initial = (coach.name||'?').split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()
                const specialty = coach.specialty?.trim() || coach.goal?.trim() || coach.bio?.trim() || null
                return (
                  <div key={coach.uid} style={{...glass({borderRadius:24}),padding:'36px 32px',position:'relative',overflow:'hidden',border:`1px solid ${color}22`}}>
                    <div style={{position:'absolute',top:-30,right:-30,width:120,height:120,background:`radial-gradient(circle,${color}22,transparent 70%)`,pointerEvents:'none'}}/>
                    <div style={{display:'flex',gap:20,alignItems:'flex-start',position:'relative',zIndex:1}}>
                      <div style={{width:80,height:80,borderRadius:'50%',background:`linear-gradient(135deg,${color}44,${color}11)`,border:`3px solid ${color}`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color,flexShrink:0,boxShadow:`0 0 24px ${color}44`}}>
                        {initial}
                      </div>
                      <div style={{flex:1}}>
                        <div style={{fontSize:18,fontWeight:700,color:'#f0ece8'}}>{coach.name || 'Coach'}</div>
                        <div style={{fontSize:11,color,fontWeight:600,marginTop:3,marginBottom:14}}>
                          Coach{coach.experience ? ` · ${coach.experience}` : ''}
                        </div>
                        {(coach.students != null || coach.wins != null) && (
                          <div style={{display:'flex',gap:10,marginBottom:16}}>
                            {coach.students != null && (
                              <div style={{background:`${color}12`,border:`1px solid ${color}22`,borderRadius:10,padding:'8px 14px',textAlign:'center'}}>
                                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color}}>{coach.students}</div>
                                <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase'}}>Students</div>
                              </div>
                            )}
                            {coach.wins != null && (
                              <div style={{background:`${color}12`,border:`1px solid ${color}22`,borderRadius:10,padding:'8px 14px',textAlign:'center'}}>
                                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color}}>{coach.wins}</div>
                                <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase'}}>Victories</div>
                              </div>
                            )}
                          </div>
                        )}
                        {specialty && (
                          <>
                            <div style={{fontSize:11,fontWeight:700,color:'#555',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:6}}>Specialty</div>
                            <div style={{fontSize:12,color:'#b0ada8'}}>{specialty}</div>
                          </>
                        )}
                      </div>
                    </div>
                    {coach.quote?.trim() && (
                      <div style={{marginTop:20,padding:'16px 18px',background:'rgba(255,255,255,0.03)',borderRadius:14,border:`1px solid ${color}18`,position:'relative',zIndex:1}}>
                        <div style={{position:'absolute',top:-6,left:16,fontSize:24,color,opacity:0.4,fontFamily:'Georgia,serif'}}>"</div>
                        <div style={{fontSize:12,color:'#b0ada8',fontStyle:'italic',lineHeight:1.7,paddingTop:8}}>{coach.quote}</div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* VALUES */}
        <div style={{marginBottom:24}}>
          <div style={{textAlign:'center',marginBottom:28}}>
            <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>What We Stand For</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:40,color:'#f0ece8'}}>Our Values</div>
          </div>
          {configLoading ? (
            <div style={{...glass({borderRadius:18}),padding:'32px',textAlign:'center',fontSize:12,color:'#666'}}>Loading values...</div>
          ) : values.length === 0 ? (
            <EmptyBlock icon="⭐" title="VALUES NOT CONFIGURED" hint="Add a values array in gymConfig/main (icon, title, desc for each value)." />
          ) : (
            <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))',gap:16}}>
              {values.map((v,i)=>(
                <div key={i} style={{...glass({borderRadius:20}),padding:'28px 22px',textAlign:'center',transition:'all 0.3s'}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-6px)';e.currentTarget.style.borderColor='rgba(232,74,47,0.3)'}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.borderColor='rgba(245,200,66,0.15)'}}>
                  {v.icon && <div style={{fontSize:36,marginBottom:14}}>{v.icon}</div>}
                  {v.title && <div style={{fontSize:15,fontWeight:700,color:'#f0ece8',marginBottom:10}}>{v.title}</div>}
                  {v.desc && <div style={{fontSize:12,color:'#7a7570',lineHeight:1.7}}>{v.desc}</div>}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* CONTACT */}
        <div style={{...glass({borderRadius:24}),padding:'44px 52px',border:'1px solid rgba(232,74,47,0.2)'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:48,alignItems:'start'}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>{contactSubhead}</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,color:'#f0ece8',lineHeight:1.2,marginBottom:24,whiteSpace:'pre-line'}}>
                {contactHeadline}
              </div>
              {contactFields.length > 0 ? (
                <div style={{display:'flex',flexDirection:'column',gap:14}}>
                  {contactFields.map((c,i)=>(
                    <div key={i} style={{display:'flex',gap:14,alignItems:'flex-start'}}>
                      <div style={{width:40,height:40,borderRadius:12,background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>
                        {c.icon}
                      </div>
                      <div>
                        <div style={{fontSize:10,fontWeight:700,color:'#555',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:3}}>{c.label}</div>
                        <div style={{fontSize:13,color:'#f0ece8',fontWeight:500}}>{c.val}</div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{fontSize:12,color:'#666',lineHeight:1.7}}>Contact details will appear here once configured in Gym Settings.</div>
              )}
            </div>

            <div style={{background:'rgba(255,255,255,0.02)',borderRadius:20,padding:'32px',border:'1px solid rgba(255,255,255,0.05)',display:'flex',flexDirection:'column',gap:14}}>
              <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:4}}>Send a Message</div>

              <input
                placeholder="Full Name"
                value={contactForm.name}
                onChange={e => setContactForm(p => ({ ...p, name: e.target.value }))}
                style={inputStyle}
                onFocus={e=>e.target.style.borderColor='rgba(232,74,47,0.4)'}
                onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'}
              />
              <input
                placeholder="Email Address"
                type="email"
                value={contactForm.email}
                onChange={e => setContactForm(p => ({ ...p, email: e.target.value }))}
                style={inputStyle}
                onFocus={e=>e.target.style.borderColor='rgba(232,74,47,0.4)'}
                onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'}
              />
              <textarea
                placeholder="Message"
                rows={4}
                value={contactForm.message}
                onChange={e => setContactForm(p => ({ ...p, message: e.target.value }))}
                style={{...inputStyle, resize:'vertical'}}
                onFocus={e=>e.target.style.borderColor='rgba(232,74,47,0.4)'}
                onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'}
              />

              {contactStatus === 'success' && (
                <div style={{padding:'10px 14px',background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.25)',borderRadius:10,fontSize:12,color:'#4ade80',fontWeight:700}}>
                  Message sent. We will get back to you soon.
                </div>
              )}
              {contactStatus === 'error' && (
                <div style={{padding:'10px 14px',background:'rgba(232,74,47,0.08)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:10,fontSize:12,color:'#e84a2f',fontWeight:700}}>
                  Failed to send. Please try again.
                </div>
              )}

              <button
                type="button"
                onClick={handleContactSubmit}
                disabled={contactStatus === 'sending'}
                style={{
                  background: contactStatus === 'sending' ? 'rgba(255,255,255,0.08)' : 'linear-gradient(135deg,#e84a2f,#c93820)',
                  color: contactStatus === 'sending' ? '#666' : '#fff',
                  border:'none', borderRadius:50, padding:'14px',
                  fontSize:14, fontWeight:700,
                  cursor: contactStatus === 'sending' ? 'not-allowed' : 'pointer',
                  boxShadow: contactStatus === 'sending' ? 'none' : '0 4px 20px rgba(232,74,47,0.4)',
                  marginTop:4, transition:'all 0.25s',
                  display:'flex', alignItems:'center', justifyContent:'center', gap:8,
                }}>
                {contactStatus === 'sending' ? (
                  <>
                    <span style={{display:'inline-block',width:14,height:14,border:'2px solid rgba(255,255,255,0.2)',borderTopColor:'#aaa',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                    Sending…
                  </>
                ) : 'Send Message'}
              </button>
            </div>
          </div>
        </div>

      </div>
      <style>{`
        @keyframes bounce{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-8px)}}
        @keyframes spin{to{transform:rotate(360deg)}}
      `}</style>
    </>
  )
}

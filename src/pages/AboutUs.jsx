import { useEffect, useRef, useState } from 'react'
import Navbar from '../components/Navbar'

const glass = (extra={}) => ({
  background:'linear-gradient(135deg,rgba(30,28,28,0.97),rgba(18,16,16,0.99))',
  borderRadius:20, border:'1px solid rgba(245,200,66,0.15)',
  boxShadow:'0 8px 40px rgba(0,0,0,0.5),inset 0 1px 0 rgba(245,200,66,0.08)',
  overflow:'hidden', ...extra,
})

const COACHES = [
  { name:'Coach Rafael Labordo', role:'Head Coach · 12 Years Experience', initial:'RL', specialty:'Combination Work · Defense Strategy', color:'#e84a2f', students:24, wins:38, quote:'Boxing is chess with your fists. Every move is calculated.' },
  { name:'Coach Joey Mendoza',   role:'Assistant Coach · 8 Years Experience', initial:'JM', specialty:'Footwork · Conditioning', color:'#f5c842', students:18, wins:22, quote:'Train hard, fight easy. Discipline is the foundation of every champion.' },
]

const VALUES = [
  { icon:'🥊', title:'Discipline',    desc:'We believe discipline in training translates to discipline in life. Every session builds mental toughness alongside physical strength.' },
  { icon:'🤝', title:'Community',     desc:'Wild Bout is more than a gym — it\'s a family. We push each other to be better every single day.' },
  { icon:'🏆', title:'Excellence',    desc:'We don\'t just train fighters. We build athletes who carry the champion mindset into everything they do.' },
  { icon:'🛡️', title:'Safety First',  desc:'Every technique is taught with safety as the priority. Our coaches ensure every member trains smart and injury-free.' },
]

const STATS_GYM = [
  { val:'5+',  label:'Years Running',   icon:'📅' },
  { val:'40+', label:'Active Members',  icon:'👊' },
  { val:'2',   label:'Expert Coaches',  icon:'🥊' },
  { val:'10+', label:'Class Types',     icon:'📋' },
]

function AnimNum({ target, suffix='', duration=1200 }) {
  const [val,setVal]=useState(0)
  const num = parseInt(target)
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

export default function AboutUs() {
  const canvasRef=useRef(null)
  const [mounted,setMounted]=useState(false)
  const profile = (() => { try{return JSON.parse(localStorage.getItem('hittrack_profile')||'{}')}catch{return{}} })()

  useEffect(()=>{ const t=setTimeout(()=>setMounted(true),100); return()=>clearTimeout(t) },[])

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

  return(
    <>
      <Navbar user={{name:profile.name||'Athlete'}}/>
      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',zIndex:0,pointerEvents:'none'}}/>

      <div style={{position:'relative',zIndex:1,maxWidth:1200,margin:'0 auto',padding:'0 40px 60px',display:'flex',flexDirection:'column',gap:0,fontFamily:'Montserrat,sans-serif'}}>

        {/* ── HERO ── */}
        <div style={{minHeight:'60vh',display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',textAlign:'center',padding:'60px 20px',position:'relative'}}>
          <div style={{fontSize:14,fontWeight:700,color:'#e84a2f',letterSpacing:'0.2em',textTransform:'uppercase',marginBottom:16,
            opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(20px)',transition:'all 0.6s ease'}}>
            Est. 2019 · Wild Bout Boxing Gym
          </div>
          <h1 style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:'clamp(52px,8vw,96px)',letterSpacing:'0.04em',color:'#f0ece8',lineHeight:1,margin:0,
            opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(30px)',transition:'all 0.7s ease 0.1s',
            textShadow:'0 0 80px rgba(232,74,47,0.3)'}}>
            WILD BOUT<br/><span style={{color:'#e84a2f',WebkitTextStroke:'2px #e84a2f',WebkitTextFillColor:'transparent'}}>BOXING GYM</span>
          </h1>
          <p style={{fontSize:16,color:'#7a7570',maxWidth:560,lineHeight:1.8,marginTop:20,
            opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(20px)',transition:'all 0.7s ease 0.2s'}}>
            Where champions are forged. We train fighters, build athletes, and create warriors who carry the boxing spirit into every area of life.
          </p>

          {/* CTA Row */}
          <div style={{display:'flex',gap:12,marginTop:32,
            opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(20px)',transition:'all 0.7s ease 0.3s'}}>
            <div style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',borderRadius:50,padding:'14px 32px',fontSize:14,fontWeight:700,boxShadow:'0 8px 30px rgba(232,74,47,0.4)',cursor:'pointer'}}>
              Start Training 🥊
            </div>
            <div style={{background:'rgba(255,255,255,0.04)',color:'#f0ece8',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'14px 32px',fontSize:14,fontWeight:700,cursor:'pointer'}}>
              View Classes →
            </div>
          </div>

          {/* Scroll hint */}
          <div style={{position:'absolute',bottom:20,left:'50%',transform:'translateX(-50%)',display:'flex',flexDirection:'column',alignItems:'center',gap:4,animation:'bounce 2s ease infinite',opacity:0.4}}>
            <div style={{width:1,height:40,background:'linear-gradient(180deg,transparent,#555)'}}/>
            <div style={{fontSize:10,color:'#555',fontWeight:600,letterSpacing:'0.1em'}}>SCROLL</div>
          </div>
        </div>

        {/* ── GYM STATS ── */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16,marginBottom:24}}>
          {STATS_GYM.map((st,i)=>(
            <div key={i} style={{...glass({borderRadius:18}),padding:'28px 20px',textAlign:'center',
              opacity:mounted?1:0,transform:mounted?'translateY(0)':'translateY(20px)',
              transition:`all 0.6s ease ${0.4+i*0.1}s`}}>
              <div style={{fontSize:32,marginBottom:10}}>{st.icon}</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:48,color:'#e84a2f',lineHeight:1,textShadow:'0 0 20px rgba(232,74,47,0.4)'}}>
                <AnimNum target={st.val.replace(/\D/g,'')} suffix={st.val.replace(/\d/g,'')}/>
              </div>
              <div style={{fontSize:11,fontWeight:700,color:'#7a7570',letterSpacing:'0.08em',textTransform:'uppercase',marginTop:8}}>{st.label}</div>
            </div>
          ))}
        </div>

        {/* ── OUR STORY ── */}
        <div style={{...glass({borderRadius:24}),padding:'48px 52px',marginBottom:24,position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',right:-20,top:'50%',transform:'translateY(-50%)',fontSize:180,opacity:0.03,userSelect:'none'}}>🥊</div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:48,position:'relative',zIndex:1}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Our Story</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,color:'#f0ece8',lineHeight:1.2,marginBottom:20}}>
                Built for Fighters,<br/>By Fighters
              </div>
              <p style={{fontSize:13,color:'#7a7570',lineHeight:1.9,marginBottom:16}}>
                Wild Bout Boxing Gym was founded with one mission: to give every person — regardless of background or experience — access to world-class boxing training in a welcoming, high-energy environment.
              </p>
              <p style={{fontSize:13,color:'#7a7570',lineHeight:1.9}}>
                From complete beginners to competitive fighters, our coaches tailor every program to the individual. We believe boxing is more than a sport — it's a lifestyle that builds confidence, discipline, and resilience.
              </p>
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:16}}>
              <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:4}}>What We Offer</div>
              {['Private 1-on-1 Coaching Sessions','Group Boxing Classes (all levels)','Sparring & Competition Prep','Strength & Conditioning Programs','Youth Boxing Development','HITTRACK Digital Training Platform'].map((item,i)=>(
                <div key={i} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 16px',background:'rgba(255,255,255,0.03)',borderRadius:12,border:'1px solid rgba(232,74,47,0.1)'}}>
                  <div style={{width:8,height:8,borderRadius:'50%',background:'#e84a2f',flexShrink:0,boxShadow:'0 0 8px rgba(232,74,47,0.6)'}}/>
                  <span style={{fontSize:13,color:'#f0ece8',fontWeight:500}}>{item}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* ── COACHES ── */}
        <div style={{marginBottom:24}}>
          <div style={{textAlign:'center',marginBottom:28}}>
            <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>Meet The Team</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:40,color:'#f0ece8'}}>Our Coaches</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:20}}>
            {COACHES.map((coach,i)=>(
              <div key={i} style={{...glass({borderRadius:24}),padding:'36px 32px',position:'relative',overflow:'hidden',border:`1px solid ${coach.color}22`}}>
                <div style={{position:'absolute',top:-30,right:-30,width:120,height:120,background:`radial-gradient(circle,${coach.color}22,transparent 70%)`,pointerEvents:'none'}}/>
                <div style={{display:'flex',gap:20,alignItems:'flex-start',position:'relative',zIndex:1}}>
                  <div style={{width:80,height:80,borderRadius:'50%',background:`linear-gradient(135deg,${coach.color}44,${coach.color}11)`,border:`3px solid ${coach.color}`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color:coach.color,flexShrink:0,boxShadow:`0 0 24px ${coach.color}44`}}>
                    {coach.initial}
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:18,fontWeight:700,color:'#f0ece8'}}>{coach.name}</div>
                    <div style={{fontSize:11,color:coach.color,fontWeight:600,marginTop:3,marginBottom:14}}>{coach.role}</div>
                    <div style={{display:'flex',gap:10,marginBottom:16}}>
                      {[{label:'Students',val:coach.students},{label:'Victories',val:coach.wins}].map((st,j)=>(
                        <div key={j} style={{background:`${coach.color}12`,border:`1px solid ${coach.color}22`,borderRadius:10,padding:'8px 14px',textAlign:'center'}}>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:coach.color}}>{st.val}</div>
                          <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.06em',textTransform:'uppercase'}}>{st.label}</div>
                        </div>
                      ))}
                    </div>
                    <div style={{fontSize:11,fontWeight:700,color:'#555',letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:6}}>Specialty</div>
                    <div style={{fontSize:12,color:'#b0ada8'}}>{coach.specialty}</div>
                  </div>
                </div>
                <div style={{marginTop:20,padding:'16px 18px',background:'rgba(255,255,255,0.03)',borderRadius:14,border:`1px solid ${coach.color}18`,position:'relative',zIndex:1}}>
                  <div style={{position:'absolute',top:-6,left:16,fontSize:24,color:coach.color,opacity:0.4,fontFamily:'Georgia,serif'}}>"</div>
                  <div style={{fontSize:12,color:'#b0ada8',fontStyle:'italic',lineHeight:1.7,paddingTop:8}}>{coach.quote}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── VALUES ── */}
        <div style={{marginBottom:24}}>
          <div style={{textAlign:'center',marginBottom:28}}>
            <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:8}}>What We Stand For</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:40,color:'#f0ece8'}}>Our Values</div>
          </div>
          <div style={{display:'grid',gridTemplateColumns:'repeat(4,1fr)',gap:16}}>
            {VALUES.map((v,i)=>(
              <div key={i} style={{...glass({borderRadius:20}),padding:'28px 22px',textAlign:'center',transition:'all 0.3s'}}
                onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-6px)';e.currentTarget.style.borderColor='rgba(232,74,47,0.3)'}}
                onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.borderColor='rgba(245,200,66,0.15)'}}>
                <div style={{fontSize:36,marginBottom:14}}>{v.icon}</div>
                <div style={{fontSize:15,fontWeight:700,color:'#f0ece8',marginBottom:10}}>{v.title}</div>
                <div style={{fontSize:12,color:'#7a7570',lineHeight:1.7}}>{v.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── CONTACT ── */}
        <div style={{...glass({borderRadius:24}),padding:'44px 52px',border:'1px solid rgba(232,74,47,0.2)'}}>
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:48,alignItems:'center'}}>
            <div>
              <div style={{fontSize:11,fontWeight:700,color:'#e84a2f',letterSpacing:'0.15em',textTransform:'uppercase',marginBottom:12}}>Get In Touch</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,color:'#f0ece8',lineHeight:1.2,marginBottom:24}}>
                Ready to Start<br/>Your Journey?
              </div>
              <div style={{display:'flex',flexDirection:'column',gap:14}}>
                {[
                  {icon:'📍',label:'Location',val:'Wild Bout Boxing Gym, Metro Manila, Philippines'},
                  {icon:'📞',label:'Phone',   val:'+63 900 000 0000'},
                  {icon:'📧',label:'Email',   val:'wildbout@boxing.ph'},
                  {icon:'🕐',label:'Hours',   val:'Mon–Sat: 6:00 AM – 9:00 PM'},
                ].map((c,i)=>(
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
            </div>
            <div style={{background:'rgba(255,255,255,0.02)',borderRadius:20,padding:'32px',border:'1px solid rgba(255,255,255,0.05)',display:'flex',flexDirection:'column',gap:14}}>
              <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:4}}>Send a Message</div>
              {['Full Name','Email Address','Message'].map((field,i)=>
                i<2 ? (
                  <input key={i} placeholder={field}
                    style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:12,padding:'13px 16px',color:'#f0ece8',fontSize:13,fontFamily:'Montserrat,sans-serif',outline:'none',transition:'border-color 0.2s'}}
                    onFocus={e=>e.target.style.borderColor='rgba(232,74,47,0.4)'}
                    onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'}/>
                ) : (
                  <textarea key={i} placeholder={field} rows={4}
                    style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:12,padding:'13px 16px',color:'#f0ece8',fontSize:13,fontFamily:'Montserrat,sans-serif',outline:'none',resize:'vertical',transition:'border-color 0.2s'}}
                    onFocus={e=>e.target.style.borderColor='rgba(232,74,47,0.4)'}
                    onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.08)'}/>
                )
              )}
              <button style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'14px',fontSize:14,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 20px rgba(232,74,47,0.4)',marginTop:4}}>
                Send Message 🥊
              </button>
            </div>
          </div>
        </div>

      </div>
      <style>{`@keyframes bounce{0%,100%{transform:translateX(-50%) translateY(0)}50%{transform:translateX(-50%) translateY(-8px)}}`}</style>
    </>
  )
}

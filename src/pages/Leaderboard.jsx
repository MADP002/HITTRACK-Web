import { useState, useEffect, useRef } from 'react'
import { collection, getDocs, doc, getDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'
import Navbar from '../components/Navbar'
import { useIsMobile } from '../lib/useIsMobile'
import { computeMembershipState, canBook, STATUS } from '../lib/membership'
import { getMemberLevel, levelScore, LEVEL_COLOR, LEVEL_ICON, DIVISIONS } from '../lib/memberLevel'

const RANK_COLORS = ['#f5c842','#c8d6e5','#cd7f32']
const MEDALS      = { 1:'🥇', 2:'🥈', 3:'🥉' }
const GOAL_DIVS   = ['All Goals','Learn Boxing','Lose Weight','Build Strength','Compete']

const calcScore = levelScore   // alias — canonical scoring

const glass=(e={})=>({background:'linear-gradient(135deg,rgba(30,28,28,0.97),rgba(18,16,16,0.99))',borderRadius:20,border:'1px solid rgba(245,200,66,0.15)',boxShadow:'0 8px 40px rgba(0,0,0,0.5)',overflow:'hidden',...e})

function AnimNum({target}){
  const [v,setV]=useState(0)
  useEffect(()=>{let f;const s=Date.now();const t=()=>{const p=Math.min((Date.now()-s)/1200,1);setV(Math.round(target*(1-Math.pow(1-p,3))));if(p<1)f=requestAnimationFrame(t)};f=requestAnimationFrame(t);return()=>cancelAnimationFrame(f)},[target])
  return <>{v.toLocaleString()}</>
}

function PodiumCard({user,rank,delay=0}){
  const [show,setShow]=useState(false)
  useEffect(()=>{const t=setTimeout(()=>setShow(true),delay);return()=>clearTimeout(t)},[])
  const color=RANK_COLORS[rank-1]||'#f5c842'
  const lc=LEVEL_COLOR[user.level]||RANK_COLORS[rank-1]
  const tall=rank===1
  return(
    <div style={{flex:tall?1.2:1,background:'linear-gradient(160deg,rgba(28,26,26,0.99),rgba(14,12,12,1))',borderRadius:20,
      border:`1.5px solid ${color}44`,boxShadow:`0 0 0 1px ${color}11,0 16px 48px ${color}22`,
      padding:'20px 16px 18px',display:'flex',flexDirection:'column',alignItems:'center',gap:10,textAlign:'center',
      marginTop:rank===1?0:rank===2?32:48,position:'relative',overflow:'hidden',
      opacity:show?1:0,transform:show?'translateY(0)':'translateY(30px)',transition:`all 0.6s ease ${delay}ms`}}>
      <div style={{position:'absolute',top:-20,left:'50%',transform:'translateX(-50%)',width:100,height:100,background:`radial-gradient(circle,${color}20,transparent 70%)`,pointerEvents:'none'}}/>
      <div style={{position:'absolute',top:10,left:12,fontFamily:"'Bebas Neue',sans-serif",fontSize:11,color,letterSpacing:'0.08em',zIndex:1}}>
        {MEDALS[rank]} {rank===1?'1ST':rank===2?'2ND':'3RD'}
      </div>
      {/* Avatar */}
      <div style={{width:tall?68:52,height:tall?68:52,borderRadius:'50%',
        background:`linear-gradient(135deg,${color}44,${color}11)`,
        border:`2.5px solid ${color}`,display:'flex',alignItems:'center',justifyContent:'center',
        fontFamily:"'Bebas Neue',sans-serif",fontSize:tall?26:18,color,
        boxShadow:`0 0 20px ${color}55`,marginTop:14,position:'relative',zIndex:1}}>
        {(user.name||'?')[0].toUpperCase()}
        {user.isMe&&<div style={{position:'absolute',bottom:-2,right:-2,width:14,height:14,borderRadius:'50%',background:'#f5c842',fontSize:8,display:'flex',alignItems:'center',justifyContent:'center',border:'2px solid #111'}}>★</div>}
      </div>
      <div style={{zIndex:1}}>
        <div style={{fontSize:12,fontWeight:700,color:'var(--t-text)',lineHeight:1.3}}>{user.name}{user.isMe?' (You)':''}</div>
        <div style={{fontSize:9,color:'var(--t-dim3)',marginTop:2}}>{user.goal||'—'}</div>
      </div>
      {/* Score */}
      <div style={{background:`${color}0e`,border:`1px solid ${color}2a`,borderRadius:10,padding:'8px 14px',width:'100%',zIndex:1}}>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:tall?28:20,color,lineHeight:1}}><AnimNum target={user.score}/></div>
        <div style={{fontSize:8,color:'var(--t-dim3)',fontWeight:700,marginTop:1,letterSpacing:'0.1em'}}>POINTS</div>
      </div>
      {/* Stats */}
      <div style={{display:'flex',gap:6,width:'100%',zIndex:1}}>
        {[{icon:'🥊',val:user.totalWorkouts||0,label:'WKT'},{icon:'🔥',val:`${user.streak||0}d`,label:'STK'}].map((st,i)=>(
          <div key={i} style={{flex:1,background:'var(--t-s04)',borderRadius:8,padding:'6px 4px',display:'flex',flexDirection:'column',alignItems:'center',gap:2,border:`1px solid ${color}1a`}}>
            <span style={{fontSize:12}}>{st.icon}</span>
            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color}}>{st.val}</span>
            <span style={{fontSize:7,color:'var(--t-dim3)',fontWeight:700}}>{st.label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function LeaderRow({user,maxScore,isMe,idx,divColor}){
  const isMobile=useIsMobile()
  const [show,setShow]=useState(false)
  const [barW,setBarW]=useState(0)
  useEffect(()=>{
    const t1=setTimeout(()=>setShow(true),idx*35)
    const t2=setTimeout(()=>setBarW(maxScore>0?(user.score/maxScore)*100:0),idx*35+350)
    return()=>{clearTimeout(t1);clearTimeout(t2)}
  },[])
  const rc=user.rank<=3?RANK_COLORS[user.rank-1]:divColor
  return(
    <div style={{display:'flex',alignItems:'center',padding:isMobile?'10px 12px':'11px 20px',
      background:isMe?'rgba(245,200,66,0.04)':user.rank<=3?`${RANK_COLORS[user.rank-1]}08`:'transparent',
      borderBottom:'1px solid var(--t-s04)',
      borderLeft:`3px solid ${isMe?'#f5c842':user.rank<=3?RANK_COLORS[user.rank-1]:'transparent'}`,
      opacity:show?1:0,transform:show?'none':'translateX(-16px)',transition:`all 0.35s ease ${idx*35}ms`}}
      onMouseEnter={e=>e.currentTarget.style.background='var(--t-s02)'}
      onMouseLeave={e=>e.currentTarget.style.background=isMe?'rgba(245,200,66,0.04)':user.rank<=3?`${RANK_COLORS[user.rank-1]}08`:'transparent'}>
      <div style={{width:isMobile?32:44,flexShrink:0,textAlign:'center',fontSize:user.rank<=3?(isMobile?15:18):12,fontWeight:700,color:user.rank<=3?RANK_COLORS[user.rank-1]:'var(--t-dim3)'}}>
        {MEDALS[user.rank]||`#${user.rank}`}
      </div>
      <div style={{width:isMobile?28:34,height:isMobile?28:34,borderRadius:'50%',flexShrink:0,background:`${divColor}22`,border:`1.5px solid ${divColor}44`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:isMobile?11:13,color:divColor,marginRight:isMobile?8:10}}>
        {(user.name||'?')[0].toUpperCase()}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap'}}>
          <span style={{fontSize:isMobile?11:12,fontWeight:700,color:isMe?'#f5c842':'var(--t-text)',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',maxWidth:isMobile?100:'none'}}>{user.name}</span>
          {isMe&&<span style={{fontSize:8,background:'rgba(245,200,66,0.2)',color:'#f5c842',border:'1px solid rgba(245,200,66,0.4)',borderRadius:50,padding:'1px 6px',fontWeight:700}}>YOU</span>}
          {(user.streak||0)>=14&&<span style={{fontSize:8,background:'rgba(232,74,47,0.15)',color:'#e84a2f',borderRadius:50,padding:'1px 5px',fontWeight:700}}>🔥HOT</span>}
        </div>
        <div style={{fontSize:9,color:'var(--t-dim3)',marginTop:1,display:'flex',gap:6,alignItems:'center'}}>
          <span>{user.goal||'—'}</span>
          {isMobile && <span style={{color:'var(--t-dim3)'}}>· 🥊{user.totalWorkouts||0} · 🔥{user.streak||0}d</span>}
        </div>
      </div>
      {!isMobile && (
        <div style={{width:60,flexShrink:0,display:'flex',alignItems:'center',gap:2}}>
          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:'var(--t-text)'}}>{user.totalWorkouts||0}</span>
          <span style={{fontSize:9}}>🥊</span>
        </div>
      )}
      {!isMobile && (
        <div style={{width:66,flexShrink:0,fontFamily:"'Bebas Neue',sans-serif",fontSize:12,color:(user.streak||0)>0?'#e84a2f':'var(--t-dim4)'}}>🔥{user.streak||0}d</div>
      )}
      <div style={{width:isMobile?78:140,flexShrink:0,display:'flex',alignItems:'center',gap:isMobile?5:8}}>
        <div style={{flex:1,height:5,background:'var(--t-s06)',borderRadius:50,overflow:'hidden'}}>
          <div style={{height:'100%',borderRadius:50,background:`linear-gradient(90deg,${rc},${rc}bb)`,width:`${barW}%`,transition:'width 1s ease',boxShadow:`0 0 6px ${rc}66`}}/>
        </div>
        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:isMobile?11:13,color:rc,minWidth:isMobile?26:36,textAlign:'right'}}>{user.score.toLocaleString()}</span>
      </div>
    </div>
  )
}

// Single division leaderboard section
function DivisionSection({division,users,myUid,goalFilter,searchQ}){
  const isMobile=useIsMobile()
  const color=LEVEL_COLOR[division]||'#f5c842'
  const icon=LEVEL_ICON[division]||'🥊'

  const filtered=users.filter(u=>{
    if(searchQ&&!u.name.toLowerCase().includes(searchQ.toLowerCase()))return false
    if(goalFilter!=='All Goals'&&u.goal!==goalFilter)return false
    return true
  }).map((u,i)=>({...u,rank:i+1,isMe:u.uid===myUid}))

  const maxScore=filtered[0]?.score||1
  const myEntry=filtered.find(u=>u.isMe)
  const top3=filtered.slice(0,3)
  const rest=filtered.slice(3)

  return(
    <div style={{display:'flex',flexDirection:'column',gap:16}}>
      {/* Division header */}
      <div style={{display:'flex',alignItems:'center',gap:12}}>
        <div style={{width:44,height:44,borderRadius:12,background:`${color}18`,border:`1.5px solid ${color}33`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>{icon}</div>
        <div>
          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,color,letterSpacing:'0.06em',lineHeight:1}}>{division.toUpperCase()} DIVISION</div>
          <div style={{fontSize:11,color:'var(--t-dim3)',marginTop:2}}>{filtered.length} member{filtered.length!==1?'s':''} competing</div>
        </div>
        {myEntry&&(
          <div style={{marginLeft:'auto',background:`${color}0e`,border:`1px solid ${color}22`,borderRadius:12,padding:'8px 16px',textAlign:'center'}}>
            <div style={{fontSize:9,color:'var(--t-dim3)',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase'}}>Your Rank</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color,lineHeight:1}}>#{myEntry.rank}</div>
          </div>
        )}
      </div>

      {filtered.length===0?(
        <div style={{...glass({borderRadius:14}),padding:'32px',textAlign:'center'}}>
          <div style={{fontSize:36,marginBottom:8,opacity:0.4}}>{icon}</div>
          <div style={{fontSize:12,color:'var(--t-dim3)'}}>No {division} members{goalFilter!=='All Goals'?' with this goal':''} yet</div>
        </div>
      ):(
        <>
          {/* Podium for top 3 */}
          {top3.length>=3&&(
            <div style={{display:'grid',gridTemplateColumns:'1fr 1.2fr 1fr',gap:isMobile?6:12,alignItems:'flex-end'}}>
              <PodiumCard user={top3[1]} rank={2} delay={100}/>
              <PodiumCard user={top3[0]} rank={1} delay={0}/>
              <PodiumCard user={top3[2]} rank={3} delay={200}/>
            </div>
          )}
          {top3.length<3&&top3.length>0&&(
            <div style={{display:'flex',gap:12,justifyContent:'center'}}>
              {top3.map((u,i)=><PodiumCard key={u.uid} user={u} rank={i+1} delay={i*100}/>)}
            </div>
          )}

          {/* Full rankings */}
          {filtered.length>0&&(
            <div style={{background:'linear-gradient(135deg,rgba(28,26,26,0.98),rgba(14,12,12,0.99))',borderRadius:16,border:`1px solid ${color}18`,overflow:'hidden'}}>
              <div style={{display:'flex',padding:isMobile?'9px 12px':'9px 20px',borderBottom:'1px solid var(--t-s04)'}}>
                {(isMobile
                  ? [{label:'RANK',w:32},{label:'MEMBER',flex:1},{label:'SCORE',w:78}]
                  : [{label:'RANK',w:44},{label:'MEMBER',flex:1},{label:'WORKOUTS',w:60},{label:'STREAK',w:66},{label:'SCORE',w:140}]
                ).map((h,i)=>(
                  <div key={i} style={{width:h.w,flex:h.flex,fontSize:8,fontWeight:700,color:'var(--t-dim4)',letterSpacing:'0.1em'}}>{h.label}</div>
                ))}
              </div>
              {filtered.map((u,i)=>(
                <LeaderRow key={u.uid} user={u} maxScore={maxScore} isMe={u.isMe} idx={i} divColor={color}/>
              ))}
            </div>
          )}

          {/* Motivator for current user */}
          {myEntry&&(
            <div style={{background:`${color}08`,border:`1px solid ${color}18`,borderRadius:12,padding:'14px 20px',display:'flex',alignItems:'center',gap:14}}>
              <span style={{fontSize:28}}>{icon}</span>
              <div style={{flex:1}}>
                <div style={{fontSize:11,fontWeight:700,color,letterSpacing:'0.08em',textTransform:'uppercase',marginBottom:3}}>Your Standing in {division}</div>
                <div style={{fontSize:13,fontWeight:700,color:'var(--t-text)'}}>
                  Rank <span style={{color}}>#{myEntry.rank}</span> of {filtered.length} ·{' '}
                  {myEntry.rank===1?'🏆 Division Champion!':myEntry.rank<=3?'🔥 On the podium!':'💪 Keep pushing!'}
                </div>
                {myEntry.rank>1&&filtered[myEntry.rank-2]&&(
                  <div style={{fontSize:10,color:'var(--t-dim3)',marginTop:3}}>
                    <span style={{color,fontWeight:700}}>{(filtered[myEntry.rank-2].score-myEntry.score).toLocaleString()} pts</span> behind #{myEntry.rank-1} — {filtered[myEntry.rank-2].name}
                  </div>
                )}
              </div>
              <div style={{textAlign:'center',flexShrink:0}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color,lineHeight:1}}>{myEntry.score}</div>
                <div style={{fontSize:9,color:'var(--t-dim3)',fontWeight:600,marginTop:2}}>YOUR PTS</div>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── MAIN LEADERBOARD ─────────────────────────────────
export default function Leaderboard(){
  const canvasRef=useRef(null)
  const isMobile=useIsMobile()
  const [allUsers,setAllUsers]=useState([])
  const [loading,setLoading]=useState(true)
  const [goalFilter,setGoalFilter]=useState('All Goals')
  const [searchQ,setSearchQ]=useState('')
  const [activeDiv,setActiveDiv]=useState('All')
  const [myUid,setMyUid]=useState(null)

  const profile=(() => {try{return JSON.parse(localStorage.getItem('hittrack_profile')||'{}')}catch{return{}}})()
  // Membership gate — non-members and active members ignore this.
  const isMember = (profile.role || 'member') === 'member'
  const membershipBlocked = isMember && !canBook(profile.membership)
  const membershipState = computeMembershipState(profile.membership)

  useEffect(()=>{
    const user=auth.currentUser
    if(user)setMyUid(user.uid)
  },[])

  async function loadLeaderboard(){
    try{
      const me=auth.currentUser
      // SINGLE SOURCE OF TRUTH: read users (identity) + merge stats (performance)
      const usersSnap=await getDocs(collection(db,'users'))
      const list=[]
      for(const ud of usersSnap.docs){
        const userData=ud.data()
        // Only include members on the gym leaderboard
        if(userData.role && userData.role!=='member') continue
        // Skip deactivated accounts — they don't compete on the leaderboard
        if(userData.status==='inactive') continue
        if(!userData.name) continue
        // Pull stats (may not exist for new users OR may be permission-denied)
        let stats={}
        try{
          const ss=await getDoc(doc(db,'stats',ud.id))
          if(ss.exists()) stats=ss.data()
        }catch(e){/* stats may be missing — fine */}
        // Merge — same semantics as coach/admin
        const merged={uid:ud.id,...userData,...stats}
        // Canonical level via shared helper (admin experience > mobile
        // trainingLevel > legacy currentLevel, clamped to 3 divisions).
        merged.level=getMemberLevel(merged)
        merged.goal=userData.goal||stats.goal||'Learn Boxing'
        merged.totalWorkouts=merged.totalWorkouts||0
        merged.streak=merged.streak||0
        merged.weeklyPct=merged.weeklyPct||0
        merged.score=Math.round(levelScore(merged))
        merged.isMe=me&&ud.id===me.uid
        list.push(merged)
      }
      // Safety net: add current user if somehow missing from users collection
      if(me&&!list.find(u=>u.uid===me.uid)&&profile.name){
        const fallback={
          uid:me.uid,name:profile.name,
          goal:profile.goal||'Learn Boxing',
          experience:profile.experience||'Beginner',
          trainingLevel:profile.trainingLevel,
          currentLevel:profile.currentLevel,
          totalWorkouts:0,streak:0,weeklyPct:0,isMe:true,
        }
        fallback.level=getMemberLevel(fallback)
        fallback.score=Math.round(levelScore(fallback))
        list.push(fallback)
      }
      setAllUsers(list.sort((a,b)=>b.score-a.score))
    }catch(e){console.error('Leaderboard load error:',e)}
    setLoading(false)
  }

  useEffect(()=>{loadLeaderboard();const t=setInterval(loadLeaderboard,10000);return()=>clearInterval(t)},[])

  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return
    const ctx=canvas.getContext('2d');let animId,t=0
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight}
    resize();window.addEventListener('resize',resize)
    const draw=()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height);t+=0.006
      ctx.strokeStyle='rgba(245,200,66,0.02)';ctx.lineWidth=1
      const g=70
      for(let x=0;x<canvas.width+g;x+=g){const o=(t*18)%g;ctx.beginPath();ctx.moveTo(x-o,0);ctx.lineTo(x-o,canvas.height);ctx.stroke()}
      for(let y=0;y<canvas.height+g;y+=g){const o=(t*9)%g;ctx.beginPath();ctx.moveTo(0,y-o);ctx.lineTo(canvas.width,y-o);ctx.stroke()}
      [{x:canvas.width*.15,y:canvas.height*.2,r:200,c:'rgba(232,74,47,0.04)'},{x:canvas.width*.85,y:canvas.height*.15,r:220,c:'rgba(245,200,66,0.05)'},{x:canvas.width*.5,y:canvas.height*.8,r:180,c:'rgba(192,132,252,0.03)'}].forEach(o=>{
        const grd=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r);grd.addColorStop(0,o.c);grd.addColorStop(1,'transparent')
        ctx.fillStyle=grd;ctx.beginPath();ctx.arc(o.x,o.y,o.r,0,Math.PI*2);ctx.fill()
      })
      animId=requestAnimationFrame(draw)
    }
    draw();return()=>{cancelAnimationFrame(animId);window.removeEventListener('resize',resize)}
  },[])

  // Split by division
  const byDiv={}
  DIVISIONS.forEach(d=>{ byDiv[d]=allUsers.filter(u=>u.level===d) })

  const myUser=allUsers.find(u=>u.uid===myUid)
  const divsToShow=activeDiv==='All'?DIVISIONS:[activeDiv]

  return(
    <>
      <Navbar user={{name:profile.name||'Athlete'}}/>
      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',zIndex:0,pointerEvents:'none'}}/>

      <div style={{position:'relative',zIndex:1,maxWidth:1200,margin:'0 auto',padding:isMobile?'14px 12px 40px':'24px 40px 60px',display:'flex',flexDirection:'column',gap:isMobile?16:24,fontFamily:'Montserrat,sans-serif'}}>

        {/* HEADER */}
        <div style={{...glass({borderRadius:20}),padding:'24px 32px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'relative',overflow:'hidden'}}>
          <div style={{position:'absolute',top:-20,right:-20,fontSize:120,opacity:0.03,pointerEvents:'none'}}>🏆</div>
          <div style={{display:'flex',alignItems:'center',gap:14}}>
            <span style={{fontSize:36}}>🏆</span>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,letterSpacing:'0.06em',color:'var(--t-text)',lineHeight:1}}>LEADERBOARD</div>
              <div style={{fontSize:11,color:'var(--t-muted)',marginTop:3}}>Wild Bout Boxing Gym · Separate divisions by level · Live</div>
            </div>
          </div>
          {myUser&&(
            <div style={{background:'rgba(245,200,66,0.08)',border:'1.5px solid rgba(245,200,66,0.2)',borderRadius:16,padding:'14px 20px',textAlign:'center',flexShrink:0}}>
              <div style={{fontSize:9,color:'var(--t-dim3)',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',marginBottom:3}}>Your Division</div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:LEVEL_COLOR[myUser.level]||'#f5c842',lineHeight:1}}>
                {LEVEL_ICON[myUser.level]||'🥊'} {myUser.level}
              </div>
              <div style={{fontSize:10,color:'var(--t-dim3)',marginTop:4}}>{myUser.score} pts</div>
            </div>
          )}
        </div>

        {/* DIVISION TABS */}
        <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
          <span style={{fontSize:10,fontWeight:700,color:'var(--t-dim3)',letterSpacing:'0.08em',textTransform:'uppercase'}}>Division:</span>
          {['All',...DIVISIONS].map(d=>{
            const color=d==='All'?'#e84a2f':LEVEL_COLOR[d]||'#f5c842'
            const active=activeDiv===d
            return(
              <button key={d} onClick={()=>setActiveDiv(d)}
                style={{display:'flex',alignItems:'center',gap:6,background:active?`${color}18`:'var(--t-s03)',color:active?color:'var(--t-dim3)',border:active?`1.5px solid ${color}44`:'1px solid rgba(255,255,255,0.07)',borderRadius:50,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer',transition:'all 0.2s',boxShadow:active?`0 0 16px ${color}22`:'none'}}>
                {d!=='All'&&<span>{LEVEL_ICON[d]}</span>}
                {d==='All'?'🏆 All Divisions':d}
                <span style={{fontSize:10,background:active?`${color}22`:'var(--t-s06)',borderRadius:50,padding:'1px 6px'}}>{d==='All'?allUsers.length:(byDiv[d]||[]).length}</span>
              </button>
            )
          })}
        </div>

        {/* GOAL FILTER + SEARCH — and everything below this is the
            membership-gated content (filters + divisions). Header stays clean.
            When member is expired/paused: content is blurred + un-clickable,
            and a centered lock card invites them to renew. */}
        <div style={{position:'relative'}}>
          {/* The blurred/disabled content */}
          <div style={{
            filter: membershipBlocked ? 'blur(7px)' : 'none',
            pointerEvents: membershipBlocked ? 'none' : 'auto',
            userSelect: membershipBlocked ? 'none' : 'auto',
            transition: 'filter 0.3s',
            display:'flex', flexDirection:'column', gap: isMobile?16:24,
          }}>

          {/* GOAL FILTER + SEARCH */}
        <div style={{display:'flex',gap:8,alignItems:'center',flexWrap:'wrap'}}>
          <span style={{fontSize:10,fontWeight:700,color:'var(--t-dim3)',letterSpacing:'0.08em',textTransform:'uppercase'}}>Goal:</span>
          {GOAL_DIVS.map((d,i)=>{
            const colors=['#f5c842','#42a5f5','#e84a2f','#4ade80','#c084fc']
            const active=goalFilter===d;const color=colors[i]||'#f5c842'
            return<button key={d} onClick={()=>setGoalFilter(d)} style={{background:active?`${color}18`:'var(--t-s03)',color:active?color:'var(--t-dim3)',border:active?`1px solid ${color}44`:'1px solid var(--t-s06)',borderRadius:50,padding:'6px 14px',fontSize:11,fontWeight:700,cursor:'pointer',transition:'all 0.2s'}}>{d}</button>
          })}
          <div style={{position:'relative',marginLeft:'auto'}}>
            <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:12,color:'var(--t-dim3)'}}>🔍</span>
            <input placeholder="Search..." value={searchQ} onChange={e=>setSearchQ(e.target.value)}
              style={{background:'var(--t-s04)',border:'1px solid var(--t-s08)',borderRadius:50,padding:'7px 16px 7px 36px',color:'var(--t-text)',fontSize:12,fontFamily:'Montserrat,sans-serif',outline:'none',width:180,transition:'border-color 0.2s'}}
              onFocus={e=>e.target.style.borderColor='rgba(245,200,66,0.4)'}
              onBlur={e=>e.target.style.borderColor='var(--t-s08)'}/>
          </div>
          {(goalFilter!=='All Goals'||searchQ)&&<button onClick={()=>{setGoalFilter('All Goals');setSearchQ('')}} style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.2)',borderRadius:50,padding:'6px 12px',fontSize:11,fontWeight:700,color:'#e84a2f',cursor:'pointer'}}>✕ Clear</button>}
        </div>

        {loading?(
          <div style={{textAlign:'center',padding:'60px 0',color:'var(--t-dim3)'}}>
            <div style={{fontSize:32,marginBottom:12}}>⏳</div>Loading leaderboard...
          </div>
        ):(
          <div style={{display:'flex',flexDirection:'column',gap:36}}>
            {divsToShow.map(div=>(
              <DivisionSection
                key={div}
                division={div}
                users={byDiv[div]||[]}
                myUid={myUid}
                goalFilter={goalFilter}
                searchQ={searchQ}
              />
            ))}
          </div>
        )}
          </div>{/* end blurred content */}

          {/* ════════════════════════════════════════════════ */}
          {/*  LOCK OVERLAY — centered card invites renewal     */}
          {/* ════════════════════════════════════════════════ */}
          {membershipBlocked && (
            <div style={{
              position:'absolute', top:0, left:0, right:0,
              display:'flex', alignItems:'flex-start', justifyContent:'center',
              paddingTop:80, pointerEvents:'none',
            }}>
              <div style={{
                pointerEvents:'auto',
                maxWidth:440, width:'90%',
                background:'linear-gradient(135deg,rgba(28,18,18,0.97),rgba(14,10,10,0.99))',
                borderRadius:20,
                border:`2px solid ${membershipState===STATUS.EXPIRED?'rgba(232,74,47,0.55)':'rgba(156,163,175,0.45)'}`,
                boxShadow:'0 30px 80px rgba(0,0,0,0.8), 0 0 60px rgba(232,74,47,0.25)',
                padding:'30px 28px', textAlign:'center',
                backdropFilter:'blur(12px)',
                position:'relative', overflow:'hidden',
              }}>
                {/* Accent stripe */}
                <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:membershipState===STATUS.EXPIRED?'linear-gradient(180deg,#e84a2f,#c93820)':'linear-gradient(180deg,#9ca3af,#6b7280)'}}/>
                <div style={{fontSize:50,marginBottom:12,lineHeight:1}}>
                  {membershipState===STATUS.EXPIRED ? '🔒' : '⏸'}
                </div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:28,letterSpacing:'0.05em',color:'var(--t-text)',lineHeight:1.1,marginBottom:8}}>
                  {membershipState===STATUS.EXPIRED ? 'LEADERBOARD LOCKED' : 'MEMBERSHIP PAUSED'}
                </div>
                <div style={{fontSize:12,color:'var(--t-dim1)',lineHeight:1.7,marginBottom:18}}>
                  {membershipState===STATUS.EXPIRED
                    ? 'Your membership has expired — leaderboard rankings are members-only. Speak with the gym admin to renew and rejoin the competition.'
                    : 'Your membership is paused. Resume your plan with the admin to see how you stack up against the gym.'}
                </div>
                <div style={{display:'flex',alignItems:'center',justifyContent:'center',gap:8,padding:'10px 16px',background:'rgba(232,74,47,0.08)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:12,fontSize:11,color:'#e84a2f',fontWeight:700,letterSpacing:'0.06em'}}>
                  <span>👀</span><span>Preview shown — Renew to compete</span>
                </div>
              </div>
            </div>
          )}
        </div>{/* end membership gate wrapper */}
      </div>
    </>
  )
}

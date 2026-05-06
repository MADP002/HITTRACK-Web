import { useState, useEffect, useRef } from 'react'
import Navbar from '../components/Navbar'

const glass = (extra={}) => ({
  background:'linear-gradient(135deg,rgba(30,28,28,0.97),rgba(18,16,16,0.99))',
  borderRadius:20, border:'1px solid rgba(245,200,66,0.15)',
  boxShadow:'0 8px 40px rgba(0,0,0,0.5),inset 0 1px 0 rgba(245,200,66,0.08)',
  overflow:'hidden', ...extra,
})

// ── BADGE DEFINITIONS ─────────────────────────────────
// Each badge has: id, title, desc, icon, category, condition(stats), rarity, xp
const BADGES = [
  // WORKOUT MILESTONES
  { id:'w1',  category:'Milestones', icon:'🥊', title:'First Punch',      desc:'Complete your very first workout',        rarity:'common',    xp:50,   condition: s => s.totalWorkouts >= 1  },
  { id:'w2',  category:'Milestones', icon:'🏅', title:'10 Workouts',       desc:'Complete 10 workouts',                   rarity:'common',    xp:100,  condition: s => s.totalWorkouts >= 10 },
  { id:'w3',  category:'Milestones', icon:'🥈', title:'20 Workouts',       desc:'Complete 20 workouts',                   rarity:'uncommon',  xp:200,  condition: s => s.totalWorkouts >= 20 },
  { id:'w4',  category:'Milestones', icon:'🥇', title:'30 Workouts',       desc:'Complete 30 workouts',                   rarity:'uncommon',  xp:300,  condition: s => s.totalWorkouts >= 30 },
  { id:'w5',  category:'Milestones', icon:'💎', title:'50 Workouts',       desc:'Complete 50 workouts',                   rarity:'rare',      xp:500,  condition: s => s.totalWorkouts >= 50 },
  { id:'w6',  category:'Milestones', icon:'👑', title:'100 Workouts',      desc:'Complete 100 workouts — true fighter',   rarity:'legendary', xp:1000, condition: s => s.totalWorkouts >= 100},

  // STREAK BADGES
  { id:'s1',  category:'Streaks',    icon:'🔥', title:'On Fire',           desc:'Maintain a 3-day training streak',        rarity:'common',    xp:75,   condition: s => s.streak >= 3  },
  { id:'s2',  category:'Streaks',    icon:'🔥', title:'Week Warrior',      desc:'Maintain a 7-day training streak',        rarity:'uncommon',  xp:150,  condition: s => s.streak >= 7  },
  { id:'s3',  category:'Streaks',    icon:'⚡', title:'Unstoppable',       desc:'Maintain a 14-day training streak',       rarity:'rare',      xp:300,  condition: s => s.streak >= 14 },
  { id:'s4',  category:'Streaks',    icon:'👑', title:'Iron Will',         desc:'Maintain a 30-day training streak',       rarity:'legendary', xp:750,  condition: s => s.streak >= 30 },

  // LEVEL BADGES
  { id:'l1',  category:'Levels',     icon:'🌱', title:'Beginner\'s Heart', desc:'Start your boxing journey',               rarity:'common',    xp:50,   condition: s => s.totalWorkouts >= 1  },
  { id:'l2',  category:'Levels',     icon:'⚡', title:'Intermediate',      desc:'Reach Intermediate level (25 workouts)',  rarity:'uncommon',  xp:400,  condition: s => s.totalWorkouts >= 25 },
  { id:'l3',  category:'Levels',     icon:'🔥', title:'Advanced Fighter',  desc:'Reach Advanced level (50 workouts)',      rarity:'rare',      xp:800,  condition: s => s.totalWorkouts >= 50 },
  { id:'l4',  category:'Levels',     icon:'💎', title:'Expert',            desc:'Reach Expert level (75 workouts)',        rarity:'epic',      xp:1200, condition: s => s.totalWorkouts >= 75 },
  { id:'l5',  category:'Levels',     icon:'👑', title:'Elite',             desc:'Reach Elite level (100 workouts)',        rarity:'legendary', xp:2000, condition: s => s.totalWorkouts >= 100},

  // WEEKLY CONSISTENCY
  { id:'c1',  category:'Consistency',icon:'📅', title:'Consistent',        desc:'Complete 50% of weekly workouts',         rarity:'common',    xp:80,   condition: s => s.weeklyPct >= 50  },
  { id:'c2',  category:'Consistency',icon:'📅', title:'Dedicated',         desc:'Complete 75% of weekly workouts',         rarity:'uncommon',  xp:160,  condition: s => s.weeklyPct >= 75  },
  { id:'c3',  category:'Consistency',icon:'🏆', title:'Perfect Week',      desc:'Complete 100% of weekly workouts',        rarity:'rare',      xp:350,  condition: s => s.weeklyPct >= 100 },

  // LEADERBOARD
  { id:'r1',  category:'Rankings',   icon:'📊', title:'On the Board',      desc:'Appear on the gym leaderboard',           rarity:'common',    xp:50,   condition: s => s.totalWorkouts >= 1  },
  { id:'r2',  category:'Rankings',   icon:'🏅', title:'Top 10',            desc:'Reach top 10 on the leaderboard',         rarity:'uncommon',  xp:300,  condition: s => s.rank <= 10 && s.rank > 0 },
  { id:'r3',  category:'Rankings',   icon:'🥉', title:'Podium',            desc:'Reach top 3 on the leaderboard',          rarity:'epic',      xp:700,  condition: s => s.rank <= 3  && s.rank > 0 },
  { id:'r4',  category:'Rankings',   icon:'🥇', title:'Champion',          desc:'Reach #1 on the gym leaderboard',         rarity:'legendary', xp:1500, condition: s => s.rank === 1               },
]

const RARITY_COLOR = {
  common:    { bg:'rgba(176,190,197,0.1)',  border:'rgba(176,190,197,0.25)', text:'#b0bec5', glow:'rgba(176,190,197,0.3)', label:'Common'    },
  uncommon:  { bg:'rgba(74,222,128,0.1)',   border:'rgba(74,222,128,0.25)',  text:'#4ade80', glow:'rgba(74,222,128,0.3)',  label:'Uncommon'  },
  rare:      { bg:'rgba(66,165,245,0.1)',   border:'rgba(66,165,245,0.25)',  text:'#42a5f5', glow:'rgba(66,165,245,0.3)',  label:'Rare'      },
  epic:      { bg:'rgba(192,132,252,0.1)',  border:'rgba(192,132,252,0.25)', text:'#c084fc', glow:'rgba(192,132,252,0.3)', label:'Epic'      },
  legendary: { bg:'rgba(245,200,66,0.12)', border:'rgba(245,200,66,0.35)',  text:'#f5c842', glow:'rgba(245,200,66,0.5)',  label:'Legendary' },
}

const CATEGORIES = ['All', 'Milestones', 'Streaks', 'Levels', 'Consistency', 'Rankings']

const MOCK_USERS_COUNT = 12
function calcRank(totalWorkouts, streak, weeklyPct, level) {
  const LEVEL_BONUS = { Beginner:0, Intermediate:150, Advanced:350, Expert:600, Elite:1000 }
  const myScore = (totalWorkouts*10)+(streak*5)+(LEVEL_BONUS[level]||0)+Math.round(weeklyPct*1.5)
  const gymScores = [2228,1562,1483,1008,913,822,627,544,436,375,180,135]
  return gymScores.filter(s=>s>myScore).length+1
}

// ── BADGE CARD ────────────────────────────────────────
function BadgeCard({ badge, unlocked, progress, idx }) {
  const [mounted,setMounted]=useState(false)
  const [hovered,setHovered]=useState(false)
  useEffect(()=>{ const t=setTimeout(()=>setMounted(true),idx*40); return()=>clearTimeout(t) },[])
  const r = RARITY_COLOR[badge.rarity]

  return (
    <div
      onMouseEnter={()=>setHovered(true)}
      onMouseLeave={()=>setHovered(false)}
      style={{
        background: unlocked ? r.bg : 'rgba(255,255,255,0.02)',
        borderRadius:16,
        border:`1.5px solid ${unlocked?(hovered?r.text:r.border):'rgba(255,255,255,0.06)'}`,
        padding:'20px 16px',
        display:'flex',flexDirection:'column',alignItems:'center',gap:10,
        textAlign:'center',position:'relative',overflow:'hidden',
        boxShadow: unlocked&&hovered ? `0 0 30px ${r.glow}` : 'none',
        opacity: mounted ? 1 : 0,
        transform: mounted ? 'translateY(0) scale(1)' : 'translateY(20px) scale(0.95)',
        transition:`all 0.4s cubic-bezier(0.34,1.2,0.64,1) ${idx*40}ms`,
        cursor:'default',
        filter: unlocked ? 'none' : 'grayscale(0.8)',
      }}
    >
      {/* Glow orb behind icon */}
      {unlocked && (
        <div style={{position:'absolute',top:0,left:'50%',transform:'translateX(-50%)',
          width:80,height:80,background:`radial-gradient(circle,${r.glow},transparent 70%)`,
          pointerEvents:'none'}}/>
      )}

      {/* Lock overlay */}
      {!unlocked && (
        <div style={{position:'absolute',inset:0,display:'flex',alignItems:'center',justifyContent:'center',background:'rgba(0,0,0,0.2)',zIndex:2,borderRadius:16}}>
          <span style={{fontSize:18,opacity:0.3}}>🔒</span>
        </div>
      )}

      {/* Rarity label */}
      <div style={{position:'absolute',top:10,right:10,fontSize:8,fontWeight:700,
        color:unlocked?r.text:'#333',letterSpacing:'0.08em',
        background:unlocked?`${r.text}18`:'transparent',
        border:unlocked?`1px solid ${r.text}33`:'none',
        borderRadius:50,padding:'2px 7px',textTransform:'uppercase'}}>
        {badge.rarity}
      </div>

      {/* Icon */}
      <div style={{fontSize:unlocked?44:36,filter:unlocked?`drop-shadow(0 0 10px ${r.glow})`:'none',
        animation:unlocked&&hovered?'badgeBounce 0.5s ease':'none',position:'relative',zIndex:1}}>
        {badge.icon}
      </div>

      {/* Title */}
      <div style={{fontSize:12,fontWeight:700,color:unlocked?r.text:'#444',lineHeight:1.3}}>{badge.title}</div>

      {/* Desc */}
      <div style={{fontSize:10,color:unlocked?'#7a7570':'#333',lineHeight:1.5}}>{badge.desc}</div>

      {/* XP */}
      <div style={{fontSize:10,fontWeight:700,
        color:unlocked?r.text:'#333',
        background:unlocked?`${r.text}15`:'rgba(255,255,255,0.03)',
        border:`1px solid ${unlocked?r.text+'33':'rgba(255,255,255,0.05)'}`,
        borderRadius:50,padding:'3px 10px'}}>
        {unlocked?`+${badge.xp} XP`:`${badge.xp} XP`}
      </div>

      {/* Progress bar (for locked) */}
      {!unlocked && progress !== null && progress !== undefined && (
        <div style={{width:'100%'}}>
          <div style={{height:3,background:'rgba(255,255,255,0.06)',borderRadius:50,overflow:'hidden'}}>
            <div style={{height:'100%',background:'rgba(245,200,66,0.4)',borderRadius:50,
              width:`${Math.min(progress*100,100)}%`,transition:'width 1s ease'}}/>
          </div>
          <div style={{fontSize:9,color:'#444',marginTop:4}}>{Math.round(progress*100)}% there</div>
        </div>
      )}
    </div>
  )
}

// ── MAIN ─────────────────────────────────────────────
export default function Achievements() {
  const canvasRef = useRef(null)
  const [category,setCategory] = useState('All')
  const [showOnly,setShowOnly] = useState('all') // all | unlocked | locked

  const profile = (() => {
    try {
      const p=JSON.parse(localStorage.getItem('hittrack_profile')||'{}')
      const s=JSON.parse(localStorage.getItem('hittrack_stats')||'{}')
      return {...p,...s}
    } catch { return {} }
  })()

  const totalWorkouts = profile.totalWorkouts || 0
  const streak        = profile.streak        || 0
  const weeklyPct     = profile.weeklyPct     || 0
  const currentLevel  = profile.currentLevel  || profile.experience || 'Beginner'
  const rank          = calcRank(totalWorkouts, streak, weeklyPct, currentLevel)

  const stats = { totalWorkouts, streak, weeklyPct, rank }

  // Determine which badges are unlocked
  const badgeStatus = BADGES.map(b => ({
    ...b,
    unlocked: b.condition(stats),
  }))

  const unlockedCount = badgeStatus.filter(b=>b.unlocked).length
  const totalXP       = badgeStatus.filter(b=>b.unlocked).reduce((a,b)=>a+b.xp, 0)
  const totalPossibleXP = BADGES.reduce((a,b)=>a+b.xp,0)

  // Filter
  const filtered = badgeStatus
    .filter(b => category === 'All' || b.category === category)
    .filter(b => showOnly === 'all' || (showOnly==='unlocked'?b.unlocked:!b.unlocked))

  // Progress for locked badges
  function getProgress(badge) {
    if(badge.id.startsWith('w')) {
      const needed = [1,10,20,30,50,100]
      const n = needed[['w1','w2','w3','w4','w5','w6'].indexOf(badge.id)]
      return n ? totalWorkouts/n : null
    }
    if(badge.id.startsWith('s')) {
      const needed = [3,7,14,30]
      const n = needed[['s1','s2','s3','s4'].indexOf(badge.id)]
      return n ? streak/n : null
    }
    if(badge.id.startsWith('c')) {
      return weeklyPct/[50,75,100][['c1','c2','c3'].indexOf(badge.id)]
    }
    return null
  }

  // Canvas background
  useEffect(()=>{
    const canvas=canvasRef.current; if(!canvas)return
    const ctx=canvas.getContext('2d'); let animId,t=0
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight}
    resize(); window.addEventListener('resize',resize)
    const draw=()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height); t+=0.005
      ctx.strokeStyle='rgba(245,200,66,0.025)'; ctx.lineWidth=1
      const g=80
      for(let x=0;x<canvas.width+g;x+=g){const o=(t*15)%g;ctx.beginPath();ctx.moveTo(x-o,0);ctx.lineTo(x-o,canvas.height);ctx.stroke()}
      for(let y=0;y<canvas.height+g;y+=g){const o=(t*8)%g;ctx.beginPath();ctx.moveTo(0,y-o);ctx.lineTo(canvas.width,y-o);ctx.stroke()}
      const orbs=[
        {x:canvas.width*0.1,y:canvas.height*0.2,r:300,c:'rgba(245,200,66,0.04)'},
        {x:canvas.width*0.9,y:canvas.height*0.6,r:280,c:'rgba(232,74,47,0.03)'},
        {x:canvas.width*0.5,y:canvas.height*0.9,r:250,c:'rgba(192,132,252,0.03)'},
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

  return (
    <>
      <Navbar user={{name:profile.name||'Athlete'}}/>
      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',zIndex:0,pointerEvents:'none'}}/>

      <div style={{position:'relative',zIndex:1,maxWidth:1300,margin:'0 auto',padding:'28px 40px 60px',display:'flex',flexDirection:'column',gap:20,fontFamily:'Montserrat,sans-serif'}}>

        {/* HEADER */}
        <div style={{...glass({borderRadius:20}),padding:'28px 36px',display:'flex',alignItems:'center',justifyContent:'space-between',position:'relative',overflow:'hidden',border:'1px solid rgba(245,200,66,0.2)'}}>
          <div style={{position:'absolute',top:-40,right:200,fontSize:140,opacity:0.04,filter:'blur(2px)',userSelect:'none',animation:'trophyFloat 4s ease infinite'}}>🏆</div>
          <div style={{position:'relative',zIndex:1}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:36,letterSpacing:'0.06em',color:'#f0ece8',lineHeight:1}}>
              🏆 Achievements
            </div>
            <div style={{fontSize:13,color:'#7a7570',marginTop:4}}>
              {profile.name||'Athlete'} · Collect badges by training consistently
            </div>
          </div>

          {/* Summary stats */}
          <div style={{display:'flex',gap:12,position:'relative',zIndex:1}}>
            {[
              {label:'Unlocked',  val:`${unlockedCount}/${BADGES.length}`, color:'#f5c842'},
              {label:'Total XP',  val:totalXP.toLocaleString(),            color:'#4ade80'},
              {label:'Completion',val:`${Math.round((unlockedCount/BADGES.length)*100)}%`, color:'#e84a2f'},
            ].map((st,i)=>(
              <div key={i} style={{textAlign:'center',background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:14,padding:'14px 20px',minWidth:100}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:st.color,lineHeight:1}}>{st.val}</div>
                <div style={{fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.1em',marginTop:4,textTransform:'uppercase'}}>{st.label}</div>
              </div>
            ))}
          </div>
        </div>

        {/* XP Progress bar */}
        <div style={{...glass({borderRadius:14}),padding:'16px 24px'}}>
          <div style={{display:'flex',justifyContent:'space-between',marginBottom:8}}>
            <span style={{fontSize:11,fontWeight:700,color:'#7a7570',letterSpacing:'0.08em',textTransform:'uppercase'}}>Overall XP Progress</span>
            <span style={{fontSize:11,fontWeight:700,color:'#f5c842'}}>{totalXP.toLocaleString()} / {totalPossibleXP.toLocaleString()} XP</span>
          </div>
          <div style={{height:10,background:'rgba(255,255,255,0.06)',borderRadius:50,overflow:'hidden',position:'relative'}}>
            <div style={{position:'absolute',inset:0,background:'repeating-linear-gradient(90deg,transparent,transparent 40px,rgba(255,255,255,0.03) 40px,rgba(255,255,255,0.03) 41px)'}}/>
            <div style={{height:'100%',background:'linear-gradient(90deg,#e84a2f,#f5c842,#4ade80)',borderRadius:50,
              width:`${(totalXP/totalPossibleXP)*100}%`,transition:'width 1.2s ease',
              boxShadow:'0 0 20px rgba(245,200,66,0.4)'}}/>
          </div>
          <div style={{display:'flex',justifyContent:'space-between',marginTop:8}}>
            <span style={{fontSize:10,color:'#555'}}>Beginner</span>
            <span style={{fontSize:10,color:'#555'}}>Intermediate</span>
            <span style={{fontSize:10,color:'#555'}}>Advanced</span>
            <span style={{fontSize:10,color:'#555'}}>Expert</span>
            <span style={{fontSize:10,color:'#555'}}>Legend</span>
          </div>
        </div>

        {/* FILTERS */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:16,flexWrap:'wrap'}}>
          {/* Category filter */}
          <div style={{display:'flex',gap:4,background:'rgba(255,255,255,0.03)',borderRadius:50,padding:4,border:'1px solid rgba(255,255,255,0.06)',flexWrap:'wrap'}}>
            {CATEGORIES.map(cat=>(
              <button key={cat}
                style={{background:category===cat?'rgba(245,200,66,0.15)':'transparent',
                  color:category===cat?'#f5c842':'#555',
                  border:category===cat?'1px solid rgba(245,200,66,0.3)':'1px solid transparent',
                  borderRadius:50,padding:'7px 18px',fontSize:11,fontWeight:700,cursor:'pointer',transition:'all 0.2s'}}
                onClick={()=>setCategory(cat)}>
                {cat}
              </button>
            ))}
          </div>

          {/* Show filter */}
          <div style={{display:'flex',gap:4,background:'rgba(255,255,255,0.03)',borderRadius:50,padding:4,border:'1px solid rgba(255,255,255,0.06)'}}>
            {[['all','All'],['unlocked','Unlocked ✓'],['locked','Locked 🔒']].map(([val,label])=>(
              <button key={val}
                style={{background:showOnly===val?'rgba(74,222,128,0.12)':'transparent',
                  color:showOnly===val?'#4ade80':'#555',
                  border:showOnly===val?'1px solid rgba(74,222,128,0.25)':'1px solid transparent',
                  borderRadius:50,padding:'7px 16px',fontSize:11,fontWeight:700,cursor:'pointer',transition:'all 0.2s'}}
                onClick={()=>setShowOnly(val)}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* BADGE GRID */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(160px,1fr))',gap:14}}>
          {filtered.map((badge,i)=>(
            <BadgeCard key={badge.id} badge={badge} unlocked={badge.unlocked}
              progress={badge.unlocked?null:getProgress(badge)} idx={i}/>
          ))}
        </div>

        {filtered.length===0&&(
          <div style={{...glass({borderRadius:16}),padding:'40px',textAlign:'center'}}>
            <div style={{fontSize:36,marginBottom:12}}>🔍</div>
            <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:6}}>No badges found</div>
            <div style={{fontSize:12,color:'#555'}}>Try changing your filter</div>
          </div>
        )}

      </div>
      <style>{`
        @keyframes trophyFloat{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-8px) rotate(3deg)}}
        @keyframes badgeBounce{0%,100%{transform:scale(1)}50%{transform:scale(1.2)}}
      `}</style>
    </>
  )
}

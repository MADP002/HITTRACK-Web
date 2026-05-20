import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { signOut } from 'firebase/auth'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase'
import { useIsMobile } from '../lib/useIsMobile'

const LogoIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
    <rect x="2" y="9" width="4" height="6" rx="2" fill="#e84a2f"/>
    <rect x="18" y="9" width="4" height="6" rx="2" fill="#e84a2f"/>
    <rect x="6" y="7" width="12" height="10" rx="2" fill="#e84a2f" opacity="0.3"/>
    <rect x="6" y="10" width="12" height="4" rx="1" fill="#e84a2f"/>
  </svg>
)

// ── Realtime unread-message counter ──────────────────
function useUnreadCount(){
  const [count,setCount]=useState(0)
  useEffect(()=>{
    const uid=auth.currentUser?.uid
    if(!uid) return
    const q=query(collection(db,'messages'),where('participants','array-contains',uid))
    const unsub=onSnapshot(q,(snap)=>{
      let readMap={}
      try{readMap=JSON.parse(localStorage.getItem('hittrack_inbox_read')||'{}')}catch{}
      let c=0
      snap.docs.forEach(d=>{
        const m=d.data()
        if(m.from===uid) return
        const otherUid=m.participants?.find(p=>p!==uid)
        const lastRead=readMap[otherUid]||0
        const ts=m.createdAt?.seconds||0
        if(ts>lastRead) c++
      })
      setCount(c)
    },(err)=>console.error('Unread counter error:',err))
    return ()=>unsub()
  },[])
  return count
}

export default function Navbar({ user }) {
  const navigate = useNavigate()
  const initial  = user?.name ? user.name[0].toUpperCase() : 'U'
  const [showLogout, setShowLogout] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)  // mobile drawer
  const unread = useUnreadCount()
  const isMobile = useIsMobile()

  async function handleLogout() {
    await signOut(auth)
    localStorage.clear()
    navigate('/login')
  }

  function navAndClose(path) { setMenuOpen(false); navigate(path) }

  const LINKS = [
    { to:'/home',         label:'Home' },
    { to:'/forum',        label:'Forum' },
    { to:'/leaderboard',  label:'Leaderboard' },
    { to:'/stats',        label:'Stats' },
    { to:'/achievements', label:'Achievements' },
    { to:'/about',        label:'About Us' },
  ]

  return (
    <>
      <nav className="nav" style={isMobile ? { padding:'10px 14px', justifyContent:'space-between' } : undefined}>
        <div className="nav-logo-icon"><LogoIcon /></div>

        {/* DESKTOP: full link row + right cluster */}
        {!isMobile && (
          <div className="nav-links">
            {LINKS.map(l => (
              <NavLink key={l.to} to={l.to}
                className={({isActive})=>'nav-link'+(isActive?' active':'')}>
                {l.label}
              </NavLink>
            ))}
          </div>
        )}
        {!isMobile && (
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <NavLink to="/inbox" title="Inbox"
              style={({isActive})=>({position:'relative',width:36,height:36,borderRadius:'50%',background:isActive?'rgba(245,200,66,0.15)':'rgba(255,255,255,0.04)',border:`1px solid ${isActive?'rgba(245,200,66,0.35)':'rgba(255,255,255,0.08)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,textDecoration:'none',transition:'all 0.2s'})}>
              💬
              {unread>0 && (
                <span style={{position:'absolute',top:-4,right:-4,minWidth:18,height:18,borderRadius:50,background:'#e84a2f',color:'#fff',fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 5px',border:'2px solid #0c0a0a',boxShadow:'0 2px 8px rgba(232,74,47,0.4)',fontFamily:'Montserrat,sans-serif'}}>
                  {unread>99?'99+':unread}
                </span>
              )}
            </NavLink>
            <button onClick={()=>setShowLogout(true)} style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.2)',borderRadius:50,padding:'6px 14px',fontSize:11,fontWeight:700,color:'#e84a2f',cursor:'pointer',fontFamily:'Montserrat,sans-serif'}}>Logout</button>
            <div className="nav-avatar" onClick={()=>navigate('/profile')} title="Profile" style={{cursor:'pointer'}}>
              {user?.avatar
                ? <img src={user.avatar} alt="avatar" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/>
                : initial}
            </div>
          </div>
        )}

        {/* MOBILE: inbox + hamburger */}
        {isMobile && (
          <div style={{display:'flex',alignItems:'center',gap:6}}>
            <NavLink to="/inbox" title="Inbox"
              style={({isActive})=>({position:'relative',width:38,height:38,borderRadius:'50%',background:isActive?'rgba(245,200,66,0.15)':'rgba(255,255,255,0.04)',border:`1px solid ${isActive?'rgba(245,200,66,0.35)':'rgba(255,255,255,0.08)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,textDecoration:'none'})}>
              💬
              {unread>0 && (
                <span style={{position:'absolute',top:-3,right:-3,minWidth:16,height:16,borderRadius:50,background:'#e84a2f',color:'#fff',fontSize:8,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 4px',border:'2px solid #0c0a0a'}}>
                  {unread>9?'9+':unread}
                </span>
              )}
            </NavLink>
            <button onClick={()=>setMenuOpen(o=>!o)} aria-label="Menu"
              style={{
                width:42,height:42,borderRadius:11,
                background:menuOpen?'rgba(232,74,47,0.18)':'rgba(255,255,255,0.04)',
                border:`1px solid ${menuOpen?'rgba(232,74,47,0.35)':'rgba(255,255,255,0.08)'}`,
                display:'flex',alignItems:'center',justifyContent:'center',
                flexDirection:'column',gap:4,cursor:'pointer',padding:0,
                transition:'all 0.2s ease',
              }}>
              {[0,1,2].map(i=>(
                <span key={i} style={{
                  display:'block',width:18,height:2,borderRadius:1,
                  background:menuOpen?'#e84a2f':'#f0ece8',
                  transition:'all 0.25s ease',
                  transform:
                    menuOpen && i===0 ? 'translateY(6px) rotate(45deg)' :
                    menuOpen && i===2 ? 'translateY(-6px) rotate(-45deg)' :
                    'none',
                  opacity: menuOpen && i===1 ? 0 : 1,
                }}/>
              ))}
            </button>
          </div>
        )}
      </nav>

      {/* MOBILE DRAWER */}
      {isMobile && menuOpen && (
        <>
          <div onClick={()=>setMenuOpen(false)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',backdropFilter:'blur(6px)',zIndex:998,animation:'fadeIn 0.2s ease'}}/>
          <div style={{
            position:'fixed',top:0,right:0,bottom:0,zIndex:999,
            width:'min(82%, 320px)',
            background:'linear-gradient(180deg,#161414 0%,#0e0a0a 100%)',
            borderLeft:'1px solid rgba(232,74,47,0.25)',
            boxShadow:'-20px 0 60px rgba(0,0,0,0.7)',
            display:'flex',flexDirection:'column',
            animation:'slideInRight 0.28s cubic-bezier(0.34,1.56,0.64,1)',
            fontFamily:'Montserrat,sans-serif',
          }}>
            <div style={{padding:'22px 18px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',alignItems:'center',gap:12,background:'linear-gradient(135deg,rgba(232,74,47,0.08),transparent 70%)'}}>
              <div className="nav-avatar" onClick={()=>navAndClose('/profile')} style={{cursor:'pointer',width:46,height:46,fontSize:18}}>
                {user?.avatar
                  ? <img src={user.avatar} alt="avatar" style={{width:'100%',height:'100%',objectFit:'cover',borderRadius:'50%'}}/>
                  : initial}
              </div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontSize:13,fontWeight:700,color:'#f0ece8',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{user?.name||'Member'}</div>
                <div style={{fontSize:10,color:'#666',marginTop:2,letterSpacing:'0.04em',textTransform:'uppercase',fontWeight:600}}>Tap to view profile</div>
              </div>
            </div>
            <div style={{flex:1,padding:'10px 0',display:'flex',flexDirection:'column',gap:2,overflowY:'auto'}}>
              {LINKS.map(l => (
                <NavLink key={l.to} to={l.to} onClick={()=>setMenuOpen(false)}
                  style={({isActive})=>({
                    padding:'14px 22px',fontSize:14,fontWeight:700,
                    color:isActive?'#e84a2f':'#d4cfc9',
                    background:isActive?'rgba(232,74,47,0.08)':'transparent',
                    borderLeft:`3px solid ${isActive?'#e84a2f':'transparent'}`,
                    textDecoration:'none',transition:'all 0.15s',
                    letterSpacing:'0.02em',
                  })}>
                  {l.label}
                </NavLink>
              ))}
            </div>
            <div style={{padding:'14px 18px',borderTop:'1px solid rgba(255,255,255,0.05)'}}>
              <button onClick={()=>{setMenuOpen(false);setShowLogout(true)}}
                style={{width:'100%',background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:12,padding:'13px',fontSize:12,fontWeight:800,color:'#e84a2f',cursor:'pointer',letterSpacing:'0.06em'}}>
                LOGOUT
              </button>
            </div>
          </div>
        </>
      )}

      <style>{`
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideInRight {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
      `}</style>

      {showLogout&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Montserrat,sans-serif',padding:16}}>
          <div style={{background:'linear-gradient(135deg,rgba(22,20,20,0.99),rgba(14,12,12,0.99))',borderRadius:20,border:'1px solid rgba(232,74,47,0.2)',boxShadow:'0 20px 60px rgba(0,0,0,0.6)',padding:isMobile?'30px 24px':'40px',maxWidth:380,width:'100%',textAlign:'center'}}>
            <div style={{fontSize:44,marginBottom:12}}>👋</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#f0ece8',marginBottom:8}}>LOG OUT?</div>
            <div style={{fontSize:13,color:'#7a7570',lineHeight:1.7,marginBottom:24}}>Are you sure you want to sign out of HITTRACK?</div>
            <div style={{display:'flex',gap:12,justifyContent:'center'}}>
              <button onClick={()=>setShowLogout(false)} style={{background:'transparent',color:'#555',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Cancel</button>
              <button onClick={handleLogout} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 16px rgba(232,74,47,0.4)'}}>Yes, Logout</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}

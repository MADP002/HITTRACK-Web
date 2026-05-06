import { NavLink, useNavigate } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { signOut } from 'firebase/auth'
import { collection, query, where, onSnapshot } from 'firebase/firestore'
import { auth, db } from '../firebase'

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
  const unread = useUnreadCount()

  async function handleLogout() {
    await signOut(auth)
    localStorage.clear()
    navigate('/login')
  }

  return (
    <>
      <nav className="nav">
        <div className="nav-logo-icon"><LogoIcon /></div>
        <div className="nav-links">
          <NavLink to="/home"         className={({isActive})=>'nav-link'+(isActive?' active':'')}>Home</NavLink>
          <NavLink to="/leaderboard"  className={({isActive})=>'nav-link'+(isActive?' active':'')}>Leaderboard</NavLink>
          <NavLink to="/stats"        className={({isActive})=>'nav-link'+(isActive?' active':'')}>Stats</NavLink>
          <NavLink to="/achievements" className={({isActive})=>'nav-link'+(isActive?' active':'')}>Achievements</NavLink>
          <NavLink to="/about"        className={({isActive})=>'nav-link'+(isActive?' active':'')}>About Us</NavLink>
        </div>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          {/* Inbox icon with unread badge */}
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
      </nav>

      {showLogout&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:9999,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:'Montserrat,sans-serif'}}>
          <div style={{background:'linear-gradient(135deg,rgba(22,20,20,0.99),rgba(14,12,12,0.99))',borderRadius:20,border:'1px solid rgba(232,74,47,0.2)',boxShadow:'0 20px 60px rgba(0,0,0,0.6)',padding:'40px',maxWidth:380,width:'90%',textAlign:'center'}}>
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

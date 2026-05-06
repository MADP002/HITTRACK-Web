import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, setDoc, serverTimestamp, query, where, orderBy, onSnapshot } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../firebase'
import InboxView from '../components/InboxView'

// ── CONSTANTS ─────────────────────────────────────────
const LEVEL_COLOR = { Beginner:'#fb923c', Intermediate:'#f5c842', Advanced:'#4ade80' }
const LEVEL_ICON  = { Beginner:'🥊', Intermediate:'⚡', Advanced:'🔥' }
const LEVEL_BONUS = { Beginner:0, Intermediate:150, Advanced:350 }
const LEVELS      = ['Beginner','Intermediate','Advanced']
const LEVEL_DIVS  = ['All Levels','Beginner','Intermediate','Advanced']
const GOAL_DIVS   = ['All Goals','Learn Boxing','Lose Weight','Build Strength','Compete']
const DAYS        = ['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday']
const TIMES       = ['6:00 AM','7:00 AM','8:00 AM','9:00 AM','10:00 AM','11:00 AM','12:00 PM','1:00 PM','2:00 PM','3:00 PM','4:00 PM','5:00 PM','6:00 PM','7:00 PM','8:00 PM']
const GOAL_ICONS  = { 'Learn Boxing':'🥊', 'Lose Weight':'⚡', 'Build Strength':'💪', 'Compete':'🏆' }
const GOAL_COLORS = { 'Learn Boxing':'#f5c842', 'Lose Weight':'#42a5f5', 'Build Strength':'#4ade80', 'Compete':'#c084fc' }

function calcScore(u){ return ((u.totalWorkouts||0)*10)+((u.streak||0)*5)+(LEVEL_BONUS[u.experience]||0)+Math.round((u.weeklyPct||0)*1.5) }

// ── Cinematic stat card (Session 3A) ────────────────
function StatCard({icon,label,value,trend,subtext,color='gold'}){
  const COLORS={
    gold:    {accent:'#f5c842',glow:'rgba(245,200,66,0.25)',border:'rgba(245,200,66,0.3)'},
    success: {accent:'#22c55e',glow:'rgba(34,197,94,0.25)',border:'rgba(34,197,94,0.3)'},
    info:    {accent:'#42a5f5',glow:'rgba(66,165,245,0.25)',border:'rgba(66,165,245,0.3)'},
    danger:  {accent:'#e84a2f',glow:'rgba(232,74,47,0.25)',border:'rgba(232,74,47,0.3)'},
    purple:  {accent:'#c084fc',glow:'rgba(192,132,252,0.25)',border:'rgba(192,132,252,0.3)'},
  }
  const c=COLORS[color]||COLORS.gold
  const [hover,setHover]=useState(false)
  return(
    <div onMouseEnter={()=>setHover(true)} onMouseLeave={()=>setHover(false)}
      style={{
        position:'relative',overflow:'hidden',cursor:'default',
        background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',
        borderRadius:18,padding:'24px 22px',
        border:`1px solid ${hover?c.border:'rgba(255,255,255,0.06)'}`,
        transform:hover?'translateY(-6px)':'translateY(0)',
        boxShadow:hover?`0 16px 40px rgba(0,0,0,0.6),0 0 30px ${c.glow}`:'0 4px 16px rgba(0,0,0,0.4)',
        transition:'all 0.5s cubic-bezier(0.34,1.56,0.64,1)',
      }}>
      <div style={{position:'absolute',inset:0,opacity:hover?1:0,transition:'opacity 0.4s ease',background:`radial-gradient(circle at top right,${c.glow} 0%,transparent 60%)`,pointerEvents:'none'}}/>
      <div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:`linear-gradient(180deg,${c.accent},transparent)`,transform:hover?'scaleY(1)':'scaleY(0)',transformOrigin:'top',transition:'transform 0.4s cubic-bezier(0.65,0,0.35,1)'}}/>
      <div style={{position:'absolute',right:-12,top:-8,fontSize:72,opacity:hover?0.10:0.04,transform:hover?'rotate(-8deg) scale(1.1)':'rotate(0) scale(1)',transition:'all 0.5s ease',pointerEvents:'none'}}>{icon}</div>
      <div style={{position:'relative',fontSize:10,fontWeight:700,letterSpacing:'0.18em',textTransform:'uppercase',color:c.accent,marginBottom:12,display:'flex',alignItems:'center',gap:8}}>
        <span style={{display:'inline-block',width:hover?40:24,height:2,background:c.accent,transition:'width 0.4s ease'}}/>
        {label}
      </div>
      <div style={{position:'relative',fontFamily:"'Bebas Neue',sans-serif",fontSize:52,lineHeight:0.95,color:'#f0ece8',marginBottom:6,textShadow:'0 2px 20px rgba(0,0,0,0.4)'}}>{value}</div>
      {(trend||subtext)&&(
        <div style={{position:'relative',display:'flex',alignItems:'center',gap:8,fontSize:10,color:'#666',fontWeight:600,letterSpacing:'0.05em',flexWrap:'wrap'}}>
          {trend&&<span style={{background:`${c.accent}26`,color:c.accent,padding:'2px 9px',borderRadius:50,fontWeight:700}}>{trend}</span>}
          {subtext&&<span>{subtext}</span>}
        </div>
      )}
    </div>
  )
}

const glass=(e={})=>({
  background:'linear-gradient(135deg,rgba(22,20,20,0.97),rgba(14,12,12,0.99))',
  borderRadius:16,border:'1px solid rgba(255,255,255,0.07)',
  boxShadow:'0 4px 24px rgba(0,0,0,0.5)',...e
})

function ConfirmModal({ title, message, onConfirm, onCancel, danger=true }) {
  return (
    <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center'}}>
      <div style={{...glass(),padding:'36px 40px',maxWidth:400,width:'90%',textAlign:'center',border:`1px solid ${danger?'rgba(232,74,47,0.3)':'rgba(245,200,66,0.3)'}`}}>
        <div style={{fontSize:40,marginBottom:12}}>{danger?'⚠️':'❓'}</div>
        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:'#f0ece8',marginBottom:8}}>{title}</div>
        <div style={{fontSize:13,color:'#7a7570',lineHeight:1.7,marginBottom:24}}>{message}</div>
        <div style={{display:'flex',gap:12,justifyContent:'center'}}>
          <button onClick={onCancel} style={{background:'transparent',color:'#555',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Cancel</button>
          <button onClick={onConfirm} style={{background:danger?'linear-gradient(135deg,#e84a2f,#c93820)':'linear-gradient(135deg,#4ade80,#22c55e)',color:danger?'#fff':'#000',border:'none',borderRadius:50,padding:'10px 24px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Confirm</button>
        </div>
      </div>
    </div>
  )
}

// Leaderboard Row (same style as client leaderboard)
function LBRow({user,maxScore,idx}){
  const [show,setShow]=useState(false)
  const [barW,setBarW]=useState(0)
  useEffect(()=>{
    const t1=setTimeout(()=>setShow(true),idx*40)
    const t2=setTimeout(()=>setBarW(maxScore>0?(user.score/maxScore)*100:0),idx*40+400)
    return()=>{clearTimeout(t1);clearTimeout(t2)}
  },[])
  const lc=LEVEL_COLOR[user.experience]||'#f5c842'
  const rc=user.rank<=3?['#f5c842','#c8d6e5','#cd7f32'][user.rank-1]:lc
  const medals={1:'🥇',2:'🥈',3:'🥉'}
  return(
    <div style={{display:'flex',alignItems:'center',padding:'13px 22px',
      background:user.rank<=3?['rgba(245,200,66,0.05)','rgba(200,214,229,0.03)','rgba(205,127,50,0.03)'][user.rank-1]:'transparent',
      borderBottom:'1px solid rgba(255,255,255,0.04)',
      opacity:show?1:0,transform:show?'none':'translateX(-20px)',transition:`all 0.4s ease ${idx*40}ms`}}
      onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.025)'}
      onMouseLeave={e=>e.currentTarget.style.background=user.rank<=3?['rgba(245,200,66,0.05)','rgba(200,214,229,0.03)','rgba(205,127,50,0.03)'][user.rank-1]:'transparent'}>
      <div style={{width:48,flexShrink:0,textAlign:'center',fontSize:user.rank<=3?20:13,fontWeight:700,color:user.rank<=3?rc:'#555'}}>
        {medals[user.rank]||`#${user.rank}`}
      </div>
      <div style={{width:38,height:38,borderRadius:'50%',flexShrink:0,background:`${lc}22`,border:`1.5px solid ${lc}55`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:lc,marginRight:12}}>
        {(user.name||'?')[0].toUpperCase()}
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8}}>
          <span style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{user.name}</span>
          {(user.streak||0)>=14&&<span style={{fontSize:9,background:'rgba(232,74,47,0.15)',color:'#e84a2f',border:'1px solid rgba(232,74,47,0.3)',borderRadius:50,padding:'2px 6px',fontWeight:700}}>🔥HOT</span>}
        </div>
        <div style={{fontSize:10,color:'#555',marginTop:1}}>{user.goal||'—'}</div>
      </div>
      <div style={{width:110,flexShrink:0}}>
        <div style={{display:'inline-flex',alignItems:'center',gap:4,background:`${lc}15`,border:`1px solid ${lc}30`,borderRadius:50,padding:'3px 9px'}}>
          <span style={{fontSize:10}}>{LEVEL_ICON[user.experience]||'🥊'}</span>
          <span style={{fontSize:9,fontWeight:700,color:lc}}>{user.experience||'Beginner'}</span>
        </div>
      </div>
      <div style={{width:70,flexShrink:0,display:'flex',alignItems:'center',gap:3}}>
        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#f0ece8'}}>{user.totalWorkouts||0}</span>
        <span style={{fontSize:10}}>🥊</span>
      </div>
      <div style={{width:80,flexShrink:0,fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:(user.streak||0)>0?'#e84a2f':'#333'}}>🔥{user.streak||0}d</div>
      <div style={{width:160,flexShrink:0,display:'flex',alignItems:'center',gap:8}}>
        <div style={{flex:1,height:5,background:'rgba(255,255,255,0.06)',borderRadius:50,overflow:'hidden'}}>
          <div style={{height:'100%',borderRadius:50,background:`linear-gradient(90deg,${rc},${rc}cc)`,width:`${barW}%`,transition:'width 1s ease',boxShadow:`0 0 6px ${rc}88`}}/>
        </div>
        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:rc,minWidth:40,textAlign:'right'}}>{user.score.toLocaleString()}</span>
      </div>
    </div>
  )
}

export default function AdminDashboard() {
  const navigate   = useNavigate()
  const canvasRef  = useRef(null)
  const msgEndRef  = useRef(null)
  const [tab,setTab]           = useState('overview')
  const [members,setMembers]   = useState([])
  const [coaches,setCoaches]   = useState([])
  const [pending,setPending]   = useState([])
  const [classes,setClasses]   = useState([])
  const [bookings,setBookings] = useState([])
  const [notifs,setNotifs]     = useState([])
  const [loading,setLoading]   = useState(true)
  const [toast,setToast]       = useState({msg:'',type:'success'})
  const [confirm,setConfirm]   = useState(null)
  const [searchQ,setSearchQ]   = useState('')
  const [lbLevel,setLbLevel]   = useState('All Levels')
  const [lbGoal,setLbGoal]     = useState('All Goals')
  const [lbSearch,setLbSearch] = useState('')
  const [logoutConfirm,setLogoutConfirm] = useState(false)
  const [showNewClass,setShowNewClass]   = useState(false)
  const [newClass,setNewClass]           = useState({name:'',day:'Monday',time:'6:00 AM',spots:'12',level:'Beginner',coach:''})
  const [deleteClassId,setDeleteClassId] = useState(null)
  const [showNotif,setShowNotif]         = useState(false)
  const [notifForm,setNotifForm]         = useState({title:'',message:'',audience:'all'})
  const [editingNotifId,setEditingNotifId] = useState(null)
  const [deleteNotifId,setDeleteNotifId]   = useState(null)
  const [msgTarget,setMsgTarget]         = useState(null)
  const [msgThread,setMsgThread]         = useState([])
  const [msgText,setMsgText]             = useState('')
  const [sendingMsg,setSendingMsg]       = useState(false)
  const [adminProfile,setAdminProfile]   = useState({name:'Admin'})

  function showToast(msg,type='success'){setToast({msg,type});setTimeout(()=>setToast({msg:'',type:'success'}),3500)}

  useEffect(()=>{
    const user=auth.currentUser
    if(user) getDoc(doc(db,'users',user.uid)).then(s=>{if(s.exists())setAdminProfile(s.data())}).catch(()=>{})
  },[])

  const loadAll=useCallback(async()=>{
    try{
      const usersSnap=await getDocs(collection(db,'users'))
      const mems=[],coachs=[],pends=[]
      for(const d of usersSnap.docs){
        const data=d.data()
        let stats={}
        try{const ss=await getDoc(doc(db,'stats',d.id));if(ss.exists())stats=ss.data()}catch(e){}
        const merged={uid:d.id,...data,...stats}
        if(data.role==='member') mems.push(merged)
        else if(data.role==='coach') coachs.push(merged)
        else if(data.role==='coach_pending') pends.push(merged)
      }
      setMembers(mems);setCoaches(coachs);setPending(pends)
      const clsSnap=await getDocs(collection(db,'classes'))
      setClasses(clsSnap.docs.map(d=>({id:d.id,...d.data()})))
      const bkSnap=await getDocs(collection(db,'bookings'))
      setBookings(bkSnap.docs.map(d=>({id:d.id,...d.data()})))
    }catch(e){console.error(e)}
    setLoading(false)
  },[])

  // Load notifications with real-time
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,'notifications'),(snap)=>{
      const ns=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
      setNotifs(ns)
    },(e)=>console.error('Notif listener:',e))
    return()=>unsub()
  },[])

  useEffect(()=>{loadAll();const t=setInterval(loadAll,15000);return()=>clearInterval(t)},[])

  // Real-time messages for selected thread
  useEffect(()=>{
    if(!msgTarget)return
    const adminUid=auth.currentUser?.uid
    if(!adminUid)return
    const q=query(collection(db,'messages'),where('participants','array-contains',adminUid),orderBy('createdAt','asc'))
    const unsub=onSnapshot(q,(snap)=>{
      const all=snap.docs.map(d=>({id:d.id,...d.data()}))
      const thread=all.filter(m=>m.participants.includes(msgTarget.uid))
      setMsgThread(thread)
      setTimeout(()=>msgEndRef.current?.scrollIntoView({behavior:'smooth'}),100)
    },(e)=>console.error('Msg listener:',e))
    return()=>unsub()
  },[msgTarget])

  async function sendMessage(){
    if(!msgText.trim()||!msgTarget||sendingMsg)return
    setSendingMsg(true)
    const adminUid=auth.currentUser?.uid
    try{
      await addDoc(collection(db,'messages'),{
        participants:[adminUid,msgTarget.uid],
        from:adminUid,fromName:adminProfile.name||'Admin',
        to:msgTarget.uid,toName:msgTarget.name||'Member',
        text:msgText.trim(),
        createdAt:serverTimestamp(),
      })
      setMsgText('')
    }catch(e){
      console.error('Send message error:',e)
      showToast('❌ Failed to send. Check permissions.','error')
    }
    setSendingMsg(false)
  }

  async function toggleMemberStatus(uid,current){
    const next=current==='inactive'?'active':'inactive'
    try{
      await updateDoc(doc(db,'users',uid),{status:next})
      setMembers(prev=>prev.map(m=>m.uid===uid?{...m,status:next}:m))
      showToast(`✅ Member ${next==='active'?'activated':'deactivated'}`)
    }catch(e){showToast('❌ Error: '+e.message,'error')}
  }

  async function toggleCoachStatus(uid,current){
    const next=current==='inactive'?'active':'inactive'
    try{
      await updateDoc(doc(db,'users',uid),{status:next})
      setCoaches(prev=>prev.map(c=>c.uid===uid?{...c,status:next}:c))
      showToast(`✅ Coach ${next==='active'?'activated':'deactivated'}`)
    }catch(e){showToast('❌ Error: '+e.message,'error')}
  }

  async function approveCoach(uid){
    try{
      await updateDoc(doc(db,'users',uid),{role:'coach',approved:true,status:'active'})
      showToast('✅ Coach approved! They can now log in.')
      loadAll()
    }catch(e){showToast('❌ Error: '+e.message,'error')}
  }

  async function rejectCoach(uid){
    try{
      await updateDoc(doc(db,'users',uid),{role:'coach_rejected',approved:false})
      showToast('🗑 Coach application rejected')
      loadAll()
    }catch(e){showToast('❌ Error','error')}
  }

  async function createClass(){
    if(!newClass.name.trim()){showToast('❌ Please enter a class name','error');return}
    try{
      const coachName=newClass.coach||(coaches[0]?.name)||adminProfile.name||'Admin'
      await addDoc(collection(db,'classes'),{
        name:newClass.name.trim(),day:newClass.day,time:newClass.time,
        level:newClass.level,spots:parseInt(newClass.spots)||12,
        enrolled:0,coach:coachName,createdAt:serverTimestamp(),
      })
      setNewClass({name:'',day:'Monday',time:'6:00 AM',spots:'12',level:'Beginner',coach:''})
      setShowNewClass(false)
      loadAll()
      showToast('✅ Class created! Members can now see and book it.')
    }catch(e){showToast('❌ Failed: '+e.message,'error')}
  }

  async function deleteClassConfirmed(){
    if(!deleteClassId)return
    try{
      await deleteDoc(doc(db,'classes',deleteClassId))
      setDeleteClassId(null);loadAll();showToast('🗑 Class deleted')
    }catch(e){showToast('❌ Error','error')}
  }

  async function postNotification(){
    if(!notifForm.title.trim()||!notifForm.message.trim()){showToast('❌ Fill in title and message','error');return}
    try{
      if(editingNotifId){
        // EDIT MODE — update existing announcement
        await updateDoc(doc(db,'notifications',editingNotifId),{
          title:notifForm.title.trim(),
          message:notifForm.message.trim(),
          audience:notifForm.audience,
          editedAt:serverTimestamp(),
          editedBy:adminProfile.name||'Admin',
        })
        setEditingNotifId(null)
        setNotifForm({title:'',message:'',audience:'all'})
        setShowNotif(false)
        showToast('✏️ Announcement updated!')
      }else{
        // CREATE MODE — new announcement
        const notifRef=doc(collection(db,'notifications'))
        await setDoc(notifRef,{
          id:notifRef.id,
          title:notifForm.title.trim(),
          message:notifForm.message.trim(),
          audience:notifForm.audience,
          from:adminProfile.name||'Admin',
          fromUid:auth.currentUser?.uid||'',
          createdAt:serverTimestamp(),
        })
        setNotifForm({title:'',message:'',audience:'all'})
        setShowNotif(false)
        showToast('📢 Announcement sent to all members!')
      }
    }catch(e){
      console.error('Notification error:',e)
      showToast('❌ Permission denied. Check Firestore rules.','error')
    }
  }

  function startEditNotification(n){
    setEditingNotifId(n.id)
    setNotifForm({title:n.title||'',message:n.message||'',audience:n.audience||'all'})
    setShowNotif(true)
  }

  async function deleteNotificationConfirmed(){
    if(!deleteNotifId)return
    try{
      await deleteDoc(doc(db,'notifications',deleteNotifId))
      setDeleteNotifId(null)
      showToast('🗑 Announcement deleted')
    }catch(e){
      console.error('Delete notif error:',e)
      showToast('❌ Could not delete','error')
    }
  }

  async function handleLogout(){
    await signOut(auth);localStorage.clear();navigate('/login')
  }

  // Canvas bg
  useEffect(()=>{
    const canvas=canvasRef.current;if(!canvas)return
    const ctx=canvas.getContext('2d');let animId,t=0
    const resize=()=>{canvas.width=canvas.offsetWidth;canvas.height=canvas.offsetHeight}
    resize();window.addEventListener('resize',resize)
    const draw=()=>{
      ctx.clearRect(0,0,canvas.width,canvas.height);t+=0.003
      ctx.strokeStyle='rgba(232,74,47,0.015)';ctx.lineWidth=1
      const g=80
      for(let x=0;x<canvas.width+g;x+=g){const o=(t*10)%g;ctx.beginPath();ctx.moveTo(x-o,0);ctx.lineTo(x-o,canvas.height);ctx.stroke()}
      for(let y=0;y<canvas.height+g;y+=g){const o=(t*6)%g;ctx.beginPath();ctx.moveTo(0,y-o);ctx.lineTo(canvas.width,y-o);ctx.stroke()}
      [{x:canvas.width*.1,y:canvas.height*.2,r:300,c:'rgba(232,74,47,0.04)'},{x:canvas.width*.9,y:canvas.height*.5,r:280,c:'rgba(245,200,66,0.03)'}].forEach(o=>{
        const grd=ctx.createRadialGradient(o.x,o.y,0,o.x,o.y,o.r)
        grd.addColorStop(0,o.c);grd.addColorStop(1,'transparent')
        ctx.fillStyle=grd;ctx.beginPath();ctx.arc(o.x,o.y,o.r,0,Math.PI*2);ctx.fill()
      })
      animId=requestAnimationFrame(draw)
    }
    draw();return()=>{cancelAnimationFrame(animId);window.removeEventListener('resize',resize)}
  },[])

  const scored=[...members].map(m=>({...m,score:calcScore(m)})).sort((a,b)=>b.score-a.score).map((m,i)=>({...m,rank:i+1}))
  const maxScore=scored[0]?.score||1
  const filtered=members.filter(m=>m.name?.toLowerCase().includes(searchQ.toLowerCase())||m.email?.toLowerCase().includes(searchQ.toLowerCase()))
  const goalCounts=Object.keys(GOAL_ICONS).map(g=>({goal:g,count:members.filter(m=>m.goal===g).length}))
  const levelCounts=LEVELS.map(lv=>({level:lv,count:members.filter(m=>(m.experience||'Beginner')===lv).length}))

  const inp={background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,padding:'11px 14px',color:'#f0ece8',fontSize:13,fontFamily:'Montserrat,sans-serif',outline:'none',width:'100%',boxSizing:'border-box',transition:'border-color 0.2s'}
  const selStyle={...inp,cursor:'pointer',appearance:'none',WebkitAppearance:'none',backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%23555'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`,backgroundRepeat:'no-repeat',backgroundPosition:'right 12px center',paddingRight:32}

  const tabs=[{id:'overview',icon:'📊',label:'Overview'},{id:'members',icon:'👥',label:'Members'},{id:'inbox',icon:'💬',label:'Inbox'},{id:'coaches',icon:'🥊',label:`Coaches${pending.length>0?' ('+pending.length+')':''}`},{id:'classes',icon:'📋',label:'Classes'},{id:'leaderboard',icon:'🏆',label:'Leaderboard'},{id:'notifications',icon:'📢',label:'Notifications'}]

  return(
    <div style={{minHeight:'100vh',background:'#0c0a0a',fontFamily:'Montserrat,sans-serif',position:'relative'}}>
      <canvas ref={canvasRef} style={{position:'fixed',inset:0,width:'100%',height:'100%',zIndex:0,pointerEvents:'none'}}/>

      {/* Toast */}
      {toast.msg&&(
        <div style={{position:'fixed',top:20,right:20,zIndex:3000,background:toast.type==='error'?'rgba(232,74,47,0.15)':'rgba(22,20,20,0.97)',border:`1px solid ${toast.type==='error'?'rgba(232,74,47,0.4)':'rgba(74,222,128,0.4)'}`,borderRadius:12,padding:'12px 20px',fontSize:13,fontWeight:700,color:toast.type==='error'?'#e84a2f':'#4ade80',backdropFilter:'blur(12px)',maxWidth:360}}>
          {toast.msg}
        </div>
      )}

      {/* Modals */}
      {logoutConfirm&&<ConfirmModal title="Log Out?" message="Are you sure you want to sign out of the Admin Portal?" onConfirm={handleLogout} onCancel={()=>setLogoutConfirm(false)} danger={false}/>}
      {deleteClassId&&<ConfirmModal title="Delete Class?" message="This will permanently remove the class and all its bookings will no longer be valid." onConfirm={deleteClassConfirmed} onCancel={()=>setDeleteClassId(null)}/>}
      {confirm&&<ConfirmModal title={confirm.title} message={confirm.message} onConfirm={()=>{confirm.onConfirm();setConfirm(null)}} onCancel={()=>setConfirm(null)} danger={confirm.danger!==false}/>}

      <div style={{position:'relative',zIndex:1,maxWidth:1400,margin:'0 auto',padding:'20px 32px 60px',display:'flex',flexDirection:'column',gap:16}}>

        {/* TOPBAR */}
        <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',paddingBottom:8}}>
          <div style={{display:'flex',alignItems:'center',gap:12}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,letterSpacing:'0.06em',color:'#f0ece8'}}>HIT<span style={{color:'#e84a2f'}}>TRACK</span></div>
            <div style={{fontSize:10,fontWeight:700,color:'#e84a2f',background:'rgba(232,74,47,0.12)',border:'1px solid rgba(232,74,47,0.3)',borderRadius:50,padding:'4px 14px',letterSpacing:'0.1em'}}>ADMIN PORTAL</div>
            {pending.length>0&&<div style={{fontSize:10,fontWeight:700,color:'#f5c842',background:'rgba(245,200,66,0.12)',border:'1px solid rgba(245,200,66,0.3)',borderRadius:50,padding:'4px 12px'}}>⏳ {pending.length} pending coach{pending.length>1?'es':''}</div>}
          </div>
          <div style={{display:'flex',gap:8,alignItems:'center'}}>
            <span style={{fontSize:12,color:'#555'}}>Admin: <strong style={{color:'#f0ece8'}}>{adminProfile.name}</strong></span>
            <button onClick={()=>setShowNotif(true)} style={{background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.25)',borderRadius:50,padding:'7px 14px',fontSize:11,fontWeight:700,color:'#f5c842',cursor:'pointer'}}>📢 Announce</button>
            <button onClick={()=>setLogoutConfirm(true)} style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:50,padding:'7px 14px',fontSize:11,fontWeight:700,color:'#e84a2f',cursor:'pointer'}}>Logout →</button>
          </div>
        </div>

        {/* STAT CARDS — Session 3A cinematic */}
        <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:14}}>
          <StatCard icon="👥" label="Total Members" value={members.length} color="gold"
            trend={`${members.filter(m=>m.status!=='inactive').length} active`}/>
          <StatCard icon="⚡" label="Have Workouts" value={members.filter(m=>(m.totalWorkouts||0)>0).length} color="success"
            subtext="completed at least 1"/>
          <StatCard icon="⛔" label="Inactive" value={members.filter(m=>m.status==='inactive').length} color="danger"
            subtext="deactivated accounts"/>
          <StatCard icon="📋" label="Classes" value={classes.length} color="info"
            subtext={`${bookings.length} bookings total`}/>
          <StatCard icon="🥊" label="Coaches" value={coaches.length} color="purple"
            trend={pending.length>0?`+${pending.length} pending`:undefined}
            subtext={pending.length>0?undefined:'all approved'}/>
        </div>

        {/* TABS */}
        <div style={{display:'flex',gap:3,background:'rgba(255,255,255,0.03)',borderRadius:14,padding:4,border:'1px solid rgba(255,255,255,0.06)',flexWrap:'wrap'}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)}
              style={{background:tab===t.id?'rgba(232,74,47,0.2)':'transparent',color:tab===t.id?'#e84a2f':'#555',border:tab===t.id?'1px solid rgba(232,74,47,0.3)':'1px solid transparent',borderRadius:10,padding:'8px 16px',fontSize:11,fontWeight:700,cursor:'pointer',transition:'all 0.2s',whiteSpace:'nowrap'}}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* ── OVERVIEW ── */}
        {tab==='overview'&&(
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:16}}>
            <div style={glass()}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.05)',fontSize:13,fontWeight:700}}>📊 Level Distribution</div>
              <div style={{padding:'20px',display:'flex',flexDirection:'column',gap:16}}>
                {members.length===0?<div style={{textAlign:'center',color:'#555',fontSize:12,padding:20}}>No members yet</div>:levelCounts.map(({level,count})=>{
                  const color=LEVEL_COLOR[level]
                  const pct=members.length>0?Math.round((count/members.length)*100):0
                  return(
                    <div key={level}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:8}}>
                        <div style={{display:'flex',alignItems:'center',gap:8}}>
                          <div style={{width:32,height:32,borderRadius:10,background:`${color}18`,border:`1px solid ${color}33`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16}}>{LEVEL_ICON[level]}</div>
                          <span style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{level}</span>
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:10}}>
                          <span style={{fontSize:10,color:'#555'}}>{pct}%</span>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color}}>{count}</span>
                        </div>
                      </div>
                      <div style={{height:8,background:'rgba(255,255,255,0.05)',borderRadius:50,overflow:'hidden'}}>
                        <div style={{height:'100%',borderRadius:50,background:`linear-gradient(90deg,${color},${color}88)`,width:`${pct}%`,transition:'width 1s ease',boxShadow:`0 0 10px ${color}55`}}/>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={glass()}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.05)',fontSize:13,fontWeight:700}}>🎯 Goal Distribution</div>
              <div style={{padding:'16px',display:'flex',flexDirection:'column',gap:10}}>
                {goalCounts.map(({goal,count})=>{
                  const color=GOAL_COLORS[goal]||'#f5c842'
                  const icon=GOAL_ICONS[goal]||'🎯'
                  const pct=members.length>0?Math.round((count/members.length)*100):0
                  return(
                    <div key={goal} style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:`${color}08`,borderRadius:12,border:`1px solid ${color}1a`,transition:'all 0.2s'}}
                      onMouseEnter={e=>e.currentTarget.style.background=`${color}14`}
                      onMouseLeave={e=>e.currentTarget.style.background=`${color}08`}>
                      <div style={{width:36,height:36,borderRadius:10,background:`${color}18`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,flexShrink:0}}>{icon}</div>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:5}}>
                          <span style={{fontSize:12,fontWeight:700,color:'#f0ece8'}}>{goal}</span>
                          <div style={{display:'flex',alignItems:'center',gap:6}}>
                            <span style={{fontSize:10,color:'#555'}}>{pct}%</span>
                            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color}}>{count}</span>
                          </div>
                        </div>
                        <div style={{height:5,background:'rgba(255,255,255,0.05)',borderRadius:50,overflow:'hidden'}}>
                          <div style={{height:'100%',borderRadius:50,background:color,width:`${pct}%`,boxShadow:`0 0 8px ${color}66`}}/>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            <div style={{...glass(),gridColumn:'1/-1'}}>
              <div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{fontSize:13,fontWeight:700}}>📢 Recent Announcements</div>
                <button onClick={()=>setShowNotif(true)} style={{background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.2)',borderRadius:50,padding:'6px 14px',fontSize:11,fontWeight:700,color:'#f5c842',cursor:'pointer'}}>+ New</button>
              </div>
              {notifs.length===0?(
                <div style={{padding:30,textAlign:'center',color:'#555',fontSize:12}}>No announcements yet.</div>
              ):(
                <div style={{display:'flex',flexDirection:'column',maxHeight:280,overflowY:'auto'}}>
                  {notifs.slice(0,5).map((n,i)=>(
                    <div key={n.id} style={{padding:'12px 20px',borderBottom:'1px solid rgba(255,255,255,0.04)',display:'flex',gap:12,alignItems:'flex-start'}}>
                      <div style={{width:32,height:32,borderRadius:10,background:n.audience==='all'?'rgba(245,200,66,0.15)':'rgba(66,165,245,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0}}>{n.audience==='all'?'📢':'🥊'}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:3,flexWrap:'wrap'}}>
                          <span style={{fontSize:12,fontWeight:700,color:'#f0ece8'}}>{n.title}</span>
                          <span style={{fontSize:9,background:n.audience==='all'?'rgba(245,200,66,0.15)':'rgba(66,165,245,0.15)',color:n.audience==='all'?'#f5c842':'#42a5f5',borderRadius:50,padding:'2px 8px',fontWeight:700}}>{n.audience==='all'?'All':'Coaches'}</span>
                          {n.editedAt&&<span style={{fontSize:8,color:'#777',fontStyle:'italic'}}>· edited</span>}
                        </div>
                        <div style={{fontSize:11,color:'#555',lineHeight:1.5}}>{n.message}</div>
                        <div style={{fontSize:9,color:'#444',marginTop:4}}>By {n.from||'Admin'}</div>
                      </div>
                      <div style={{display:'flex',gap:4,flexShrink:0}}>
                        <button onClick={()=>startEditNotification(n)} title="Edit"
                          style={{background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.25)',borderRadius:7,padding:'5px 9px',fontSize:11,color:'#f5c842',cursor:'pointer',fontWeight:700}}>✏️</button>
                        <button onClick={()=>setDeleteNotifId(n.id)} title="Delete"
                          style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:7,padding:'5px 9px',fontSize:11,color:'#e84a2f',cursor:'pointer',fontWeight:700}}>🗑</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── MEMBERS ── */}
        {tab==='members'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'flex',gap:10,alignItems:'center'}}>
              <div style={{position:'relative',flex:1,maxWidth:360}}>
                <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:13,color:'#555'}}>🔍</span>
                <input placeholder="Search by name or email..." value={searchQ} onChange={e=>setSearchQ(e.target.value)} style={{...inp,paddingLeft:36,borderRadius:50}}/>
              </div>
              <span style={{fontSize:11,color:'#555',fontWeight:600}}>{filtered.length} members</span>
            </div>
            <div style={glass()}>
              <div style={{display:'grid',gridTemplateColumns:'1fr 110px 140px 70px 70px 110px 160px',gap:0,padding:'10px 18px',borderBottom:'1px solid rgba(255,255,255,0.05)'}}>
                {['MEMBER','LEVEL','GOAL','WORKOUTS','STREAK','STATUS','ACTIONS'].map((h,i)=>(
                  <div key={i} style={{fontSize:9,fontWeight:700,color:'#444',letterSpacing:'0.1em'}}>{h}</div>
                ))}
              </div>
              {loading?<div style={{padding:40,textAlign:'center',color:'#555'}}>Loading...</div>
              :filtered.length===0?<div style={{padding:40,textAlign:'center',color:'#555',fontSize:13}}>No members found</div>
              :filtered.map(m=>{
                const lc=LEVEL_COLOR[m.experience]||'#f5c842'
                const isActive=m.status!=='inactive'
                return(
                  <div key={m.uid} style={{display:'grid',gridTemplateColumns:'1fr 110px 140px 70px 70px 110px 160px',gap:0,padding:'11px 18px',borderBottom:'1px solid rgba(255,255,255,0.04)',alignItems:'center',transition:'background 0.2s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.02)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{display:'flex',alignItems:'center',gap:10}}>
                      <div style={{width:34,height:34,borderRadius:'50%',background:`${lc}${isActive?'22':'11'}`,border:`1.5px solid ${lc}${isActive?'55':'22'}`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color:isActive?lc:'#444',flexShrink:0}}>
                        {(m.name||'?')[0].toUpperCase()}
                      </div>
                      <div>
                        <div style={{fontSize:12,fontWeight:700,color:isActive?'#f0ece8':'#555'}}>{m.name||'Unknown'}</div>
                        <div style={{fontSize:10,color:'#444'}}>{m.email||'—'}</div>
                      </div>
                    </div>
                    <div style={{fontSize:10,fontWeight:700,color:isActive?lc:'#444'}}>{LEVEL_ICON[m.experience]||'🥊'} {m.experience||'Beginner'}</div>
                    <div style={{fontSize:10,color:'#555'}}>{m.goal||'—'}</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:isActive?'#f5c842':'#444'}}>{m.totalWorkouts||0}</div>
                    <div style={{fontSize:11,color:(m.streak||0)>0&&isActive?'#e84a2f':'#444'}}>🔥{m.streak||0}d</div>
                    <div>
                      <span style={{display:'inline-block',fontSize:9,background:isActive?'rgba(74,222,128,0.12)':'rgba(232,74,47,0.1)',color:isActive?'#4ade80':'#e84a2f',border:`1px solid ${isActive?'rgba(74,222,128,0.3)':'rgba(232,74,47,0.25)'}`,borderRadius:50,padding:'3px 10px',fontWeight:700}}>
                        {isActive?'Active':'Inactive'}
                      </span>
                    </div>
                    <div style={{display:'flex',gap:6,alignItems:'center'}}>
                      <button onClick={()=>setConfirm({
                        title:isActive?'Deactivate Member?':'Activate Member?',
                        message:isActive?`This will block ${m.name} from logging in until reactivated.`:`Restore full access for ${m.name}.`,
                        danger:isActive,
                        onConfirm:()=>toggleMemberStatus(m.uid,m.status||'active')
                      })} style={{fontSize:10,fontWeight:700,background:isActive?'rgba(232,74,47,0.12)':'rgba(74,222,128,0.12)',color:isActive?'#e84a2f':'#4ade80',border:`1.5px solid ${isActive?'rgba(232,74,47,0.3)':'rgba(74,222,128,0.3)'}`,borderRadius:8,padding:'6px 10px',cursor:'pointer',whiteSpace:'nowrap'}}>
                        {isActive?'Deactivate':'Activate'}
                      </button>
                      <button onClick={()=>{setMsgTarget(m);setMsgThread([])}}
                        style={{width:32,height:32,background:'rgba(66,165,245,0.12)',color:'#42a5f5',border:'1.5px solid rgba(66,165,245,0.3)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,cursor:'pointer',flexShrink:0}}>💬</button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── INBOX ── */}
        {tab==='inbox'&&(
          <InboxView
            currentUid={auth.currentUser?.uid}
            currentName={adminProfile.name||'Admin'}
            currentRole="admin"
            embedded={true}
          />
        )}

        {/* ── COACHES ── */}
        {tab==='coaches'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {pending.length>0&&(
              <div style={glass()}>
                <div style={{padding:'14px 20px',borderBottom:'1px solid rgba(245,200,66,0.12)',display:'flex',alignItems:'center',gap:8}}>
                  <span style={{fontSize:16,animation:'pulse 2s ease infinite'}}>⏳</span>
                  <span style={{fontSize:13,fontWeight:700,color:'#f5c842'}}>Pending Coach Approvals ({pending.length})</span>
                </div>
                {pending.map(p=>(
                  <div key={p.uid} style={{display:'flex',alignItems:'center',gap:14,padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                    <div style={{width:44,height:44,borderRadius:'50%',background:'rgba(245,200,66,0.15)',border:'2px solid rgba(245,200,66,0.35)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#f5c842'}}>
                      {(p.name||'?')[0].toUpperCase()}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:700,color:'#f0ece8'}}>{p.name}</div>
                      <div style={{fontSize:11,color:'#555'}}>{p.email} · Applied for Coach</div>
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      <button onClick={()=>setConfirm({title:'Approve Coach?',message:`Approve ${p.name} as a coach? They will be able to log in immediately.`,danger:false,onConfirm:()=>approveCoach(p.uid)})}
                        style={{background:'rgba(74,222,128,0.15)',color:'#4ade80',border:'1.5px solid rgba(74,222,128,0.35)',borderRadius:50,padding:'8px 18px',fontSize:12,fontWeight:700,cursor:'pointer'}}>✓ Approve</button>
                      <button onClick={()=>setConfirm({title:'Reject Coach?',message:`Reject ${p.name}'s coach application.`,danger:true,onConfirm:()=>rejectCoach(p.uid)})}
                        style={{background:'rgba(232,74,47,0.12)',color:'#e84a2f',border:'1.5px solid rgba(232,74,47,0.3)',borderRadius:50,padding:'8px 16px',fontSize:12,fontWeight:700,cursor:'pointer'}}>✕ Reject</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div style={glass()}>
              <div style={{padding:'14px 20px',borderBottom:'1px solid rgba(255,255,255,0.05)',fontSize:13,fontWeight:700}}>Active Coaches ({coaches.length})</div>
              {coaches.length===0?<div style={{padding:40,textAlign:'center',color:'#555',fontSize:12}}>No approved coaches yet.</div>:coaches.map(c=>{
                const isActive=c.status!=='inactive'
                return(
                  <div key={c.uid} style={{display:'flex',alignItems:'center',gap:14,padding:'14px 20px',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                    <div style={{width:44,height:44,borderRadius:'50%',background:isActive?'rgba(66,165,245,0.15)':'rgba(255,255,255,0.04)',border:`2px solid ${isActive?'rgba(66,165,245,0.35)':'rgba(255,255,255,0.1)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:isActive?'#42a5f5':'#444'}}>
                      {(c.name||'?')[0].toUpperCase()}
                    </div>
                    <div style={{flex:1}}>
                      <div style={{fontSize:14,fontWeight:700,color:isActive?'#f0ece8':'#555'}}>{c.name}</div>
                      <div style={{fontSize:11,color:'#555'}}>{c.email}</div>
                    </div>
                    <span style={{fontSize:10,fontWeight:700,background:isActive?'rgba(74,222,128,0.12)':'rgba(232,74,47,0.1)',color:isActive?'#4ade80':'#e84a2f',border:`1px solid ${isActive?'rgba(74,222,128,0.3)':'rgba(232,74,47,0.25)'}`,borderRadius:50,padding:'4px 12px'}}>
                      {isActive?'✓ Active':'⛔ Inactive'}
                    </span>
                    <button onClick={()=>setConfirm({
                      title:isActive?'Deactivate Coach?':'Activate Coach?',
                      message:isActive?`Deactivate ${c.name}? They won't be able to log in.`:`Restore ${c.name}'s coach access.`,
                      danger:isActive,
                      onConfirm:()=>toggleCoachStatus(c.uid,c.status||'active')
                    })} style={{fontSize:11,fontWeight:700,background:isActive?'rgba(232,74,47,0.1)':'rgba(74,222,128,0.1)',color:isActive?'#e84a2f':'#4ade80',border:`1.5px solid ${isActive?'rgba(232,74,47,0.3)':'rgba(74,222,128,0.3)'}`,borderRadius:8,padding:'7px 14px',cursor:'pointer'}}>
                      {isActive?'Deactivate':'Activate'}
                    </button>
                    <button onClick={()=>{setMsgTarget(c);setMsgThread([])}} style={{width:34,height:34,background:'rgba(66,165,245,0.12)',color:'#42a5f5',border:'1.5px solid rgba(66,165,245,0.3)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,cursor:'pointer'}}>💬</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── CLASSES ── */}
        {tab==='classes'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'flex',justifyContent:'flex-end'}}>
              <button onClick={()=>setShowNewClass(v=>!v)} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'10px 22px',fontSize:12,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 16px rgba(232,74,47,0.35)'}}>
                {showNewClass?'✕ Cancel':'+ Create Class'}
              </button>
            </div>
            {showNewClass&&(
              <div style={{...glass(),padding:'24px',border:'1px solid rgba(232,74,47,0.2)'}}>
                <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:16}}>New Class</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:16}}>
                  <div>
                    <label style={{fontSize:10,color:'#555',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',display:'block',marginBottom:7}}>Class Name *</label>
                    <input placeholder="e.g. Heavy Bag Basics" value={newClass.name} onChange={e=>setNewClass(p=>({...p,name:e.target.value}))} style={inp}
                      onFocus={e=>e.target.style.borderColor='#e84a2f'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.12)'}/>
                  </div>
                  {[
                    {key:'day',label:'Day',opts:DAYS},
                    {key:'time',label:'Time',opts:TIMES},
                    {key:'level',label:'Level',opts:LEVELS},
                    {key:'coach',label:'Coach',opts:coaches.length>0?coaches.map(c=>c.name||'Coach'):['Admin']},
                    {key:'spots',label:'Max Spots',opts:['6','8','10','12','15','20','25','30']},
                  ].map(f=>(
                    <div key={f.key}>
                      <label style={{fontSize:10,color:'#555',fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase',display:'block',marginBottom:7}}>{f.label}</label>
                      <select value={newClass[f.key]} onChange={e=>setNewClass(p=>({...p,[f.key]:e.target.value}))} style={selStyle}
                        onFocus={e=>e.target.style.borderColor='#e84a2f'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.12)'}>
                        {f.opts.map(o=><option key={o} value={o} style={{background:'#1a1818',color:'#f0ece8'}}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <div style={{display:'flex',gap:10}}>
                  <button onClick={createClass} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'11px 28px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 16px rgba(232,74,47,0.3)'}}>✓ Create Class</button>
                </div>
              </div>
            )}
            {classes.length===0?<div style={{...glass(),padding:'60px',textAlign:'center'}}><div style={{fontSize:48,marginBottom:12}}>📋</div><div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:6}}>No Classes Yet</div><div style={{fontSize:12,color:'#555'}}>Create your first class. It appears on all member dashboards immediately.</div></div>:(
              <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14}}>
                {classes.map(cls=>{
                  const classBookings=bookings.filter(b=>b.classId===cls.id)
                  const pct=cls.spots>0?Math.round((classBookings.length/cls.spots)*100):0
                  const color=pct>=90?'#e84a2f':pct>=60?'#f5c842':'#4ade80'
                  const lc=LEVEL_COLOR[cls.level]||'#f5c842'
                  return(
                    <div key={cls.id} style={{...glass(),padding:'20px',position:'relative',border:`1px solid ${lc}18`}}>
                      <button onClick={()=>setDeleteClassId(cls.id)} style={{position:'absolute',top:12,right:12,width:28,height:28,background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.2)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,color:'#e84a2f',cursor:'pointer'}}>🗑</button>
                      <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:6,paddingRight:34}}>{cls.name}</div>
                      <div style={{display:'flex',gap:6,marginBottom:12,flexWrap:'wrap'}}>
                        <span style={{fontSize:10,color:'#e84a2f',fontWeight:600}}>📅 {cls.day}</span>
                        <span style={{fontSize:10,color:'#7a7570'}}>⏰ {cls.time}</span>
                        <span style={{fontSize:10,color:'#7a7570'}}>· {cls.coach}</span>
                        <span style={{fontSize:9,background:`${lc}18`,color:lc,border:`1px solid ${lc}22`,borderRadius:50,padding:'1px 8px',fontWeight:700}}>{cls.level}</span>
                      </div>
                      <div>
                        <div style={{display:'flex',justifyContent:'space-between',marginBottom:5,fontSize:10}}>
                          <span style={{color:'#555'}}>Bookings</span>
                          <span style={{fontWeight:700,color}}>{classBookings.length}/{cls.spots}</span>
                        </div>
                        <div style={{height:6,background:'rgba(255,255,255,0.06)',borderRadius:50,overflow:'hidden'}}>
                          <div style={{height:'100%',borderRadius:50,background:color,width:`${pct}%`,boxShadow:`0 0 8px ${color}66`,transition:'width 0.5s ease'}}/>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── LEADERBOARD (same style as client) ── */}
        {tab==='leaderboard'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Filters */}
            <div style={{display:'flex',flexDirection:'column',gap:8}}>
              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:10,fontWeight:700,color:'#555',letterSpacing:'0.08em',textTransform:'uppercase',minWidth:44}}>Level:</span>
                {LEVEL_DIVS.map(d=>{
                  const lc=LEVEL_COLOR[d]||'#e84a2f';const active=lbLevel===d
                  return<button key={d} onClick={()=>setLbLevel(d)} style={{background:active?`${lc}18`:'rgba(255,255,255,0.03)',color:active?lc:'#555',border:active?`1px solid ${lc}44`:'1px solid rgba(255,255,255,0.06)',borderRadius:50,padding:'6px 14px',fontSize:11,fontWeight:700,cursor:'pointer',transition:'all 0.2s'}}>{d!=='All Levels'&&LEVEL_ICON[d]+' '}{d}</button>
                })}
              </div>
              <div style={{display:'flex',gap:6,alignItems:'center',flexWrap:'wrap'}}>
                <span style={{fontSize:10,fontWeight:700,color:'#555',letterSpacing:'0.08em',textTransform:'uppercase',minWidth:44}}>Goal:</span>
                {GOAL_DIVS.map((d,i)=>{
                  const colors=['#f5c842','#42a5f5','#e84a2f','#4ade80','#c084fc'];const active=lbGoal===d;const color=colors[i]||'#f5c842'
                  return<button key={d} onClick={()=>setLbGoal(d)} style={{background:active?`${color}18`:'rgba(255,255,255,0.03)',color:active?color:'#555',border:active?`1px solid ${color}44`:'1px solid rgba(255,255,255,0.06)',borderRadius:50,padding:'6px 14px',fontSize:11,fontWeight:700,cursor:'pointer',transition:'all 0.2s'}}>{d}</button>
                })}
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:13,color:'#555'}}>🔍</span>
                  <input placeholder="Search member..." value={lbSearch} onChange={e=>setLbSearch(e.target.value)}
                    style={{...inp,paddingLeft:36,borderRadius:50,width:200}}/>
                </div>
                {(lbLevel!=='All Levels'||lbGoal!=='All Goals'||lbSearch)&&<button onClick={()=>{setLbLevel('All Levels');setLbGoal('All Goals');setLbSearch('')}} style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.2)',borderRadius:50,padding:'7px 14px',fontSize:11,fontWeight:700,color:'#e84a2f',cursor:'pointer'}}>✕ Clear</button>}
              </div>
            </div>

            {/* Leaderboard table — same design as client side */}
            <div style={{background:'linear-gradient(135deg,rgba(28,26,26,0.98),rgba(14,12,12,0.99))',borderRadius:20,border:'1px solid rgba(245,200,66,0.12)',overflow:'hidden',boxShadow:'0 8px 40px rgba(0,0,0,0.5)'}}>
              <div style={{padding:'16px 22px',borderBottom:'1px solid rgba(245,200,66,0.08)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <span style={{fontSize:24}}>🏆</span>
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:'0.06em',color:'#f0ece8'}}>FULL GYM LEADERBOARD</div>
                    <div style={{fontSize:11,color:'#7a7570',marginTop:2}}>Live rankings · All members</div>
                  </div>
                </div>
                <div style={{fontSize:11,color:'#555',fontWeight:600,background:'rgba(255,255,255,0.04)',borderRadius:50,padding:'4px 14px',border:'1px solid rgba(255,255,255,0.06)'}}>
                  {scored.filter(m=>{
                    if(lbSearch&&!m.name?.toLowerCase().includes(lbSearch.toLowerCase()))return false
                    if(lbLevel!=='All Levels'&&m.experience!==lbLevel)return false
                    if(lbGoal!=='All Goals'&&m.goal!==lbGoal)return false
                    return true
                  }).length} / {scored.length} members
                </div>
              </div>
              {/* Column headers */}
              <div style={{display:'flex',padding:'10px 22px',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
                {[{label:'RANK',w:48},{label:'MEMBER',flex:1},{label:'LEVEL',w:110},{label:'WORKOUTS',w:70},{label:'STREAK',w:80},{label:'SCORE',w:160}].map((h,i)=>(
                  <div key={i} style={{width:h.w,flex:h.flex,fontSize:9,fontWeight:700,color:'#444',letterSpacing:'0.1em'}}>{h.label}</div>
                ))}
              </div>
              {scored.filter(m=>{
                if(lbSearch&&!m.name?.toLowerCase().includes(lbSearch.toLowerCase()))return false
                if(lbLevel!=='All Levels'&&m.experience!==lbLevel)return false
                if(lbGoal!=='All Goals'&&m.goal!==lbGoal)return false
                return true
              }).length===0?(
                <div style={{padding:40,textAlign:'center',color:'#555',fontSize:13}}>No members match this filter</div>
              ):scored.filter(m=>{
                if(lbSearch&&!m.name?.toLowerCase().includes(lbSearch.toLowerCase()))return false
                if(lbLevel!=='All Levels'&&m.experience!==lbLevel)return false
                if(lbGoal!=='All Goals'&&m.goal!==lbGoal)return false
                return true
              }).map((m,i)=><LBRow key={m.uid} user={m} maxScore={maxScore} idx={i}/>)}
            </div>
          </div>
        )}

        {/* ── NOTIFICATIONS ── */}
        {tab==='notifications'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            <div style={{display:'flex',justifyContent:'flex-end'}}>
              <button onClick={()=>setShowNotif(true)} style={{background:'linear-gradient(135deg,#f5c842,#e08820)',color:'#000',border:'none',borderRadius:50,padding:'10px 22px',fontSize:12,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 16px rgba(245,200,66,0.3)'}}>📢 Post Announcement</button>
            </div>
            {notifs.length===0?<div style={{...glass(),padding:'60px',textAlign:'center'}}><div style={{fontSize:48,marginBottom:12}}>📭</div><div style={{fontSize:14,fontWeight:700,color:'#f0ece8'}}>No Announcements</div></div>:(
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {notifs.map(n=>(
                  <div key={n.id} style={{...glass(),padding:'18px 22px',display:'flex',gap:14,alignItems:'flex-start',border:n.audience==='coaches'?'1px solid rgba(66,165,245,0.15)':'1px solid rgba(245,200,66,0.12)'}}>
                    <div style={{width:44,height:44,borderRadius:12,background:n.audience==='all'?'rgba(245,200,66,0.15)':'rgba(66,165,245,0.15)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>{n.audience==='all'?'📢':'🥊'}</div>
                    <div style={{flex:1}}>
                      <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6}}>
                        <span style={{fontSize:14,fontWeight:700,color:'#f0ece8'}}>{n.title}</span>
                        <span style={{fontSize:9,background:n.audience==='all'?'rgba(245,200,66,0.15)':'rgba(66,165,245,0.15)',color:n.audience==='all'?'#f5c842':'#42a5f5',borderRadius:50,padding:'2px 10px',fontWeight:700}}>{n.audience==='all'?'All Members':'Coaches Only'}</span>
                      </div>
                      <div style={{fontSize:12,color:'#7a7570',lineHeight:1.7}}>{n.message}</div>
                      <div style={{fontSize:10,color:'#444',marginTop:6}}>By {n.from}</div>
                    </div>
                    <button onClick={()=>deleteDoc(doc(db,'notifications',n.id)).then(()=>showToast('🗑 Deleted'))} style={{background:'none',border:'none',color:'#555',cursor:'pointer',fontSize:16,padding:4}}>🗑</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── MESSAGE MODAL ── */}
      {msgTarget&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...glass(),width:'100%',maxWidth:500,maxHeight:'85vh',display:'flex',flexDirection:'column',border:'1px solid rgba(66,165,245,0.25)'}}>
            <div style={{padding:'16px 20px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:38,height:38,borderRadius:'50%',background:'rgba(66,165,245,0.15)',border:'1.5px solid rgba(66,165,245,0.35)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:'#42a5f5'}}>
                {(msgTarget.name||'?')[0].toUpperCase()}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:14,fontWeight:700,color:'#f0ece8'}}>{msgTarget.name}</div>
                <div style={{fontSize:10,color:'#42a5f5',fontWeight:600,textTransform:'capitalize'}}>{msgTarget.role||'Member'}</div>
              </div>
              <button onClick={()=>{setMsgTarget(null);setMsgThread([])}} style={{background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:8,padding:'6px 10px',color:'#555',cursor:'pointer',fontSize:14,fontWeight:700}}>✕</button>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'14px',display:'flex',flexDirection:'column',gap:10,minHeight:250,maxHeight:400}}>
              {msgThread.length===0?(
                <div style={{textAlign:'center',color:'#555',fontSize:12,marginTop:60}}>
                  <div style={{fontSize:32,marginBottom:8}}>💬</div>
                  Start a conversation with {msgTarget.name?.split(' ')[0]}
                </div>
              ):msgThread.map((msg,i)=>{
                const isMe=msg.from===auth.currentUser?.uid
                return(
                  <div key={i} style={{display:'flex',justifyContent:isMe?'flex-end':'flex-start'}}>
                    <div style={{background:isMe?'rgba(232,74,47,0.18)':'rgba(255,255,255,0.06)',borderRadius:12,padding:'10px 14px',maxWidth:'75%',border:`1px solid ${isMe?'rgba(232,74,47,0.25)':'rgba(255,255,255,0.08)'}`}}>
                      <div style={{fontSize:12,color:'#f0ece8',lineHeight:1.6}}>{msg.text}</div>
                      <div style={{fontSize:9,color:'#555',marginTop:4,textAlign:isMe?'right':'left'}}>{isMe?'You':msg.fromName}</div>
                    </div>
                  </div>
                )
              })}
              <div ref={msgEndRef}/>
            </div>
            <div style={{padding:'12px 14px',borderTop:'1px solid rgba(255,255,255,0.05)',display:'flex',gap:8,alignItems:'center'}}>
              <input value={msgText} onChange={e=>setMsgText(e.target.value)}
                placeholder={`Message ${msgTarget.name?.split(' ')[0]}...`}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}}}
                style={{flex:1,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'11px 14px',color:'#f0ece8',fontSize:13,fontFamily:'Montserrat,sans-serif',outline:'none'}}
                onFocus={e=>e.target.style.borderColor='rgba(66,165,245,0.4)'}
                onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'}/>
              <button
                onClick={()=>sendMessage()}
                disabled={!msgText.trim()||sendingMsg}
                style={{
                  background:msgText.trim()&&!sendingMsg?'linear-gradient(135deg,#42a5f5,#1565c0)':'rgba(255,255,255,0.05)',
                  color:msgText.trim()&&!sendingMsg?'#fff':'#444',
                  border:'none',borderRadius:10,padding:'11px 18px',
                  fontSize:13,fontWeight:700,
                  cursor:msgText.trim()&&!sendingMsg?'pointer':'not-allowed',
                  transition:'all 0.2s',flexShrink:0,
                  boxShadow:msgText.trim()&&!sendingMsg?'0 4px 12px rgba(66,165,245,0.3)':'none',
                }}>
                {sendingMsg?'..':'Send →'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── DELETE NOTIFICATION CONFIRM ── */}
      {deleteNotifId&&<ConfirmModal title="Delete Announcement?" message="This will permanently remove the announcement for everyone." onConfirm={deleteNotificationConfirmed} onCancel={()=>setDeleteNotifId(null)}/>}

      {/* ── NOTIFICATION MODAL ── */}
      {showNotif&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div style={{...glass(),padding:'36px 40px',width:'100%',maxWidth:500,border:`1px solid ${editingNotifId?'rgba(66,165,245,0.3)':'rgba(245,200,66,0.25)'}`}}>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:26,color:'#f0ece8',marginBottom:4,letterSpacing:'0.06em'}}>
              {editingNotifId?'✏️ EDIT ANNOUNCEMENT':'📢 POST ANNOUNCEMENT'}
            </div>
            <div style={{fontSize:12,color:'#555',marginBottom:20}}>
              {editingNotifId?'Update this announcement — changes will be visible to everyone immediately.':'Send a notification to members or coaches'}
            </div>
            <div style={{display:'flex',gap:8,marginBottom:18}}>
              {[{id:'all',label:'📢 All Members'},{id:'coaches',label:'🥊 Coaches Only'}].map(a=>(
                <button key={a.id} type="button" onClick={()=>setNotifForm(p=>({...p,audience:a.id}))}
                  style={{flex:1,padding:'11px',borderRadius:10,border:'none',fontSize:12,fontWeight:700,cursor:'pointer',transition:'all 0.2s',
                    background:notifForm.audience===a.id?'#e84a2f':'rgba(255,255,255,0.05)',
                    color:notifForm.audience===a.id?'#fff':'#555',
                    boxShadow:notifForm.audience===a.id?'0 4px 12px rgba(232,74,47,0.3)':'none'}}>
                  {a.label}
                </button>
              ))}
            </div>
            <div style={{display:'flex',flexDirection:'column',gap:12}}>
              <input placeholder="Announcement title..." value={notifForm.title} onChange={e=>setNotifForm(p=>({...p,title:e.target.value}))}
                style={inp} onFocus={e=>e.target.style.borderColor='#f5c842'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.12)'}/>
              <textarea placeholder="Write your message here..." value={notifForm.message} onChange={e=>setNotifForm(p=>({...p,message:e.target.value}))} rows={4}
                style={{...inp,resize:'vertical'}} onFocus={e=>e.target.style.borderColor='#f5c842'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.12)'}/>
            </div>
            <div style={{display:'flex',gap:10,marginTop:18}}>
              <button onClick={postNotification}
                style={{background:editingNotifId?'linear-gradient(135deg,#42a5f5,#1565c0)':'linear-gradient(135deg,#f5c842,#e08820)',color:editingNotifId?'#fff':'#000',border:'none',borderRadius:50,padding:'12px 28px',fontSize:13,fontWeight:700,cursor:'pointer',boxShadow:editingNotifId?'0 4px 16px rgba(66,165,245,0.3)':'0 4px 16px rgba(245,200,66,0.3)'}}>
                {editingNotifId?'Save Changes ✏️':'Send Announcement 📢'}
              </button>
              <button onClick={()=>{setShowNotif(false);setEditingNotifId(null);setNotifForm({title:'',message:'',audience:'all'})}}
                style={{background:'transparent',color:'#555',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'12px 22px',fontSize:13,fontWeight:700,cursor:'pointer'}}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:0.5}}
        select option{background:#1a1818 !important;color:#f0ece8 !important}
      `}</style>
    </div>
  )
}

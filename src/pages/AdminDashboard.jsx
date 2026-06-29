import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, getDocs, doc, getDoc, addDoc, updateDoc, deleteDoc, setDoc, serverTimestamp, query, where, orderBy, onSnapshot, writeBatch } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { auth, db } from '../firebase'
import { logActivity, ACTIVITY_TYPES } from '../lib/activityLog'
import { isClassActive, autoEndPastClasses } from '../lib/classLifecycle'
import { computeMembershipState, daysRemaining, fmtExpiry, fmtRemaining, getStatusLabel, getStatusColor, getStatusIcon, computeResumeExpiry, DEFAULT_MONTHLY_DAYS, STATUS } from '../lib/membership'
import InboxView from '../components/InboxView'
import PunchAnalyticsCard from '../components/PunchAnalyticsCard'
import MedicalCertCard from '../components/MedicalCertCard'
import { getMemberLevel, levelScore } from '../lib/memberLevel'
import { PLANS, DISCIPLINES, getPlan, planLabel, peso } from '../lib/plans'
import Forum from './Forum'

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

const calcScore = levelScore

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

// Leaderboard Row (cinematic — matches client/coach side)
function LBRow({user,maxScore,idx}){
  const [show,setShow]=useState(false)
  const [barW,setBarW]=useState(0)
  useEffect(()=>{
    const t1=setTimeout(()=>setShow(true),idx*40)
    const t2=setTimeout(()=>setBarW(maxScore>0?(user.score/maxScore)*100:0),idx*40+400)
    return()=>{clearTimeout(t1);clearTimeout(t2)}
  },[])
  const lc=LEVEL_COLOR[getMemberLevel(user)]||'#f5c842'
  const lvIc=LEVEL_ICON[getMemberLevel(user)]||'🥊'
  const podiumColors=['#f5c842','#c0c0c0','#cd7f32']
  const rc=user.rank<=3?podiumColors[user.rank-1]:lc
  const medals={1:'🥇',2:'🥈',3:'🥉'}
  return(
    <div style={{display:'flex',alignItems:'center',padding:'13px 22px',
      background:user.rank<=3?`linear-gradient(90deg,${podiumColors[user.rank-1]}10,transparent)`:'transparent',
      borderBottom:'1px solid rgba(255,255,255,0.04)',
      borderLeft:user.rank<=3?`3px solid ${podiumColors[user.rank-1]}`:'3px solid transparent',
      opacity:show?1:0,transform:show?'none':'translateX(-20px)',transition:`all 0.4s ease ${idx*40}ms`,cursor:'default'}}
      onMouseEnter={e=>{e.currentTarget.style.background=user.rank<=3?`linear-gradient(90deg,${podiumColors[user.rank-1]}20,transparent)`:'rgba(255,255,255,0.025)'}}
      onMouseLeave={e=>{e.currentTarget.style.background=user.rank<=3?`linear-gradient(90deg,${podiumColors[user.rank-1]}10,transparent)`:'transparent'}}>
      <div style={{width:48,flexShrink:0,textAlign:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:user.rank<=3?22:14,color:user.rank<=3?rc:'#666',letterSpacing:'0.05em'}}>
        {medals[user.rank]||`#${user.rank}`}
      </div>
      <div style={{position:'relative',flexShrink:0,marginRight:12}}>
        <div style={{width:38,height:38,borderRadius:'50%',background:`linear-gradient(135deg,${lc},${lc}aa)`,color:'#000',border:`2px solid ${lc}66`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:14,boxShadow:`0 2px 8px ${lc}30`}}>
          {(user.name||'?')[0].toUpperCase()}
        </div>
        <div style={{position:'absolute',bottom:-2,right:-4,width:14,height:14,borderRadius:'50%',background:'#0e0a0a',border:`1.5px solid ${lc}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:7}}>{lvIc}</div>
      </div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
          <span style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{user.name}</span>
          {(user.streak||0)>=14&&<span style={{fontSize:8,fontWeight:800,background:'rgba(232,74,47,0.18)',color:'#e84a2f',border:'1px solid rgba(232,74,47,0.35)',borderRadius:50,padding:'2px 7px',letterSpacing:'0.08em'}}>🔥HOT</span>}
        </div>
        <div style={{fontSize:9,color:'#666',letterSpacing:'0.04em'}}>{user.goal||'—'}</div>
      </div>
      <div style={{width:118,flexShrink:0}}>
        <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:`${lc}18`,color:lc,border:`1px solid ${lc}44`,letterSpacing:'0.06em',textTransform:'uppercase'}}>
          {lvIc} {getMemberLevel(user)}
        </span>
      </div>
      <div style={{width:60,flexShrink:0,fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:'#f0ece8'}}>{user.totalWorkouts||0}<span style={{fontSize:10,marginLeft:2}}>🥊</span></div>
      <div style={{width:70,flexShrink:0,fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:(user.streak||0)>0?'#e84a2f':'#333'}}>🔥{user.streak||0}d</div>
      <div style={{width:160,flexShrink:0,display:'flex',alignItems:'center',gap:10}}>
        <div style={{flex:1,height:6,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden',border:'1px solid rgba(255,255,255,0.04)'}}>
          <div style={{height:'100%',borderRadius:50,background:`linear-gradient(90deg,${rc},${rc}dd)`,width:`${barW}%`,transition:'width 1s ease',boxShadow:`0 0 10px ${rc}88`}}/>
        </div>
        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:rc,minWidth:42,textAlign:'right',textShadow:`0 0 10px ${rc}66`}}>{user.score}</span>
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
  const [activity,setActivity] = useState([])              // operational event log
  const [overviewSubTab, setOverviewSubTab] = useState('announcements')  // 'announcements' | 'activity'
  const [notifSubTab, setNotifSubTab]       = useState('announcements')
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
  const [levelTarget,setLevelTarget]     = useState(null)  // member object for Level Control modal
  const [deleteTarget,setDeleteTarget]   = useState(null)  // member object for delete confirmation
  const [viewMember,setViewMember]       = useState(null)  // member object for read-only View Member drawer
  const [deleteTyped,setDeleteTyped]     = useState('')    // user-typed confirmation
  const [deleting,setDeleting]           = useState(false) // loading state during cascade delete
  const [coachDeleteTarget,setCoachDeleteTarget] = useState(null) // coach object for delete confirmation
  const [coachDeleteTyped,setCoachDeleteTyped]   = useState('')   // user-typed coach confirmation
  const [coachDeleting,setCoachDeleting]         = useState(false)// loading state during coach cascade

  // Membership management state
  const [payTarget,setPayTarget]         = useState(null)  // member object for Record Payment modal
  const [payForm,setPayForm]             = useState({amount:'',durationDays:'30',method:'cash',reference:'',notes:'',planId:'',discipline:'Boxing'})
  const [paySaving,setPaySaving]         = useState(false)
  const [pauseTarget,setPauseTarget]     = useState(null)  // member object for pause/resume confirmation
  const [pauseSaving,setPauseSaving]     = useState(false)
  const [paymentHistory,setPaymentHistory] = useState(null) // { member, payments[] } or null when drawer closed
  const [monthlyPayments,setMonthlyPayments] = useState([])   // current month payments for revenue card
  const [remindedThisCycle,setRemindedThisCycle] = useState({}) // {uid: true} session-local dedupe
  const [deletePaymentTarget,setDeletePaymentTarget] = useState(null) // payment object pending deletion
  const [deletingPayment,setDeletingPayment] = useState(false)

  function showToast(msg,type='success'){setToast({msg,type});setTimeout(()=>setToast({msg:'',type:'success'}),3500)}

  // Relative time formatter for activity feed timestamps
  function formatRelativeTime(date) {
    const now = new Date()
    const diff = (now - date) / 1000
    if (diff < 60)     return 'just now'
    if (diff < 3600)   return Math.floor(diff/60) + 'm ago'
    if (diff < 86400)  return Math.floor(diff/3600) + 'h ago'
    if (diff < 604800) return Math.floor(diff/86400) + 'd ago'
    return date.toLocaleDateString('en-US', { month:'short', day:'numeric' })
  }

  // ════════════════════════════════════════════════════════
  //  ANNOUNCEMENTS — Filter out legacy system events
  //
  //  Legacy notifications with type='level_change', 'booking_created',
  //  etc. should NOT pollute the Announcements view. Those events
  //  belong to the Activity Feed now. We filter at render only — the
  //  Firestore data stays intact so member-side level-change celebration
  //  popups still work via their targeted notification.
  // ════════════════════════════════════════════════════════
  const SYSTEM_EVENT_TYPES = [
    'booking_created', 'booking_cancelled',
    'class_created',   'class_deleted',   'class_ended',   'class_thanks',
    'level_change',
    'member_signup',   'member_deactivated', 'member_reactivated', 'member_deleted',
    'membership_reminder',   // Item 3 — directed renewal nudges, never an announcement
  ]
  // Item 3 — exclude member-directed notifications (renewal reminders,
  // level-up popups) so they never leak into the admin announcement feed.
  const realAnnouncements = notifs.filter(n => {
    if (n.type && SYSTEM_EVENT_TYPES.includes(n.type)) return false
    if (n.audience === 'member') return false
    if (n.targetUserId && n.targetUserId !== auth.currentUser?.uid) return false
    return true
  })

  // Classes the admin actually sees on the schedule view — ended/past classes
  // are auto-filtered. The full `classes` array stays available for lookups.
  const visibleClasses = classes.filter(isClassActive)

  // Delete a single activity event
  async function deleteActivityEvent(eventId) {
    try {
      await deleteDoc(doc(db, 'activity', eventId))
      // onSnapshot will auto-update the UI — no manual state mgmt needed
    } catch(e) {
      console.error('Delete activity failed:', e)
      showToast('❌ Failed to delete: ' + (e.message||'unknown'), 'error')
    }
  }

  // Clear ALL activity events — batched delete for speed
  const [clearActivityConfirm, setClearActivityConfirm] = useState(false)
  const [clearingActivity, setClearingActivity] = useState(false)
  async function clearAllActivity() {
    if (activity.length === 0) return
    setClearingActivity(true)
    try {
      // Firestore batches max 500 ops — chunk if needed
      const chunks = []
      for (let i = 0; i < activity.length; i += 500) chunks.push(activity.slice(i, i+500))
      for (const chunk of chunks) {
        const batch = writeBatch(db)
        chunk.forEach(ev => batch.delete(doc(db, 'activity', ev.id)))
        await batch.commit()
      }
      showToast(`🧹 Cleared ${activity.length} activity event${activity.length===1?'':'s'}`)
      setClearActivityConfirm(false)
    } catch(e) {
      console.error('Clear activity failed:', e)
      showToast('❌ Failed: ' + (e.message||'unknown'), 'error')
    } finally {
      setClearingActivity(false)
    }
  }

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
      const allClasses = clsSnap.docs.map(d=>({id:d.id,...d.data()}))
      setClasses(allClasses)
      // Auto-end past classes (background, throttled to 5min per session)
      autoEndPastClasses(allClasses).catch(e=>console.warn('Auto-end scan failed:',e.message))
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

  // Load activity feed with real-time (system event log)
  useEffect(()=>{
    const unsub=onSnapshot(collection(db,'activity'),(snap)=>{
      const items=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.createdAt?.seconds||0)-(a.createdAt?.seconds||0))
      setActivity(items)
    },(e)=>console.error('Activity listener:',e))
    return()=>unsub()
  },[])

  useEffect(()=>{loadAll();const t=setInterval(loadAll,15000);return()=>clearInterval(t)},[])

  // Lock background page scroll while the View Member modal is open.
  // Modal owns its own scroll container; without this the user wheel scrolls
  // the page behind the modal instead of the modal body.
  useEffect(() => {
    if (!viewMember) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [viewMember])

  // Fetch current month's payments for the revenue card.
  // Re-runs when the Memberships tab opens or when a payment is recorded.
  useEffect(() => {
    if (tab !== 'memberships') return
    async function loadMonthly() {
      const startOfMonth = new Date()
      startOfMonth.setDate(1); startOfMonth.setHours(0,0,0,0)
      try {
        const snap = await getDocs(query(
          collection(db, 'payments'),
          where('createdAt', '>=', startOfMonth)
        ))
        setMonthlyPayments(snap.docs.map(d => ({ id: d.id, ...d.data() })))
      } catch (e) {
        console.warn('Monthly payments fetch failed:', e.message)
      }
    }
    loadMonthly()
  }, [tab, paySaving])  // refetch after each new payment

  // Real-time messages for selected thread
  useEffect(()=>{
    if(!msgTarget)return
    const adminUid=auth.currentUser?.uid
    if(!adminUid)return
    // No orderBy in the query — array-contains + orderBy needs a composite index
    // that isn't version-controlled. We sort client-side instead (CLAUDE.md convention).
    const q=query(collection(db,'messages'),where('participants','array-contains',adminUid))
    const unsub=onSnapshot(q,(snap)=>{
      const all=snap.docs.map(d=>({id:d.id,...d.data()}))
      const ts=v=>v?.toMillis?.()??(v?.seconds?v.seconds*1000:Infinity)  // pending serverTimestamp → last
      const thread=all.filter(m=>m.participants?.includes(msgTarget.uid)).sort((a,b)=>ts(a.createdAt)-ts(b.createdAt))
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
    const member = members.find(m => m.uid === uid)
    try{
      await updateDoc(doc(db,'users',uid),{status:next})
      setMembers(prev=>prev.map(m=>m.uid===uid?{...m,status:next}:m))
      // Activity log
      logActivity({
        type: next === 'inactive' ? 'member_deactivated' : 'member_reactivated',
        actorId: auth.currentUser?.uid || '',
        actorName: adminProfile.name || 'Admin',
        actorRole: 'admin',
        payload: { memberId: uid, memberName: member?.name || 'Member' },
      })
      showToast(`✅ Member ${next==='active'?'activated':'deactivated'}`)
    }catch(e){showToast('❌ Error: '+e.message,'error')}
  }

  // ════════════════════════════════════════════════════════
  //  CHANGE MEMBER LEVEL — Admin Level Control
  //  Same logic as coach but with role='admin' in the audit log
  // ════════════════════════════════════════════════════════
  async function changeMemberLevel(member, newLevel){
    if (!member?.uid || !newLevel) return
    const oldLevel = getMemberLevel(member)
    if (oldLevel === newLevel) { showToast('Already at that level','error'); return }
    try{
      const me = auth.currentUser
      // firestore.rules restrict level writes to ['experience'] (and 'status'
      // on users). The canonical resolver returns experience for Intermediate/
      // Advanced, so promotes take effect without writing trainingLevel.
      await updateDoc(doc(db,'users',member.uid), { experience: newLevel })
      try { await setDoc(doc(db,'stats',member.uid), { experience: newLevel }, { merge: true }) } catch(_){}
      await addDoc(collection(db,'notifications'), {
        title: `🎚 Level Updated: ${newLevel}`,
        message: `Admin ${adminProfile.name||'Admin'} ${LEVEL_BONUS[newLevel] > LEVEL_BONUS[oldLevel] ? 'promoted' : 'moved'} you to ${newLevel}. Your training plan and leaderboard division have been updated.`,
        audience: 'member',
        targetUserId: member.uid,
        type: 'level_change',
        oldLevel,
        newLevel,
        from: adminProfile.name || 'Admin',
        createdAt: serverTimestamp(),
      })
      await addDoc(collection(db,'levelChanges'), {
        memberId: member.uid,
        memberName: member.name || 'Member',
        oldLevel,
        newLevel,
        changedBy: me?.uid || '',
        changedByName: adminProfile.name || 'Admin',
        changedByRole: 'admin',
        createdAt: serverTimestamp(),
      })
      const isPromote = LEVEL_BONUS[newLevel] > LEVEL_BONUS[oldLevel]
      logActivity({
        type: 'level_change',
        actorId: me?.uid || '',
        actorName: adminProfile.name || 'Admin',
        actorRole: 'admin',
        payload: { memberId: member.uid, memberName: member.name || 'Member', oldLevel, newLevel, isPromote },
      })
      setMembers(ms => ms.map(m => m.uid === member.uid ? { ...m, experience: newLevel } : m))
      setLevelTarget(null)
      showToast(`${isPromote?'⬆️ Promoted':'⬇️ Moved'} to ${newLevel}!`)
    } catch(e) {
      console.error('Level change failed:', e)
      showToast('❌ ' + (e.message || 'Failed to change level'), 'error')
    }
  }

  // ════════════════════════════════════════════════════════
  //  MEMBERSHIP MANAGEMENT — Payment + Pause/Resume
  // ════════════════════════════════════════════════════════

  // Record a payment: creates payments/{id} + updates user's membership
  async function recordPayment() {
    if (!payTarget?.uid) return
    const plan = getPlan(payForm.planId)
    const isDropin = plan?.kind === 'dropin'
    const amount = parseFloat(payForm.amount)
    const duration = parseInt(payForm.durationDays, 10)
    const label = plan ? planLabel(plan) : null
    const discipline = plan?.discipline || payForm.discipline || null
    if (isNaN(amount) || amount <= 0) { showToast('Enter a valid amount','error'); return }
    // Drop-ins are record-only (no access window). Everything else needs a duration.
    if (!isDropin && (isNaN(duration) || duration <= 0)) { showToast('Enter a valid duration','error'); return }

    setPaySaving(true)
    try {
      const m = payTarget.membership || {}

      if (isDropin) {
        // ── RECORD-ONLY: log to the ledger, do NOT change membership/access ──
        await addDoc(collection(db,'payments'), {
          memberId:        payTarget.uid,
          memberName:      payTarget.name || 'Unknown',
          amount,
          currency:        'PHP',
          kind:            'dropin',
          planLabel:       label || 'Drop-in Session',
          discipline,
          durationDays:    0,
          paymentMethod:   payForm.method,
          referenceNumber: payForm.reference.trim() || null,
          notes:           payForm.notes.trim() || null,
          receivedBy:      auth.currentUser.uid,
          receivedByName:  adminProfile.name || 'Admin',
          createdAt:       serverTimestamp(),
        })
        try {
          await logActivity({
            type: 'payment_recorded', actorId: auth.currentUser.uid,
            actorName: adminProfile.name || 'Admin', actorRole: 'admin',
            targetUserId: payTarget.uid, targetUserName: payTarget.name,
            metadata: { amount, kind:'dropin', discipline, method: payForm.method },
          })
        } catch(_) {}
        showToast(`💵 Drop-in recorded · ${peso(amount)} (no membership change)`)
        setPayTarget(null)
        setPayForm({amount:'',durationDays:'30',method:'cash',reference:'',notes:'',planId:'',discipline:'Boxing'})
        return
      }

      // ── SUBSCRIPTION / SESSION PACK: extend the validity window ──
      const currentExp = m.expiresAt ? (m.expiresAt.toMillis ? m.expiresAt.toMillis() : new Date(m.expiresAt).getTime()) : null
      const startBase = (currentExp && currentExp > Date.now()) ? currentExp : Date.now()
      const newStarts = new Date(startBase)
      const newExpires = new Date(startBase + duration * 86400000)

      // 1. Create payment record
      await addDoc(collection(db,'payments'), {
        memberId:        payTarget.uid,
        memberName:      payTarget.name || 'Unknown',
        amount,
        currency:        'PHP',
        kind:            plan?.kind || 'custom',
        planLabel:       label,
        discipline,
        durationDays:    duration,
        startsAt:        newStarts,
        expiresAt:       newExpires,
        paymentMethod:   payForm.method,
        referenceNumber: payForm.reference.trim() || null,
        notes:           payForm.notes.trim() || null,
        receivedBy:      auth.currentUser.uid,
        receivedByName:  adminProfile.name || 'Admin',
        createdAt:       serverTimestamp(),
      })

      // 2. Update user's membership field (label/discipline for receipts + display)
      await updateDoc(doc(db,'users',payTarget.uid), {
        'membership.startedAt':         m.startedAt || newStarts,  // preserve first-paid date
        'membership.expiresAt':         newExpires,
        'membership.pausedAt':          null,                       // payment unpauses if paused
        'membership.planLabel':         label,
        'membership.discipline':        discipline,
        'membership.lastRenewedAt':     serverTimestamp(),
        'membership.lastRenewedBy':     auth.currentUser.uid,
        'membership.lastRenewedByName': adminProfile.name || 'Admin',
      })

      // 3. Activity log
      try {
        await logActivity({
          type: 'payment_recorded',
          actorId: auth.currentUser.uid,
          actorName: adminProfile.name || 'Admin',
          actorRole: 'admin',
          targetUserId: payTarget.uid,
          targetUserName: payTarget.name,
          metadata: { amount, durationDays: duration, planLabel: label, discipline, method: payForm.method },
        })
      } catch(_) {}

      // 4. Optimistic local update
      setMembers(prev => prev.map(x => x.uid === payTarget.uid ? {
        ...x,
        membership: {
          ...(x.membership||{}),
          startedAt:  m.startedAt || newStarts,
          expiresAt:  newExpires,
          pausedAt:   null,
          planLabel:  label,
          discipline,
          lastRenewedByName: adminProfile.name || 'Admin',
        }
      } : x))

      showToast(`💰 ${peso(amount)} recorded${label ? ' · '+label : ''} · expires ${newExpires.toLocaleDateString()}`)
      setPayTarget(null)
      setPayForm({amount:'',durationDays:'30',method:'cash',reference:'',notes:'',planId:'',discipline:'Boxing'})
    } catch (e) {
      console.error('Record payment failed:', e)
      showToast('❌ Failed: ' + (e.message || 'unknown'),'error')
    }
    setPaySaving(false)
  }

  // Toggle pause/resume. When resuming, push expiry forward by the paused duration.
  async function togglePause(member) {
    if (!member?.uid) return
    setPauseSaving(true)
    try {
      const m = member.membership || {}
      const isPaused = !!m.pausedAt
      if (isPaused) {
        // Resume: shift expiry forward by paused duration
        const newExp = computeResumeExpiry(m)
        const pausedMs = m.pausedAt.toMillis ? m.pausedAt.toMillis() : new Date(m.pausedAt).getTime()
        const pausedDays = Math.floor((Date.now() - pausedMs) / 86400000)
        await updateDoc(doc(db,'users',member.uid), {
          'membership.pausedAt':       null,
          'membership.expiresAt':      new Date(newExp),
          'membership.totalPauseDays': (m.totalPauseDays || 0) + pausedDays,
        })
        setMembers(prev => prev.map(x => x.uid === member.uid ? {
          ...x, membership: { ...m, pausedAt:null, expiresAt:new Date(newExp), totalPauseDays:(m.totalPauseDays||0)+pausedDays }
        } : x))
        showToast(`▶ Resumed — expiry extended by ${pausedDays} day${pausedDays===1?'':'s'}`)
      } else {
        // Pause: just record the timestamp
        await updateDoc(doc(db,'users',member.uid), {
          'membership.pausedAt': serverTimestamp(),
        })
        setMembers(prev => prev.map(x => x.uid === member.uid ? {
          ...x, membership: { ...m, pausedAt: new Date() }
        } : x))
        showToast('⏸ Membership paused')
      }
      setPauseTarget(null)
    } catch (e) {
      console.error('Pause toggle failed:', e)
      showToast('❌ Failed: ' + (e.message || 'unknown'),'error')
    }
    setPauseSaving(false)
  }

  // Send a manual renewal reminder to a member's notification feed.
  // De-duped per-session so admin doesn't spam someone by accident.
  async function sendReminder(member) {
    if (!member?.uid) return
    if (remindedThisCycle[member.uid]) {
      showToast('Already reminded this session','error'); return
    }
    try {
      const days = daysRemaining(member.membership)
      const dayLabel = days === null
        ? 'soon'
        : days < 0
          ? `${Math.abs(days)} day${Math.abs(days)===1?'':'s'} ago`
          : days === 0
            ? 'today'
            : `in ${days} day${days===1?'':'s'}`
      await addDoc(collection(db,'notifications'), {
        type:         'membership_reminder',
        title:        days < 0 ? '🔒 Membership has expired' : '⚠ Membership renewal reminder',
        message:      days < 0
          ? `Your membership expired ${dayLabel}. Speak with the gym admin to renew and unlock class bookings.`
          : `Your membership expires ${dayLabel}. Please coordinate with the gym admin to renew before access is locked.`,
        audience:     'member',
        targetUserId: member.uid,
        from:         adminProfile.name || 'Admin',
        fromUid:      auth.currentUser.uid,
        createdAt:    serverTimestamp(),
      })
      setRemindedThisCycle(prev => ({ ...prev, [member.uid]: true }))
      showToast(`📣 Reminder sent to ${member.name}`)
    } catch (e) {
      console.error('Send reminder failed:', e)
      showToast('❌ Failed: ' + (e.message || 'unknown'),'error')
    }
  }

  // Open payment history drawer
  async function openPaymentHistory(member) {
    setPaymentHistory({ member, payments: null })   // null = loading
    try {
      // Query without orderBy to avoid needing a composite Firestore index
      // (where + orderBy on different fields requires one). We sort client-side.
      const snap = await getDocs(query(collection(db,'payments'), where('memberId','==',member.uid)))
      const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }))
        .sort((a, b) => {
          const aMs = a.createdAt?.toMillis ? a.createdAt.toMillis() : 0
          const bMs = b.createdAt?.toMillis ? b.createdAt.toMillis() : 0
          return bMs - aMs  // newest first
        })
      setPaymentHistory({ member, payments: rows })
    } catch (e) {
      console.error('Load payment history failed:', e)
      setPaymentHistory({ member, payments: [] })
    }
  }

  // Delete a payment record (admin made a mistake recording it).
  // Implementation: SOFT delete — full record moved to /deletedPayments
  // with deletion metadata. Preserved forever for dispute resolution.
  //
  // We do NOT roll back the member's expiresAt. The ledger and access
  // window are independent — admin adjusts expiry separately if needed.
  async function deletePayment() {
    if (!deletePaymentTarget?.id) return
    setDeletingPayment(true)
    try {
      // 1. Re-fetch the payment to ensure we have the full server-side record
      //    (in case the local one is stale)
      const liveSnap = await getDoc(doc(db, 'payments', deletePaymentTarget.id))
      const liveData = liveSnap.exists() ? liveSnap.data() : deletePaymentTarget

      // 2. Write the soft-delete record FIRST (so we don't lose data if
      //    the hard delete fails mid-operation)
      await setDoc(doc(db, 'deletedPayments', deletePaymentTarget.id), {
        ...liveData,
        originalId:        deletePaymentTarget.id,
        deletedAt:         serverTimestamp(),
        deletedBy:         auth.currentUser.uid,
        deletedByName:     adminProfile.name || 'Admin',
      })

      // 3. Now hard-delete from /payments
      await deleteDoc(doc(db, 'payments', deletePaymentTarget.id))

      // 4. Optimistic UI update
      setPaymentHistory(prev => prev ? {
        ...prev,
        payments: (prev.payments || []).filter(p => p.id !== deletePaymentTarget.id)
      } : prev)
      setMonthlyPayments(prev => prev.filter(p => p.id !== deletePaymentTarget.id))

      // 5. Audit log
      try {
        await logActivity({
          type:            'payment_deleted',
          actorId:         auth.currentUser.uid,
          actorName:       adminProfile.name || 'Admin',
          actorRole:       'admin',
          targetUserId:    liveData.memberId,
          targetUserName:  liveData.memberName,
          metadata: {
            amount:          liveData.amount,
            paymentId:       deletePaymentTarget.id,
            paymentMethod:   liveData.paymentMethod,
            durationDays:    liveData.durationDays,
          },
        })
      } catch (_) {}

      showToast('🗑 Payment archived to deletedPayments')
      setDeletePaymentTarget(null)
    } catch (e) {
      console.error('Delete payment failed:', e)
      showToast('❌ Failed: ' + (e.message || 'unknown'), 'error')
    }
    setDeletingPayment(false)
  }

  // ════════════════════════════════════════════════════════
  //  PERMANENTLY DELETE MEMBER — Cascade delete
  //
  //  Order matters: delete child documents BEFORE the user doc,
  //  because security rules check the deleter's role via the user doc.
  //  Audit trail written to deletions/{uid} BEFORE deletion happens.
  // ════════════════════════════════════════════════════════
  async function permanentlyDeleteMember(member){
    if (!member?.uid) return
    setDeleting(true)
    const uid = member.uid
    const me  = auth.currentUser
    let deletedCount = { bookings:0, feedback:0, messages:0, notifications:0, adaptive:0, levelChanges:0 }

    try {
      // 1. Write audit entry FIRST (before anything is gone)
      await setDoc(doc(db,'deletions',uid), {
        memberId:    uid,
        memberName:  member.name || 'Unknown',
        memberEmail: member.email || '',
        memberRole:  member.role || 'member',
        deletedBy:   me?.uid || '',
        deletedByName: adminProfile.name || 'Admin',
        deletedAt:   serverTimestamp(),
        reason:      'Admin permanent deletion',
      })

      // 2. Delete bookings
      const bookingsSnap = await getDocs(query(collection(db,'bookings'), where('userId','==',uid)))
      for (const d of bookingsSnap.docs) {
        // Decrement enrolled count on the class
        try {
          const classRef = doc(db,'classes', d.data().classId)
          const classSnap = await getDoc(classRef)
          if (classSnap.exists() && (classSnap.data().enrolled||0) > 0) {
            await updateDoc(classRef, { enrolled: (classSnap.data().enrolled||1) - 1 })
          }
        } catch(_) {}
        await deleteDoc(d.ref)
        deletedCount.bookings++
      }

      // 3. Delete feedback
      const feedbackSnap = await getDocs(query(collection(db,'feedback'), where('memberId','==',uid)))
      for (const d of feedbackSnap.docs) { await deleteDoc(d.ref); deletedCount.feedback++ }

      // 4. Delete messages (where they're a participant)
      const messagesSnap = await getDocs(query(collection(db,'messages'), where('participants','array-contains',uid)))
      for (const d of messagesSnap.docs) { await deleteDoc(d.ref); deletedCount.messages++ }

      // 5. Delete notifications targeted at them
      const notifSnap = await getDocs(query(collection(db,'notifications'), where('targetUserId','==',uid)))
      for (const d of notifSnap.docs) { await deleteDoc(d.ref); deletedCount.notifications++ }

      // 6. Delete adaptive decisions
      const adaptiveSnap = await getDocs(query(collection(db,'adaptiveDecisions'), where('userId','==',uid)))
      for (const d of adaptiveSnap.docs) { await deleteDoc(d.ref); deletedCount.adaptive++ }

      // 7. Delete level changes audit entries
      const levelSnap = await getDocs(query(collection(db,'levelChanges'), where('memberId','==',uid)))
      for (const d of levelSnap.docs) { await deleteDoc(d.ref); deletedCount.levelChanges++ }

      // 8. Delete stats doc (best-effort, may not exist)
      try { await deleteDoc(doc(db,'stats',uid)) } catch(_) {}

      // 9. Delete workouts doc (best-effort)
      try { await deleteDoc(doc(db,'workouts',uid)) } catch(_) {}

      // 10. Delete user doc LAST (other deletes need this for permission checks)
      await deleteDoc(doc(db,'users',uid))

      // Update local UI state
      setMembers(ms => ms.filter(m => m.uid !== uid))
      setDeleteTarget(null)
      setDeleteTyped('')
      const total = Object.values(deletedCount).reduce((a,b)=>a+b,0)
      // Activity log (final action — fired AFTER everything else succeeds)
      logActivity({
        type: 'member_deleted',
        actorId: me?.uid || '',
        actorName: adminProfile.name || 'Admin',
        actorRole: 'admin',
        payload: { memberId: uid, memberName: member.name || 'Member', recordsRemoved: total },
      })
      showToast(`🗑 ${member.name} permanently deleted (${total} records purged)`)

    } catch(e) {
      console.error('Cascade delete failed:', e)
      showToast('❌ Delete failed: ' + (e.message || 'unknown error'), 'error')
    } finally {
      setDeleting(false)
    }
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

  // ════════════════════════════════════════════════════════
  //  PERMANENT COACH DELETE — cascade, mirrors permanentlyDeleteMember
  //  but for coach-owned data. Writes an audit entry to deletions/{uid}
  //  FIRST, cancels the classes this coach runs (notifying booked
  //  members like the class-delete cascade), removes the feedback they
  //  authored + training recordings + messages + notifications, then the
  //  user doc LAST. Classes are matched by coach NAME (that's how class
  //  docs store the coach). Note: the Firebase Auth login can't be removed
  //  from the client SDK — same limitation as the member delete.
  // ════════════════════════════════════════════════════════
  async function permanentlyDeleteCoach(coach){
    if (!coach?.uid) return
    setCoachDeleting(true)
    const uid = coach.uid
    const me  = auth.currentUser
    let removed = { classes:0, bookings:0, feedback:0, recordings:0, messages:0, notifications:0 }
    try {
      // 1. Audit FIRST
      await setDoc(doc(db,'deletions',uid), {
        memberId: uid, memberName: coach.name || 'Unknown', memberEmail: coach.email || '',
        memberRole: 'coach', deletedBy: me?.uid || '', deletedByName: adminProfile.name || 'Admin',
        deletedAt: serverTimestamp(), reason: 'Admin permanent coach deletion',
      })

      // 2. Cancel classes this coach runs (matched by name) — cascade like class delete
      try {
        const clsSnap = await getDocs(query(collection(db,'classes'), where('coach','==', coach.name || '')))
        for (const cd of clsSnap.docs) {
          const cls = { id: cd.id, ...cd.data() }
          try {
            const bSnap = await getDocs(query(collection(db,'bookings'), where('classId','==',cls.id)))
            for (const b of bSnap.docs) {
              const bk = b.data()
              if (bk.userId) {
                await addDoc(collection(db,'notifications'), {
                  type:'class_cancelled', title:'⚠ Class Cancelled',
                  message:`The class "${cls.name||'your booking'}" on ${cls.day||''} at ${cls.time||''} was cancelled because the coach was removed. Your booking has been refunded.`,
                  audience:'member', targetUserId: bk.userId,
                  from: adminProfile.name||'Admin', fromUid: me?.uid||'', createdAt: serverTimestamp(),
                })
              }
              await deleteDoc(b.ref); removed.bookings++
            }
          } catch(e){ console.warn('coach booking cascade:', e.message) }
          await deleteDoc(cd.ref); removed.classes++
        }
      } catch(e){ console.warn('coach class cascade:', e.message) }

      // 3. Feedback this coach authored
      try {
        const fbSnap = await getDocs(query(collection(db,'feedback'), where('coachId','==',uid)))
        for (const d of fbSnap.docs){ await deleteDoc(d.ref); removed.feedback++ }
      } catch(e){ console.warn('coach feedback:', e.message) }

      // 4. Training recordings (mobile)
      try {
        const trSnap = await getDocs(query(collection(db,'trainingRecordings'), where('coachUid','==',uid)))
        for (const d of trSnap.docs){ await deleteDoc(d.ref); removed.recordings++ }
      } catch(e){ console.warn('coach recordings:', e.message) }

      // 5. Messages where this coach is a participant
      try {
        const mSnap = await getDocs(query(collection(db,'messages'), where('participants','array-contains',uid)))
        for (const d of mSnap.docs){ await deleteDoc(d.ref); removed.messages++ }
      } catch(e){ console.warn('coach messages:', e.message) }

      // 6. Notifications targeted at this coach
      try {
        const nSnap = await getDocs(query(collection(db,'notifications'), where('targetUserId','==',uid)))
        for (const d of nSnap.docs){ await deleteDoc(d.ref); removed.notifications++ }
      } catch(e){ console.warn('coach notifications:', e.message) }

      // 7. Best-effort stats/workouts (coaches can use the member portal too)
      try { await deleteDoc(doc(db,'stats',uid)) } catch(_){}
      try { await deleteDoc(doc(db,'workouts',uid)) } catch(_){}

      // 8. User doc LAST
      await deleteDoc(doc(db,'users',uid))

      // Local state + close modal
      setCoaches(prev => prev.filter(c => c.uid !== uid))
      setClasses(prev => prev.filter(c => (c.coach||'') !== (coach.name||'')))
      setCoachDeleteTarget(null); setCoachDeleteTyped('')
      const total = Object.values(removed).reduce((a,b)=>a+b,0)
      try {
        logActivity({
          type:'coach_deleted', actorId: me?.uid||'', actorName: adminProfile.name||'Admin', actorRole:'admin',
          payload: { coachId: uid, coachName: coach.name||'Coach', classesCancelled: removed.classes, recordsRemoved: total },
        })
      } catch(_){}
      showToast(`🗑 Coach ${coach.name} deleted (${removed.classes} class${removed.classes===1?'':'es'} cancelled, ${total} records purged)`)
    } catch(e){
      console.error('Coach delete failed:', e)
      showToast('❌ Delete failed: '+(e.message||'unknown error'),'error')
    } finally {
      setCoachDeleting(false)
    }
  }

  async function createClass(){
    if(!newClass.name.trim()){showToast('❌ Please enter a class name','error');return}
    try{
      const coachName=newClass.coach||(coaches[0]?.name)||adminProfile.name||'Admin'
      const classData={
        name:newClass.name.trim(),day:newClass.day,time:newClass.time,
        level:newClass.level,spots:parseInt(newClass.spots)||12,
        enrolled:0,coach:coachName,createdAt:serverTimestamp(),
      }
      const tempId='_temp_'+Date.now()
      setClasses(prev => [...prev, { id: tempId, ...classData, createdAt: { seconds: Date.now()/1000 } }])
      setNewClass({name:'',day:'Monday',time:'6:00 AM',spots:'12',level:'Beginner',coach:''})
      setShowNewClass(false)
      showToast('✅ Class created! Members can now see and book it.')
      const ref = await addDoc(collection(db,'classes'), classData)
      setClasses(prev => prev.map(c => c.id === tempId ? { ...c, id: ref.id } : c))
      logActivity({
        type:'class_created',
        actorId: auth.currentUser?.uid || '',
        actorName: adminProfile.name || 'Admin',
        actorRole: 'admin',
        payload: { classId: ref.id, className: classData.name, classDay: classData.day, classTime: classData.time, level: classData.level, coach: coachName },
      })
    }catch(e){
      setClasses(prev => prev.filter(c => !c.id.startsWith('_temp_')))
      showToast('❌ Failed: '+e.message,'error')
    }
  }

  async function deleteClassConfirmed(){
    if(!deleteClassId)return
    const cls = classes.find(c => c.id === deleteClassId)
    const idToDelete = deleteClassId
    setDeleteClassId(null)

    // ════════════════════════════════════════════════════
    //  CLASS CASCADE
    //  1. Find all bookings for this class
    //  2. For each booking: send a "class cancelled" notification
    //     to the booked member, then delete the booking record
    //  3. Then delete the class itself
    //  This prevents orphan bookings (member shows up to a class
    //  that no longer exists) and keeps members informed.
    // ════════════════════════════════════════════════════
    try {
      // Fetch authoritative list of bookings for this class
      let bookingsToCancel = []
      try {
        const snap = await getDocs(query(collection(db, 'bookings'), where('classId', '==', idToDelete)))
        bookingsToCancel = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      } catch (e) {
        // Fall back to local state if query fails
        console.warn('Bookings query failed, using local state:', e.message)
        bookingsToCancel = bookings.filter(b => b.classId === idToDelete)
      }

      // Optimistic UI: remove the class + its bookings from local state
      setClasses(prev => prev.filter(c => c.id !== idToDelete))
      setBookings(prev => prev.filter(b => b.classId !== idToDelete))
      showToast(`🗑 Class deleted${bookingsToCancel.length ? ` · Notifying ${bookingsToCancel.length} member${bookingsToCancel.length===1?'':'s'}` : ''}`)

      // Cancel each booking + notify the affected member
      for (const bk of bookingsToCancel) {
        try {
          // Send cancellation notification to the member
          if (bk.userId) {
            await addDoc(collection(db, 'notifications'), {
              type:         'class_cancelled',
              title:        '⚠ Class Cancelled',
              message:      `The class "${cls?.name || 'your booking'}" on ${cls?.day || ''} at ${cls?.time || ''} has been cancelled by the admin. Your booking has been refunded.`,
              audience:     'member',
              targetUserId: bk.userId,
              from:         adminProfile.name || 'Admin',
              fromUid:      auth.currentUser?.uid || '',
              createdAt:    serverTimestamp(),
            })
          }
          // Delete the booking
          await deleteDoc(doc(db, 'bookings', bk.id))
        } catch (e) {
          console.warn(`Failed to cascade booking ${bk.id}:`, e.message)
        }
      }

      // Finally delete the class doc itself
      await deleteDoc(doc(db,'classes',idToDelete))

      // Activity log
      if (cls) {
        logActivity({
          type:'class_deleted',
          actorId: auth.currentUser?.uid || '',
          actorName: adminProfile.name || 'Admin',
          actorRole: 'admin',
          payload: { classId: cls.id, className: cls.name, classDay: cls.day, classTime: cls.time, bookingsCancelled: bookingsToCancel.length },
        })
      }
    } catch (e) {
      // Critical failure — restore optimistic UI changes
      setClasses(prev => [...prev, cls].filter(Boolean))
      showToast('❌ Delete failed — restored class','error')
    }
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

  // Leaderboard scoring — exclude deactivated accounts (Issue 1 fix)
  const scored=[...members].filter(m=>m.status!=='inactive').map(m=>({...m,score:calcScore(m)})).sort((a,b)=>b.score-a.score).map((m,i)=>({...m,rank:i+1}))
  const maxScore=scored[0]?.score||1
  const filtered=members.filter(m=>m.name?.toLowerCase().includes(searchQ.toLowerCase())||m.email?.toLowerCase().includes(searchQ.toLowerCase()))
  const goalCounts=Object.keys(GOAL_ICONS).map(g=>({goal:g,count:members.filter(m=>m.goal===g).length}))
  const levelCounts=LEVELS.map(lv=>({level:lv,count:members.filter(m=>getMemberLevel(m)===lv).length}))

  const inp={background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.12)',borderRadius:10,padding:'11px 14px',color:'#f0ece8',fontSize:13,fontFamily:'Montserrat,sans-serif',outline:'none',width:'100%',boxSizing:'border-box',transition:'border-color 0.2s'}
  const selStyle={...inp,cursor:'pointer',appearance:'none',WebkitAppearance:'none',backgroundImage:`url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%23555'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`,backgroundRepeat:'no-repeat',backgroundPosition:'right 12px center',paddingRight:32}

  // Tab order, grouped by purpose: landing → people/management → operations →
  // communication → community. Tail (classes→inbox→notifications→forum→leaderboard)
  // is kept identical to the coach dashboard for a predictable staff layout.
  const tabs=[{id:'overview',icon:'📊',label:'Overview'},{id:'members',icon:'👥',label:'Members'},{id:'coaches',icon:'🥊',label:`Coaches${pending.length>0?' ('+pending.length+')':''}`},{id:'memberships',icon:'💳',label:'Memberships'},{id:'classes',icon:'📋',label:'Classes'},{id:'inbox',icon:'💬',label:'Inbox'},{id:'notifications',icon:'📢',label:'Notifications'},{id:'forum',icon:'💬',label:'Forum'},{id:'leaderboard',icon:'🏆',label:'Leaderboard'}]

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

      {/* ════════════════════════════════════════════════════ */}
      {/*  LEVEL CONTROL MODAL — Admin                         */}
      {/* ════════════════════════════════════════════════════ */}
      {/* ════════════════════════════════════════════════════ */}
      {/*  PERMANENT DELETE — Two-step confirmation             */}
      {/*  Type the member's name to confirm.                   */}
      {/* ════════════════════════════════════════════════════ */}
      {/* ════════════════════════════════════════════════════ */}
      {/*  CLEAR ALL ACTIVITY — Confirmation                    */}
      {/* ════════════════════════════════════════════════════ */}
      {clearActivityConfirm && (
        <div onClick={()=>!clearingActivity && setClearActivityConfirm(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'2px solid rgba(232,74,47,0.4)',maxWidth:440,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.8),0 0 50px rgba(232,74,47,0.25)'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#c93820)'}}/>
            <div style={{padding:'22px 26px',display:'flex',flexDirection:'column',gap:16,position:'relative'}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:44,height:44,borderRadius:12,background:'linear-gradient(135deg,#e84a2f,#c93820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(232,74,47,0.5)'}}>🧹</div>
                <div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#e84a2f'}}>CLEAR ALL ACTIVITY?</div>
                  <div style={{fontSize:9,color:'#888',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>This wipes the activity feed for everyone</div>
                </div>
              </div>
              <div style={{padding:'14px 16px',background:'rgba(232,74,47,0.06)',border:'1px solid rgba(232,74,47,0.2)',borderRadius:12,fontSize:12,color:'#bbb',lineHeight:1.6}}>
                <strong style={{color:'#e84a2f'}}>{activity.length}</strong> activity event{activity.length===1?'':'s'} will be permanently deleted. Announcements are NOT affected. Audit logs (deletions, level changes) are NOT affected.
              </div>
              <div style={{display:'flex',gap:10}}>
                <button onClick={()=>setClearActivityConfirm(false)} disabled={clearingActivity}
                  style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:clearingActivity?'not-allowed':'pointer',opacity:clearingActivity?0.5:1,transition:'all 0.2s'}}
                  onMouseEnter={e=>{if(!clearingActivity){e.currentTarget.style.background='rgba(255,255,255,0.08)';e.currentTarget.style.color='#f0ece8'}}}
                  onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.color='#aaa'}}>
                  KEEP THEM
                </button>
                <button onClick={clearAllActivity} disabled={clearingActivity}
                  style={{flex:1.3,background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:clearingActivity?'not-allowed':'pointer',boxShadow:'0 4px 14px rgba(232,74,47,0.4)',transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',opacity:clearingActivity?0.7:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}
                  onMouseEnter={e=>{if(!clearingActivity){e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 8px 22px rgba(232,74,47,0.55)'}}}
                  onMouseLeave={e=>{if(!clearingActivity){e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 4px 14px rgba(232,74,47,0.4)'}}}>
                  {clearingActivity ? (<>
                    <span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                    CLEARING...
                  </>) : `🧹 CLEAR ${activity.length}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/*  RECORD PAYMENT MODAL                                 */}
      {/* ════════════════════════════════════════════════════ */}
      {payTarget && (
        <div onClick={()=>!paySaving && setPayTarget(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'2px solid rgba(74,222,128,0.35)',maxWidth:500,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.8),0 0 50px rgba(74,222,128,0.15)'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#4ade80,#22c55e)'}}/>
            <div style={{padding:'22px 26px',display:'flex',flexDirection:'column',gap:14}}>
              <div style={{display:'flex',alignItems:'center',gap:12}}>
                <div style={{width:46,height:46,borderRadius:12,background:'linear-gradient(135deg,#4ade80,#22c55e)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>💰</div>
                <div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#4ade80'}}>RECORD PAYMENT</div>
                  <div style={{fontSize:11,color:'#888',marginTop:2}}>{payTarget.name || 'Unknown member'}</div>
                </div>
              </div>

              {/* Current expiry context */}
              {payTarget.membership?.expiresAt && (
                <div style={{padding:'10px 14px',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:10,fontSize:11,color:'#888'}}>
                  Current expiry: <strong style={{color:'#f0ece8'}}>{fmtExpiry(payTarget.membership)}</strong>
                  {(() => {
                    const d = daysRemaining(payTarget.membership)
                    if (d === null) return null
                    return <span style={{marginLeft:6,color:'#666'}}>· {d >= 0 ? `${d}d left` : `${Math.abs(d)}d ago`}</span>
                  })()}
                </div>
              )}

              {/* Plan catalog — pick a preset (auto-fills amount + days) or use custom */}
              <div>
                <label style={{fontSize:9,fontWeight:800,letterSpacing:'0.1em',textTransform:'uppercase',color:'#888'}}>Discipline</label>
                <div style={{display:'flex',gap:6,marginTop:4}}>
                  {DISCIPLINES.map(d => (
                    <button key={d} onClick={()=>setPayForm(p=>({...p,discipline:d,planId:''}))}
                      style={{flex:1,padding:'8px',background:payForm.discipline===d?'rgba(74,222,128,0.15)':'rgba(255,255,255,0.03)',border:`1px solid ${payForm.discipline===d?'rgba(74,222,128,0.4)':'rgba(255,255,255,0.06)'}`,borderRadius:10,color:payForm.discipline===d?'#4ade80':'#888',fontSize:10,fontWeight:700,cursor:'pointer'}}>
                      {d}
                    </button>
                  ))}
                </div>
                <select value={payForm.planId}
                  onChange={e=>{ const pl=getPlan(e.target.value); setPayForm(p=> pl ? {...p,planId:pl.id,amount:String(pl.amount),durationDays:String(pl.durationDays||0)} : {...p,planId:''}) }}
                  style={{width:'100%',marginTop:8,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'10px 12px',color:'#f0ece8',fontSize:12,fontFamily:'Montserrat,sans-serif',outline:'none',boxSizing:'border-box',cursor:'pointer'}}>
                  <option value="">— Custom amount —</option>
                  {PLANS.filter(p=>p.discipline===payForm.discipline).map(pl=>(
                    <option key={pl.id} value={pl.id}>{pl.category} · {pl.name} — {peso(pl.amount)}{pl.kind==='dropin'?' (drop-in)':pl.durationDays?` · ${pl.durationDays}d`:''}</option>
                  ))}
                </select>
                {getPlan(payForm.planId)?.kind === 'dropin' && (
                  <div style={{marginTop:8,padding:'8px 12px',background:'rgba(66,165,245,0.08)',border:'1px solid rgba(66,165,245,0.25)',borderRadius:8,fontSize:10,color:'#7ba8d4',lineHeight:1.5}}>
                    ℹ Drop-in is <strong>record-only</strong> — logged to the payments ledger; it does not change the member's access or expiry.
                  </div>
                )}
              </div>

              <div style={{display:'grid',gridTemplateColumns: getPlan(payForm.planId)?.kind==='dropin' ? '1fr' : '2fr 1fr',gap:10}}>
                <div>
                  <label style={{fontSize:9,fontWeight:800,letterSpacing:'0.1em',textTransform:'uppercase',color:'#888'}}>Amount (₱)</label>
                  <input type="number" min="0" step="100" value={payForm.amount}
                    onChange={e=>setPayForm(p=>({...p,amount:e.target.value}))}
                    style={{width:'100%',marginTop:4,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'10px 12px',color:'#f0ece8',fontSize:14,fontFamily:'Montserrat,sans-serif',outline:'none',boxSizing:'border-box'}}/>
                </div>
                {getPlan(payForm.planId)?.kind !== 'dropin' && (
                  <div>
                    <label style={{fontSize:9,fontWeight:800,letterSpacing:'0.1em',textTransform:'uppercase',color:'#888'}}>Duration (days)</label>
                    <input type="number" min="1" step="1" value={payForm.durationDays}
                      onChange={e=>setPayForm(p=>({...p,durationDays:e.target.value}))}
                      style={{width:'100%',marginTop:4,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'10px 12px',color:'#f0ece8',fontSize:14,fontFamily:'Montserrat,sans-serif',outline:'none',boxSizing:'border-box'}}/>
                  </div>
                )}
              </div>

              <div>
                <label style={{fontSize:9,fontWeight:800,letterSpacing:'0.1em',textTransform:'uppercase',color:'#888'}}>Payment Method</label>
                <div style={{display:'flex',gap:6,marginTop:4}}>
                  {[
                    {id:'cash',label:'💵 Cash'},
                    {id:'gcash',label:'📱 GCash'},
                    {id:'bank',label:'🏦 Bank'},
                    {id:'other',label:'· Other'},
                  ].map(opt => (
                    <button key={opt.id} onClick={()=>setPayForm(p=>({...p,method:opt.id}))}
                      style={{flex:1,padding:'8px',background:payForm.method===opt.id?'rgba(74,222,128,0.15)':'rgba(255,255,255,0.03)',border:`1px solid ${payForm.method===opt.id?'rgba(74,222,128,0.4)':'rgba(255,255,255,0.06)'}`,borderRadius:10,color:payForm.method===opt.id?'#4ade80':'#888',fontSize:10,fontWeight:700,cursor:'pointer'}}>
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label style={{fontSize:9,fontWeight:800,letterSpacing:'0.1em',textTransform:'uppercase',color:'#888'}}>Reference Number (optional)</label>
                <input value={payForm.reference} placeholder="GCash ref #, bank txn ID, etc."
                  onChange={e=>setPayForm(p=>({...p,reference:e.target.value}))}
                  style={{width:'100%',marginTop:4,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'10px 12px',color:'#f0ece8',fontSize:12,fontFamily:'Montserrat,sans-serif',outline:'none',boxSizing:'border-box'}}/>
              </div>

              <div>
                <label style={{fontSize:9,fontWeight:800,letterSpacing:'0.1em',textTransform:'uppercase',color:'#888'}}>Notes (optional)</label>
                <textarea value={payForm.notes} placeholder="e.g. promo rate, family discount"
                  onChange={e=>setPayForm(p=>({...p,notes:e.target.value}))} rows={2}
                  style={{width:'100%',marginTop:4,background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'10px 12px',color:'#f0ece8',fontSize:12,fontFamily:'Montserrat,sans-serif',outline:'none',resize:'vertical',boxSizing:'border-box'}}/>
              </div>

              <div style={{display:'flex',gap:10,marginTop:4}}>
                <button onClick={()=>setPayTarget(null)} disabled={paySaving}
                  style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'11px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:paySaving?'not-allowed':'pointer',opacity:paySaving?0.5:1}}>
                  CANCEL
                </button>
                <button onClick={recordPayment} disabled={paySaving}
                  style={{flex:1.4,background:'linear-gradient(135deg,#4ade80,#22c55e)',color:'#000',border:'none',borderRadius:50,padding:'11px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:paySaving?'not-allowed':'pointer',boxShadow:'0 4px 14px rgba(74,222,128,0.35)',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                  {paySaving ? (<><span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(0,0,0,0.3)',borderTopColor:'#000',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>SAVING…</>) : (getPlan(payForm.planId)?.kind==='dropin' ? '💵 RECORD DROP-IN' : '💰 RECORD PAYMENT')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/*  PAUSE / RESUME CONFIRMATION                          */}
      {/* ════════════════════════════════════════════════════ */}
      {pauseTarget && (() => {
        const isPaused = !!pauseTarget.membership?.pausedAt
        return (
          <div onClick={()=>!pauseSaving && setPauseTarget(null)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:`2px solid ${isPaused?'rgba(74,222,128,0.35)':'rgba(245,200,66,0.35)'}`,maxWidth:460,width:'100%',overflow:'hidden'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:isPaused?'linear-gradient(180deg,#4ade80,#22c55e)':'linear-gradient(180deg,#f5c842,#e08820)'}}/>
              <div style={{padding:'22px 26px',display:'flex',flexDirection:'column',gap:14}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:46,height:46,borderRadius:12,background:isPaused?'linear-gradient(135deg,#4ade80,#22c55e)':'linear-gradient(135deg,#f5c842,#e08820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22}}>{isPaused?'▶':'⏸'}</div>
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:isPaused?'#4ade80':'#f5c842'}}>{isPaused ? 'RESUME MEMBERSHIP?' : 'PAUSE MEMBERSHIP?'}</div>
                    <div style={{fontSize:11,color:'#888',marginTop:2}}>{pauseTarget.name}</div>
                  </div>
                </div>
                <div style={{padding:'12px 14px',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:10,fontSize:12,color:'#bbb',lineHeight:1.6}}>
                  {isPaused ? (
                    <>Resuming will <strong style={{color:'#4ade80'}}>extend the expiry date</strong> by however many days the membership was paused. The member will regain booking access immediately.</>
                  ) : (
                    <>Pausing freezes the expiry timer. The member can still log in and see their workouts, but <strong style={{color:'#f5c842'}}>cannot book classes</strong>. When you resume, the expiry shifts forward by the paused duration.</>
                  )}
                </div>
                <div style={{display:'flex',gap:10}}>
                  <button onClick={()=>setPauseTarget(null)} disabled={pauseSaving}
                    style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'11px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:pauseSaving?'not-allowed':'pointer',opacity:pauseSaving?0.5:1}}>
                    CANCEL
                  </button>
                  <button onClick={()=>togglePause(pauseTarget)} disabled={pauseSaving}
                    style={{flex:1.3,background:isPaused?'linear-gradient(135deg,#4ade80,#22c55e)':'linear-gradient(135deg,#f5c842,#e08820)',color:'#000',border:'none',borderRadius:50,padding:'11px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:pauseSaving?'not-allowed':'pointer'}}>
                    {pauseSaving ? 'SAVING…' : (isPaused ? '▶ RESUME' : '⏸ PAUSE')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ════════════════════════════════════════════════════ */}
      {/*  PAYMENT HISTORY DRAWER                               */}
      {/* ════════════════════════════════════════════════════ */}
      {paymentHistory && (
        <div onClick={()=>setPaymentHistory(null)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'2px solid rgba(66,165,245,0.35)',maxWidth:560,width:'100%',maxHeight:'80vh',overflow:'hidden',display:'flex',flexDirection:'column'}}>
            <div style={{padding:'18px 24px',borderBottom:'1px solid rgba(255,255,255,0.06)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
              <div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#42a5f5'}}>📜 PAYMENT HISTORY</div>
                <div style={{fontSize:11,color:'#888',marginTop:2}}>{paymentHistory.member.name}</div>
              </div>
              <button onClick={()=>setPaymentHistory(null)}
                style={{background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,width:34,height:34,color:'#888',fontSize:14,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'16px 24px'}}>
              {paymentHistory.payments === null ? (
                <div style={{textAlign:'center',color:'#555',fontSize:12,padding:30}}>Loading…</div>
              ) : paymentHistory.payments.length === 0 ? (
                <div style={{textAlign:'center',color:'#555',fontSize:12,padding:30}}>No payments recorded yet</div>
              ) : (
                <div style={{display:'flex',flexDirection:'column',gap:10}}>
                  {paymentHistory.payments.map(p => {
                    const dt = p.createdAt?.toDate ? p.createdAt.toDate() : null
                    return (
                      <div key={p.id} className="payment-row"
                        style={{padding:'14px 16px',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:12,position:'relative',transition:'all 0.2s'}}
                        onMouseEnter={e=>{
                          const btn = e.currentTarget.querySelector('.payment-delete-btn')
                          if (btn) btn.style.opacity = '1'
                        }}
                        onMouseLeave={e=>{
                          const btn = e.currentTarget.querySelector('.payment-delete-btn')
                          if (btn) btn.style.opacity = '0'
                        }}>
                        {/* Delete button — appears on row hover */}
                        <button
                          className="payment-delete-btn"
                          onClick={()=>setDeletePaymentTarget(p)}
                          title="Delete this payment record"
                          style={{
                            position:'absolute',top:10,right:10,
                            width:28,height:28,borderRadius:8,
                            background:'rgba(232,74,47,0.12)',
                            border:'1px solid rgba(232,74,47,0.3)',
                            color:'#e84a2f',cursor:'pointer',
                            display:'flex',alignItems:'center',justifyContent:'center',
                            fontSize:13,fontWeight:700,
                            opacity:0,transition:'opacity 0.2s,background 0.15s',
                          }}
                          onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.25)'}}
                          onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.12)'}}>
                          🗑
                        </button>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6,paddingRight:36}}>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#4ade80',letterSpacing:'0.04em'}}>
                            ₱{(p.amount||0).toLocaleString()}
                          </div>
                          <span style={{fontSize:9,padding:'2px 8px',background:'rgba(66,165,245,0.12)',color:'#42a5f5',border:'1px solid rgba(66,165,245,0.3)',borderRadius:50,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>
                            {p.paymentMethod || 'cash'}
                          </span>
                        </div>
                        {p.planLabel && (
                          <div style={{fontSize:11,color:'#f5c842',fontWeight:600,marginBottom:4}}>🥊 {p.planLabel}</div>
                        )}
                        <div style={{fontSize:11,color:'#888',display:'flex',gap:10,flexWrap:'wrap'}}>
                          {p.kind === 'dropin'
                            ? <span style={{color:'#f5c842'}}>Drop-in · no membership change</span>
                            : <>
                                <span>{p.durationDays} days</span>
                                {p.startsAt && <span>· {fmtExpiry({expiresAt:p.startsAt})}–{fmtExpiry({expiresAt:p.expiresAt})}</span>}
                              </>}
                        </div>
                        {p.referenceNumber && (
                          <div style={{fontSize:10,color:'#666',marginTop:4,fontFamily:'monospace'}}>Ref: {p.referenceNumber}</div>
                        )}
                        {p.notes && (
                          <div style={{fontSize:11,color:'#aaa',marginTop:6,fontStyle:'italic'}}>"{p.notes}"</div>
                        )}
                        <div style={{fontSize:9,color:'#555',marginTop:8,paddingTop:6,borderTop:'1px solid rgba(255,255,255,0.04)',letterSpacing:'0.04em'}}>
                          Recorded by {p.receivedByName || 'Admin'}{dt ? ` · ${dt.toLocaleDateString()} ${dt.toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'})}` : ''}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ════════════════════════════════════════════════════ */}
      {/*  DELETE PAYMENT RECORD CONFIRMATION                   */}
      {/*  (Layered above the payment history drawer)           */}
      {/* ════════════════════════════════════════════════════ */}
      {deletePaymentTarget && (() => {
        const p = deletePaymentTarget
        const dt = p.createdAt?.toDate ? p.createdAt.toDate() : null
        return (
          <div onClick={()=>!deletingPayment && setDeletePaymentTarget(null)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',backdropFilter:'blur(12px)',zIndex:2100,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'2px solid rgba(232,74,47,0.4)',maxWidth:460,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.85)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#c93820)'}}/>
              <div style={{padding:'22px 26px',display:'flex',flexDirection:'column',gap:14}}>
                <div style={{display:'flex',alignItems:'center',gap:12}}>
                  <div style={{width:46,height:46,borderRadius:12,background:'linear-gradient(135deg,#e84a2f,#c93820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(232,74,47,0.4)'}}>🗑</div>
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#e84a2f'}}>DELETE PAYMENT?</div>
                    <div style={{fontSize:10,color:'#888',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>Cannot be undone</div>
                  </div>
                </div>

                {/* Receipt preview */}
                <div style={{padding:'14px 16px',background:'rgba(255,255,255,0.03)',border:'1px solid rgba(255,255,255,0.06)',borderRadius:12}}>
                  <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',marginBottom:6}}>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:'#4ade80',letterSpacing:'0.04em'}}>
                      ₱{(p.amount||0).toLocaleString()}
                    </div>
                    <span style={{fontSize:9,padding:'2px 8px',background:'rgba(66,165,245,0.12)',color:'#42a5f5',border:'1px solid rgba(66,165,245,0.3)',borderRadius:50,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>
                      {p.paymentMethod || 'cash'}
                    </span>
                  </div>
                  <div style={{fontSize:11,color:'#888'}}>
                    {p.planLabel ? `${p.planLabel} · ` : ''}{p.kind === 'dropin' ? 'Drop-in' : `${p.durationDays} days`} · Recorded by {p.receivedByName || 'Admin'}
                    {dt ? ` · ${dt.toLocaleDateString()}` : ''}
                  </div>
                  {p.referenceNumber && (
                    <div style={{fontSize:10,color:'#666',marginTop:3,fontFamily:'monospace'}}>Ref: {p.referenceNumber}</div>
                  )}
                </div>

                {/* Warning about expiry */}
                <div style={{padding:'10px 14px',background:'rgba(245,200,66,0.06)',border:'1px solid rgba(245,200,66,0.22)',borderRadius:10,fontSize:11,color:'#bbb',lineHeight:1.6}}>
                  ⚠ <strong style={{color:'#f5c842'}}>Heads up:</strong> Deleting this record will NOT roll back the member's expiry date. If this payment is the source of their current access, you'll want to adjust their expiry separately (e.g., via Pause/Resume or a corrected payment).
                </div>

                <div style={{display:'flex',gap:10}}>
                  <button onClick={()=>setDeletePaymentTarget(null)} disabled={deletingPayment}
                    style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'11px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:deletingPayment?'not-allowed':'pointer',opacity:deletingPayment?0.5:1}}>
                    KEEP IT
                  </button>
                  <button onClick={deletePayment} disabled={deletingPayment}
                    style={{flex:1.3,background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'11px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:deletingPayment?'not-allowed':'pointer',boxShadow:'0 4px 14px rgba(232,74,47,0.4)',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                    {deletingPayment ? (<>
                      <span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                      DELETING…
                    </>) : '🗑 DELETE PAYMENT'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ════════════════════════════════════════════════════ */}
      {/*  PERMANENT DELETE — COACH (two-step type-to-confirm)  */}
      {/* ════════════════════════════════════════════════════ */}
      {coachDeleteTarget && (() => {
        const expected = (coachDeleteTarget.name || '').trim()
        const matches = coachDeleteTyped.trim().toLowerCase() === expected.toLowerCase() && expected.length > 0
        const coachClasses = classes.filter(c => (c.coach||'') === (coachDeleteTarget.name||''))
        return (
          <div onClick={()=>!coachDeleting && setCoachDeleteTarget(null)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',backdropFilter:'blur(12px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'2px solid rgba(232,74,47,0.4)',maxWidth:520,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.8),0 0 60px rgba(232,74,47,0.25)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#c93820)'}}/>
              <div style={{padding:'20px 26px',borderBottom:'1px solid rgba(232,74,47,0.2)',display:'flex',alignItems:'center',gap:14}}>
                <div style={{width:46,height:46,borderRadius:12,background:'linear-gradient(135deg,#e84a2f,#c93820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(232,74,47,0.5)'}}>🗑</div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#e84a2f'}}>DELETE COACH</div>
                  <div style={{fontSize:9,color:'#888',letterSpacing:'0.14em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>This action cannot be undone</div>
                </div>
                {!coachDeleting && (
                  <button onClick={()=>setCoachDeleteTarget(null)}
                    style={{width:32,height:32,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:9,color:'#888',fontSize:16,cursor:'pointer'}}>✕</button>
                )}
              </div>
              <div style={{padding:'24px 26px',display:'flex',flexDirection:'column',gap:18}}>
                <div style={{padding:'14px 16px',background:'rgba(232,74,47,0.06)',border:'1px solid rgba(232,74,47,0.2)',borderRadius:12,display:'flex',alignItems:'center',gap:14}}>
                  <div style={{width:48,height:48,borderRadius:'50%',background:'linear-gradient(135deg,#42a5f5,#2563eb)',color:'#fff',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:22,flexShrink:0}}>
                    {(coachDeleteTarget.name||'?')[0].toUpperCase()}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:3}}>{coachDeleteTarget.name}</div>
                    <div style={{fontSize:10,color:'#888'}}>{coachDeleteTarget.email||'—'}</div>
                    <div style={{fontSize:9,color:'#666',letterSpacing:'0.06em',marginTop:2}}>Coach account</div>
                  </div>
                </div>

                {coachClasses.length > 0 && (
                  <div style={{padding:'12px 14px',background:'rgba(245,200,66,0.08)',border:'1px solid rgba(245,200,66,0.3)',borderRadius:10,fontSize:11,color:'#f5c842',lineHeight:1.6}}>
                    ⚠ This coach runs <strong>{coachClasses.length}</strong> class{coachClasses.length===1?'':'es'}. Deleting will <strong>cancel</strong> {coachClasses.length===1?'it':'them'} and notify all booked members.
                  </div>
                )}

                <div>
                  <div style={{fontSize:9,fontWeight:800,color:'#e84a2f',letterSpacing:'0.16em',textTransform:'uppercase',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                    <span style={{display:'inline-block',width:14,height:2,background:'#e84a2f'}}/>
                    The following will be permanently erased
                  </div>
                  <div style={{background:'rgba(0,0,0,0.4)',border:'1px solid rgba(232,74,47,0.15)',borderRadius:10,padding:'10px 14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px 14px',fontSize:10,color:'#aaa',lineHeight:1.7}}>
                    <span>• Coach profile</span>
                    <span>• Classes they run (cancelled)</span>
                    <span>• Feedback they wrote</span>
                    <span>• Training recordings</span>
                    <span>• Their messages</span>
                    <span>• Notifications & alerts</span>
                  </div>
                  <div style={{fontSize:10,color:'#888',marginTop:8,fontStyle:'italic',lineHeight:1.5}}>
                    💾 An audit entry is saved in <code style={{background:'rgba(0,0,0,0.4)',padding:'1px 5px',borderRadius:4,fontFamily:'monospace',color:'#c084fc'}}>deletions/</code>. The Firebase Auth login is not removed by this action — delete it in the Firebase console if needed.
                  </div>
                </div>

                <div>
                  <div style={{fontSize:9,fontWeight:800,color:'#e84a2f',letterSpacing:'0.16em',textTransform:'uppercase',marginBottom:8}}>Type the coach's name to confirm</div>
                  <div style={{fontSize:11,color:'#888',marginBottom:8}}>
                    Type <strong style={{color:'#f5c842',fontFamily:'monospace',background:'rgba(245,200,66,0.1)',padding:'2px 8px',borderRadius:5}}>{coachDeleteTarget.name}</strong> below:
                  </div>
                  <input type="text" value={coachDeleteTyped} onChange={e=>setCoachDeleteTyped(e.target.value)} disabled={coachDeleting} autoFocus
                    placeholder={`Type "${coachDeleteTarget.name}" exactly`}
                    style={{width:'100%',padding:'12px 14px',background:'rgba(0,0,0,0.4)',border:`1.5px solid ${matches?'#22c55e':'rgba(232,74,47,0.3)'}`,borderRadius:10,color:matches?'#22c55e':'#f0ece8',fontSize:13,fontFamily:'monospace',outline:'none'}}/>
                  {matches && <div style={{fontSize:10,color:'#22c55e',fontWeight:700,marginTop:6}}>✓ Name matches — deletion unlocked</div>}
                </div>

                <div style={{display:'flex',gap:10,marginTop:4}}>
                  <button onClick={()=>setCoachDeleteTarget(null)} disabled={coachDeleting}
                    style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:coachDeleting?'not-allowed':'pointer',opacity:coachDeleting?0.5:1}}>
                    KEEP COACH
                  </button>
                  <button onClick={()=>permanentlyDeleteCoach(coachDeleteTarget)} disabled={!matches||coachDeleting}
                    style={{flex:1.4,background:matches?'linear-gradient(135deg,#e84a2f,#c93820)':'rgba(232,74,47,0.2)',color:matches?'#fff':'#666',border:'none',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:matches&&!coachDeleting?'pointer':'not-allowed',boxShadow:matches?'0 4px 14px rgba(232,74,47,0.4)':'none',display:'flex',alignItems:'center',justifyContent:'center',gap:8}}>
                    {coachDeleting ? (<>
                      <span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                      DELETING...
                    </>) : '🗑 PERMANENTLY DELETE'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {deleteTarget && (() => {
        const expected = (deleteTarget.name || '').trim()
        const matches = deleteTyped.trim().toLowerCase() === expected.toLowerCase() && expected.length > 0
        return (
          <div onClick={()=>!deleting && setDeleteTarget(null)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.92)',backdropFilter:'blur(12px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'2px solid rgba(232,74,47,0.4)',maxWidth:520,width:'100%',overflow:'hidden',boxShadow:'0 30px 80px rgba(0,0,0,0.8),0 0 60px rgba(232,74,47,0.25)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#c93820)'}}/>
              {/* Animated glow burst */}
              <div style={{position:'absolute',top:-80,right:-80,width:300,height:300,borderRadius:'50%',background:'radial-gradient(circle,rgba(232,74,47,0.2),transparent 65%)',pointerEvents:'none',animation:'dangerPulse 2s ease-in-out infinite'}}/>

              {/* Header */}
              <div style={{padding:'20px 26px',borderBottom:'1px solid rgba(232,74,47,0.2)',background:'linear-gradient(135deg,rgba(232,74,47,0.1) 0%,transparent 60%)',display:'flex',alignItems:'center',gap:14,position:'relative'}}>
                <div style={{width:46,height:46,borderRadius:12,background:'linear-gradient(135deg,#e84a2f,#c93820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(232,74,47,0.5)'}}>🗑</div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.05em',color:'#e84a2f',textShadow:'0 0 12px rgba(232,74,47,0.5)'}}>PERMANENT DELETE</div>
                  <div style={{fontSize:9,color:'#888',letterSpacing:'0.14em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>This action cannot be undone</div>
                </div>
                {!deleting && (
                  <button onClick={()=>setDeleteTarget(null)}
                    style={{width:32,height:32,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:9,color:'#888',fontSize:16,cursor:'pointer'}}>✕</button>
                )}
              </div>

              {/* Body */}
              <div style={{padding:'24px 26px',display:'flex',flexDirection:'column',gap:18,position:'relative'}}>
                {/* Member info card */}
                <div style={{padding:'14px 16px',background:'rgba(232,74,47,0.06)',border:'1px solid rgba(232,74,47,0.2)',borderRadius:12,display:'flex',alignItems:'center',gap:14}}>
                  <div style={{width:48,height:48,borderRadius:'50%',background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'2px solid rgba(232,74,47,0.5)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:22,flexShrink:0,boxShadow:'0 4px 14px rgba(232,74,47,0.4)'}}>
                    {(deleteTarget.name||'?')[0].toUpperCase()}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:3}}>{deleteTarget.name}</div>
                    <div style={{fontSize:10,color:'#888',marginBottom:1}}>{deleteTarget.email||'—'}</div>
                    <div style={{fontSize:9,color:'#666',letterSpacing:'0.06em'}}>
                      {getMemberLevel(deleteTarget)} · {deleteTarget.totalWorkouts||0} workouts · joined {deleteTarget.createdAt?.seconds?new Date(deleteTarget.createdAt.seconds*1000).toLocaleDateString():'recently'}
                    </div>
                  </div>
                </div>

                {/* Warning list — what gets deleted */}
                <div>
                  <div style={{fontSize:9,fontWeight:800,color:'#e84a2f',letterSpacing:'0.16em',textTransform:'uppercase',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                    <span style={{display:'inline-block',width:14,height:2,background:'#e84a2f'}}/>
                    The following will be permanently erased
                  </div>
                  <div style={{background:'rgba(0,0,0,0.4)',border:'1px solid rgba(232,74,47,0.15)',borderRadius:10,padding:'10px 14px',display:'grid',gridTemplateColumns:'1fr 1fr',gap:'4px 14px',fontSize:10,color:'#aaa',lineHeight:1.7}}>
                    <span>• User profile & login</span>
                    <span>• All bookings (slots freed)</span>
                    <span>• Workout history & stats</span>
                    <span>• Coach feedback received</span>
                    <span>• All sent/received messages</span>
                    <span>• Notifications & alerts</span>
                    <span>• Adaptive AI audit log</span>
                    <span>• Level change history</span>
                  </div>
                  <div style={{fontSize:10,color:'#888',marginTop:8,fontStyle:'italic',lineHeight:1.5}}>
                    💾 An audit entry of this deletion will be saved in <code style={{background:'rgba(0,0,0,0.4)',padding:'1px 5px',borderRadius:4,fontFamily:'monospace',color:'#c084fc'}}>deletions/</code> for compliance.
                  </div>
                </div>

                {/* Type-to-confirm */}
                <div>
                  <div style={{fontSize:9,fontWeight:800,color:'#e84a2f',letterSpacing:'0.16em',textTransform:'uppercase',marginBottom:8,display:'flex',alignItems:'center',gap:8}}>
                    <span style={{display:'inline-block',width:14,height:2,background:'#e84a2f'}}/>
                    Type the member's name to confirm
                  </div>
                  <div style={{fontSize:11,color:'#888',marginBottom:8}}>
                    Type <strong style={{color:'#f5c842',fontFamily:'monospace',background:'rgba(245,200,66,0.1)',padding:'2px 8px',borderRadius:5,letterSpacing:'0.05em'}}>{deleteTarget.name}</strong> below:
                  </div>
                  <input type="text" value={deleteTyped} onChange={e=>setDeleteTyped(e.target.value)} disabled={deleting}
                    autoFocus
                    placeholder={`Type "${deleteTarget.name}" exactly`}
                    style={{width:'100%',padding:'12px 14px',background:'rgba(0,0,0,0.4)',border:`1.5px solid ${matches?'#22c55e':'rgba(232,74,47,0.3)'}`,borderRadius:10,color:matches?'#22c55e':'#f0ece8',fontSize:13,fontFamily:'monospace',outline:'none',transition:'all 0.2s',boxShadow:matches?'0 0 16px rgba(34,197,94,0.25)':'inset 0 1px 4px rgba(0,0,0,0.3)'}}
                    onFocus={e=>{if(!matches)e.currentTarget.style.borderColor='rgba(232,74,47,0.6)'}}
                    onBlur={e=>{if(!matches)e.currentTarget.style.borderColor='rgba(232,74,47,0.3)'}}/>
                  {matches && (
                    <div style={{fontSize:10,color:'#22c55e',fontWeight:700,marginTop:6,letterSpacing:'0.04em'}}>✓ Name matches — deletion unlocked</div>
                  )}
                </div>

                {/* Action buttons */}
                <div style={{display:'flex',gap:10,marginTop:4}}>
                  <button onClick={()=>setDeleteTarget(null)} disabled={deleting}
                    style={{flex:1,background:'rgba(255,255,255,0.04)',color:'#aaa',border:'1px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:deleting?'not-allowed':'pointer',transition:'all 0.2s',opacity:deleting?0.5:1}}
                    onMouseEnter={e=>{if(!deleting){e.currentTarget.style.background='rgba(255,255,255,0.08)';e.currentTarget.style.color='#f0ece8'}}}
                    onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.color='#aaa'}}>
                    KEEP USER
                  </button>
                  <button onClick={()=>permanentlyDeleteMember(deleteTarget)} disabled={!matches||deleting}
                    style={{flex:1.4,background:matches?'linear-gradient(135deg,#e84a2f,#c93820)':'rgba(232,74,47,0.2)',color:matches?'#fff':'#666',border:'none',borderRadius:50,padding:'12px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:matches&&!deleting?'pointer':'not-allowed',boxShadow:matches?'0 4px 14px rgba(232,74,47,0.4)':'none',transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',opacity:deleting?0.7:1,display:'flex',alignItems:'center',justifyContent:'center',gap:8}}
                    onMouseEnter={e=>{if(matches&&!deleting){e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 8px 22px rgba(232,74,47,0.55)'}}}
                    onMouseLeave={e=>{if(matches&&!deleting){e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 4px 14px rgba(232,74,47,0.4)'}}}>
                    {deleting ? (<>
                      <span style={{display:'inline-block',width:12,height:12,border:'2px solid rgba(255,255,255,0.3)',borderTopColor:'#fff',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
                      DELETING...
                    </>) : '🗑 PERMANENTLY DELETE'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ════════════════════════════════════════════════════ */}
      {/*  LEVEL CONTROL MODAL — Admin                         */}
      {/* ════════════════════════════════════════════════════ */}
      {levelTarget && (() => {
        const currentLevel = getMemberLevel(levelTarget)
        const lc = LEVEL_COLOR[currentLevel] || '#f5c842'
        return (
          <div onClick={()=>setLevelTarget(null)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'1px solid rgba(192,132,252,0.3)',maxWidth:520,width:'100%',overflow:'hidden',boxShadow:'0 24px 60px rgba(0,0,0,0.7),0 0 40px rgba(192,132,252,0.15)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#c084fc,#42a5f5)'}}/>
              <div style={{padding:'20px 26px',borderBottom:'1px solid rgba(192,132,252,0.15)',background:'linear-gradient(135deg,rgba(192,132,252,0.08) 0%,transparent 60%)',display:'flex',alignItems:'center',gap:14}}>
                <div style={{width:46,height:46,borderRadius:12,background:'linear-gradient(135deg,#c084fc,#7b1fa2)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(192,132,252,0.4)'}}>🎚</div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:'0.06em',color:'#f0ece8'}}>LEVEL CONTROL</div>
                  <div style={{fontSize:9,color:'#9d8ec0',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>Promote or demote {levelTarget.name?.split(' ')[0] || 'member'}</div>
                </div>
                <button onClick={()=>setLevelTarget(null)}
                  style={{width:32,height:32,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:9,color:'#888',fontSize:16,cursor:'pointer'}}>✕</button>
              </div>
              <div style={{padding:'24px 26px',display:'flex',flexDirection:'column',gap:18}}>
                <div style={{padding:'14px 16px',background:`linear-gradient(135deg,${lc}10,rgba(20,15,14,0.6))`,border:`1px solid ${lc}30`,borderRadius:14,display:'flex',alignItems:'center',gap:14}}>
                  <div style={{position:'relative',flexShrink:0}}>
                    <div style={{width:48,height:48,borderRadius:'50%',background:`linear-gradient(135deg,${lc},${lc}aa)`,color:'#000',border:`2px solid ${lc}66`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:22,boxShadow:`0 4px 14px ${lc}40`}}>
                      {(levelTarget.name||'?')[0].toUpperCase()}
                    </div>
                    <div style={{position:'absolute',bottom:-2,right:-3,width:18,height:18,borderRadius:'50%',background:'#0e0a0a',border:`1.5px solid ${lc}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:10}}>{LEVEL_ICON[currentLevel]||'🥊'}</div>
                  </div>
                  <div style={{flex:1}}>
                    <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:3}}>{levelTarget.name}</div>
                    <div style={{display:'flex',alignItems:'center',gap:6}}>
                      <span style={{fontSize:9,color:'#666',letterSpacing:'0.1em',fontWeight:700,textTransform:'uppercase'}}>Currently:</span>
                      <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:`${lc}22`,color:lc,border:`1px solid ${lc}44`,letterSpacing:'0.08em',textTransform:'uppercase'}}>{LEVEL_ICON[currentLevel]||'🥊'} {currentLevel}</span>
                    </div>
                  </div>
                </div>
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  {[
                    {icon:'🥊',label:'Workouts',val:levelTarget.totalWorkouts||0,color:'#f5c842'},
                    {icon:'🔥',label:'Streak',val:(levelTarget.streak||0)+'d',color:'#e84a2f'},
                    {icon:'📅',label:'Weekly',val:(levelTarget.weeklyPct||0)+'%',color:'#22c55e'},
                  ].map((s,i)=>(
                    <div key={i} style={{padding:'10px 12px',background:`${s.color}08`,border:`1px solid ${s.color}25`,borderRadius:10,textAlign:'center'}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:s.color,lineHeight:1}}>{s.val}</div>
                      <div style={{fontSize:7,color:'#666',fontWeight:700,letterSpacing:'0.12em',marginTop:3}}>{s.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>
                <div>
                  <div style={{fontSize:9,fontWeight:800,color:'#9d8ec0',letterSpacing:'0.16em',textTransform:'uppercase',marginBottom:10,display:'flex',alignItems:'center',gap:8}}>
                    <span style={{display:'inline-block',width:14,height:2,background:'#c084fc'}}/>
                    Move To Level
                  </div>
                  <div style={{display:'flex',flexDirection:'column',gap:8}}>
                    {LEVELS.map(level=>{
                      const targetColor=LEVEL_COLOR[level]||'#f5c842'
                      const isCurrent=level===currentLevel
                      const isPromote=LEVELS.indexOf(level)>LEVELS.indexOf(currentLevel)
                      return(
                        <button key={level}
                          disabled={isCurrent}
                          onClick={()=>changeMemberLevel(levelTarget,level)}
                          style={{position:'relative',display:'flex',alignItems:'center',gap:14,padding:'14px 16px',background:isCurrent?'rgba(255,255,255,0.025)':`linear-gradient(135deg,${targetColor}12,${targetColor}06)`,border:`1.5px solid ${isCurrent?'rgba(255,255,255,0.06)':targetColor+'35'}`,borderRadius:12,cursor:isCurrent?'default':'pointer',opacity:isCurrent?0.5:1,transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)',textAlign:'left'}}
                          onMouseEnter={e=>{if(!isCurrent){e.currentTarget.style.transform='translateX(4px)';e.currentTarget.style.borderColor=targetColor+'66';e.currentTarget.style.boxShadow=`0 6px 20px ${targetColor}25`}}}
                          onMouseLeave={e=>{if(!isCurrent){e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.borderColor=targetColor+'35';e.currentTarget.style.boxShadow='none'}}}>
                          <div style={{width:40,height:40,borderRadius:11,background:`linear-gradient(135deg,${targetColor},${targetColor}aa)`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0,boxShadow:`0 4px 12px ${targetColor}40`}}>{LEVEL_ICON[level]||'🥊'}</div>
                          <div style={{flex:1}}>
                            <div style={{fontSize:13,fontWeight:800,color:isCurrent?'#666':targetColor,letterSpacing:'0.04em'}}>{level}</div>
                            <div style={{fontSize:10,color:'#666',marginTop:2}}>
                              {isCurrent?'Currently here':isPromote?'⬆ Promote — harder workouts unlocked':'⬇ Move down — lighter workouts'}
                            </div>
                          </div>
                          {!isCurrent && (
                            <div style={{fontSize:11,fontWeight:800,color:targetColor,padding:'6px 10px',borderRadius:50,background:`${targetColor}22`,border:`1px solid ${targetColor}44`,letterSpacing:'0.05em'}}>
                              {isPromote?'PROMOTE →':'MOVE →'}
                            </div>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
                <div style={{padding:'10px 14px',background:'rgba(192,132,252,0.06)',border:'1px solid rgba(192,132,252,0.2)',borderRadius:10,fontSize:10,color:'#9d8ec0',lineHeight:1.6}}>
                  <strong style={{color:'#c084fc'}}>What happens:</strong> Member's training plan regenerates for the new level. They move to the matching leaderboard division. They get a notification. Action is logged in <code style={{background:'rgba(0,0,0,0.4)',padding:'1px 4px',borderRadius:4,fontFamily:'monospace'}}>levelChanges</code> for audit.
                </div>
              </div>
            </div>
          </div>
        )
      })()}

      {/* ── VIEW MEMBER DRAWER — read-only profile + Punch Analytics ── */}
      {viewMember && (() => {
        const vLevel = getMemberLevel(viewMember)
        const vlc = LEVEL_COLOR[vLevel] || '#f5c842'
        const vlvIc = LEVEL_ICON[vLevel] || '🥊'
        const joined = viewMember.createdAt?.seconds
          ? new Date(viewMember.createdAt.seconds * 1000).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})
          : '—'
        return (
          <div onClick={()=>setViewMember(null)}
            style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.88)',backdropFilter:'blur(10px)',zIndex:2000,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
            {/* Always-visible scrollbar for the modal body. Plain solid thumb — Chrome's overlay scrollbars and clipped/padding-box tricks were rendering invisible. */}
            <style>{`
              .view-member-scroll::-webkit-scrollbar { width: 10px; }
              .view-member-scroll::-webkit-scrollbar-track { background: rgba(255,255,255,0.06); }
              .view-member-scroll::-webkit-scrollbar-thumb { background: #42a5f5; min-height: 40px; }
              .view-member-scroll::-webkit-scrollbar-thumb:hover { background: #5eb6f8; }
              .view-member-scroll::-webkit-scrollbar-button { display: none; }
            `}</style>
            <div onClick={e=>e.stopPropagation()}
              style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:20,border:'1px solid rgba(66,165,245,0.3)',maxWidth:560,width:'100%',maxHeight:'90vh',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 24px 60px rgba(0,0,0,0.7), 0 0 40px rgba(66,165,245,0.15)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#42a5f5,#c084fc,#f5c842)'}}/>

              {/* Header — fixed at top, body scrolls beneath it */}
              <div style={{padding:'20px 26px',borderBottom:'1px solid rgba(66,165,245,0.15)',background:'linear-gradient(135deg,rgba(66,165,245,0.08) 0%,transparent 60%)',display:'flex',alignItems:'center',gap:14,flexShrink:0}}>
                <div style={{width:46,height:46,borderRadius:12,background:'linear-gradient(135deg,#42a5f5,#1e6db8)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(66,165,245,0.4)'}}>👁</div>
                <div style={{flex:1}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:'0.06em',color:'#f0ece8'}}>MEMBER PROFILE</div>
                  <div style={{fontSize:9,color:'#7ba8d4',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:2}}>Read-only view · {viewMember.name?.split(' ')[0] || 'member'}</div>
                </div>
                <button onClick={()=>setViewMember(null)}
                  style={{width:32,height:32,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:9,color:'#888',fontSize:16,cursor:'pointer'}}>✕</button>
              </div>

              <div className="view-member-scroll" style={{padding:'24px 26px',display:'flex',flexDirection:'column',gap:22,overflowY:'scroll',flex:1,minHeight:0,scrollbarWidth:'thin',scrollbarColor:'#42a5f5 rgba(255,255,255,0.04)'}}>

                {/* Identity card */}
                <div style={{padding:'18px 18px',background:`linear-gradient(135deg,${vlc}10,rgba(20,15,14,0.6))`,border:`1px solid ${vlc}30`,borderRadius:14,display:'flex',alignItems:'center',gap:14}}>
                  <div style={{position:'relative',flexShrink:0}}>
                    <div style={{width:56,height:56,borderRadius:'50%',background:`linear-gradient(135deg,${vlc},${vlc}aa)`,color:'#000',border:`2px solid ${vlc}66`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:26,boxShadow:`0 4px 14px ${vlc}40`}}>
                      {(viewMember.name||'?')[0].toUpperCase()}
                    </div>
                    <div style={{position:'absolute',bottom:-2,right:-3,width:20,height:20,borderRadius:'50%',background:'#0e0a0a',border:`1.5px solid ${vlc}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11}}>{vlvIc}</div>
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:15,fontWeight:700,color:'#f0ece8',marginBottom:3}}>{viewMember.name||'Unknown'}</div>
                    <div style={{fontSize:11,color:'#888',marginBottom:6,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{viewMember.email||'—'}</div>
                    <div style={{display:'flex',gap:5,flexWrap:'wrap'}}>
                      <span style={{fontSize:8,fontWeight:800,padding:'3px 8px',borderRadius:50,background:`${vlc}22`,color:vlc,border:`1px solid ${vlc}44`,letterSpacing:'0.06em',textTransform:'uppercase'}}>{vlvIc} {vLevel}</span>
                      <span style={{fontSize:8,fontWeight:800,padding:'3px 8px',borderRadius:50,background:'rgba(245,200,66,0.12)',color:'#f5c842',border:'1px solid rgba(245,200,66,0.3)',letterSpacing:'0.06em',textTransform:'uppercase'}}>🎯 {viewMember.goal||'Learn Boxing'}</span>
                      <span style={{fontSize:8,fontWeight:800,padding:'3px 8px',borderRadius:50,background:'rgba(66,165,245,0.12)',color:'#42a5f5',border:'1px solid rgba(66,165,245,0.3)',letterSpacing:'0.06em',textTransform:'uppercase'}}>📅 Joined {joined}</span>
                    </div>
                  </div>
                </div>

                {/* Quick stats — same shape as level modal so the admin gets a familiar read */}
                <div style={{display:'grid',gridTemplateColumns:'1fr 1fr 1fr',gap:8}}>
                  {[
                    {icon:'🥊',label:'Workouts',val:viewMember.totalWorkouts||0,color:'#f5c842'},
                    {icon:'🔥',label:'Streak',val:(viewMember.streak||0)+'d',color:'#e84a2f'},
                    {icon:'📅',label:'Weekly',val:(viewMember.weeklyPct||0)+'%',color:'#22c55e'},
                  ].map((s,i)=>(
                    <div key={i} style={{padding:'12px 12px',background:`${s.color}08`,border:`1px solid ${s.color}25`,borderRadius:10,textAlign:'center'}}>
                      <div style={{fontSize:14,marginBottom:3}}>{s.icon}</div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:s.color,lineHeight:1}}>{s.val}</div>
                      <div style={{fontSize:7,color:'#666',fontWeight:700,letterSpacing:'0.12em',marginTop:4}}>{s.label.toUpperCase()}</div>
                    </div>
                  ))}
                </div>

                {/* Medical Clearance — Issue #6. Clearance-before-performance. */}
                <MedicalCertCard member={viewMember} />

                {/* Punch Analytics — shared component, AI flagship */}
                <PunchAnalyticsCard uid={viewMember.uid} compact />
              </div>

              {/* Footer — pinned to bottom of modal, doesn't scroll with body */}
              <div style={{padding:'14px 26px',borderTop:'1px solid rgba(66,165,245,0.15)',background:'linear-gradient(135deg,rgba(66,165,245,0.05) 0%,transparent 60%)',flexShrink:0}}>
                <div style={{padding:'10px 14px',background:'rgba(66,165,245,0.06)',border:'1px solid rgba(66,165,245,0.2)',borderRadius:10,fontSize:10,color:'#7ba8d4',lineHeight:1.6}}>
                  <strong style={{color:'#42a5f5'}}>Read-only view.</strong> Use the action buttons on the member row to change level, deactivate, message, or delete this member.
                </div>
              </div>
            </div>
          </div>
        )
      })()}

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
          <StatCard icon="📋" label="Classes" value={visibleClasses.length} color="info"
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
            {/* LEVEL DISTRIBUTION */}
            <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.12)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#f5c842,#e84a2f)'}}/>
              <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'linear-gradient(135deg,rgba(245,200,66,0.06) 0%,transparent 60%)',display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:38,height:38,borderRadius:10,background:'linear-gradient(135deg,#f5c842,#e08820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,boxShadow:'0 4px 14px rgba(245,200,66,0.3)'}}>📊</div>
                <div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8'}}>LEVEL DISTRIBUTION</div>
                  <div style={{fontSize:9,color:'#666',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:1}}>By experience tier</div>
                </div>
              </div>
              <div style={{padding:'22px',display:'flex',flexDirection:'column',gap:18}}>
                {members.length===0?<div style={{textAlign:'center',color:'#555',fontSize:12,padding:30}}>No members yet</div>:levelCounts.map(({level,count})=>{
                  const color=LEVEL_COLOR[level]
                  const pct=members.length>0?Math.round((count/members.length)*100):0
                  return(
                    <div key={level} style={{cursor:'default',transition:'all 0.3s ease'}}
                      onMouseEnter={e=>e.currentTarget.style.transform='translateX(2px)'}
                      onMouseLeave={e=>e.currentTarget.style.transform='translateX(0)'}>
                      <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',marginBottom:9}}>
                        <div style={{display:'flex',alignItems:'center',gap:12}}>
                          <div style={{width:38,height:38,borderRadius:11,background:`linear-gradient(135deg,${color},${color}aa)`,border:`1px solid ${color}55`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,boxShadow:`0 4px 12px ${color}40`}}>{LEVEL_ICON[level]}</div>
                          <div>
                            <div style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{level}</div>
                            <div style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase',marginTop:2}}>{pct}% of gym</div>
                          </div>
                        </div>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:34,color,lineHeight:1,textShadow:`0 0 12px ${color}55`}}>{count}</div>
                      </div>
                      <div style={{height:10,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden',border:'1px solid rgba(255,255,255,0.04)'}}>
                        <div style={{height:'100%',borderRadius:50,background:`linear-gradient(90deg,${color},${color}dd)`,width:`${pct}%`,transition:'width 1s ease',boxShadow:`0 0 12px ${color}88`}}/>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* GOAL DISTRIBUTION */}
            <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.12)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#42a5f5,#c084fc)'}}/>
              <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'linear-gradient(135deg,rgba(66,165,245,0.06) 0%,transparent 60%)',display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:38,height:38,borderRadius:10,background:'linear-gradient(135deg,#42a5f5,#2563eb)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,boxShadow:'0 4px 14px rgba(66,165,245,0.3)'}}>🎯</div>
                <div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8'}}>GOAL DISTRIBUTION</div>
                  <div style={{fontSize:9,color:'#666',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:1}}>What members are training for</div>
                </div>
              </div>
              <div style={{padding:'18px',display:'flex',flexDirection:'column',gap:10}}>
                {goalCounts.map(({goal,count})=>{
                  const color=GOAL_COLORS[goal]||'#f5c842'
                  const icon=GOAL_ICONS[goal]||'🎯'
                  const pct=members.length>0?Math.round((count/members.length)*100):0
                  return(
                    <div key={goal} style={{position:'relative',display:'flex',alignItems:'center',gap:14,padding:'14px 16px',background:'linear-gradient(135deg,rgba(40,30,28,0.5),rgba(20,15,14,0.7))',borderRadius:12,border:`1px solid ${color}1a`,cursor:'default',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform='translateX(4px)';e.currentTarget.style.borderColor=`${color}55`;e.currentTarget.style.boxShadow=`0 6px 20px ${color}20`}}
                      onMouseLeave={e=>{e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.borderColor=`${color}1a`;e.currentTarget.style.boxShadow='none'}}>
                      <div style={{width:42,height:42,borderRadius:11,background:`linear-gradient(135deg,${color},${color}aa)`,border:`1px solid ${color}55`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0,boxShadow:`0 4px 12px ${color}40`}}>{icon}</div>
                      <div style={{flex:1}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
                          <span style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{goal}</span>
                          <div style={{display:'flex',alignItems:'baseline',gap:8}}>
                            <span style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.1em'}}>{pct}%</span>
                            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color,lineHeight:1,textShadow:`0 0 10px ${color}55`}}>{count}</span>
                          </div>
                        </div>
                        <div style={{height:6,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden',border:'1px solid rgba(255,255,255,0.04)'}}>
                          <div style={{height:'100%',borderRadius:50,background:`linear-gradient(90deg,${color},${color}dd)`,width:`${pct}%`,boxShadow:`0 0 10px ${color}88`,transition:'width 1s ease'}}/>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* RECENT ANNOUNCEMENTS + ACTIVITY — full width with tabs */}
            <div style={{gridColumn:'1/-1',position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.12)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:overviewSubTab==='announcements'?'linear-gradient(180deg,#e84a2f,#f5c842)':'linear-gradient(180deg,#42a5f5,#c084fc)',transition:'background 0.3s'}}/>

              {/* Header with tabs */}
              <div style={{padding:'16px 22px 0',borderBottom:'1px solid rgba(255,255,255,0.05)',background:overviewSubTab==='announcements'?'linear-gradient(135deg,rgba(232,74,47,0.06) 0%,transparent 60%)':'linear-gradient(135deg,rgba(66,165,245,0.06) 0%,transparent 60%)',display:'flex',alignItems:'center',justifyContent:'space-between',flexWrap:'wrap',gap:10}}>
                {/* Left: tabs */}
                <div style={{display:'flex',alignItems:'center',gap:6}}>
                  {[
                    {id:'announcements', label:'📢 ANNOUNCEMENTS', count:realAnnouncements.length, color:'#f5c842', sub:'Manual gym news'},
                    {id:'activity',      label:'⚡ ACTIVITY',     count:activity.length, color:'#42a5f5', sub:'System events log'},
                  ].map(t => {
                    const active = overviewSubTab === t.id
                    return (
                      <button key={t.id} onClick={()=>setOverviewSubTab(t.id)}
                        style={{position:'relative',display:'flex',alignItems:'center',gap:8,background:active?`${t.color}15`:'transparent',color:active?t.color:'#666',border:'none',borderBottom:`3px solid ${active?t.color:'transparent'}`,padding:'12px 16px 14px',fontSize:12,fontWeight:800,letterSpacing:'0.06em',cursor:'pointer',transition:'all 0.25s'}}
                        onMouseEnter={e=>{if(!active)e.currentTarget.style.color='#aaa'}}
                        onMouseLeave={e=>{if(!active)e.currentTarget.style.color='#666'}}>
                        <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:15}}>{t.label}</span>
                        <span style={{fontSize:8,fontWeight:800,padding:'2px 7px',borderRadius:50,background:active?`${t.color}30`:'rgba(255,255,255,0.06)',color:active?t.color:'#666',letterSpacing:'0.05em'}}>{t.count}</span>
                      </button>
                    )
                  })}
                </div>
                {/* Right: action button */}
                {overviewSubTab==='announcements' ? (
                  <button onClick={()=>setShowNotif(true)}
                    style={{background:'linear-gradient(135deg,#f5c842,#e08820)',color:'#000',border:'none',borderRadius:50,padding:'8px 16px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:'pointer',boxShadow:'0 4px 14px rgba(245,200,66,0.3)',marginBottom:8,transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                    onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px) scale(1.04)';e.currentTarget.style.boxShadow='0 6px 20px rgba(245,200,66,0.5)'}}
                    onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 4px 14px rgba(245,200,66,0.3)'}}>
                    + NEW
                  </button>
                ) : (
                  <span style={{fontSize:9,color:'#666',letterSpacing:'0.1em',fontWeight:700,marginBottom:8,padding:'4px 10px',background:'rgba(66,165,245,0.08)',borderRadius:50,border:'1px solid rgba(66,165,245,0.2)'}}>
                    🔴 LIVE · auto-updates
                  </span>
                )}
              </div>

              {/* CONTENT — Announcements */}
              {overviewSubTab==='announcements' && (
                realAnnouncements.length===0?(
                  <div style={{padding:'50px 30px',textAlign:'center'}}>
                    <div style={{fontSize:42,marginBottom:10,opacity:0.4}}>📭</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#888',letterSpacing:'0.06em',marginBottom:4}}>NOTHING POSTED YET</div>
                    <div style={{fontSize:10,color:'#555',letterSpacing:'0.05em'}}>Tap +NEW to announce something to the gym</div>
                  </div>
                ):(
                  <div style={{display:'flex',flexDirection:'column',maxHeight:320,overflowY:'auto'}}>
                    {realAnnouncements.slice(0,5).map((n,i)=>{
                      const ac=n.audience==='all'?'#f5c842':'#42a5f5'
                      return(
                        <div key={n.id} style={{padding:'14px 22px',borderBottom:i<Math.min(realAnnouncements.length,5)-1?'1px solid rgba(255,255,255,0.04)':'none',display:'flex',gap:12,alignItems:'flex-start',transition:'all 0.25s ease'}}
                          onMouseEnter={e=>e.currentTarget.style.background=`linear-gradient(90deg,${ac}10,transparent)`}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${ac},${ac}aa)`,color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,flexShrink:0,boxShadow:`0 4px 12px ${ac}40`,border:`1px solid ${ac}66`}}>{n.audience==='all'?'📢':'🥊'}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:4,flexWrap:'wrap'}}>
                              <span style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{n.title}</span>
                              <span style={{fontSize:8,fontWeight:800,padding:'2px 8px',borderRadius:50,background:`${ac}22`,color:ac,letterSpacing:'0.08em',textTransform:'uppercase',border:`1px solid ${ac}44`}}>{n.audience==='all'?'All':'Coaches'}</span>
                              {n.editedAt&&<span style={{fontSize:8,color:'#777',fontStyle:'italic',letterSpacing:'0.05em'}}>· edited</span>}
                            </div>
                            <div style={{fontSize:11,color:'#888',lineHeight:1.6,marginBottom:5}}>{n.message}</div>
                            <div style={{fontSize:9,color:'#555',fontWeight:600}}>By <strong style={{color:'#777'}}>{n.from||'Admin'}</strong></div>
                          </div>
                          <div style={{display:'flex',gap:5,flexShrink:0}}>
                            <button onClick={()=>startEditNotification(n)} title="Edit"
                              style={{background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.25)',borderRadius:8,padding:'6px 10px',fontSize:12,color:'#f5c842',cursor:'pointer',fontWeight:700,transition:'all 0.2s'}}
                              onMouseEnter={e=>{e.currentTarget.style.background='rgba(245,200,66,0.2)';e.currentTarget.style.transform='scale(1.08)'}}
                              onMouseLeave={e=>{e.currentTarget.style.background='rgba(245,200,66,0.1)';e.currentTarget.style.transform='scale(1)'}}>✏️</button>
                            <button onClick={()=>setDeleteNotifId(n.id)} title="Delete"
                              style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:8,padding:'6px 10px',fontSize:12,color:'#e84a2f',cursor:'pointer',fontWeight:700,transition:'all 0.2s'}}
                              onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.transform='scale(1.08)'}}
                              onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.1)';e.currentTarget.style.transform='scale(1)'}}>🗑</button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              )}

              {/* CONTENT — Activity Feed */}
              {overviewSubTab==='activity' && (
                activity.length===0 ? (
                  <div style={{padding:'50px 30px',textAlign:'center'}}>
                    <div style={{fontSize:42,marginBottom:10,opacity:0.4}}>⚡</div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#888',letterSpacing:'0.06em',marginBottom:4}}>NO ACTIVITY YET</div>
                    <div style={{fontSize:10,color:'#555',letterSpacing:'0.05em'}}>System events will appear here in real time</div>
                  </div>
                ) : (
                  <div style={{display:'flex',flexDirection:'column',maxHeight:380,overflowY:'auto'}}>
                    {activity.slice(0,10).map((ev,i)=>{
                      const t = ACTIVITY_TYPES[ev.type] || { icon:'⚡', color:'#888', label:'Event' }
                      const ts = ev.createdAt?.seconds ? new Date(ev.createdAt.seconds*1000) : null
                      return(
                        <div key={ev.id} className="activity-row" style={{padding:'10px 22px',borderBottom:i<Math.min(activity.length,10)-1?'1px solid rgba(255,255,255,0.03)':'none',display:'flex',gap:11,alignItems:'center',transition:'all 0.2s ease',position:'relative'}}
                          onMouseEnter={e=>{e.currentTarget.style.background=`linear-gradient(90deg,${t.color}10,transparent)`;const btn=e.currentTarget.querySelector('.act-del');if(btn)btn.style.opacity='1'}}
                          onMouseLeave={e=>{e.currentTarget.style.background='transparent';const btn=e.currentTarget.querySelector('.act-del');if(btn)btn.style.opacity='0'}}>
                          <div style={{width:30,height:30,borderRadius:9,background:`linear-gradient(135deg,${t.color}30,${t.color}10)`,color:t.color,border:`1px solid ${t.color}40`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,flexShrink:0}}>{t.icon}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:'flex',alignItems:'center',gap:6,marginBottom:1,flexWrap:'wrap'}}>
                              <span style={{fontSize:8,fontWeight:800,color:t.color,letterSpacing:'0.1em',textTransform:'uppercase'}}>{t.label}</span>
                              {ev.actorRole && <span style={{fontSize:7,fontWeight:700,padding:'1px 6px',borderRadius:50,background:'rgba(255,255,255,0.04)',color:'#666',letterSpacing:'0.06em',textTransform:'uppercase'}}>{ev.actorRole}</span>}
                            </div>
                            <div style={{fontSize:11,color:'#bbb',lineHeight:1.5}}>{ev.description}</div>
                          </div>
                          <div style={{fontSize:9,color:'#555',fontWeight:600,whiteSpace:'nowrap',flexShrink:0,letterSpacing:'0.04em'}}>
                            {ts ? formatRelativeTime(ts) : '—'}
                          </div>
                          <button className="act-del" onClick={()=>deleteActivityEvent(ev.id)} title="Delete this event"
                            style={{opacity:0,width:26,height:26,background:'rgba(232,74,47,0.12)',color:'#e84a2f',border:'1px solid rgba(232,74,47,0.3)',borderRadius:8,display:'flex',alignItems:'center',justifyContent:'center',fontSize:11,cursor:'pointer',flexShrink:0,transition:'all 0.2s',padding:0}}
                            onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.25)';e.currentTarget.style.transform='scale(1.08)'}}
                            onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.12)';e.currentTarget.style.transform='scale(1)'}}>🗑</button>
                        </div>
                      )
                    })}
                  </div>
                )
              )}
            </div>
          </div>
        )}

        {/* ── MEMBERS ── */}
        {tab==='members'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Header strip */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',gap:14,padding:'14px 18px',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:14,border:'1px solid rgba(255,255,255,0.06)'}}>
              <div style={{display:'flex',alignItems:'center',gap:10,flexShrink:0}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:'0.06em',color:'#f0ece8'}}>👥 ROSTER</div>
                <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em'}}>{filtered.length} MEMBERS</span>
                <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(232,74,47,0.15)',color:'#e84a2f',letterSpacing:'0.08em'}}>{members.filter(m=>m.status==='inactive').length} INACTIVE</span>
              </div>
              <div style={{position:'relative',flex:1,maxWidth:380}}>
                <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:13,color:'#666'}}>🔍</span>
                <input placeholder="Search by name or email…" value={searchQ} onChange={e=>setSearchQ(e.target.value)}
                  style={{width:'100%',background:'rgba(20,15,14,0.8)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:50,padding:'9px 14px 9px 36px',color:'#f0ece8',fontFamily:'Montserrat,sans-serif',fontSize:12,outline:'none',boxSizing:'border-box',transition:'all 0.25s ease'}}
                  onFocus={e=>{e.target.style.borderColor='rgba(245,200,66,0.4)';e.target.style.boxShadow='0 0 0 3px rgba(245,200,66,0.08)'}}
                  onBlur={e=>{e.target.style.borderColor='rgba(255,255,255,0.08)';e.target.style.boxShadow='none'}}/>
              </div>
            </div>

            {/* Table */}
            <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.12)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#f5c842,#e84a2f)'}}/>
              <div style={{display:'grid',gridTemplateColumns:'1fr 130px 130px 70px 70px 100px 170px',gap:0,padding:'12px 22px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'rgba(0,0,0,0.25)'}}>
                {['MEMBER','LEVEL','GOAL','WORKOUTS','STREAK','STATUS','ACTIONS'].map((h,i)=>(
                  <div key={i} style={{fontSize:8,fontWeight:800,color:'#666',letterSpacing:'0.15em'}}>{h}</div>
                ))}
              </div>
              {loading?<div style={{padding:50,textAlign:'center',color:'#555'}}>Loading...</div>
              :filtered.length===0?<div style={{padding:50,textAlign:'center',color:'#555',fontSize:13}}>No members found</div>
              :filtered.map(m=>{
                const lc=LEVEL_COLOR[getMemberLevel(m)]||'#f5c842'
                const lvIc=LEVEL_ICON[getMemberLevel(m)]||'🥊'
                const isActive=m.status!=='inactive'
                return(
                  <div key={m.uid}
                    style={{position:'relative',display:'grid',gridTemplateColumns:'1fr 130px 130px 70px 70px 100px 170px',gap:0,padding:'13px 22px',borderBottom:'1px solid rgba(255,255,255,0.04)',alignItems:'center',transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',opacity:isActive?1:0.55,cursor:'default'}}
                    onMouseEnter={e=>{e.currentTarget.style.background=`linear-gradient(90deg,${lc}10,transparent)`;e.currentTarget.style.transform='translateX(2px)'}}
                    onMouseLeave={e=>{e.currentTarget.style.background='transparent';e.currentTarget.style.transform='translateX(0)'}}>
                    {/* Member */}
                    <div style={{display:'flex',alignItems:'center',gap:12,minWidth:0}}>
                      <div style={{position:'relative',flexShrink:0}}>
                        <div style={{width:40,height:40,borderRadius:'50%',background:isActive?`linear-gradient(135deg,${lc},${lc}aa)`:'rgba(60,55,55,0.5)',color:isActive?'#000':'#666',border:`2px solid ${isActive?lc+'66':'rgba(255,255,255,0.08)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:16,boxShadow:isActive?`0 2px 8px ${lc}30`:'none'}}>
                          {(m.name||'?')[0].toUpperCase()}
                        </div>
                        {isActive && <div style={{position:'absolute',bottom:-2,right:-4,width:16,height:16,borderRadius:'50%',background:'#0e0a0a',border:`1.5px solid ${lc}`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:8}}>{lvIc}</div>}
                      </div>
                      <div style={{minWidth:0}}>
                        <div style={{fontSize:12,fontWeight:700,color:isActive?'#f0ece8':'#666',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.name||'Unknown'}</div>
                        <div style={{fontSize:10,color:'#555',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{m.email||'—'}</div>
                      </div>
                    </div>
                    {/* Level */}
                    <div>
                      <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:isActive?`${lc}18`:'rgba(255,255,255,0.04)',color:isActive?lc:'#555',border:`1px solid ${isActive?lc+'44':'rgba(255,255,255,0.06)'}`,letterSpacing:'0.06em',textTransform:'uppercase'}}>{lvIc} {getMemberLevel(m)}</span>
                    </div>
                    {/* Goal */}
                    <div style={{fontSize:10,color:isActive?'#888':'#555',fontWeight:600}}>{m.goal||'—'}</div>
                    {/* Workouts */}
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:isActive?'#f5c842':'#444',lineHeight:1}}>{m.totalWorkouts||0}</div>
                    {/* Streak */}
                    <div style={{fontSize:11,fontWeight:700,color:(m.streak||0)>0&&isActive?'#e84a2f':'#444'}}>🔥{m.streak||0}d</div>
                    {/* Status */}
                    <div>
                      <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:9,fontWeight:800,background:isActive?'rgba(34,197,94,0.15)':'rgba(232,74,47,0.12)',color:isActive?'#22c55e':'#e84a2f',border:`1px solid ${isActive?'rgba(34,197,94,0.35)':'rgba(232,74,47,0.3)'}`,borderRadius:50,padding:'4px 10px',letterSpacing:'0.08em',textTransform:'uppercase'}}>
                        <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:isActive?'#22c55e':'#e84a2f',animation:isActive?'pulseDot 1.6s ease-in-out infinite':'none'}}/>
                        {isActive?'Active':'Inactive'}
                      </span>
                    </div>
                    {/* Actions — uniform icon buttons, breathe properly */}
                    <div style={{display:'flex',gap:7,alignItems:'center',justifyContent:'flex-end'}}>
                      <button onClick={()=>setViewMember(m)} title="View member profile"
                        style={{width:32,height:32,background:'rgba(245,200,66,0.12)',color:'#f5c842',border:'1.5px solid rgba(245,200,66,0.3)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,cursor:'pointer',flexShrink:0,transition:'all 0.2s'}}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(245,200,66,0.22)';e.currentTarget.style.transform='scale(1.08)';e.currentTarget.style.boxShadow='0 4px 12px rgba(245,200,66,0.3)'}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(245,200,66,0.12)';e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}>👁</button>
                      <button onClick={()=>setLevelTarget(m)} title="Change Level"
                        style={{width:32,height:32,background:'rgba(192,132,252,0.12)',color:'#c084fc',border:'1.5px solid rgba(192,132,252,0.3)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,cursor:'pointer',flexShrink:0,transition:'all 0.2s'}}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(192,132,252,0.2)';e.currentTarget.style.transform='scale(1.08)';e.currentTarget.style.boxShadow='0 4px 12px rgba(192,132,252,0.3)'}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(192,132,252,0.12)';e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}>🎚</button>
                      <button onClick={()=>setConfirm({
                        title:isActive?'Deactivate Member?':'Activate Member?',
                        message:isActive?`This will block ${m.name} from logging in until reactivated.`:`Restore full access for ${m.name}.`,
                        danger:isActive,
                        onConfirm:()=>toggleMemberStatus(m.uid,m.status||'active')
                      })} title={isActive?'Deactivate':'Activate'}
                      style={{width:32,height:32,background:isActive?'rgba(232,74,47,0.12)':'rgba(34,197,94,0.12)',color:isActive?'#e84a2f':'#22c55e',border:`1.5px solid ${isActive?'rgba(232,74,47,0.35)':'rgba(34,197,94,0.4)'}`,borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,cursor:'pointer',flexShrink:0,transition:'all 0.2s'}}
                      onMouseEnter={e=>{e.currentTarget.style.background=isActive?'rgba(232,74,47,0.22)':'rgba(34,197,94,0.22)';e.currentTarget.style.transform='scale(1.08)';e.currentTarget.style.boxShadow=isActive?'0 4px 12px rgba(232,74,47,0.35)':'0 4px 12px rgba(34,197,94,0.35)'}}
                      onMouseLeave={e=>{e.currentTarget.style.background=isActive?'rgba(232,74,47,0.12)':'rgba(34,197,94,0.12)';e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}>
                        {isActive?'⏸':'▶'}
                      </button>
                      <button onClick={()=>{setMsgTarget(m);setMsgThread([])}} title="Quick message"
                        style={{width:32,height:32,background:'rgba(66,165,245,0.12)',color:'#42a5f5',border:'1.5px solid rgba(66,165,245,0.3)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,cursor:'pointer',flexShrink:0,transition:'all 0.2s'}}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(66,165,245,0.2)';e.currentTarget.style.transform='scale(1.08)';e.currentTarget.style.boxShadow='0 4px 12px rgba(66,165,245,0.3)'}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(66,165,245,0.12)';e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}>💬</button>
                      <button onClick={()=>{setDeleteTarget(m);setDeleteTyped('')}} title="Permanently delete user"
                        style={{width:32,height:32,background:'rgba(232,74,47,0.12)',color:'#e84a2f',border:'1.5px solid rgba(232,74,47,0.3)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:14,cursor:'pointer',flexShrink:0,transition:'all 0.2s'}}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.25)';e.currentTarget.style.transform='scale(1.08)';e.currentTarget.style.boxShadow='0 4px 12px rgba(232,74,47,0.4)'}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.12)';e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}>🗑</button>
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
            {/* PENDING approvals — gold glow */}
            {pending.length>0&&(
              <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.35)',boxShadow:'0 12px 40px rgba(0,0,0,0.5),0 0 30px rgba(245,200,66,0.1)'}}>
                <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#f5c842,#e08820)'}}/>
                <div style={{padding:'16px 22px',borderBottom:'1px solid rgba(245,200,66,0.15)',background:'linear-gradient(135deg,rgba(245,200,66,0.1) 0%,transparent 60%)',display:'flex',alignItems:'center',gap:10}}>
                  <span style={{fontSize:18,animation:'pulseDot 1.6s ease-in-out infinite'}}>⏳</span>
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f5c842'}}>PENDING APPROVALS</div>
                    <div style={{fontSize:9,color:'#888',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:1}}>{pending.length} coach{pending.length>1?'es':''} waiting</div>
                  </div>
                </div>
                {pending.map(p=>(
                  <div key={p.uid} style={{display:'flex',alignItems:'center',gap:14,padding:'16px 22px',borderBottom:'1px solid rgba(255,255,255,0.04)',transition:'all 0.25s ease'}}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(245,200,66,0.04)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{position:'relative',flexShrink:0}}>
                      <div style={{width:48,height:48,borderRadius:'50%',background:'linear-gradient(135deg,#f5c842,#e08820)',color:'#000',border:'2px solid rgba(245,200,66,0.5)',display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:20,boxShadow:'0 4px 14px rgba(245,200,66,0.4)'}}>
                        {(p.name||'?')[0].toUpperCase()}
                      </div>
                      <div style={{position:'absolute',bottom:-2,right:-2,width:18,height:18,borderRadius:'50%',background:'#0e0a0a',border:'1.5px solid #f5c842',display:'flex',alignItems:'center',justifyContent:'center',fontSize:10}}>⏳</div>
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:700,color:'#f0ece8',marginBottom:3}}>{p.name}</div>
                      <div style={{fontSize:10,color:'#666',display:'flex',alignItems:'center',gap:6}}>
                        <span>{p.email}</span>
                        <span style={{fontSize:8,fontWeight:800,padding:'2px 7px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em',textTransform:'uppercase'}}>Applied for Coach</span>
                      </div>
                    </div>
                    <div style={{display:'flex',gap:8}}>
                      <button onClick={()=>setConfirm({title:'Approve Coach?',message:`Approve ${p.name} as a coach? They will be able to log in immediately.`,danger:false,onConfirm:()=>approveCoach(p.uid)})}
                        style={{background:'linear-gradient(135deg,#22c55e,#16a34a)',color:'#fff',border:'none',borderRadius:50,padding:'9px 20px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:'pointer',boxShadow:'0 4px 14px rgba(34,197,94,0.35)',transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)'}}
                        onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px) scale(1.04)';e.currentTarget.style.boxShadow='0 6px 20px rgba(34,197,94,0.5)'}}
                        onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 4px 14px rgba(34,197,94,0.35)'}}>
                        ✓ APPROVE
                      </button>
                      <button onClick={()=>setConfirm({title:'Reject Coach?',message:`Reject ${p.name}'s coach application.`,danger:true,onConfirm:()=>rejectCoach(p.uid)})}
                        style={{background:'rgba(232,74,47,0.12)',color:'#e84a2f',border:'1.5px solid rgba(232,74,47,0.35)',borderRadius:50,padding:'9px 18px',fontSize:11,fontWeight:800,letterSpacing:'0.06em',cursor:'pointer',transition:'all 0.25s ease'}}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.transform='translateY(-2px)'}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.12)';e.currentTarget.style.transform='translateY(0)'}}>
                        ✕ REJECT
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* ACTIVE coaches list */}
            <div style={{position:'relative',overflow:'hidden',borderRadius:18,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(66,165,245,0.12)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#42a5f5,#2563eb)'}}/>
              <div style={{padding:'16px 22px',borderBottom:'1px solid rgba(255,255,255,0.05)',background:'linear-gradient(135deg,rgba(66,165,245,0.06) 0%,transparent 60%)',display:'flex',alignItems:'center',gap:10}}>
                <div style={{width:38,height:38,borderRadius:10,background:'linear-gradient(135deg,#42a5f5,#2563eb)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18,boxShadow:'0 4px 14px rgba(66,165,245,0.3)'}}>🥊</div>
                <div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8'}}>COACH ROSTER</div>
                  <div style={{fontSize:9,color:'#666',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:1}}>{coaches.length} approved coach{coaches.length===1?'':'es'}</div>
                </div>
              </div>
              {coaches.length===0?(
                <div style={{padding:'50px 30px',textAlign:'center'}}>
                  <div style={{fontSize:42,marginBottom:10,opacity:0.4}}>🥊</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,color:'#888',letterSpacing:'0.06em'}}>NO COACHES YET</div>
                </div>
              ):coaches.map(c=>{
                const isActive=c.status!=='inactive'
                return(
                  <div key={c.uid} style={{display:'flex',alignItems:'center',gap:14,padding:'14px 22px',borderBottom:'1px solid rgba(255,255,255,0.04)',transition:'all 0.25s ease',opacity:isActive?1:0.55}}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(66,165,245,0.04)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{position:'relative',flexShrink:0}}>
                      <div style={{width:46,height:46,borderRadius:'50%',background:isActive?'linear-gradient(135deg,#42a5f5,#2563eb)':'rgba(60,55,55,0.5)',color:isActive?'#fff':'#666',border:`2px solid ${isActive?'rgba(66,165,245,0.5)':'rgba(255,255,255,0.08)'}`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:18,boxShadow:isActive?'0 4px 14px rgba(66,165,245,0.4)':'none'}}>
                        {(c.name||'?')[0].toUpperCase()}
                      </div>
                      {isActive && <div style={{position:'absolute',bottom:-2,right:-2,width:16,height:16,borderRadius:'50%',background:'#0e0a0a',border:'1.5px solid #42a5f5',display:'flex',alignItems:'center',justifyContent:'center',fontSize:9}}>🥊</div>}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:14,fontWeight:700,color:isActive?'#f0ece8':'#666',marginBottom:2}}>{c.name}</div>
                      <div style={{fontSize:10,color:'#555'}}>{c.email}</div>
                    </div>
                    <span style={{display:'inline-flex',alignItems:'center',gap:5,fontSize:9,fontWeight:800,background:isActive?'rgba(34,197,94,0.15)':'rgba(232,74,47,0.12)',color:isActive?'#22c55e':'#e84a2f',border:`1px solid ${isActive?'rgba(34,197,94,0.35)':'rgba(232,74,47,0.3)'}`,borderRadius:50,padding:'4px 12px',letterSpacing:'0.08em',textTransform:'uppercase'}}>
                      <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:isActive?'#22c55e':'#e84a2f',animation:isActive?'pulseDot 1.6s ease-in-out infinite':'none'}}/>
                      {isActive?'Active':'Inactive'}
                    </span>
                    <button onClick={()=>setConfirm({
                      title:isActive?'Deactivate Coach?':'Activate Coach?',
                      message:isActive?`Deactivate ${c.name}? They won't be able to log in.`:`Restore ${c.name}'s coach access.`,
                      danger:isActive,
                      onConfirm:()=>toggleCoachStatus(c.uid,c.status||'active')
                    })}
                    style={{fontSize:10,fontWeight:800,background:isActive?'rgba(232,74,47,0.12)':'linear-gradient(135deg,rgba(34,197,94,0.2),rgba(34,197,94,0.08))',color:isActive?'#e84a2f':'#22c55e',border:`1.5px solid ${isActive?'rgba(232,74,47,0.35)':'rgba(34,197,94,0.4)'}`,borderRadius:8,padding:'8px 14px',cursor:'pointer',letterSpacing:'0.04em',transition:'all 0.2s'}}
                    onMouseEnter={e=>{e.currentTarget.style.transform='scale(1.05)';e.currentTarget.style.boxShadow=isActive?'0 4px 12px rgba(232,74,47,0.3)':'0 4px 12px rgba(34,197,94,0.3)'}}
                    onMouseLeave={e=>{e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}>
                      {isActive?'Deactivate':'Activate'}
                    </button>
                    <button onClick={()=>{setCoachDeleteTarget(c);setCoachDeleteTyped('')}} title="Permanently delete coach"
                      style={{width:34,height:34,background:'rgba(232,74,47,0.12)',color:'#e84a2f',border:'1.5px solid rgba(232,74,47,0.3)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,cursor:'pointer',transition:'all 0.2s'}}
                      onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.transform='scale(1.08)'}}
                      onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.12)';e.currentTarget.style.transform='scale(1)'}}>🗑</button>
                    <button onClick={()=>{setMsgTarget(c);setMsgThread([])}} title="Quick message"
                      style={{width:34,height:34,background:'rgba(66,165,245,0.12)',color:'#42a5f5',border:'1.5px solid rgba(66,165,245,0.3)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:15,cursor:'pointer',transition:'all 0.2s'}}
                      onMouseEnter={e=>{e.currentTarget.style.background='rgba(66,165,245,0.2)';e.currentTarget.style.transform='scale(1.08)'}}
                      onMouseLeave={e=>{e.currentTarget.style.background='rgba(66,165,245,0.12)';e.currentTarget.style.transform='scale(1)'}}>💬</button>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* ── CLASSES ── */}
        {tab==='classes'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Header strip */}
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.06em',color:'#f0ece8'}}>📋 GYM SCHEDULE</div>
                <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em'}}>{visibleClasses.length} ACTIVE</span>
                <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(66,165,245,0.15)',color:'#42a5f5',letterSpacing:'0.08em'}}>{bookings.length} BOOKINGS</span>
              </div>
              <button onClick={()=>setShowNewClass(v=>!v)}
                style={{background:showNewClass?'rgba(255,255,255,0.06)':'linear-gradient(135deg,#e84a2f,#c93820)',color:showNewClass?'#888':'#fff',border:showNewClass?'1px solid rgba(255,255,255,0.1)':'none',borderRadius:50,padding:'10px 22px',fontSize:12,fontWeight:800,letterSpacing:'0.05em',cursor:'pointer',boxShadow:showNewClass?'none':'0 6px 20px rgba(232,74,47,0.4)',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                onMouseEnter={e=>{if(!showNewClass){e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 10px 28px rgba(232,74,47,0.55)'}}}
                onMouseLeave={e=>{if(!showNewClass){e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 6px 20px rgba(232,74,47,0.4)'}}}>
                {showNewClass?'✕ CANCEL':'+ CREATE CLASS'}
              </button>
            </div>

            {/* New class form */}
            {showNewClass&&(
              <div style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:'1px solid rgba(232,74,47,0.3)',padding:'24px 26px',boxShadow:'0 12px 40px rgba(0,0,0,0.5),0 0 30px rgba(232,74,47,0.1)'}}>
                <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#e84a2f,#f5c842)',borderRadius:'18px 0 0 18px'}}/>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8',marginBottom:4}}>🥊 CREATE NEW CLASS</div>
                <div style={{fontSize:10,color:'#777',letterSpacing:'0.1em',textTransform:'uppercase',fontWeight:600,marginBottom:18}}>Schedule a session for the gym</div>
                <div style={{display:'grid',gridTemplateColumns:'repeat(3,1fr)',gap:14,marginBottom:16}}>
                  <div>
                    <label style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',display:'block',marginBottom:6}}>Class Name *</label>
                    <input placeholder="e.g. Heavy Bag Basics" value={newClass.name} onChange={e=>setNewClass(p=>({...p,name:e.target.value}))} style={{...inp,background:'rgba(20,15,14,0.8)'}}
                      onFocus={e=>{e.target.style.borderColor='#e84a2f';e.target.style.boxShadow='0 0 0 3px rgba(232,74,47,0.1)'}}
                      onBlur={e=>{e.target.style.borderColor='rgba(255,255,255,0.12)';e.target.style.boxShadow='none'}}/>
                  </div>
                  {[
                    {key:'day',label:'Day',opts:DAYS},
                    {key:'time',label:'Time',opts:TIMES},
                    {key:'level',label:'Level',opts:LEVELS},
                    {key:'coach',label:'Coach',opts:coaches.length>0?coaches.map(c=>c.name||'Coach'):['Admin']},
                    {key:'spots',label:'Max Spots',opts:['6','8','10','12','15','20','25','30']},
                  ].map(f=>(
                    <div key={f.key}>
                      <label style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase',display:'block',marginBottom:6}}>{f.label}</label>
                      <select value={newClass[f.key]} onChange={e=>setNewClass(p=>({...p,[f.key]:e.target.value}))} style={{...selStyle,background:'rgba(20,15,14,0.8)'}}
                        onFocus={e=>e.target.style.borderColor='#e84a2f'} onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.12)'}>
                        {f.opts.map(o=><option key={o} value={o} style={{background:'#1a1818',color:'#f0ece8'}}>{o}</option>)}
                      </select>
                    </div>
                  ))}
                </div>
                <button onClick={createClass}
                  style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'12px 28px',fontSize:12,fontWeight:800,letterSpacing:'0.06em',cursor:'pointer',boxShadow:'0 6px 20px rgba(232,74,47,0.4),inset 0 1px 0 rgba(255,255,255,0.15)',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                  onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 10px 28px rgba(232,74,47,0.55),inset 0 1px 0 rgba(255,255,255,0.2)'}}
                  onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 6px 20px rgba(232,74,47,0.4),inset 0 1px 0 rgba(255,255,255,0.15)'}}>
                  ✓ CREATE CLASS
                </button>
              </div>
            )}

            {/* Class grid */}
            {visibleClasses.length===0?(
              <div style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:'1px dashed rgba(255,255,255,0.08)',padding:'60px 30px',textAlign:'center'}}>
                <div style={{fontSize:56,marginBottom:14,opacity:0.4}}>📋</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#f0ece8',letterSpacing:'0.06em',marginBottom:6}}>NO ACTIVE CLASSES</div>
                <div style={{fontSize:11,color:'#666',letterSpacing:'0.05em'}}>{classes.length>0?`${classes.length} class${classes.length===1?'':'es'} ended — create new ones 🥊`:'Create your first class — appears on all member dashboards 🥊'}</div>
              </div>
            ):(
              <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(320px,1fr))',gap:14}}>
                {visibleClasses.map(cls=>{
                  const classBookings=bookings.filter(b=>b.classId===cls.id)
                  const pct=cls.spots>0?Math.round((classBookings.length/cls.spots)*100):0
                  const fillColor=pct>=90?'#e84a2f':pct>=60?'#f5c842':'#22c55e'
                  const lc=LEVEL_COLOR[cls.level]||'#f5c842'
                  const lvIc=LEVEL_ICON[cls.level]||'🥊'
                  const dayShort=(cls.day||'').slice(0,3).toUpperCase()
                  return(
                    <div key={cls.id}
                      style={{position:'relative',overflow:'hidden',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:`1px solid ${lc}25`,padding:'20px 22px',cursor:'default',transition:'all 0.4s cubic-bezier(0.34,1.56,0.64,1)',boxShadow:'0 4px 16px rgba(0,0,0,0.4)'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-4px)';e.currentTarget.style.borderColor=`${lc}55`;e.currentTarget.style.boxShadow=`0 16px 40px rgba(0,0,0,0.6),0 0 30px ${lc}22`}}
                      onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.borderColor=`${lc}25`;e.currentTarget.style.boxShadow='0 4px 16px rgba(0,0,0,0.4)'}}>
                      <div style={{position:'absolute',right:-30,top:-30,width:160,height:160,borderRadius:'50%',background:`radial-gradient(circle,${lc}25,transparent 70%)`,pointerEvents:'none'}}/>
                      <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:`linear-gradient(180deg,${lc},#e84a2f)`}}/>
                      <button onClick={()=>setDeleteClassId(cls.id)} title="Delete"
                        style={{position:'absolute',top:10,right:10,width:38,height:38,background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:10,display:'flex',alignItems:'center',justifyContent:'center',fontSize:17,color:'#e84a2f',cursor:'pointer',transition:'all 0.2s ease',zIndex:2}}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.25)';e.currentTarget.style.transform='scale(1.12)'}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.1)';e.currentTarget.style.transform='scale(1)'}}>🗑</button>
                      <div style={{position:'relative',display:'flex',gap:14,alignItems:'flex-start',marginBottom:18,paddingRight:36}}>
                        <div style={{width:64,height:64,borderRadius:14,background:`linear-gradient(135deg,${lc},${lc}aa)`,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',color:'#000',flexShrink:0,boxShadow:`0 6px 18px ${lc}50`,border:`2px solid ${lc}66`}}>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,lineHeight:1}}>{dayShort}</div>
                          <div style={{fontSize:8,fontWeight:800,letterSpacing:'0.08em',marginTop:2,opacity:0.85}}>{cls.time}</div>
                        </div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:'0.04em',color:'#f0ece8',lineHeight:1.1,marginBottom:6}}>{cls.name}</div>
                          <div style={{display:'flex',gap:6,flexWrap:'wrap'}}>
                            <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:`${lc}22`,color:lc,border:`1px solid ${lc}44`,letterSpacing:'0.08em',textTransform:'uppercase'}}>{lvIc} {cls.level}</span>
                            {cls.coach && <span style={{fontSize:9,fontWeight:700,padding:'3px 9px',borderRadius:50,background:'rgba(255,255,255,0.05)',color:'#888',letterSpacing:'0.05em'}}>👨‍🏫 {cls.coach}</span>}
                          </div>
                        </div>
                      </div>
                      <div style={{position:'relative'}}>
                        <div style={{display:'flex',justifyContent:'space-between',alignItems:'baseline',marginBottom:6}}>
                          <span style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.12em',textTransform:'uppercase'}}>Bookings</span>
                          <span style={{display:'flex',alignItems:'baseline',gap:4}}>
                            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:fillColor,lineHeight:1}}>{classBookings.length}</span>
                            <span style={{fontSize:11,color:'#555',fontWeight:700}}>/ {cls.spots}</span>
                            <span style={{fontSize:9,color:fillColor,fontWeight:700,marginLeft:4,padding:'2px 7px',borderRadius:50,background:`${fillColor}18`}}>{pct}%</span>
                          </span>
                        </div>
                        <div style={{height:8,background:'rgba(255,255,255,0.04)',borderRadius:50,overflow:'hidden',border:'1px solid rgba(255,255,255,0.04)'}}>
                          <div style={{height:'100%',borderRadius:50,background:`linear-gradient(90deg,${fillColor},${fillColor}dd)`,width:`${pct}%`,boxShadow:`0 0 12px ${fillColor}88`,transition:'width 0.6s ease'}}/>
                        </div>
                        {pct>=90 && <div style={{marginTop:6,fontSize:9,color:'#e84a2f',fontWeight:700,letterSpacing:'0.05em'}}>🔥 ALMOST FULL</div>}
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
          (() => {
            const lbVisible = scored.filter(m=>{
              if(lbSearch&&!m.name?.toLowerCase().includes(lbSearch.toLowerCase()))return false
              if(lbLevel!=='All Levels'&&getMemberLevel(m)!==lbLevel)return false
              if(lbGoal!=='All Goals'&&m.goal!==lbGoal)return false
              return true
            })
            return(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Filters */}
            <div style={{display:'flex',flexDirection:'column',gap:10,padding:'14px 16px',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:14,border:'1px solid rgba(255,255,255,0.06)'}}>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{fontSize:9,fontWeight:800,color:'#666',letterSpacing:'0.18em',textTransform:'uppercase',minWidth:50,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'inline-block',width:14,height:2,background:'#f5c842'}}/>Level
                </span>
                {LEVEL_DIVS.map(d=>{const lc=LEVEL_COLOR[d]||'#42a5f5';const active=lbLevel===d;return<button key={d} onClick={()=>setLbLevel(d)}
                  style={{background:active?`${lc}22`:'rgba(255,255,255,0.03)',color:active?lc:'#666',border:active?`1px solid ${lc}66`:'1px solid rgba(255,255,255,0.06)',borderRadius:50,padding:'6px 14px',fontSize:10,fontWeight:700,cursor:'pointer',transition:'all 0.2s',display:'flex',alignItems:'center',gap:5,boxShadow:active?`0 4px 12px ${lc}33`:'none'}}
                  onMouseEnter={e=>{if(!active){e.currentTarget.style.borderColor=`${lc}33`;e.currentTarget.style.color=lc}}}
                  onMouseLeave={e=>{if(!active){e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';e.currentTarget.style.color='#666'}}}>{d!=='All Levels'&&LEVEL_ICON[d]+' '}{d}</button>})}
              </div>
              <div style={{display:'flex',gap:8,flexWrap:'wrap',alignItems:'center'}}>
                <span style={{fontSize:9,fontWeight:800,color:'#666',letterSpacing:'0.18em',textTransform:'uppercase',minWidth:50,display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'inline-block',width:14,height:2,background:'#f5c842'}}/>Goal
                </span>
                {GOAL_DIVS.map((d,i)=>{const colors=['#f5c842','#42a5f5','#e84a2f','#22c55e','#c084fc'];const active=lbGoal===d;const color=colors[i]||'#f5c842';return<button key={d} onClick={()=>setLbGoal(d)}
                  style={{background:active?`${color}22`:'rgba(255,255,255,0.03)',color:active?color:'#666',border:active?`1px solid ${color}66`:'1px solid rgba(255,255,255,0.06)',borderRadius:50,padding:'6px 14px',fontSize:10,fontWeight:700,cursor:'pointer',transition:'all 0.2s',boxShadow:active?`0 4px 12px ${color}33`:'none'}}
                  onMouseEnter={e=>{if(!active){e.currentTarget.style.borderColor=`${color}33`;e.currentTarget.style.color=color}}}
                  onMouseLeave={e=>{if(!active){e.currentTarget.style.borderColor='rgba(255,255,255,0.06)';e.currentTarget.style.color='#666'}}}>{d}</button>})}
              </div>
              <div style={{display:'flex',gap:8,alignItems:'center'}}>
                <div style={{position:'relative'}}>
                  <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:13,color:'#666'}}>🔍</span>
                  <input placeholder="Search member…" value={lbSearch} onChange={e=>setLbSearch(e.target.value)}
                    style={{paddingLeft:36,background:'rgba(20,15,14,0.8)',border:'1px solid rgba(255,255,255,0.08)',borderRadius:50,padding:'8px 14px 8px 36px',color:'#f0ece8',fontFamily:'Montserrat,sans-serif',fontSize:11,outline:'none',width:220,transition:'all 0.25s'}}
                    onFocus={e=>{e.target.style.borderColor='rgba(245,200,66,0.4)';e.target.style.boxShadow='0 0 0 3px rgba(245,200,66,0.08)'}}
                    onBlur={e=>{e.target.style.borderColor='rgba(255,255,255,0.08)';e.target.style.boxShadow='none'}}/>
                </div>
                {(lbLevel!=='All Levels'||lbGoal!=='All Goals'||lbSearch)&&<button onClick={()=>{setLbLevel('All Levels');setLbGoal('All Goals');setLbSearch('')}}
                  style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:50,padding:'7px 14px',fontSize:10,fontWeight:800,color:'#e84a2f',cursor:'pointer',letterSpacing:'0.05em'}}>✕ CLEAR</button>}
              </div>
            </div>

            {/* PODIUM — top 3 if we have them */}
            {lbVisible.length>=3 && (
              <div style={{display:'grid',gridTemplateColumns:'1fr 1.15fr 1fr',gap:14,alignItems:'end'}}>
                {[lbVisible[1],lbVisible[0],lbVisible[2]].map((u,podiumIdx)=>{
                  const realRank=podiumIdx===1?1:podiumIdx===0?2:3
                  const lc=LEVEL_COLOR[getMemberLevel(u)]||'#f5c842'
                  const podiumColors=['#c0c0c0','#f5c842','#cd7f32']
                  const podiumColor=podiumColors[realRank-1]
                  const medals=['🥈','🥇','🥉']
                  const heights=[170,200,160]
                  return(
                    <div key={u.uid} style={{position:'relative',overflow:'hidden',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:`2px solid ${podiumColor}55`,padding:'18px 16px',textAlign:'center',minHeight:heights[podiumIdx],display:'flex',flexDirection:'column',justifyContent:'center',alignItems:'center',boxShadow:`0 12px 30px rgba(0,0,0,0.5),0 0 30px ${podiumColor}22`,transform:realRank===1?'translateY(-10px)':'translateY(0)',transition:'all 0.4s cubic-bezier(0.34,1.56,0.64,1)'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform=realRank===1?'translateY(-14px) scale(1.02)':'translateY(-4px) scale(1.02)';e.currentTarget.style.boxShadow=`0 16px 40px rgba(0,0,0,0.6),0 0 40px ${podiumColor}44`}}
                      onMouseLeave={e=>{e.currentTarget.style.transform=realRank===1?'translateY(-10px) scale(1)':'translateY(0) scale(1)';e.currentTarget.style.boxShadow=`0 12px 30px rgba(0,0,0,0.5),0 0 30px ${podiumColor}22`}}>
                      <div style={{position:'absolute',top:-30,left:'50%',transform:'translateX(-50%)',width:120,height:120,borderRadius:'50%',background:`radial-gradient(circle,${podiumColor}30,transparent 70%)`,pointerEvents:'none'}}/>
                      <div style={{position:'relative',fontSize:30,marginBottom:6}}>{medals[realRank-1]}</div>
                      <div style={{position:'relative',fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:podiumColor,letterSpacing:'0.1em',marginBottom:10}}>#{realRank}</div>
                      <div style={{position:'relative',width:realRank===1?70:58,height:realRank===1?70:58,borderRadius:'50%',background:`linear-gradient(135deg,${lc},${lc}aa)`,color:'#000',border:`3px solid ${podiumColor}`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:realRank===1?28:22,marginBottom:10,boxShadow:`0 6px 18px ${podiumColor}55`}}>
                        {(u.name||'?')[0].toUpperCase()}
                      </div>
                      <div style={{position:'relative',fontSize:realRank===1?13:12,fontWeight:700,color:'#f0ece8',marginBottom:3,maxWidth:'100%',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',padding:'0 4px'}}>{u.name||'Member'}</div>
                      <div style={{position:'relative',fontSize:9,color:'#666',marginBottom:10}}>{u.goal||'—'}</div>
                      <div style={{position:'relative',fontFamily:"'Bebas Neue',sans-serif",fontSize:realRank===1?32:26,color:podiumColor,lineHeight:1,textShadow:`0 0 12px ${podiumColor}88`}}>{u.score||0}</div>
                      <div style={{position:'relative',fontSize:8,color:'#666',fontWeight:700,letterSpacing:'0.15em',marginTop:3}}>POINTS</div>
                    </div>
                  )
                })}
              </div>
            )}

            {/* Full leaderboard table */}
            <div style={{position:'relative',overflow:'hidden',borderRadius:20,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',border:'1px solid rgba(245,200,66,0.12)',boxShadow:'0 12px 40px rgba(0,0,0,0.5)'}}>
              <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#f5c842,#e84a2f)'}}/>
              <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(245,200,66,0.08)',background:'linear-gradient(135deg,rgba(245,200,66,0.05) 0%,transparent 60%)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div style={{display:'flex',alignItems:'center',gap:14}}>
                  <div style={{width:42,height:42,borderRadius:11,background:'linear-gradient(135deg,#f5c842,#e08820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,boxShadow:'0 4px 14px rgba(245,200,66,0.3)'}}>🏆</div>
                  <div>
                    <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.06em',color:'#f0ece8'}}>FULL GYM LEADERBOARD</div>
                    <div style={{fontSize:9,color:'#666',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:1}}>
                      <span style={{display:'inline-block',width:6,height:6,borderRadius:'50%',background:'#22c55e',animation:'pulseDot 1.6s ease-in-out infinite',marginRight:6}}/>
                      Live rankings · All members
                    </div>
                  </div>
                </div>
                <div style={{fontSize:10,color:'#888',fontWeight:800,background:'rgba(245,200,66,0.1)',borderRadius:50,padding:'5px 14px',border:'1px solid rgba(245,200,66,0.2)',letterSpacing:'0.08em'}}>
                  {lbVisible.length} / {scored.length} MEMBERS
                </div>
              </div>
              <div style={{display:'flex',padding:'10px 22px',borderBottom:'1px solid rgba(255,255,255,0.04)',background:'rgba(0,0,0,0.2)'}}>
                {[{label:'RANK',w:48},{label:'MEMBER',flex:1},{label:'LEVEL',w:118},{label:'WKT',w:60},{label:'STREAK',w:70},{label:'SCORE',w:160}].map((h,i)=>(
                  <div key={i} style={{width:h.w,flex:h.flex,fontSize:8,fontWeight:800,color:'#666',letterSpacing:'0.15em'}}>{h.label}</div>
                ))}
              </div>
              {lbVisible.length===0?(
                <div style={{padding:'40px 30px',textAlign:'center'}}>
                  <div style={{fontSize:36,marginBottom:8,opacity:0.4}}>🔍</div>
                  <div style={{fontSize:12,color:'#666',fontWeight:600}}>No members match this filter</div>
                </div>
              ):lbVisible.map((m,i)=><LBRow key={m.uid} user={m} maxScore={maxScore} idx={i}/>)}
            </div>
          </div>
            )
          })()
        )}

        {/* ════════════════════════════════════════════════════ */}
        {/*  MEMBERSHIPS TAB                                       */}
        {/* ════════════════════════════════════════════════════ */}
        {tab==='memberships' && (
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Summary stats */}
            {(() => {
              const memberMembers = members.filter(m=>m.role==='member')
              const active   = memberMembers.filter(x => computeMembershipState(x.membership) === STATUS.ACTIVE).length
              const trial    = memberMembers.filter(x => computeMembershipState(x.membership) === STATUS.TRIAL).length
              const expired  = memberMembers.filter(x => computeMembershipState(x.membership) === STATUS.EXPIRED).length
              const paused   = memberMembers.filter(x => computeMembershipState(x.membership) === STATUS.PAUSED).length
              const expiring = memberMembers.filter(x => {
                const st = computeMembershipState(x.membership)
                if (st !== STATUS.ACTIVE && st !== STATUS.TRIAL) return false
                const d = daysRemaining(x.membership)
                return d !== null && d >= 0 && d <= 7
              }).length
              return (
                <div style={{display:'grid',gridTemplateColumns:'repeat(5,1fr)',gap:10}}>
                  {[
                    {label:'Active',   val:active,   color:'#4ade80', icon:'✅'},
                    {label:'Trial',    val:trial,    color:'#42a5f5', icon:'🎁'},
                    {label:'Expiring', val:expiring, color:'#f5c842', icon:'⚠'},
                    {label:'Expired',  val:expired,  color:'#e84a2f', icon:'🔒'},
                    {label:'Paused',   val:paused,   color:'#9ca3af', icon:'⏸'},
                  ].map((s,i)=>(
                    <div key={i} style={{background:`linear-gradient(135deg,${s.color}10,transparent 70%)`,border:`1px solid ${s.color}30`,borderRadius:14,padding:'14px 16px'}}>
                      <div style={{fontSize:9,color:'#666',fontWeight:800,letterSpacing:'0.12em',textTransform:'uppercase',display:'flex',alignItems:'center',gap:6}}>
                        <span>{s.icon}</span>{s.label}
                      </div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,color:s.color,letterSpacing:'0.04em',marginTop:4,lineHeight:1}}>{s.val}</div>
                    </div>
                  ))}
                </div>
              )
            })()}

            {/* Members list with membership status + actions */}
            {/* ──── REVENUE THIS MONTH + EXPIRING SOON ──── */}
            {(() => {
              const totalRevenue = monthlyPayments.reduce((sum, p) => sum + (p.amount || 0), 0)
              const paymentCount = monthlyPayments.length
              const avgPayment   = paymentCount > 0 ? Math.round(totalRevenue / paymentCount) : 0
              const monthLabel   = new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

              // Build expiring-soon list (sorted by urgency)
              const expiringList = members
                .filter(m => m.role === 'member')
                .map(m => ({ m, days: daysRemaining(m.membership), state: computeMembershipState(m.membership) }))
                .filter(x => (x.state === STATUS.ACTIVE || x.state === STATUS.TRIAL) && x.days !== null && x.days >= 0 && x.days <= 7)
                .sort((a, b) => a.days - b.days)

              return (
                <div style={{display:'grid',gridTemplateColumns:'1fr 1.5fr',gap:14}}>

                  {/* ── Revenue This Month ── */}
                  <div style={{position:'relative',background:'linear-gradient(135deg,rgba(74,222,128,0.06) 0%,#1a1413 60%)',borderRadius:18,border:'1px solid rgba(74,222,128,0.18)',overflow:'hidden'}}>
                    <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#4ade80,#22c55e)'}}/>
                    <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(255,255,255,0.04)',display:'flex',alignItems:'center',gap:12}}>
                      <div style={{width:42,height:42,borderRadius:11,background:'linear-gradient(135deg,#4ade80,#22c55e)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,boxShadow:'0 4px 12px rgba(74,222,128,0.3)'}}>💰</div>
                      <div>
                        <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8'}}>REVENUE</div>
                        <div style={{fontSize:9,color:'#666',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:1}}>{monthLabel}</div>
                      </div>
                    </div>
                    <div style={{padding:'22px 24px'}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:48,color:'#4ade80',letterSpacing:'0.02em',lineHeight:1,textShadow:'0 0 24px rgba(74,222,128,0.3)'}}>
                        ₱{totalRevenue.toLocaleString()}
                      </div>
                      <div style={{fontSize:11,color:'#888',marginTop:6,display:'flex',gap:14,flexWrap:'wrap'}}>
                        <span>📊 <strong style={{color:'#f0ece8'}}>{paymentCount}</strong> payment{paymentCount===1?'':'s'}</span>
                        {paymentCount > 0 && <span>· Avg <strong style={{color:'#f0ece8'}}>₱{avgPayment.toLocaleString()}</strong></span>}
                      </div>
                      {paymentCount === 0 && (
                        <div style={{marginTop:14,padding:'10px 14px',background:'rgba(255,255,255,0.02)',border:'1px solid rgba(255,255,255,0.05)',borderRadius:10,fontSize:11,color:'#666',lineHeight:1.5}}>
                          No payments recorded yet this month — record one via the member list below.
                        </div>
                      )}
                    </div>
                  </div>

                  {/* ── Expiring This Week ── */}
                  <div style={{position:'relative',background:'linear-gradient(135deg,rgba(245,200,66,0.05) 0%,#1a1413 60%)',borderRadius:18,border:'1px solid rgba(245,200,66,0.2)',overflow:'hidden'}}>
                    <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#f5c842,#e08820)'}}/>
                    <div style={{padding:'18px 22px',borderBottom:'1px solid rgba(255,255,255,0.04)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                      <div style={{display:'flex',alignItems:'center',gap:12}}>
                        <div style={{width:42,height:42,borderRadius:11,background:'linear-gradient(135deg,#f5c842,#e08820)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,boxShadow:'0 4px 12px rgba(245,200,66,0.3)'}}>⚠</div>
                        <div>
                          <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8'}}>EXPIRING THIS WEEK</div>
                          <div style={{fontSize:9,color:'#666',letterSpacing:'0.12em',textTransform:'uppercase',fontWeight:700,marginTop:1}}>Within 7 days</div>
                        </div>
                      </div>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:'#f5c842',letterSpacing:'0.04em'}}>{expiringList.length}</div>
                    </div>
                    <div style={{maxHeight:260,overflowY:'auto'}}>
                      {expiringList.length === 0 ? (
                        <div style={{padding:'30px 22px',textAlign:'center',fontSize:11,color:'#555',lineHeight:1.6}}>
                          🎉 No members expiring soon.<br/>
                          <span style={{fontSize:10}}>Everyone's plan is healthy.</span>
                        </div>
                      ) : (
                        expiringList.map(({m, days}) => {
                          const urgent = days <= 2
                          const reminded = !!remindedThisCycle[m.uid]
                          return (
                            <div key={m.uid} style={{padding:'12px 22px',borderBottom:'1px solid rgba(255,255,255,0.03)',display:'flex',alignItems:'center',gap:12,transition:'background 0.15s'}}
                              onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.02)'}
                              onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                              <div style={{width:32,height:32,borderRadius:'50%',background:`linear-gradient(135deg,${urgent?'#e84a2f':'#f5c842'}33,#1a1414)`,border:`1.5px solid ${urgent?'#e84a2f44':'#f5c84244'}`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:13,color:urgent?'#e84a2f':'#f5c842',flexShrink:0}}>
                                {(m.name||'?')[0].toUpperCase()}
                              </div>
                              <div style={{flex:1,minWidth:0}}>
                                <div style={{fontSize:12,fontWeight:700,color:'#f0ece8',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{m.name}</div>
                                <div style={{fontSize:10,color:urgent?'#e84a2f':'#888',marginTop:1,fontWeight:600}}>
                                  {days === 0 ? '⚡ Expires today' : days === 1 ? '⚡ Expires tomorrow' : `${days} days left`}
                                </div>
                              </div>
                              <button onClick={()=>sendReminder(m)} disabled={reminded} title={reminded?'Already reminded':'Send renewal reminder'}
                                style={{background:reminded?'rgba(255,255,255,0.04)':'rgba(245,200,66,0.1)',border:`1px solid ${reminded?'rgba(255,255,255,0.08)':'rgba(245,200,66,0.3)'}`,borderRadius:50,padding:'6px 10px',fontSize:9,fontWeight:700,color:reminded?'#555':'#f5c842',cursor:reminded?'not-allowed':'pointer',flexShrink:0,letterSpacing:'0.04em'}}>
                                {reminded ? '✓ SENT' : '📣 REMIND'}
                              </button>
                            </div>
                          )
                        })
                      )}
                    </div>
                  </div>

                </div>
              )
            })()}

            {/* Members list with membership status + actions */}
            <div style={{background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:'1px solid rgba(245,200,66,0.12)',overflow:'hidden'}}>
              <div style={{padding:'16px 22px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',alignItems:'center',justifyContent:'space-between'}}>
                <div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:'#f0ece8',letterSpacing:'0.06em'}}>💳 MEMBERSHIPS</div>
                  <div style={{fontSize:10,color:'#666',marginTop:2}}>Record payments, pause/resume, view history</div>
                </div>
                <div style={{fontSize:11,color:'#888'}}>
                  {members.filter(m=>m.role==='member').length} total members
                </div>
              </div>

              <div style={{maxHeight:600,overflowY:'auto'}}>
                {members.filter(m=>m.role==='member').length === 0 ? (
                  <div style={{textAlign:'center',color:'#555',fontSize:12,padding:40}}>No members yet</div>
                ) : (
                  members.filter(m=>m.role==='member')
                    .sort((a,b) => {
                      // Sort: expired first, then expiring, then active by days remaining, then trial, then paused
                      const aStat = computeMembershipState(a.membership)
                      const bStat = computeMembershipState(b.membership)
                      const rank = { expired:0, active:1, trial:2, paused:3, legacy:4, none:5 }
                      const ra = rank[aStat] ?? 9, rb = rank[bStat] ?? 9
                      if (ra !== rb) return ra - rb
                      const ad = daysRemaining(a.membership) ?? 9999
                      const bd = daysRemaining(b.membership) ?? 9999
                      return ad - bd
                    })
                    .map(member => {
                      const state = computeMembershipState(member.membership)
                      const color = getStatusColor(state)
                      const label = getStatusLabel(state)
                      const icon  = getStatusIcon(state)
                      const isPaused = state === STATUS.PAUSED
                      return (
                        <div key={member.uid} style={{padding:'14px 22px',borderBottom:'1px solid rgba(255,255,255,0.04)',display:'flex',alignItems:'center',gap:14,transition:'background 0.15s'}}
                          onMouseEnter={e=>e.currentTarget.style.background='rgba(255,255,255,0.02)'}
                          onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                          {/* Avatar */}
                          <div style={{width:38,height:38,borderRadius:'50%',background:'linear-gradient(135deg,#2a2222,#1a1414)',border:`1.5px solid ${color}44`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:'#f5c842',flexShrink:0}}>
                            {(member.name||'?')[0].toUpperCase()}
                          </div>
                          {/* Name + status */}
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:2}}>
                              <span style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{member.name||'Unknown'}</span>
                              <span style={{fontSize:9,padding:'2px 8px',background:`${color}18`,color,border:`1px solid ${color}40`,borderRadius:50,fontWeight:700,letterSpacing:'0.08em',display:'inline-flex',alignItems:'center',gap:4}}>
                                <span>{icon}</span>{label}
                              </span>
                            </div>
                            <div style={{fontSize:10,color:'#666'}}>
                              {isPaused
                                ? `Paused since ${fmtExpiry({expiresAt: member.membership?.pausedAt})}`
                                : `${fmtRemaining(member.membership)} · expires ${fmtExpiry(member.membership)}`}
                            </div>
                          </div>
                          {/* Actions */}
                          <div style={{display:'flex',gap:6,flexShrink:0}}>
                            <button onClick={()=>setPayTarget(member)} title="Record payment"
                              style={{background:'rgba(74,222,128,0.1)',border:'1px solid rgba(74,222,128,0.3)',borderRadius:50,padding:'6px 12px',fontSize:10,fontWeight:700,color:'#4ade80',cursor:'pointer',display:'flex',alignItems:'center',gap:4}}>
                              💰 Record
                            </button>
                            <button onClick={()=>setPauseTarget(member)} title={isPaused?'Resume':'Pause'}
                              style={{background:isPaused?'rgba(74,222,128,0.1)':'rgba(245,200,66,0.1)',border:`1px solid ${isPaused?'rgba(74,222,128,0.3)':'rgba(245,200,66,0.3)'}`,borderRadius:50,padding:'6px 12px',fontSize:10,fontWeight:700,color:isPaused?'#4ade80':'#f5c842',cursor:'pointer'}}>
                              {isPaused ? '▶ Resume' : '⏸ Pause'}
                            </button>
                            <button onClick={()=>openPaymentHistory(member)} title="Payment history"
                              style={{background:'rgba(66,165,245,0.1)',border:'1px solid rgba(66,165,245,0.3)',borderRadius:50,padding:'6px 12px',fontSize:10,fontWeight:700,color:'#42a5f5',cursor:'pointer'}}>
                              📜 History
                            </button>
                          </div>
                        </div>
                      )
                    })
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── NOTIFICATIONS ── */}
        {tab==='notifications'&&(
          <div style={{display:'flex',flexDirection:'column',gap:14}}>
            {/* Tab switcher */}
            <div style={{display:'flex',gap:6,padding:6,background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:14,border:'1px solid rgba(255,255,255,0.06)'}}>
              {[
                {id:'announcements', icon:'📢', label:'ANNOUNCEMENTS', count:realAnnouncements.length, color:'#f5c842', sub:'Manual gym news'},
                {id:'activity',      icon:'⚡', label:'ACTIVITY FEED',  count:activity.length, color:'#42a5f5', sub:'System events'},
              ].map(t => {
                const active = notifSubTab === t.id
                return (
                  <button key={t.id} onClick={()=>setNotifSubTab(t.id)}
                    style={{flex:1,position:'relative',display:'flex',alignItems:'center',justifyContent:'center',gap:10,background:active?`linear-gradient(135deg,${t.color}20,${t.color}08)`:'transparent',color:active?t.color:'#777',border:active?`1px solid ${t.color}40`:'1px solid transparent',borderRadius:10,padding:'12px 18px',fontSize:13,fontWeight:800,letterSpacing:'0.06em',cursor:'pointer',transition:'all 0.25s cubic-bezier(0.34,1.56,0.64,1)',boxShadow:active?`0 4px 14px ${t.color}25`:'none'}}
                    onMouseEnter={e=>{if(!active){e.currentTarget.style.background='rgba(255,255,255,0.03)';e.currentTarget.style.color='#aaa'}}}
                    onMouseLeave={e=>{if(!active){e.currentTarget.style.background='transparent';e.currentTarget.style.color='#777'}}}>
                    <span style={{fontSize:18}}>{t.icon}</span>
                    <div style={{textAlign:'left'}}>
                      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:'0.06em',lineHeight:1}}>{t.label}</div>
                      <div style={{fontSize:8,color:active?t.color:'#555',marginTop:3,letterSpacing:'0.1em',opacity:0.7}}>{t.sub}</div>
                    </div>
                    <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:active?`${t.color}30`:'rgba(255,255,255,0.04)',color:active?t.color:'#666',letterSpacing:'0.05em'}}>{t.count}</span>
                  </button>
                )
              })}
            </div>

            {/* ANNOUNCEMENTS TAB CONTENT */}
            {notifSubTab==='announcements' && (<>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center'}}>
              <div style={{display:'flex',alignItems:'center',gap:10}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.06em',color:'#f0ece8'}}>📢 ANNOUNCEMENTS</div>
                <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(245,200,66,0.15)',color:'#f5c842',letterSpacing:'0.08em'}}>{realAnnouncements.length} POSTED</span>
              </div>
              <button onClick={()=>setShowNotif(true)}
                style={{background:'linear-gradient(135deg,#f5c842,#e08820)',color:'#000',border:'none',borderRadius:50,padding:'10px 22px',fontSize:12,fontWeight:800,letterSpacing:'0.05em',cursor:'pointer',boxShadow:'0 6px 20px rgba(245,200,66,0.4)',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                onMouseEnter={e=>{e.currentTarget.style.transform='translateY(-2px) scale(1.02)';e.currentTarget.style.boxShadow='0 10px 28px rgba(245,200,66,0.55)'}}
                onMouseLeave={e=>{e.currentTarget.style.transform='translateY(0) scale(1)';e.currentTarget.style.boxShadow='0 6px 20px rgba(245,200,66,0.4)'}}>
                📢 POST ANNOUNCEMENT
              </button>
            </div></>)}

            {/* ACTIVITY TAB HEADER */}
            {notifSubTab==='activity' && (
              <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',flexWrap:'wrap',gap:10}}>
                <div style={{display:'flex',alignItems:'center',gap:10}}>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,letterSpacing:'0.06em',color:'#f0ece8'}}>⚡ LIVE ACTIVITY</div>
                  <span style={{fontSize:9,fontWeight:800,padding:'3px 9px',borderRadius:50,background:'rgba(66,165,245,0.15)',color:'#42a5f5',letterSpacing:'0.08em'}}>{activity.length} EVENTS</span>
                </div>
                <div style={{display:'flex',alignItems:'center',gap:8}}>
                  <span style={{display:'flex',alignItems:'center',gap:7,fontSize:10,fontWeight:700,color:'#22c55e',padding:'6px 14px',background:'rgba(34,197,94,0.08)',border:'1px solid rgba(34,197,94,0.25)',borderRadius:50,letterSpacing:'0.06em'}}>
                    <span style={{display:'inline-block',width:7,height:7,borderRadius:'50%',background:'#22c55e',animation:'pulseDot 1.6s ease-in-out infinite'}}/>
                    LIVE
                  </span>
                  {activity.length > 0 && (
                    <button onClick={()=>setClearActivityConfirm(true)}
                      style={{background:'rgba(232,74,47,0.1)',color:'#e84a2f',border:'1px solid rgba(232,74,47,0.3)',borderRadius:50,padding:'6px 14px',fontSize:10,fontWeight:800,letterSpacing:'0.08em',cursor:'pointer',display:'flex',alignItems:'center',gap:6,transition:'all 0.25s'}}
                      onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.transform='translateY(-1px)';e.currentTarget.style.boxShadow='0 4px 12px rgba(232,74,47,0.25)'}}
                      onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.1)';e.currentTarget.style.transform='translateY(0)';e.currentTarget.style.boxShadow='none'}}>
                      🧹 CLEAR ALL
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* ANNOUNCEMENTS LIST */}
            {notifSubTab==='announcements' && (realAnnouncements.length===0?(
              <div style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:'1px dashed rgba(255,255,255,0.08)',padding:'60px 30px',textAlign:'center'}}>
                <div style={{fontSize:56,marginBottom:14,opacity:0.4}}>📭</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#f0ece8',letterSpacing:'0.06em',marginBottom:6}}>NO ANNOUNCEMENTS YET</div>
                <div style={{fontSize:11,color:'#666',letterSpacing:'0.05em'}}>Rally your gym 🥊 — post your first announcement</div>
              </div>
            ):(
              <div style={{display:'flex',flexDirection:'column',gap:10}}>
                {realAnnouncements.map(n=>{
                  const isAll=n.audience==='all'
                  const ac=isAll?'#f5c842':'#42a5f5'
                  return(
                    <div key={n.id}
                      style={{position:'relative',overflow:'hidden',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:14,border:`1px solid ${ac}25`,padding:'16px 20px',display:'flex',gap:14,alignItems:'flex-start',cursor:'default',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform='translateX(4px)';e.currentTarget.style.borderColor=`${ac}55`;e.currentTarget.style.boxShadow=`0 8px 24px ${ac}15`}}
                      onMouseLeave={e=>{e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.borderColor=`${ac}25`;e.currentTarget.style.boxShadow='none'}}>
                      <div style={{position:'absolute',left:0,top:0,bottom:0,width:4,background:`linear-gradient(180deg,${ac},transparent)`}}/>
                      <div style={{width:44,height:44,borderRadius:12,background:`linear-gradient(135deg,${ac},${ac}aa)`,color:'#000',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0,boxShadow:`0 4px 14px ${ac}50`,border:`1px solid ${ac}66`}}>
                        {isAll?'📢':'🥊'}
                      </div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:8,marginBottom:6,flexWrap:'wrap'}}>
                          <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:16,letterSpacing:'0.04em',color:'#f0ece8'}}>{n.title}</span>
                          <span style={{fontSize:8,fontWeight:800,padding:'3px 9px',borderRadius:50,background:`${ac}22`,color:ac,border:`1px solid ${ac}44`,letterSpacing:'0.08em',textTransform:'uppercase'}}>{isAll?'All Members':'Coaches Only'}</span>
                          {n.editedAt&&<span style={{fontSize:8,color:'#777',fontStyle:'italic',letterSpacing:'0.05em'}}>· edited</span>}
                        </div>
                        <div style={{fontSize:12,color:'#aaa',lineHeight:1.65,marginBottom:8}}>{n.message}</div>
                        <div style={{fontSize:9,color:'#555',fontWeight:600,letterSpacing:'0.05em'}}>By <strong style={{color:'#777'}}>{n.from}</strong></div>
                      </div>
                      <div style={{display:'flex',gap:5,flexShrink:0}}>
                        <button onClick={()=>startEditNotification(n)} title="Edit"
                          style={{background:'rgba(245,200,66,0.1)',border:'1px solid rgba(245,200,66,0.25)',borderRadius:8,padding:'7px 11px',fontSize:13,color:'#f5c842',cursor:'pointer',fontWeight:700,transition:'all 0.2s'}}
                          onMouseEnter={e=>{e.currentTarget.style.background='rgba(245,200,66,0.2)';e.currentTarget.style.transform='scale(1.08)'}}
                          onMouseLeave={e=>{e.currentTarget.style.background='rgba(245,200,66,0.1)';e.currentTarget.style.transform='scale(1)'}}>✏️</button>
                        <button onClick={()=>setDeleteNotifId(n.id)} title="Delete"
                          style={{background:'rgba(232,74,47,0.1)',border:'1px solid rgba(232,74,47,0.25)',borderRadius:8,padding:'7px 11px',fontSize:13,color:'#e84a2f',cursor:'pointer',fontWeight:700,transition:'all 0.2s'}}
                          onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.2)';e.currentTarget.style.transform='scale(1.08)'}}
                          onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.1)';e.currentTarget.style.transform='scale(1)'}}>🗑</button>
                      </div>
                    </div>
                  )
                })}
              </div>
            ))}

            {/* ACTIVITY TAB CONTENT */}
            {notifSubTab==='activity' && (activity.length===0 ? (
              <div style={{position:'relative',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:18,border:'1px dashed rgba(255,255,255,0.08)',padding:'60px 30px',textAlign:'center'}}>
                <div style={{fontSize:56,marginBottom:14,opacity:0.4}}>⚡</div>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:24,color:'#f0ece8',letterSpacing:'0.06em',marginBottom:6}}>NO ACTIVITY YET</div>
                <div style={{fontSize:11,color:'#666',letterSpacing:'0.05em'}}>System events will appear here as members book classes, coaches change levels, etc.</div>
              </div>
            ) : (
              <div style={{display:'flex',flexDirection:'column',gap:8}}>
                {activity.map(ev => {
                  const t = ACTIVITY_TYPES[ev.type] || { icon:'⚡', color:'#888', label:'Event' }
                  const ts = ev.createdAt?.seconds ? new Date(ev.createdAt.seconds*1000) : null
                  return (
                    <div key={ev.id}
                      style={{position:'relative',overflow:'hidden',background:'linear-gradient(135deg,#1a1413 0%,#0e0a0a 100%)',borderRadius:12,border:`1px solid ${t.color}22`,padding:'12px 16px',display:'flex',gap:12,alignItems:'center',cursor:'default',transition:'all 0.3s cubic-bezier(0.34,1.56,0.64,1)'}}
                      onMouseEnter={e=>{e.currentTarget.style.transform='translateX(3px)';e.currentTarget.style.borderColor=`${t.color}55`;e.currentTarget.style.boxShadow=`0 6px 18px ${t.color}15`;const btn=e.currentTarget.querySelector('.act-del');if(btn)btn.style.opacity='1'}}
                      onMouseLeave={e=>{e.currentTarget.style.transform='translateX(0)';e.currentTarget.style.borderColor=`${t.color}22`;e.currentTarget.style.boxShadow='none';const btn=e.currentTarget.querySelector('.act-del');if(btn)btn.style.opacity='0'}}>
                      <div style={{position:'absolute',left:0,top:0,bottom:0,width:3,background:`linear-gradient(180deg,${t.color},transparent)`}}/>
                      <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${t.color}30,${t.color}10)`,color:t.color,border:`1px solid ${t.color}40`,display:'flex',alignItems:'center',justifyContent:'center',fontSize:16,flexShrink:0,boxShadow:`0 4px 10px ${t.color}20`}}>{t.icon}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{display:'flex',alignItems:'center',gap:7,marginBottom:3,flexWrap:'wrap'}}>
                          <span style={{fontSize:9,fontWeight:800,color:t.color,letterSpacing:'0.12em',textTransform:'uppercase'}}>{t.label}</span>
                          {ev.actorRole && <span style={{fontSize:8,fontWeight:700,padding:'1px 7px',borderRadius:50,background:'rgba(255,255,255,0.04)',color:'#777',letterSpacing:'0.08em',textTransform:'uppercase',border:'1px solid rgba(255,255,255,0.06)'}}>{ev.actorRole}</span>}
                        </div>
                        <div style={{fontSize:12,color:'#cdc8c2',lineHeight:1.55}}>{ev.description}</div>
                      </div>
                      <div style={{display:'flex',flexDirection:'column',alignItems:'flex-end',gap:4,flexShrink:0}}>
                        <span style={{fontSize:9,color:'#666',fontWeight:700,letterSpacing:'0.04em',whiteSpace:'nowrap'}}>
                          {ts ? formatRelativeTime(ts) : '—'}
                        </span>
                        {ev.actorName && <span style={{fontSize:8,color:'#555',fontStyle:'italic',letterSpacing:'0.04em',maxWidth:120,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>by {ev.actorName}</span>}
                      </div>
                      <button className="act-del" onClick={()=>deleteActivityEvent(ev.id)} title="Delete this event"
                        style={{opacity:0,width:30,height:30,background:'rgba(232,74,47,0.12)',color:'#e84a2f',border:'1px solid rgba(232,74,47,0.3)',borderRadius:9,display:'flex',alignItems:'center',justifyContent:'center',fontSize:13,cursor:'pointer',flexShrink:0,transition:'all 0.25s',padding:0}}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.25)';e.currentTarget.style.transform='scale(1.1)';e.currentTarget.style.boxShadow='0 4px 12px rgba(232,74,47,0.35)'}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.12)';e.currentTarget.style.transform='scale(1)';e.currentTarget.style.boxShadow='none'}}>🗑</button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}

        {/* FORUM — embedded community forum with admin moderation powers */}
        {tab==='forum' && (
          <Forum embedded currentRole="admin" />
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
        @keyframes pulseDot{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:0.6}}
        @keyframes dangerPulse{0%,100%{transform:scale(1);opacity:0.7}50%{transform:scale(1.15);opacity:1}}
        @keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
        select option{background:#1a1818 !important;color:#f0ece8 !important}
      `}</style>
    </div>
  )
}

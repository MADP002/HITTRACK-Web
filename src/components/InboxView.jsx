import { useState, useEffect, useRef, useMemo } from 'react'
import {
  collection, query, where, onSnapshot, addDoc,
  getDocs, serverTimestamp, doc, deleteDoc,
} from 'firebase/firestore'
import { db } from '../firebase'

// ── ROLE STYLING ──────────────────────────────────────
const ROLE_COLOR = { admin:'#c084fc', coach:'#42a5f5', member:'#f5c842' }
const ROLE_ICON  = { admin:'👑',     coach:'🥊',      member:'🥋'      }
const ROLE_LABEL = { admin:'Admin',  coach:'Coach',   member:'Member'  }

// ── HELPERS ───────────────────────────────────────────
function fmtTime(ts){
  if(!ts||!ts.seconds) return ''
  const d=new Date(ts.seconds*1000)
  const diffMin=Math.floor((Date.now()-d)/60000)
  const diffH=Math.floor(diffMin/60)
  const diffD=Math.floor(diffH/24)
  if(diffMin<1) return 'now'
  if(diffMin<60) return `${diffMin}m`
  if(diffH<24) return `${diffH}h`
  if(diffD<7) return `${diffD}d`
  return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})
}

function fmtMsgTime(ts){
  if(!ts||!ts.seconds) return ''
  const d=new Date(ts.seconds*1000)
  return d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})
}

function fmtMsgDate(ts){
  if(!ts||!ts.seconds) return ''
  const d=new Date(ts.seconds*1000)
  const today=new Date(); today.setHours(0,0,0,0)
  const yest=new Date(today); yest.setDate(yest.getDate()-1)
  if(d>=today) return 'Today'
  if(d>=yest) return 'Yesterday'
  return d.toLocaleDateString('en-US',{weekday:'long',month:'short',day:'numeric'})
}

// ── MAIN COMPONENT ────────────────────────────────────
export default function InboxView({ currentUid, currentName, currentRole='member', embedded=false }){
  const [messages,setMessages]   = useState([])
  const [users,setUsers]         = useState([])     // all OTHER users
  const [activeUid,setActiveUid] = useState(null)   // which conversation is open
  const [msgText,setMsgText]     = useState('')
  const [searchQ,setSearchQ]     = useState('')
  const [composeMode,setComposeMode] = useState(false)
  const [composeSearch,setComposeSearch] = useState('')
  const [sending,setSending]     = useState(false)
  const [readMap,setReadMap]     = useState({})    // uid -> last seen ts (seconds)
  const [deleteMsgId,setDeleteMsgId] = useState(null)
  const [toast,setToast]         = useState('')
  const msgEndRef = useRef(null)

  // ── Subscribe to my messages (realtime) ─────────────
  // NOTE: no orderBy in the query — that would require a composite Firestore
  // index. We sort client-side instead.
  useEffect(()=>{
    if(!currentUid) return
    const q=query(
      collection(db,'messages'),
      where('participants','array-contains',currentUid),
    )
    const unsub=onSnapshot(q,(snap)=>{
      const list=snap.docs.map(d=>({id:d.id,...d.data()}))
      // Sort by createdAt asc — pendingWrites have null createdAt, push to end
      list.sort((a,b)=>{
        const ta=a.createdAt?.seconds||Number.MAX_SAFE_INTEGER
        const tb=b.createdAt?.seconds||Number.MAX_SAFE_INTEGER
        return ta-tb
      })
      setMessages(list)
    },(err)=>{
      console.error('Inbox stream error:',err)
      setToast('❌ Inbox error: '+(err.message||'check console'))
      setTimeout(()=>setToast(''),5000)
    })
    return ()=>unsub()
  },[currentUid])

  // ── Load all OTHER users for compose + name lookup ──
  useEffect(()=>{
    if(!currentUid) return
    let mounted=true
    ;(async()=>{
      try{
        const snap=await getDocs(collection(db,'users'))
        const list=[]
        snap.docs.forEach(d=>{
          const data=d.data()
          if(d.id===currentUid) return
          if(!data.name) return
          list.push({
            uid:d.id,
            name:data.name,
            role:data.role||'member',
            experience:data.experience||'Beginner',
            goal:data.goal||'',
          })
        })
        if(mounted) setUsers(list)
      }catch(e){console.error('Inbox users load:',e)}
    })()
    return ()=>{mounted=false}
  },[currentUid])

  // ── Load read state from localStorage ───────────────
  useEffect(()=>{
    try{
      const saved=localStorage.getItem('hittrack_inbox_read')
      if(saved) setReadMap(JSON.parse(saved))
    }catch{}
  },[])

  // ── Group messages into conversations ───────────────
  const conversations = useMemo(()=>{
    const map={}
    for(const msg of messages){
      const otherUid=msg.participants?.find(p=>p!==currentUid)
      if(!otherUid) continue
      if(!map[otherUid]){
        const otherUser=users.find(u=>u.uid===otherUid)
        map[otherUid]={
          uid:otherUid,
          name:otherUser?.name || (msg.from===currentUid?msg.toName:msg.fromName) || 'Unknown',
          role:otherUser?.role || (msg.from===currentUid?msg.toRole:msg.fromRole) || 'member',
          messages:[],
          lastMsg:null, lastTs:0, unread:0,
        }
      }
      map[otherUid].messages.push(msg)
      const ts=msg.createdAt?.seconds||0
      if(ts>map[otherUid].lastTs){
        map[otherUid].lastTs=ts
        map[otherUid].lastMsg=msg
      }
      const lastRead=readMap[otherUid]||0
      if(msg.from!==currentUid && ts>lastRead) map[otherUid].unread++
    }
    return Object.values(map).sort((a,b)=>b.lastTs-a.lastTs)
  },[messages,users,currentUid,readMap])

  const totalUnread=conversations.reduce((s,c)=>s+c.unread,0)

  // ── Mark active conversation as read on open ────────
  useEffect(()=>{
    if(!activeUid) return
    const newMap={...readMap,[activeUid]:Math.floor(Date.now()/1000)}
    setReadMap(newMap)
    try{localStorage.setItem('hittrack_inbox_read',JSON.stringify(newMap))}catch{}
    setTimeout(()=>msgEndRef.current?.scrollIntoView({behavior:'smooth',block:'end'}),80)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[activeUid,messages.length])

  // ── Filter conversations by search ──────────────────
  const filteredConvs = conversations.filter(c=>
    !searchQ || c.name.toLowerCase().includes(searchQ.toLowerCase())
  )

  const activeConvReal = conversations.find(c=>c.uid===activeUid)
  const activeUser = users.find(u=>u.uid===activeUid)
  // If a person was picked but no messages exist yet, build a placeholder
  // conversation shell so the thread view + send box still render.
  const activeConv = activeConvReal || (activeUid && activeUser ? {
    uid:activeUser.uid, name:activeUser.name, role:activeUser.role,
    messages:[], lastMsg:null, lastTs:0, unread:0,
  } : null)

  // ── Compose: people picker (sorted by role then name) ─
  const composeFiltered = users
    .filter(u=>!composeSearch||u.name.toLowerCase().includes(composeSearch.toLowerCase()))
    .sort((a,b)=>{
      const order={admin:0,coach:1,member:2}
      const o=(order[a.role]??3)-(order[b.role]??3)
      return o!==0 ? o : a.name.localeCompare(b.name)
    })

  // ── ACTIONS ────────────────────────────────────────
  async function sendMessage(){
    if(!msgText.trim()||!activeUid||sending) return
    setSending(true)
    const target=users.find(u=>u.uid===activeUid)||activeConv
    try{
      await addDoc(collection(db,'messages'),{
        participants:[currentUid,activeUid],
        from:currentUid,
        fromName:currentName||'User',
        fromRole:currentRole||'member',
        to:activeUid,
        toName:target?.name||'User',
        toRole:target?.role||'member',
        text:msgText.trim(),
        createdAt:serverTimestamp(),
      })
      setMsgText('')
    }catch(e){
      console.error('Send error:',e)
      setToast('❌ Send failed: '+(e.message||'permission denied'))
      setTimeout(()=>setToast(''),3500)
    }
    setSending(false)
  }

  function startConversationWith(user){
    setActiveUid(user.uid)
    setComposeMode(false)
    setComposeSearch('')
  }

  async function deleteMessage(msgId){
    try{
      await deleteDoc(doc(db,'messages',msgId))
      setDeleteMsgId(null)
      setToast('🗑 Message deleted')
      setTimeout(()=>setToast(''),2200)
    }catch(e){
      console.error('Delete msg error:',e)
      setToast('❌ Could not delete (only your own messages can be deleted)')
      setTimeout(()=>setToast(''),3500)
      setDeleteMsgId(null)
    }
  }

  // ── STYLES ─────────────────────────────────────────
  const glass={background:'linear-gradient(135deg,rgba(22,20,20,0.97),rgba(14,12,12,0.99))',border:'1px solid rgba(255,255,255,0.07)',borderRadius:16,boxShadow:'0 4px 24px rgba(0,0,0,0.4)'}
  const inp={background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'9px 13px',color:'#f0ece8',fontSize:12,fontFamily:'Montserrat,sans-serif',outline:'none',width:'100%',boxSizing:'border-box'}

  // Container — embedded means we're inside coach/admin dashboard tab,
  // standalone means we're the full member /inbox page.
  const containerStyle = embedded
    ? {display:'grid',gridTemplateColumns:'320px 1fr',gap:12,height:'72vh',minHeight:520}
    : {display:'grid',gridTemplateColumns:'320px 1fr',gap:14,height:'calc(100vh - 110px)',minHeight:560,maxWidth:1200,margin:'0 auto',padding:'14px 24px 0'}

  return(
    <div style={containerStyle}>

      {/* TOAST */}
      {toast && <div style={{position:'fixed',top:20,right:20,zIndex:5000,background:'rgba(22,20,20,0.97)',border:'1px solid rgba(245,200,66,0.25)',backdropFilter:'blur(12px)',borderRadius:12,padding:'12px 18px',fontSize:12,fontWeight:700,color:'#f0ece8',boxShadow:'0 8px 28px rgba(0,0,0,0.5)'}}>{toast}</div>}

      {/* ── LEFT: CONVERSATIONS LIST ─────────── */}
      <div style={{...glass,display:'flex',flexDirection:'column',overflow:'hidden'}}>
        <div style={{padding:'14px 16px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',alignItems:'center',justifyContent:'space-between',gap:8}}>
          <div style={{display:'flex',alignItems:'center',gap:8}}>
            <span style={{fontSize:18}}>💬</span>
            <span style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8'}}>INBOX</span>
            {totalUnread>0 && <span style={{fontSize:9,fontWeight:700,background:'#e84a2f',color:'#fff',borderRadius:50,padding:'2px 7px',minWidth:18,textAlign:'center'}}>{totalUnread}</span>}
          </div>
          <button onClick={()=>{setComposeMode(true);setActiveUid(null)}}
            style={{background:'linear-gradient(135deg,#f5c842,#e08820)',color:'#000',border:'none',borderRadius:50,padding:'6px 12px',fontSize:11,fontWeight:700,cursor:'pointer',boxShadow:'0 2px 10px rgba(245,200,66,0.25)'}}>
            ✏️ New
          </button>
        </div>

        <div style={{padding:'10px 14px',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
          <div style={{position:'relative'}}>
            <span style={{position:'absolute',left:11,top:'50%',transform:'translateY(-50%)',fontSize:11,color:'#555'}}>🔍</span>
            <input value={searchQ} onChange={e=>setSearchQ(e.target.value)} placeholder="Search conversations…"
              style={{...inp,paddingLeft:30,borderRadius:50,fontSize:11,padding:'8px 14px 8px 30px'}}/>
          </div>
        </div>

        <div style={{flex:1,overflowY:'auto'}}>
          {filteredConvs.length===0?(
            <div style={{padding:'40px 20px',textAlign:'center',color:'#555'}}>
              <div style={{fontSize:36,marginBottom:10,opacity:0.5}}>📭</div>
              <div style={{fontSize:12,fontWeight:700,color:'#777',marginBottom:4}}>
                {searchQ?'No matches':'No conversations yet'}
              </div>
              <div style={{fontSize:10,color:'#555'}}>
                {searchQ?'Try a different search':'Tap "New" to message someone'}
              </div>
            </div>
          ):filteredConvs.map(c=>{
            const rc=ROLE_COLOR[c.role]||'#f5c842'
            const isActive=activeUid===c.uid
            const lastFromMe=c.lastMsg?.from===currentUid
            const preview=c.lastMsg?.text||''
            return(
              <div key={c.uid} onClick={()=>{setActiveUid(c.uid);setComposeMode(false)}}
                style={{display:'flex',alignItems:'center',gap:10,padding:'12px 14px',cursor:'pointer',
                  background:isActive?'rgba(245,200,66,0.08)':'transparent',
                  borderBottom:'1px solid rgba(255,255,255,0.03)',
                  borderLeft:`3px solid ${isActive?'#f5c842':'transparent'}`,
                  transition:'all 0.15s'}}
                onMouseEnter={e=>{if(!isActive)e.currentTarget.style.background='rgba(255,255,255,0.02)'}}
                onMouseLeave={e=>{if(!isActive)e.currentTarget.style.background='transparent'}}>
                <div style={{position:'relative',flexShrink:0}}>
                  <div style={{width:40,height:40,borderRadius:'50%',background:`${rc}22`,border:`2px solid ${rc}55`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:15,color:rc}}>
                    {(c.name||'?')[0].toUpperCase()}
                  </div>
                  {c.unread>0 && <div style={{position:'absolute',top:-2,right:-2,minWidth:16,height:16,borderRadius:50,background:'#e84a2f',color:'#fff',fontSize:9,fontWeight:700,display:'flex',alignItems:'center',justifyContent:'center',padding:'0 4px',border:'2px solid #161414'}}>{c.unread}</div>}
                </div>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:6,marginBottom:2}}>
                    <div style={{display:'flex',alignItems:'center',gap:5,minWidth:0}}>
                      <span style={{fontSize:12,fontWeight:700,color:isActive?'#f5c842':'#f0ece8',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{c.name}</span>
                      {c.role!=='member' && <span style={{fontSize:8,color:rc,background:`${rc}15`,border:`1px solid ${rc}30`,borderRadius:50,padding:'1px 5px',fontWeight:700,flexShrink:0}}>{ROLE_ICON[c.role]} {ROLE_LABEL[c.role]}</span>}
                    </div>
                    <span style={{fontSize:9,color:'#555',flexShrink:0}}>{fmtTime(c.lastMsg?.createdAt)}</span>
                  </div>
                  <div style={{fontSize:10,color:c.unread>0?'#b0ada8':'#666',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis',fontWeight:c.unread>0?600:400}}>
                    {lastFromMe?<span style={{color:'#555'}}>You: </span>:''}
                    {preview}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* ── RIGHT: THREAD OR COMPOSE OR EMPTY ────── */}
      <div style={{...glass,display:'flex',flexDirection:'column',overflow:'hidden'}}>

        {composeMode?(
          // ── COMPOSE NEW MESSAGE ────────────────
          <>
            <div style={{padding:'14px 18px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',alignItems:'center',gap:10}}>
              <button onClick={()=>{setComposeMode(false);setComposeSearch('')}}
                style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)',color:'#777',borderRadius:8,padding:'5px 10px',fontSize:11,cursor:'pointer',fontWeight:700}}>← Back</button>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'#f0ece8'}}>NEW MESSAGE</div>
            </div>
            <div style={{padding:'14px 18px',borderBottom:'1px solid rgba(255,255,255,0.04)'}}>
              <div style={{position:'relative'}}>
                <span style={{position:'absolute',left:12,top:'50%',transform:'translateY(-50%)',fontSize:12,color:'#555'}}>🔍</span>
                <input autoFocus value={composeSearch} onChange={e=>setComposeSearch(e.target.value)} placeholder="Search by name…"
                  style={{...inp,paddingLeft:32,fontSize:12,padding:'10px 14px 10px 32px'}}/>
              </div>
              <div style={{fontSize:10,color:'#555',marginTop:8,fontWeight:700,letterSpacing:'0.08em',textTransform:'uppercase'}}>
                {composeFiltered.length} {composeFiltered.length===1?'person':'people'} available
              </div>
            </div>
            <div style={{flex:1,overflowY:'auto',padding:'8px 0'}}>
              {composeFiltered.length===0?(
                <div style={{padding:'40px 20px',textAlign:'center',color:'#555',fontSize:12}}>No people match "{composeSearch}"</div>
              ):composeFiltered.map(u=>{
                const rc=ROLE_COLOR[u.role]||'#f5c842'
                return(
                  <div key={u.uid} onClick={()=>startConversationWith(u)}
                    style={{display:'flex',alignItems:'center',gap:12,padding:'10px 18px',cursor:'pointer',transition:'all 0.15s'}}
                    onMouseEnter={e=>e.currentTarget.style.background='rgba(245,200,66,0.05)'}
                    onMouseLeave={e=>e.currentTarget.style.background='transparent'}>
                    <div style={{width:36,height:36,borderRadius:'50%',background:`${rc}22`,border:`2px solid ${rc}55`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:rc,flexShrink:0}}>
                      {(u.name||'?')[0].toUpperCase()}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontSize:12,fontWeight:700,color:'#f0ece8'}}>{u.name}</div>
                      <div style={{display:'flex',gap:6,alignItems:'center',marginTop:2,fontSize:9,color:'#555'}}>
                        <span style={{color:rc,fontWeight:700}}>{ROLE_ICON[u.role]} {ROLE_LABEL[u.role]}</span>
                        {u.role==='member' && u.experience && <span>· {u.experience}</span>}
                        {u.role==='member' && u.goal && <span>· {u.goal}</span>}
                      </div>
                    </div>
                    <span style={{fontSize:11,color:'#555'}}>→</span>
                  </div>
                )
              })}
            </div>
          </>
        ):activeConv?(
          // ── ACTIVE CONVERSATION ────────────────
          <>
            <div style={{padding:'13px 18px',borderBottom:'1px solid rgba(255,255,255,0.05)',display:'flex',alignItems:'center',gap:12}}>
              <div style={{width:38,height:38,borderRadius:'50%',background:`${ROLE_COLOR[activeConv.role]||'#f5c842'}22`,border:`2px solid ${ROLE_COLOR[activeConv.role]||'#f5c842'}55`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:14,color:ROLE_COLOR[activeConv.role]||'#f5c842'}}>
                {(activeConv.name||'?')[0].toUpperCase()}
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:13,fontWeight:700,color:'#f0ece8'}}>{activeConv.name}</div>
                <div style={{fontSize:10,color:ROLE_COLOR[activeConv.role]||'#f5c842',marginTop:1,fontWeight:600}}>
                  {ROLE_ICON[activeConv.role]} {ROLE_LABEL[activeConv.role]}
                  {activeUser?.experience && activeConv.role==='member' && ` · ${activeUser.experience}`}
                </div>
              </div>
              <button onClick={()=>setActiveUid(null)} title="Close"
                style={{background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.08)',color:'#777',borderRadius:8,padding:'5px 9px',fontSize:13,cursor:'pointer'}}>✕</button>
            </div>

            <div style={{flex:1,overflowY:'auto',padding:'16px 18px',display:'flex',flexDirection:'column',gap:6}}>
              {activeConv.messages.length===0 && (
                <div style={{margin:'auto',textAlign:'center',padding:30,opacity:0.6}}>
                  <div style={{fontSize:42,marginBottom:10}}>👋</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,color:'#f0ece8',letterSpacing:'0.06em',marginBottom:6}}>SAY HELLO</div>
                  <div style={{fontSize:11,color:'#777',lineHeight:1.6}}>
                    This is the start of your conversation with <strong style={{color:'#f5c842'}}>{activeConv.name}</strong>.<br/>
                    Send your first message below.
                  </div>
                </div>
              )}
              {activeConv.messages.map((m,i)=>{
                const isMe=m.from===currentUid
                const prev=activeConv.messages[i-1]
                const sameAsPrev=prev&&prev.from===m.from
                const showDateSep=!prev||fmtMsgDate(prev.createdAt)!==fmtMsgDate(m.createdAt)
                const rc=isMe?'#f5c842':(ROLE_COLOR[isMe?currentRole:activeConv.role]||'#42a5f5')
                return(
                  <div key={m.id||i}>
                    {showDateSep&&(
                      <div style={{textAlign:'center',margin:'14px 0 10px',fontSize:9,color:'#555',fontWeight:700,letterSpacing:'0.1em',textTransform:'uppercase'}}>
                        — {fmtMsgDate(m.createdAt)} —
                      </div>
                    )}
                    <div style={{display:'flex',justifyContent:isMe?'flex-end':'flex-start',marginTop:sameAsPrev?2:8,gap:8,alignItems:'flex-end'}}>
                      {!isMe&&!sameAsPrev&&(
                        <div style={{width:26,height:26,borderRadius:'50%',background:`${rc}22`,border:`1.5px solid ${rc}55`,display:'flex',alignItems:'center',justifyContent:'center',fontFamily:"'Bebas Neue',sans-serif",fontSize:11,color:rc,flexShrink:0}}>
                          {(activeConv.name||'?')[0].toUpperCase()}
                        </div>
                      )}
                      {!isMe&&sameAsPrev&&<div style={{width:26,flexShrink:0}}/>}
                      <div style={{maxWidth:'72%',display:'flex',flexDirection:'column',alignItems:isMe?'flex-end':'flex-start',gap:2,position:'relative'}} className="msg-bubble-wrapper">
                        <div style={{
                          background:isMe?'linear-gradient(135deg,rgba(245,200,66,0.18),rgba(232,74,47,0.12))':'rgba(255,255,255,0.05)',
                          border:`1px solid ${isMe?'rgba(245,200,66,0.28)':'rgba(255,255,255,0.08)'}`,
                          borderRadius:isMe?'14px 14px 4px 14px':'14px 14px 14px 4px',
                          padding:'9px 13px',fontSize:12,color:'#f0ece8',lineHeight:1.55,wordBreak:'break-word',whiteSpace:'pre-wrap',
                          position:'relative',
                        }}>
                          {m.text}
                        </div>
                        <div style={{display:'flex',alignItems:'center',gap:6,fontSize:8,color:'#555',padding:'0 4px'}}>
                          <span>{fmtMsgTime(m.createdAt)}</span>
                          {isMe && <button onClick={()=>setDeleteMsgId(m.id)} title="Delete" style={{background:'none',border:'none',color:'#666',cursor:'pointer',fontSize:9,padding:0,opacity:0.5}} onMouseEnter={e=>e.currentTarget.style.opacity=1} onMouseLeave={e=>e.currentTarget.style.opacity=0.5}>🗑</button>}
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={msgEndRef}/>
            </div>

            <div style={{padding:'12px 14px',borderTop:'1px solid rgba(255,255,255,0.05)',display:'flex',gap:8,alignItems:'flex-end'}}>
              <textarea value={msgText} onChange={e=>setMsgText(e.target.value)}
                onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMessage()}}}
                placeholder={`Message ${activeConv.name?.split(' ')[0]||'…'}`}
                rows={1}
                style={{flex:1,background:'rgba(255,255,255,0.05)',border:'1px solid rgba(255,255,255,0.1)',borderRadius:10,padding:'10px 13px',color:'#f0ece8',fontSize:12,fontFamily:'Montserrat,sans-serif',outline:'none',resize:'none',minHeight:38,maxHeight:120,lineHeight:1.5}}
                onFocus={e=>e.target.style.borderColor='rgba(245,200,66,0.4)'}
                onBlur={e=>e.target.style.borderColor='rgba(255,255,255,0.1)'}/>
              <button onClick={sendMessage} disabled={!msgText.trim()||sending}
                style={{background:msgText.trim()&&!sending?'linear-gradient(135deg,#f5c842,#e84a2f)':'rgba(255,255,255,0.05)',color:msgText.trim()&&!sending?'#fff':'#444',border:'none',borderRadius:10,padding:'10px 18px',fontSize:13,fontWeight:700,cursor:msgText.trim()&&!sending?'pointer':'not-allowed',transition:'all 0.2s',flexShrink:0,minHeight:38}}>
                {sending?'…':'Send →'}
              </button>
            </div>
          </>
        ):(
          // ── EMPTY STATE ─────────────────────────
          <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',padding:40,textAlign:'center',gap:14}}>
            <div style={{fontSize:64,opacity:0.25}}>💬</div>
            <div>
              <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:22,color:'#f0ece8',letterSpacing:'0.06em'}}>YOUR MESSAGES</div>
              <div style={{fontSize:12,color:'#555',marginTop:6,maxWidth:300,lineHeight:1.6}}>
                Send a private message to a teammate, coach, or admin. Pick a conversation on the left or start a new one.
              </div>
            </div>
            <button onClick={()=>{setComposeMode(true);setActiveUid(null)}}
              style={{background:'linear-gradient(135deg,#f5c842,#e08820)',color:'#000',border:'none',borderRadius:50,padding:'10px 22px',fontSize:12,fontWeight:700,cursor:'pointer',boxShadow:'0 4px 16px rgba(245,200,66,0.3)',marginTop:6}}>
              ✏️ Start a New Conversation
            </button>
          </div>
        )}
      </div>

      {/* DELETE MESSAGE CONFIRM */}
      {deleteMsgId && (
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.85)',backdropFilter:'blur(8px)',zIndex:5000,display:'flex',alignItems:'center',justifyContent:'center'}}>
          <div style={{...glass,padding:'30px 34px',maxWidth:340,width:'90%',textAlign:'center',border:'1px solid rgba(232,74,47,0.3)'}}>
            <div style={{fontSize:36,marginBottom:10}}>⚠️</div>
            <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,color:'#f0ece8',marginBottom:6}}>Delete Message?</div>
            <div style={{fontSize:11,color:'#777',lineHeight:1.7,marginBottom:20}}>This message will be removed for both you and the recipient. This action cannot be undone.</div>
            <div style={{display:'flex',gap:8,justifyContent:'center'}}>
              <button onClick={()=>setDeleteMsgId(null)} style={{background:'transparent',color:'#555',border:'1.5px solid rgba(255,255,255,0.1)',borderRadius:50,padding:'9px 22px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Cancel</button>
              <button onClick={()=>deleteMessage(deleteMsgId)} style={{background:'linear-gradient(135deg,#e84a2f,#c93820)',color:'#fff',border:'none',borderRadius:50,padding:'9px 22px',fontSize:12,fontWeight:700,cursor:'pointer'}}>Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

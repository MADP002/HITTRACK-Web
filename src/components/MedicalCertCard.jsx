// Shared medical-certificate display for coach/admin member views.
// Reads from the existing users/{uid}.medicalCert nested field — no new
// Firestore reads, no rules change (users/{uid} is auth-readable per
// firestore.rules:9-10). The mobile app at medical-certificate.jsx writes
// the cert as a base64 data URI directly into Firestore.
//
// Privacy: status is always visible (so coaches see at-a-glance whether
// a member with declared injuries has cleared medical), but the cert
// image stays behind a "View Certificate" click — coach has to actively
// open it, no medical info on screen by default.

import { useState } from 'react'

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate ? ts.toDate() : (ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts))
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function MedicalCertCard({ member }) {
  const [viewing, setViewing] = useState(false)

  const cert = member?.medicalCert
  const injury = (member?.injuries || '').trim()
  const hasInjury = !!injury && injury.toLowerCase() !== 'none' && injury !== '—'
  const hasCert = !!cert?.submitted && !!cert?.base64
  const isImage = cert?.fileType?.startsWith('image/')
  const isPdf = cert?.fileType === 'application/pdf'

  // ── STATE 1: No injury declared ─────────────────────────────────
  if (!hasInjury) {
    return (
      <div style={{position:'relative',overflow:'hidden',borderRadius:14,background:'rgba(74,222,128,0.12)',border:'1.5px solid rgba(74,222,128,0.5)',boxShadow:'0 4px 16px var(--t-sh-sm)',flexShrink:0,width:'100%',boxSizing:'border-box'}}>
        <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#4ade80,#22c55e)'}}/>
        <div style={{padding:'16px 20px 16px 24px',display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:40,height:40,borderRadius:10,background:'rgba(74,222,128,0.25)',border:'1px solid rgba(74,222,128,0.6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>✅</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:800,color:'var(--a-green2)',marginBottom:5,letterSpacing:'0.02em',lineHeight:1.3}}>Medical Clearance · No injury declared</div>
            <div style={{fontSize:12,color:'var(--t-text)',lineHeight:1.6}}>This member is cleared to train — no medical certificate required.</div>
          </div>
        </div>
      </div>
    )
  }

  // ── STATE 2: Injury declared, no cert submitted ─────────────────
  if (!hasCert) {
    return (
      <div style={{position:'relative',overflow:'hidden',borderRadius:14,background:'rgba(245,200,66,0.14)',border:'1.5px solid rgba(245,200,66,0.55)',boxShadow:'0 4px 16px var(--t-sh-sm)',flexShrink:0,width:'100%',boxSizing:'border-box'}}>
        <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#f5c842,#e08820)'}}/>
        <div style={{padding:'16px 20px 16px 24px',display:'flex',alignItems:'center',gap:14}}>
          <div style={{width:40,height:40,borderRadius:10,background:'rgba(245,200,66,0.3)',border:'1px solid rgba(245,200,66,0.6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>⚠</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:800,color:'var(--a-gold)',letterSpacing:'0.04em',marginBottom:5}}>Awaiting medical certificate</div>
            <div style={{fontSize:12,color:'var(--t-text)',lineHeight:1.6}}>
              Member declared an injury: <strong style={{color:'#fff'}}>{injury}</strong>. They must submit a medical certificate from the mobile app before training is cleared.
            </div>
          </div>
        </div>
      </div>
    )
  }

  // ── STATE 3: Injury declared + cert submitted ───────────────────
  return (
    <>
      <div style={{position:'relative',overflow:'hidden',borderRadius:14,background:'rgba(74,222,128,0.12)',border:'1.5px solid rgba(74,222,128,0.5)',boxShadow:'0 4px 16px var(--t-sh-sm)',flexShrink:0,width:'100%',boxSizing:'border-box'}}>
        <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#4ade80,#22c55e)'}}/>
        <div style={{padding:'16px 20px 16px 24px',display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
          <div style={{width:40,height:40,borderRadius:10,background:'rgba(74,222,128,0.25)',border:'1px solid rgba(74,222,128,0.6)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:20,flexShrink:0}}>🏥</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:4}}>
              <span style={{fontSize:13,fontWeight:800,color:'var(--a-green2)',letterSpacing:'0.04em'}}>Medical Certificate</span>
              <span style={{fontSize:9,fontWeight:800,padding:'2px 8px',borderRadius:50,background:isPdf?'rgba(66,165,245,0.25)':'rgba(192,132,252,0.25)',color:isPdf?'#42a5f5':'#c084fc',border:`1px solid ${isPdf?'rgba(66,165,245,0.5)':'rgba(192,132,252,0.5)'}`,letterSpacing:'0.12em'}}>
                {isPdf ? 'PDF' : isImage ? 'IMAGE' : 'FILE'}
              </span>
            </div>
            <div style={{fontSize:12,color:'var(--t-text)',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>
              {cert.fileName || 'certificate'}
            </div>
            <div style={{fontSize:10,color:'var(--t-dim1)'}}>
              Injury: <span style={{color:'#fff',fontWeight:600}}>{injury}</span> · Submitted {fmtDate(cert.submittedAt)}
            </div>
          </div>
          <button onClick={()=>setViewing(true)}
            style={{background:'rgba(74,222,128,0.25)',color:'#fff',border:'1.5px solid rgba(74,222,128,0.6)',borderRadius:50,padding:'9px 16px',fontSize:11,fontWeight:800,cursor:'pointer',letterSpacing:'0.08em',whiteSpace:'nowrap',boxShadow:'0 2px 8px rgba(74,222,128,0.25)'}}
            onMouseEnter={e=>{e.currentTarget.style.background='rgba(74,222,128,0.4)';e.currentTarget.style.transform='translateY(-1px)'}}
            onMouseLeave={e=>{e.currentTarget.style.background='rgba(74,222,128,0.25)';e.currentTarget.style.transform='translateY(0)'}}>
            👁 VIEW CERTIFICATE
          </button>
        </div>
      </div>

      {viewing && (
        <div onClick={()=>setViewing(false)}
          style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.9)',backdropFilter:'blur(10px)',zIndex:2200,display:'flex',alignItems:'center',justifyContent:'center',padding:20}}>
          <div onClick={e=>e.stopPropagation()}
            style={{position:'relative',background:'linear-gradient(135deg,var(--t-card) 0%,var(--t-card2) 100%)',borderRadius:18,border:'1px solid rgba(74,222,128,0.4)',maxWidth:720,width:'100%',maxHeight:'90vh',display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 24px 60px var(--t-sh-lg)'}}>
            <div style={{position:'absolute',left:0,top:0,bottom:0,width:5,background:'linear-gradient(180deg,#4ade80,#22c55e)'}}/>

            {/* Header — fixed */}
            <div style={{padding:'16px 22px',borderBottom:'1px solid rgba(74,222,128,0.18)',background:'linear-gradient(135deg,rgba(74,222,128,0.08) 0%,transparent 60%)',display:'flex',alignItems:'center',gap:12,flexShrink:0}}>
              <div style={{width:38,height:38,borderRadius:10,background:'rgba(74,222,128,0.18)',border:'1px solid rgba(74,222,128,0.4)',display:'flex',alignItems:'center',justifyContent:'center',fontSize:18}}>🏥</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:18,letterSpacing:'0.06em',color:'var(--t-text)'}}>MEDICAL CERTIFICATE</div>
                <div style={{fontSize:10,color:'var(--t-dim2)',marginTop:2,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>
                  {member?.name || 'Member'} · {cert.fileName || 'certificate'} · Submitted {fmtDate(cert.submittedAt)}
                </div>
              </div>
              <button onClick={()=>setViewing(false)}
                style={{width:32,height:32,background:'var(--t-s05)',border:'1px solid var(--t-s10)',borderRadius:9,color:'var(--t-dim2)',fontSize:16,cursor:'pointer'}}>✕</button>
            </div>

            {/* Body — scrollable */}
            <div style={{flex:1,minHeight:0,overflowY:'auto',padding:'20px',background:'var(--t-card2)'}}>
              {isImage ? (
                <img src={cert.base64} alt="Medical certificate"
                  style={{display:'block',maxWidth:'100%',maxHeight:'72vh',margin:'0 auto',borderRadius:10,border:'1px solid var(--t-s08)',background:'#fff'}}/>
              ) : isPdf ? (
                <div style={{textAlign:'center',padding:'40px 20px',display:'flex',flexDirection:'column',alignItems:'center',gap:14}}>
                  <div style={{fontSize:56}}>📄</div>
                  <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:20,letterSpacing:'0.04em',color:'var(--t-text)'}}>PDF CERTIFICATE</div>
                  <div style={{fontSize:12,color:'var(--t-dim2)',maxWidth:380,lineHeight:1.6}}>
                    Browser security blocks inline preview for data-URI PDFs. Download to view in your PDF reader.
                  </div>
                  <a href={cert.base64} download={cert.fileName || 'medical-certificate.pdf'}
                    style={{marginTop:6,background:'linear-gradient(135deg,#4ade80,#22c55e)',color:'#000',border:'none',borderRadius:50,padding:'12px 28px',fontSize:13,fontWeight:800,letterSpacing:'0.06em',textDecoration:'none',cursor:'pointer',boxShadow:'0 6px 20px rgba(74,222,128,0.3)'}}>
                    ⬇ DOWNLOAD PDF
                  </a>
                </div>
              ) : (
                <div style={{textAlign:'center',padding:'40px 20px',color:'var(--t-dim2)',fontSize:12}}>
                  Unsupported file type ({cert.fileType || 'unknown'}).
                  <div style={{marginTop:14}}>
                    <a href={cert.base64} download={cert.fileName || 'certificate'}
                      style={{color:'var(--a-blue)',textDecoration:'underline',fontSize:12}}>
                      Download original file
                    </a>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  )
}

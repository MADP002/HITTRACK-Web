// Shared medical-certificate UPLOAD component for member-facing pages.
// Used by Profile.jsx and ProgramBuilder.jsx StepBody.
//
// Writes the EXACT same shape mobile writes at HITTRACK-App-main/app/(member)/
// medical-certificate.jsx:100-108 — { submitted, base64, fileName, fileType,
// submittedAt } nested under users/{uid}.medicalCert. Issue #6 MedicalCertCard
// reads the same field on the coach/admin side, so all three surfaces stay
// compatible.
//
// Size cap rationale: Firestore caps a single doc at 1 MiB. Base64 inflates
// raw bytes by ~33%, plus a "data:image/...;base64," prefix and other fields
// on users/{uid}. 600 KB raw → ~800 KB base64 → comfortably under the cap.

import { useRef, useState } from 'react'
import { auth, db } from '../firebase'
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore'

const MAX_BYTES = 600 * 1024        // 600 KB raw
const ACCEPTED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'application/pdf']

function fmtBytes(n) {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(2)} MB`
}

function fmtDate(ts) {
  if (!ts) return '—'
  const d = ts?.toDate ? ts.toDate() : (ts?.seconds ? new Date(ts.seconds * 1000) : new Date(ts))
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

function fileToDataUri(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = () => resolve(reader.result)
    reader.onerror = () => reject(new Error('Failed to read file'))
    reader.readAsDataURL(file)
  })
}

export default function MedicalCertUpload({ member, onUploaded }) {
  const fileInputRef = useRef(null)
  const [picked, setPicked] = useState(null)         // { file, preview, isPdf }
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [replacing, setReplacing] = useState(false)  // existing cert + user clicked Replace
  const [justUploaded, setJustUploaded] = useState(false)

  const existing = member?.medicalCert
  const hasExisting = !!existing?.submitted && !!existing?.base64
  const showExistingPanel = hasExisting && !replacing && !picked && !justUploaded

  function openPicker(accept) {
    setError('')
    if (fileInputRef.current) {
      fileInputRef.current.value = ''      // allow re-pick of the same file
      fileInputRef.current.accept = accept
      fileInputRef.current.click()
    }
  }

  function handleFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setError('')
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setError(`Unsupported file type (${file.type || 'unknown'}). Use JPG, PNG, WEBP, GIF, or PDF.`)
      return
    }
    if (file.size > MAX_BYTES) {
      setError(`File is ${fmtBytes(file.size)} — must be under ${fmtBytes(MAX_BYTES)}. Compress the image or use a smaller PDF (Firestore document size limit).`)
      return
    }
    const isPdf = file.type === 'application/pdf'
    const preview = isPdf ? null : URL.createObjectURL(file)
    setPicked({ file, preview, isPdf })
  }

  function clearPick() {
    if (picked?.preview) URL.revokeObjectURL(picked.preview)
    setPicked(null)
    setError('')
  }

  async function submit() {
    if (!picked) return
    const user = auth.currentUser
    if (!user) { setError('Not signed in.'); return }
    setUploading(true)
    setError('')
    try {
      const base64 = await fileToDataUri(picked.file)
      const cert = {
        submitted:   true,
        base64,
        fileName:    picked.file.name,
        fileType:    picked.file.type,
        submittedAt: serverTimestamp(),
      }
      await updateDoc(doc(db, 'users', user.uid), { medicalCert: cert })
      // Hand back a parent-friendly shape — replace serverTimestamp with a Date
      // so the parent's local state shows the cert immediately (Firestore will
      // overwrite with the real timestamp on next read).
      onUploaded?.({ ...cert, submittedAt: new Date() })
      clearPick()
      setReplacing(false)
      setJustUploaded(true)
    } catch (e) {
      console.warn('Cert upload failed:', e.message)
      setError('Upload failed. Please try again.')
    } finally {
      setUploading(false)
    }
  }

  // ── EXISTING CERT PANEL — first thing the member sees if they've already submitted ──
  if (showExistingPanel) {
    const isPdf = existing.fileType === 'application/pdf'
    return (
      <div style={cardOuter('rgba(74,222,128,0.5)', 'rgba(74,222,128,0.12)')}>
        <div style={stripe('#4ade80', '#22c55e')}/>
        <div style={{padding:'18px 22px 18px 26px',display:'flex',flexDirection:'column',gap:14}}>
          <div style={{display:'flex',alignItems:'center',gap:14,flexWrap:'wrap'}}>
            <div style={iconTile('rgba(74,222,128,0.25)','rgba(74,222,128,0.6)')}>🏥</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:'flex',alignItems:'center',gap:6,flexWrap:'wrap',marginBottom:4}}>
                <span style={{fontSize:13,fontWeight:800,color:'var(--a-green2)',letterSpacing:'0.04em'}}>Medical Certificate on file</span>
                <span style={typePill(isPdf)}>{isPdf ? 'PDF' : 'IMAGE'}</span>
              </div>
              <div style={{fontSize:12,color:'var(--t-text)',fontWeight:600,overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap',marginBottom:2}}>
                {existing.fileName || 'certificate'}
              </div>
              <div style={{fontSize:10,color:'var(--t-dim1)'}}>
                Submitted {fmtDate(existing.submittedAt)}
              </div>
            </div>
            <button onClick={()=>setReplacing(true)}
              style={replaceBtnStyle}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(232,74,47,0.3)'}}
              onMouseLeave={e=>{e.currentTarget.style.background='rgba(232,74,47,0.18)'}}>
              📤 REPLACE CERTIFICATE
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── UPLOAD PANEL — initial or post-Replace state ───────────────────────────────────
  return (
    <div style={cardOuter('rgba(66,165,245,0.4)', 'rgba(66,165,245,0.08)')}>
      <div style={stripe('#42a5f5', '#1e6db8')}/>
      <div style={{padding:'18px 22px 18px 26px',display:'flex',flexDirection:'column',gap:14}}>

        <div style={{display:'flex',alignItems:'center',gap:14}}>
          <div style={iconTile('rgba(66,165,245,0.25)','rgba(66,165,245,0.6)')}>🏥</div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:800,color:'var(--a-blue)',letterSpacing:'0.04em',marginBottom:3}}>
              {replacing ? 'Replace Medical Certificate' : (justUploaded ? 'Certificate Uploaded' : 'Upload Medical Certificate')}
            </div>
            <div style={{fontSize:11,color:'#cdd5dc',lineHeight:1.55}}>
              {justUploaded
                ? 'Your certificate has been saved. Your coach and admin can now view it.'
                : 'Optional unless you\'ve declared an injury. Coaches can view this to verify medical clearance before training.'}
            </div>
          </div>
        </div>

        {error && (
          <div style={{padding:'10px 14px',background:'rgba(232,74,47,0.14)',border:'1.5px solid rgba(232,74,47,0.5)',borderRadius:10,fontSize:11,color:'#fff',lineHeight:1.5}}>
            ⚠ {error}
          </div>
        )}

        {/* Hidden picker — opened by the buttons below */}
        <input ref={fileInputRef} type="file" onChange={handleFile} style={{display:'none'}}/>

        {/* ── STATE: file picked, awaiting submit ─────────────────────────── */}
        {picked && !uploading && (
          <div style={{display:'flex',flexDirection:'column',gap:12}}>
            {picked.preview ? (
              <div style={{position:'relative',borderRadius:12,overflow:'hidden',border:'1px solid var(--t-s08)',background:'#fff'}}>
                <img src={picked.preview} alt="Preview" style={{display:'block',width:'100%',maxHeight:280,objectFit:'contain',background:'#fff'}}/>
                <button onClick={clearPick} title="Remove"
                  style={{position:'absolute',top:8,right:8,width:28,height:28,borderRadius:'50%',background:'rgba(0,0,0,0.7)',border:'1px solid var(--t-s20)',color:'#fff',fontSize:14,cursor:'pointer',display:'flex',alignItems:'center',justifyContent:'center'}}>✕</button>
              </div>
            ) : (
              <div style={{display:'flex',alignItems:'center',gap:12,padding:'12px 14px',background:'rgba(192,132,252,0.1)',border:'1px solid rgba(192,132,252,0.4)',borderRadius:12}}>
                <span style={{fontSize:24}}>📄</span>
                <div style={{flex:1,minWidth:0}}>
                  <div style={{fontSize:12,fontWeight:700,color:'var(--t-text)',overflow:'hidden',textOverflow:'ellipsis',whiteSpace:'nowrap'}}>{picked.file.name}</div>
                  <div style={{fontSize:10,color:'var(--t-dim1)',marginTop:2}}>PDF · {fmtBytes(picked.file.size)}</div>
                </div>
                <button onClick={clearPick} title="Remove"
                  style={{width:28,height:28,borderRadius:'50%',background:'rgba(232,74,47,0.15)',border:'1px solid rgba(232,74,47,0.4)',color:'var(--a-red)',fontSize:14,cursor:'pointer'}}>✕</button>
              </div>
            )}

            {picked.preview && (
              <div style={{fontSize:10,color:'var(--t-dim2)',display:'flex',justifyContent:'space-between'}}>
                <span>{picked.file.name}</span>
                <span>{fmtBytes(picked.file.size)}</span>
              </div>
            )}

            <div style={{display:'flex',gap:10}}>
              <button onClick={clearPick}
                style={cancelBtnStyle}>
                Cancel
              </button>
              <button onClick={submit}
                style={submitBtnStyle}
                onMouseEnter={e=>{e.currentTarget.style.background='linear-gradient(135deg,#5fbcfa,#42a5f5)'}}
                onMouseLeave={e=>{e.currentTarget.style.background='linear-gradient(135deg,#42a5f5,#1e6db8)'}}>
                ☁ Submit Certificate
              </button>
            </div>
          </div>
        )}

        {/* ── STATE: uploading ─────────────────────────────────────────────── */}
        {uploading && (
          <div style={{display:'flex',alignItems:'center',gap:12,padding:'14px 16px',background:'rgba(66,165,245,0.12)',border:'1px solid rgba(66,165,245,0.4)',borderRadius:12}}>
            <div style={{width:18,height:18,borderRadius:'50%',border:'2px solid rgba(66,165,245,0.3)',borderTopColor:'#42a5f5',animation:'spin 0.8s linear infinite'}}/>
            <div>
              <div style={{fontSize:12,fontWeight:700,color:'var(--a-blue)'}}>Uploading…</div>
              <div style={{fontSize:10,color:'var(--t-dim1)',marginTop:2}}>Do not close this tab.</div>
            </div>
            <style>{`@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}`}</style>
          </div>
        )}

        {/* ── STATE: no file picked — show picker buttons ──────────────────── */}
        {!picked && !uploading && (
          <div style={{display:'grid',gridTemplateColumns:'1fr 1fr',gap:10}}>
            <button onClick={()=>openPicker('image/*')}
              style={pickerBtnStyle('#f5c842')}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(245,200,66,0.18)';e.currentTarget.style.transform='translateY(-1px)'}}
              onMouseLeave={e=>{e.currentTarget.style.background='rgba(245,200,66,0.08)';e.currentTarget.style.transform='translateY(0)'}}>
              <div style={{fontSize:24}}>📷</div>
              <div style={{fontSize:12,fontWeight:800,color:'var(--a-gold)',letterSpacing:'0.04em',marginTop:6}}>Image</div>
              <div style={{fontSize:9,color:'var(--t-dim2)',marginTop:2}}>JPG · PNG · WEBP</div>
            </button>
            <button onClick={()=>openPicker('application/pdf')}
              style={pickerBtnStyle('#c084fc')}
              onMouseEnter={e=>{e.currentTarget.style.background='rgba(192,132,252,0.18)';e.currentTarget.style.transform='translateY(-1px)'}}
              onMouseLeave={e=>{e.currentTarget.style.background='rgba(192,132,252,0.08)';e.currentTarget.style.transform='translateY(0)'}}>
              <div style={{fontSize:24}}>📄</div>
              <div style={{fontSize:12,fontWeight:800,color:'var(--a-purple)',letterSpacing:'0.04em',marginTop:6}}>PDF</div>
              <div style={{fontSize:9,color:'var(--t-dim2)',marginTop:2}}>Document</div>
            </button>
          </div>
        )}

        {/* Replacing — give a way back if member changes their mind */}
        {replacing && !picked && !uploading && (
          <button onClick={()=>setReplacing(false)}
            style={{background:'transparent',color:'var(--t-dim2)',border:'none',fontSize:11,fontWeight:600,cursor:'pointer',alignSelf:'center',marginTop:-4,textDecoration:'underline'}}>
            ← Keep existing certificate
          </button>
        )}

        <div style={{fontSize:9,color:'var(--t-dim3)',textAlign:'center'}}>
          Max file size: {fmtBytes(MAX_BYTES)} · Stored securely in Firestore
        </div>
      </div>
    </div>
  )
}

// ── shared styles ──────────────────────────────────────────────────────────
const cardOuter = (borderColor, bg) => ({
  position:'relative', overflow:'hidden', borderRadius:14,
  background: bg, border:`1.5px solid ${borderColor}`,
  boxShadow:'0 4px 16px var(--t-sh-sm)',
})

const stripe = (a, b) => ({
  position:'absolute', left:0, top:0, bottom:0, width:5,
  background:`linear-gradient(180deg,${a},${b})`,
})

const iconTile = (bg, border) => ({
  width:42, height:42, borderRadius:11,
  background: bg, border:`1px solid ${border}`,
  display:'flex', alignItems:'center', justifyContent:'center',
  fontSize:20, flexShrink:0,
})

const typePill = (isPdf) => ({
  fontSize:9, fontWeight:800, padding:'2px 8px', borderRadius:50,
  background: isPdf ? 'rgba(66,165,245,0.25)' : 'rgba(192,132,252,0.25)',
  color: isPdf ? '#42a5f5' : '#c084fc',
  border: `1px solid ${isPdf ? 'rgba(66,165,245,0.5)' : 'rgba(192,132,252,0.5)'}`,
  letterSpacing:'0.12em',
})

const replaceBtnStyle = {
  background:'rgba(232,74,47,0.18)', color:'#fff',
  border:'1.5px solid rgba(232,74,47,0.5)', borderRadius:50,
  padding:'9px 16px', fontSize:11, fontWeight:800,
  cursor:'pointer', letterSpacing:'0.08em', whiteSpace:'nowrap',
  boxShadow:'0 2px 8px rgba(232,74,47,0.2)',
  transition:'background 0.2s',
}

const pickerBtnStyle = (color) => ({
  background: `rgba(${color === '#f5c842' ? '245,200,66' : '192,132,252'},0.08)`,
  border:`1.5px dashed ${color}55`, borderRadius:14, padding:'18px 14px',
  cursor:'pointer', textAlign:'center',
  transition:'all 0.2s',
})

const cancelBtnStyle = {
  background:'var(--t-s04)', color:'var(--t-dim1)',
  border:'1px solid var(--t-s10)', borderRadius:50,
  padding:'10px 20px', fontSize:12, fontWeight:700, cursor:'pointer',
  flex:'0 0 auto',
}

const submitBtnStyle = {
  background:'linear-gradient(135deg,#42a5f5,#1e6db8)', color:'#fff',
  border:'none', borderRadius:50, padding:'10px 24px',
  fontSize:12, fontWeight:800, cursor:'pointer', letterSpacing:'0.08em',
  flex:'1 1 auto', boxShadow:'0 4px 14px rgba(66,165,245,0.35)',
  transition:'background 0.2s',
}

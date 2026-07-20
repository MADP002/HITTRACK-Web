import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { collection, addDoc, doc, updateDoc, deleteDoc, onSnapshot, serverTimestamp, arrayUnion, arrayRemove } from 'firebase/firestore'
import { auth, db } from '../firebase'
import Navbar from '../components/Navbar'

function useCanvasBg(canvasRef) {
  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return
    const ctx = canvas.getContext('2d'); let animId, t = 0
    const resize = () => { canvas.width = canvas.offsetWidth; canvas.height = canvas.offsetHeight }
    resize(); window.addEventListener('resize', resize)
    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height); t += 0.005
      ctx.strokeStyle = 'rgba(245,200,66,0.025)'; ctx.lineWidth = 1
      const g = 80
      for (let x = 0; x < canvas.width + g; x += g) { const o = (t * 15) % g; ctx.beginPath(); ctx.moveTo(x - o, 0); ctx.lineTo(x - o, canvas.height); ctx.stroke() }
      for (let y = 0; y < canvas.height + g; y += g) { const o = (t * 8) % g; ctx.beginPath(); ctx.moveTo(0, y - o); ctx.lineTo(canvas.width, y - o); ctx.stroke() }
      const orbs = [
        { x: canvas.width * 0.1, y: canvas.height * 0.15, r: 280, c: 'rgba(232,74,47,0.04)' },
        { x: canvas.width * 0.9, y: canvas.height * 0.4, r: 320, c: 'rgba(245,200,66,0.03)' },
        { x: canvas.width * 0.5, y: canvas.height * 0.85, r: 250, c: 'rgba(192,132,252,0.025)' },
      ]
      orbs.forEach(o => {
        const grd = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r)
        grd.addColorStop(0, o.c); grd.addColorStop(1, 'transparent')
        ctx.fillStyle = grd; ctx.beginPath(); ctx.arc(o.x, o.y, o.r, 0, Math.PI * 2); ctx.fill()
      })
      animId = requestAnimationFrame(draw)
    }
    draw()
    return () => { cancelAnimationFrame(animId); window.removeEventListener('resize', resize) }
  }, [canvasRef])
}

const ROLE_BADGE = { admin: { bg: 'rgba(192,132,252,0.15)', color: '#c084fc', border: 'rgba(192,132,252,0.3)', label: 'ADMIN', icon: '👑' }, coach: { bg: 'rgba(66,165,245,0.15)', color: '#42a5f5', border: 'rgba(66,165,245,0.3)', label: 'COACH', icon: '🥊' } }
const CATEGORIES = ['General', 'Training', 'Nutrition', 'Equipment', 'Events', 'Other']
const CAT_COLORS = { General: '#f5c842', Training: '#e84a2f', Nutrition: '#22c55e', Equipment: '#42a5f5', Events: '#c084fc', Other: 'var(--t-dim2)' }
const CAT_ICONS = { General: '💬', Training: '🏋️', Nutrition: '🥗', Equipment: '🥊', Events: '📅', Other: '💡' }

function timeAgo(ts) {
  if (!ts) return ''
  const d = ts.toDate ? ts.toDate() : new Date(ts.seconds * 1000)
  const s = Math.floor((Date.now() - d) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return Math.floor(s / 60) + 'm ago'
  if (s < 86400) return Math.floor(s / 3600) + 'h ago'
  if (s < 604800) return Math.floor(s / 86400) + 'd ago'
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function getInitials(name) {
  return (name || '?').split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)
}

function getAvatarColor(name) {
  const colors = ['#e84a2f', '#f5c842', '#42a5f5', '#22c55e', '#c084fc', '#f472b6', '#fb923c', '#06b6d4']
  let hash = 0
  for (let i = 0; i < (name || '').length; i++) hash = name.charCodeAt(i) + ((hash << 5) - hash)
  return colors[Math.abs(hash) % colors.length]
}

export default function Forum({ embedded = false, currentRole = 'member' }) {
  const navigate = useNavigate()
  const me = auth.currentUser
  const [profile, setProfile] = useState({})
  const [posts, setPosts] = useState([])
  const [activePost, setActivePost] = useState(null)
  const [newTitle, setNewTitle] = useState('')
  const [newBody, setNewBody] = useState('')
  const [newCategory, setNewCategory] = useState('General')
  const [showNewPost, setShowNewPost] = useState(false)
  const [replyText, setReplyText] = useState('')
  const [posting, setPosting] = useState(false)
  const [replying, setReplying] = useState(false)
  const [filterCat, setFilterCat] = useState('All')
  const [searchQ, setSearchQ] = useState('')
  const [toast, setToast] = useState({ msg: '', type: 'success' })
  const replyEndRef = useRef(null)
  const canvasRef = useRef(null)
  useCanvasBg(canvasRef)

  function showToast(msg, type = 'success') { setToast({ msg, type }); setTimeout(() => setToast({ msg: '', type: 'success' }), 3000) }

  useEffect(() => {
    try { const p = JSON.parse(localStorage.getItem('hittrack_profile') || '{}'); setProfile(p) } catch { }
  }, [])

  const role = currentRole || profile.role || 'member'

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'forum'), (snap) => {
      const items = snap.docs.map(d => ({ id: d.id, ...d.data() }))
      items.sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
      setPosts(items)
    }, (e) => console.error('Forum listener:', e))
    return () => unsub()
  }, [])

  useEffect(() => {
    if (activePost) {
      const fresh = posts.find(p => p.id === activePost.id)
      if (fresh) setActivePost(fresh)
    }
  }, [posts])

  const filtered = posts.filter(p => {
    if (filterCat !== 'All' && p.category !== filterCat) return false
    if (searchQ.trim()) {
      const q = searchQ.toLowerCase()
      return (p.title || '').toLowerCase().includes(q) || (p.body || '').toLowerCase().includes(q) || (p.authorName || '').toLowerCase().includes(q)
    }
    return true
  })

  async function createPost() {
    if (!newTitle.trim()) { showToast('Enter a title', 'error'); return }
    if (!newBody.trim()) { showToast('Enter your question or topic', 'error'); return }
    if (!me) return
    setPosting(true)
    try {
      await addDoc(collection(db, 'forum'), {
        title: newTitle.trim(),
        body: newBody.trim(),
        category: newCategory,
        authorUid: me.uid,
        authorName: profile.name || 'Member',
        authorRole: role,
        replies: [],
        likes: [],
        createdAt: serverTimestamp(),
      })
      setNewTitle(''); setNewBody(''); setNewCategory('General'); setShowNewPost(false)
      showToast('Post published!')
    } catch (e) {
      showToast('Failed: ' + (e.message || 'unknown'), 'error')
    } finally { setPosting(false) }
  }

  async function postReply() {
    if (!replyText.trim() || !activePost || !me) return
    setReplying(true)
    try {
      const reply = {
        id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
        text: replyText.trim(),
        authorUid: me.uid,
        authorName: profile.name || (role === 'coach' ? 'Coach' : 'Member'),
        authorRole: role,
        createdAt: new Date().toISOString(),
      }
      await updateDoc(doc(db, 'forum', activePost.id), { replies: arrayUnion(reply) })
      setReplyText('')
      showToast(role === 'coach' || role === 'admin' ? 'Answer posted!' : 'Reply posted!')
      setTimeout(() => replyEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 200)
    } catch (e) {
      showToast('Failed: ' + (e.message || 'unknown'), 'error')
    } finally { setReplying(false) }
  }

  async function toggleLike(postId, e) {
    e?.stopPropagation()
    if (!me) return
    const p = posts.find(x => x.id === postId)
    if (!p) return
    const liked = (p.likes || []).includes(me.uid)
    try {
      await updateDoc(doc(db, 'forum', postId), { likes: liked ? arrayRemove(me.uid) : arrayUnion(me.uid) })
    } catch (e) { console.error('Like toggle:', e) }
  }

  async function deletePost(postId) {
    try {
      await deleteDoc(doc(db, 'forum', postId))
      if (activePost?.id === postId) setActivePost(null)
      showToast('Post deleted')
    } catch (e) { showToast('Failed', 'error') }
  }

  async function deleteReply(postId, replyObj) {
    try {
      await updateDoc(doc(db, 'forum', postId), { replies: arrayRemove(replyObj) })
      showToast('Reply removed')
    } catch (e) { showToast('Failed', 'error') }
  }

  const canDelete = (item) => me && (item.authorUid === me.uid || role === 'admin' || role === 'coach')

  const inp = { background: 'var(--t-s04)', border: '1px solid var(--t-s10)', borderRadius: 12, padding: '12px 16px', color: 'var(--t-text)', fontSize: 13, fontFamily: 'Montserrat,sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box', transition: 'all 0.3s' }

  const forumContent = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {toast.msg && (
        <div style={{ position: 'fixed', top: 24, left: '50%', transform: 'translateX(-50%)', zIndex: 3000, background: toast.type === 'error' ? 'rgba(232,74,47,0.95)' : 'rgba(34,197,94,0.95)', borderRadius: 14, padding: '14px 28px', fontSize: 13, fontWeight: 700, color: '#fff', backdropFilter: 'blur(20px)', boxShadow: toast.type === 'error' ? '0 8px 32px rgba(232,74,47,0.4)' : '0 8px 32px rgba(34,197,94,0.4)', animation: 'slideDown 0.4s cubic-bezier(0.34,1.56,0.64,1)' }}>
          {toast.msg}
        </div>
      )}

      {/* Hero Header */}
      <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 24, background: 'linear-gradient(135deg,var(--t-card) 0%,var(--t-card2) 60%,rgba(232,74,47,0.08) 100%)', border: '1px solid rgba(232,74,47,0.12)', padding: '28px 30px', boxShadow: '0 16px 60px rgba(0,0,0,0.5)' }}>
        <div style={{ position: 'absolute', top: -40, right: -40, width: 160, height: 160, borderRadius: '50%', background: 'radial-gradient(circle,rgba(232,74,47,0.08) 0%,transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: -30, left: '40%', width: 120, height: 120, borderRadius: '50%', background: 'radial-gradient(circle,rgba(245,200,66,0.06) 0%,transparent 70%)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: 'linear-gradient(180deg,#e84a2f,#f5c842,#e84a2f)', borderRadius: '24px 0 0 24px' }} />

        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 14, position: 'relative', zIndex: 1 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 4 }}>
              <div style={{ width: 40, height: 40, borderRadius: 12, background: 'linear-gradient(135deg,#e84a2f,#f5c842)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, boxShadow: '0 6px 20px rgba(232,74,47,0.4)' }}>💬</div>
              <div>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, letterSpacing: '0.06em', color: 'var(--t-text)', lineHeight: 1 }}>COMMUNITY FORUM</div>
                <div style={{ fontSize: 10, color: 'var(--t-dim3)', letterSpacing: '0.08em', fontWeight: 600, marginTop: 2 }}>ASK QUESTIONS • SHARE KNOWLEDGE • CONNECT</div>
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ textAlign: 'center', background: 'var(--t-s03)', border: '1px solid var(--t-s06)', borderRadius: 12, padding: '8px 16px' }}>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, color: 'var(--a-gold)' }}>{posts.length}</div>
                <div style={{ fontSize: 8, color: 'var(--t-dim3)', fontWeight: 700, letterSpacing: '0.1em' }}>POSTS</div>
              </div>
              <div style={{ textAlign: 'center', background: 'var(--t-s03)', border: '1px solid var(--t-s06)', borderRadius: 12, padding: '8px 16px' }}>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, color: 'var(--a-blue)' }}>{posts.reduce((a, p) => a + (p.replies || []).length, 0)}</div>
                <div style={{ fontSize: 8, color: 'var(--t-dim3)', fontWeight: 700, letterSpacing: '0.1em' }}>REPLIES</div>
              </div>
            </div>
            <button onClick={() => { setShowNewPost(v => !v); setActivePost(null) }}
              style={{ background: showNewPost ? 'var(--t-s06)' : 'linear-gradient(135deg,#e84a2f,#c93820)', color: showNewPost ? 'var(--t-dim2)' : '#fff', border: showNewPost ? '1px solid var(--t-s10)' : 'none', borderRadius: 14, padding: '14px 28px', fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', cursor: 'pointer', boxShadow: showNewPost ? 'none' : '0 8px 28px rgba(232,74,47,0.5)', transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)' }}
              onMouseEnter={e => { if (!showNewPost) { e.currentTarget.style.transform = 'translateY(-3px) scale(1.03)'; e.currentTarget.style.boxShadow = '0 12px 36px rgba(232,74,47,0.6)' } }}
              onMouseLeave={e => { if (!showNewPost) { e.currentTarget.style.transform = 'translateY(0) scale(1)'; e.currentTarget.style.boxShadow = '0 8px 28px rgba(232,74,47,0.5)' } }}>
              {showNewPost ? '✕ CANCEL' : '+ NEW POST'}
            </button>
          </div>
        </div>
      </div>

      {/* Search & Filters */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
          <span style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--t-dim3)', pointerEvents: 'none' }}>🔍</span>
          <input placeholder="Search posts, topics, or authors…" value={searchQ} onChange={e => setSearchQ(e.target.value)}
            style={{ ...inp, paddingLeft: 38, borderRadius: 14, background: 'var(--t-veil1)', border: '1px solid var(--t-s08)' }}
            onFocus={e => { e.target.style.borderColor = 'rgba(245,200,66,0.4)'; e.target.style.boxShadow = '0 0 0 4px rgba(245,200,66,0.06)'; e.target.style.background = 'var(--t-card2)' }}
            onBlur={e => { e.target.style.borderColor = 'var(--t-s08)'; e.target.style.boxShadow = 'none'; e.target.style.background = 'var(--t-veil1)' }} />
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {['All', ...CATEGORIES].map(c => {
            const active = filterCat === c
            const cc = c === 'All' ? '#f5c842' : (CAT_COLORS[c] || 'var(--t-dim2)')
            const icon = c === 'All' ? '🔥' : CAT_ICONS[c]
            return (
              <button key={c} onClick={() => setFilterCat(c)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, background: active ? `${cc}18` : 'var(--t-s02)', color: active ? cc : 'var(--t-dim3)', border: active ? `1.5px solid ${cc}55` : '1px solid var(--t-s06)', borderRadius: 12, padding: '8px 14px', fontSize: 10, fontWeight: 700, cursor: 'pointer', transition: 'all 0.25s', boxShadow: active ? `0 4px 16px ${cc}22` : 'none', transform: active ? 'scale(1.02)' : 'scale(1)' }}
                onMouseEnter={e => { if (!active) { e.currentTarget.style.borderColor = `${cc}44`; e.currentTarget.style.color = cc; e.currentTarget.style.background = `${cc}08` } }}
                onMouseLeave={e => { if (!active) { e.currentTarget.style.borderColor = 'var(--t-s06)'; e.currentTarget.style.color = 'var(--t-dim3)'; e.currentTarget.style.background = 'var(--t-s02)' } }}>
                <span style={{ fontSize: 12 }}>{icon}</span> {c}
              </button>
            )
          })}
        </div>
      </div>

      {/* New Post Form */}
      {showNewPost && (
        <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, background: 'linear-gradient(135deg,var(--t-card),var(--t-card2))', border: '1px solid rgba(232,74,47,0.25)', padding: '28px 30px', boxShadow: '0 16px 60px rgba(0,0,0,0.5), 0 0 40px rgba(232,74,47,0.08)' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: 'linear-gradient(180deg,#e84a2f,#f5c842)', borderRadius: '22px 0 0 22px' }} />
          <div style={{ position: 'absolute', top: -20, right: -20, width: 100, height: 100, borderRadius: '50%', background: 'radial-gradient(circle,rgba(232,74,47,0.06) 0%,transparent 70%)', pointerEvents: 'none' }} />

          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
            <div style={{ width: 36, height: 36, borderRadius: 10, background: 'linear-gradient(135deg,#e84a2f,#f5c842)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, boxShadow: '0 4px 14px rgba(232,74,47,0.4)' }}>✏️</div>
            <div>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, letterSpacing: '0.06em', color: 'var(--t-text)' }}>CREATE A POST</div>
              <div style={{ fontSize: 10, color: 'var(--t-dim3)', letterSpacing: '0.06em', fontWeight: 600 }}>Ask a question or start a discussion</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 14, marginBottom: 16 }}>
            <div style={{ flex: 2 }}>
              <label style={{ fontSize: 9, color: 'var(--t-dim2)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Title *</label>
              <input placeholder="e.g. Best wraps for beginners?" value={newTitle} onChange={e => setNewTitle(e.target.value)}
                style={{ ...inp, background: 'var(--t-veil1)', borderRadius: 12 }}
                onFocus={e => { e.target.style.borderColor = '#e84a2f'; e.target.style.boxShadow = '0 0 0 4px rgba(232,74,47,0.08)' }}
                onBlur={e => { e.target.style.borderColor = 'var(--t-s10)'; e.target.style.boxShadow = 'none' }} />
            </div>
            <div style={{ flex: 1 }}>
              <label style={{ fontSize: 9, color: 'var(--t-dim2)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Category</label>
              <select value={newCategory} onChange={e => setNewCategory(e.target.value)}
                style={{ ...inp, background: 'var(--t-veil1)', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none', borderRadius: 12, backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='%23888'%3E%3Cpath d='M7 10l5 5 5-5z'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 14px center', paddingRight: 34 }}>
                {CATEGORIES.map(c => <option key={c} value={c} style={{ background: 'var(--t-card)', color: 'var(--t-text)' }}>{CAT_ICONS[c]} {c}</option>)}
              </select>
            </div>
          </div>
          <div style={{ marginBottom: 20 }}>
            <label style={{ fontSize: 9, color: 'var(--t-dim2)', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', display: 'block', marginBottom: 6 }}>Body *</label>
            <textarea placeholder="Describe your question or topic in detail…" value={newBody} onChange={e => setNewBody(e.target.value)} rows={4}
              style={{ ...inp, background: 'var(--t-veil1)', resize: 'vertical', minHeight: 90, lineHeight: 1.7, borderRadius: 12 }}
              onFocus={e => { e.target.style.borderColor = '#e84a2f'; e.target.style.boxShadow = '0 0 0 4px rgba(232,74,47,0.08)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--t-s10)'; e.target.style.boxShadow = 'none' }} />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button onClick={createPost} disabled={posting}
              style={{ background: 'linear-gradient(135deg,#e84a2f,#c93820)', color: '#fff', border: 'none', borderRadius: 14, padding: '14px 32px', fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', cursor: posting ? 'not-allowed' : 'pointer', opacity: posting ? 0.7 : 1, boxShadow: '0 8px 24px rgba(232,74,47,0.45)', transition: 'all 0.3s' }}
              onMouseEnter={e => { if (!posting) e.currentTarget.style.boxShadow = '0 12px 32px rgba(232,74,47,0.6)' }}
              onMouseLeave={e => { e.currentTarget.style.boxShadow = '0 8px 24px rgba(232,74,47,0.45)' }}>
              {posting ? 'PUBLISHING…' : 'PUBLISH POST'}
            </button>
            <span style={{ fontSize: 10, color: 'var(--t-dim3)' }}>Visible to all members and coaches</span>
          </div>
        </div>
      )}

      {/* Main content: thread view or post list */}
      {activePost ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <button onClick={() => setActivePost(null)}
            style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, background: 'var(--t-s03)', border: '1px solid var(--t-s08)', borderRadius: 12, padding: '10px 20px', fontSize: 11, fontWeight: 700, color: 'var(--t-dim2)', cursor: 'pointer', transition: 'all 0.2s' }}
            onMouseEnter={e => { e.currentTarget.style.color = 'var(--t-text)'; e.currentTarget.style.borderColor = 'var(--t-s20)'; e.currentTarget.style.background = 'var(--t-s05)' }}
            onMouseLeave={e => { e.currentTarget.style.color = 'var(--t-dim2)'; e.currentTarget.style.borderColor = 'var(--t-s08)'; e.currentTarget.style.background = 'var(--t-s03)' }}>
            <span style={{ fontSize: 14 }}>←</span> BACK TO FORUM
          </button>

          {/* Original post */}
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 22, background: 'linear-gradient(135deg,var(--t-card) 0%,var(--t-card2) 100%)', border: '1px solid rgba(245,200,66,0.15)', padding: '26px 28px', boxShadow: '0 16px 60px rgba(0,0,0,0.5)' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 5, background: `linear-gradient(180deg,${CAT_COLORS[activePost.category] || '#f5c842'},transparent)`, borderRadius: '22px 0 0 22px' }} />
            <div style={{ position: 'absolute', top: -30, right: -30, width: 120, height: 120, borderRadius: '50%', background: `radial-gradient(circle,${CAT_COLORS[activePost.category] || '#f5c842'}08 0%,transparent 70%)`, pointerEvents: 'none' }} />

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, marginBottom: 16 }}>
              <div style={{ flex: 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
                  <span style={{ fontSize: 9, fontWeight: 800, padding: '4px 12px', borderRadius: 8, background: `${CAT_COLORS[activePost.category] || 'var(--t-dim2)'}15`, color: CAT_COLORS[activePost.category] || 'var(--t-dim2)', border: `1px solid ${CAT_COLORS[activePost.category] || 'var(--t-dim2)'}33`, letterSpacing: '0.08em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 4 }}>
                    <span style={{ fontSize: 11 }}>{CAT_ICONS[activePost.category]}</span> {activePost.category}
                  </span>
                  {ROLE_BADGE[activePost.authorRole] && (
                    <span style={{ fontSize: 8, fontWeight: 800, padding: '3px 10px', borderRadius: 8, background: ROLE_BADGE[activePost.authorRole].bg, color: ROLE_BADGE[activePost.authorRole].color, border: `1px solid ${ROLE_BADGE[activePost.authorRole].border}`, letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 3 }}>
                      {ROLE_BADGE[activePost.authorRole].icon} {ROLE_BADGE[activePost.authorRole].label}
                    </span>
                  )}
                </div>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, letterSpacing: '0.04em', color: 'var(--t-text)', lineHeight: 1.2, marginBottom: 10 }}>{activePost.title}</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11, color: 'var(--t-dim2)' }}>
                  <div style={{ width: 28, height: 28, borderRadius: 9, background: `linear-gradient(135deg,${getAvatarColor(activePost.authorName)},${getAvatarColor(activePost.authorName)}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, fontWeight: 800, color: '#fff' }}>{getInitials(activePost.authorName)}</div>
                  <span style={{ fontWeight: 700, color: 'var(--t-dim1)' }}>{activePost.authorName}</span>
                  <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--t-dim4)' }} />
                  <span>{timeAgo(activePost.createdAt)}</span>
                </div>
              </div>
              {canDelete(activePost) && (
                <button onClick={() => deletePost(activePost.id)} title="Delete post"
                  style={{ width: 34, height: 34, background: 'rgba(232,74,47,0.08)', border: '1px solid rgba(232,74,47,0.2)', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, color: 'var(--a-red)', cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s' }}
                  onMouseEnter={e => { e.currentTarget.style.background = 'rgba(232,74,47,0.2)'; e.currentTarget.style.transform = 'scale(1.1)' }}
                  onMouseLeave={e => { e.currentTarget.style.background = 'rgba(232,74,47,0.08)'; e.currentTarget.style.transform = 'scale(1)' }}>🗑</button>
              )}
            </div>

            <div style={{ fontSize: 13, color: '#ccc', lineHeight: 1.9, whiteSpace: 'pre-wrap', padding: '16px 18px', background: 'var(--t-s02)', borderRadius: 14, border: '1px solid var(--t-s04)' }}>{activePost.body}</div>

            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 12 }}>
              <button onClick={(e) => toggleLike(activePost.id, e)}
                style={{ display: 'flex', alignItems: 'center', gap: 6, background: (activePost.likes || []).includes(me?.uid) ? 'rgba(232,74,47,0.12)' : 'var(--t-s03)', border: `1px solid ${(activePost.likes || []).includes(me?.uid) ? 'rgba(232,74,47,0.3)' : 'var(--t-s06)'}`, borderRadius: 12, padding: '8px 16px', fontSize: 12, fontWeight: 700, color: (activePost.likes || []).includes(me?.uid) ? '#e84a2f' : 'var(--t-dim2)', cursor: 'pointer', transition: 'all 0.2s' }}
                onMouseEnter={e => { e.currentTarget.style.transform = 'scale(1.05)' }}
                onMouseLeave={e => { e.currentTarget.style.transform = 'scale(1)' }}>
                {(activePost.likes || []).includes(me?.uid) ? '❤️' : '🤍'} <span>{(activePost.likes || []).length}</span>
              </button>
              <span style={{ fontSize: 11, color: 'var(--t-dim3)', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 5 }}>💬 {(activePost.replies || []).length} repl{(activePost.replies || []).length === 1 ? 'y' : 'ies'}</span>
            </div>
          </div>

          {/* Replies */}
          {(activePost.replies || []).length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 4px' }}>
                <div style={{ width: 20, height: 2, background: 'linear-gradient(90deg,#42a5f5,transparent)', borderRadius: 2 }} />
                <span style={{ fontSize: 10, fontWeight: 800, color: 'var(--a-blue)', letterSpacing: '0.15em' }}>REPLIES ({(activePost.replies || []).length})</span>
              </div>
              {(activePost.replies || []).map((r, i) => {
                const isCoachReply = r.authorRole === 'coach' || r.authorRole === 'admin'
                const badge = ROLE_BADGE[r.authorRole]
                const accentColor = isCoachReply ? (r.authorRole === 'admin' ? '#c084fc' : '#42a5f5') : getAvatarColor(r.authorName)
                return (
                  <div key={r.id || i}
                    style={{ position: 'relative', overflow: 'hidden', borderRadius: 18, background: isCoachReply ? `linear-gradient(135deg,var(--t-card),${accentColor}06)` : 'linear-gradient(135deg,var(--t-card),var(--t-card2))', border: `1px solid ${isCoachReply ? `${accentColor}25` : 'var(--t-s05)'}`, padding: '16px 20px', boxShadow: isCoachReply ? `0 8px 24px ${accentColor}08` : '0 4px 20px rgba(0,0,0,0.3)' }}>
                    {isCoachReply && <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: `linear-gradient(180deg,${accentColor},transparent)`, borderRadius: '18px 0 0 18px' }} />}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 26, height: 26, borderRadius: 8, background: `linear-gradient(135deg,${accentColor},${accentColor}88)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 800, color: '#fff' }}>{getInitials(r.authorName)}</div>
                        <span style={{ fontSize: 12, fontWeight: 700, color: isCoachReply ? accentColor : 'var(--t-dim1)' }}>{r.authorName}</span>
                        {badge && <span style={{ fontSize: 7, fontWeight: 800, padding: '2px 7px', borderRadius: 6, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 2 }}>{badge.icon} {badge.label}</span>}
                        <span style={{ fontSize: 10, color: 'var(--t-dim3)' }}>{timeAgo({ seconds: new Date(r.createdAt).getTime() / 1000 })}</span>
                      </div>
                      {canDelete(r) && (
                        <button onClick={() => deleteReply(activePost.id, r)} title="Delete reply"
                          style={{ width: 24, height: 24, background: 'rgba(232,74,47,0.06)', border: '1px solid rgba(232,74,47,0.15)', borderRadius: 7, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--a-red)', cursor: 'pointer', transition: 'all 0.2s' }}
                          onMouseEnter={e => { e.currentTarget.style.background = 'rgba(232,74,47,0.15)' }}
                          onMouseLeave={e => { e.currentTarget.style.background = 'rgba(232,74,47,0.06)' }}>🗑</button>
                      )}
                    </div>
                    <div style={{ fontSize: 12, color: '#ccc', lineHeight: 1.8, whiteSpace: 'pre-wrap', paddingLeft: 34 }}>{r.text}</div>
                  </div>
                )
              })}
            </div>
          )}
          <div ref={replyEndRef} />

          {/* Reply box */}
          <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 20, background: 'linear-gradient(135deg,var(--t-card),rgba(66,165,245,0.03))', border: '1px solid rgba(66,165,245,0.15)', padding: '20px 22px', boxShadow: '0 8px 32px rgba(0,0,0,0.3)' }}>
            <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: 'linear-gradient(180deg,#42a5f5,transparent)', borderRadius: '20px 0 0 20px' }} />
            <div style={{ fontSize: 10, fontWeight: 800, color: 'var(--a-blue)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 24, height: 24, borderRadius: 7, background: 'rgba(66,165,245,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>💬</div>
              {role === 'coach' || role === 'admin' ? 'POST AN ANSWER' : 'WRITE A REPLY'}
            </div>
            <textarea placeholder={role === 'coach' || role === 'admin' ? 'Share your expertise…' : 'Add your thoughts…'} value={replyText} onChange={e => setReplyText(e.target.value)} rows={3}
              style={{ ...inp, background: 'var(--t-veil1)', resize: 'vertical', minHeight: 70, lineHeight: 1.7, marginBottom: 12, borderRadius: 12 }}
              onFocus={e => { e.target.style.borderColor = '#42a5f5'; e.target.style.boxShadow = '0 0 0 4px rgba(66,165,245,0.08)' }}
              onBlur={e => { e.target.style.borderColor = 'var(--t-s10)'; e.target.style.boxShadow = 'none' }} />
            <button onClick={postReply} disabled={replying || !replyText.trim()}
              style={{ background: replyText.trim() ? 'linear-gradient(135deg,#42a5f5,#1e88e5)' : 'var(--t-s04)', color: replyText.trim() ? '#fff' : 'var(--t-dim3)', border: 'none', borderRadius: 12, padding: '12px 28px', fontSize: 11, fontWeight: 800, letterSpacing: '0.06em', cursor: replyText.trim() ? 'pointer' : 'not-allowed', boxShadow: replyText.trim() ? '0 6px 20px rgba(66,165,245,0.4)' : 'none', transition: 'all 0.3s', opacity: replying ? 0.7 : 1 }}
              onMouseEnter={e => { if (replyText.trim()) e.currentTarget.style.boxShadow = '0 10px 28px rgba(66,165,245,0.5)' }}
              onMouseLeave={e => { if (replyText.trim()) e.currentTarget.style.boxShadow = '0 6px 20px rgba(66,165,245,0.4)' }}>
              {replying ? 'POSTING…' : role === 'coach' || role === 'admin' ? 'ANSWER' : 'REPLY'}
            </button>
          </div>
        </div>
      ) : (
        /* Post List */
        <>
          {filtered.length === 0 ? (
            <div style={{ position: 'relative', overflow: 'hidden', borderRadius: 24, background: 'linear-gradient(135deg,var(--t-card),var(--t-card2))', border: '1px dashed var(--t-s06)', padding: '70px 30px', textAlign: 'center', boxShadow: '0 16px 60px rgba(0,0,0,0.4)' }}>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', width: 200, height: 200, borderRadius: '50%', background: 'radial-gradient(circle,rgba(245,200,66,0.04) 0%,transparent 70%)', pointerEvents: 'none' }} />
              <div style={{ fontSize: 64, marginBottom: 16, opacity: 0.5 }}>💬</div>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, color: 'var(--t-text)', letterSpacing: '0.06em', marginBottom: 8 }}>{searchQ || filterCat !== 'All' ? 'NO MATCHING POSTS' : 'NO POSTS YET'}</div>
              <div style={{ fontSize: 12, color: 'var(--t-dim3)', letterSpacing: '0.04em', maxWidth: 300, margin: '0 auto' }}>{searchQ || filterCat !== 'All' ? 'Try a different search or category filter' : 'Be the first to start a discussion!'}</div>
              {!searchQ && filterCat === 'All' && (
                <button onClick={() => setShowNewPost(true)}
                  style={{ marginTop: 20, background: 'linear-gradient(135deg,#e84a2f,#c93820)', color: '#fff', border: 'none', borderRadius: 14, padding: '14px 32px', fontSize: 12, fontWeight: 800, letterSpacing: '0.06em', cursor: 'pointer', boxShadow: '0 8px 28px rgba(232,74,47,0.4)' }}>
                  + CREATE FIRST POST
                </button>
              )}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filtered.map(p => {
                const cc = CAT_COLORS[p.category] || 'var(--t-dim2)'
                const liked = (p.likes || []).includes(me?.uid)
                const replyCount = (p.replies || []).length
                const hasCoachReply = (p.replies || []).some(r => r.authorRole === 'coach' || r.authorRole === 'admin')
                const badge = ROLE_BADGE[p.authorRole]
                return (
                  <div key={p.id} onClick={() => { setActivePost(p); setShowNewPost(false) }}
                    style={{ position: 'relative', overflow: 'hidden', borderRadius: 18, background: 'linear-gradient(135deg,var(--t-card),var(--t-card2))', border: '1px solid var(--t-s06)', padding: '18px 22px', cursor: 'pointer', transition: 'all 0.3s cubic-bezier(0.34,1.56,0.64,1)', boxShadow: '0 4px 20px rgba(0,0,0,0.3)' }}
                    onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.borderColor = `${cc}44`; e.currentTarget.style.boxShadow = `0 12px 36px ${cc}12, 0 4px 20px rgba(0,0,0,0.4)` }}
                    onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.borderColor = 'var(--t-s06)'; e.currentTarget.style.boxShadow = '0 4px 20px rgba(0,0,0,0.3)' }}>
                    <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: `linear-gradient(180deg,${cc},transparent)`, borderRadius: '18px 0 0 18px', opacity: 0.6 }} />

                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
                      {/* Avatar */}
                      <div style={{ width: 40, height: 40, borderRadius: 12, background: `linear-gradient(135deg,${getAvatarColor(p.authorName)},${getAvatarColor(p.authorName)}77)`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 800, color: '#fff', flexShrink: 0, boxShadow: `0 4px 12px ${getAvatarColor(p.authorName)}33` }}>
                        {getInitials(p.authorName)}
                      </div>

                      {/* Content */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 8, fontWeight: 800, padding: '3px 9px', borderRadius: 7, background: `${cc}15`, color: cc, border: `1px solid ${cc}33`, letterSpacing: '0.07em', textTransform: 'uppercase', display: 'flex', alignItems: 'center', gap: 3 }}>
                            <span style={{ fontSize: 10 }}>{CAT_ICONS[p.category]}</span> {p.category}
                          </span>
                          {badge && <span style={{ fontSize: 7, fontWeight: 800, padding: '2px 7px', borderRadius: 6, background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, letterSpacing: '0.1em', display: 'flex', alignItems: 'center', gap: 2 }}>{badge.icon} {badge.label}</span>}
                          {hasCoachReply && <span style={{ fontSize: 7, fontWeight: 800, padding: '2px 7px', borderRadius: 6, background: 'rgba(34,197,94,0.12)', color: 'var(--a-green)', border: '1px solid rgba(34,197,94,0.25)', letterSpacing: '0.08em' }}>✓ ANSWERED</span>}
                        </div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--t-text)', lineHeight: 1.3, marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</div>
                        <div style={{ fontSize: 11, color: 'var(--t-dim2)', lineHeight: 1.5, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{p.body}</div>
                        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 10, fontSize: 10, color: 'var(--t-dim3)' }}>
                          <span style={{ fontWeight: 700, color: 'var(--t-dim2)' }}>{p.authorName}</span>
                          <span style={{ width: 3, height: 3, borderRadius: '50%', background: 'var(--t-dim4)' }} />
                          <span>{timeAgo(p.createdAt)}</span>
                        </div>
                      </div>

                      {/* Stats */}
                      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flexShrink: 0, paddingTop: 6 }}>
                        <button onClick={(e) => toggleLike(p.id, e)}
                          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: liked ? 'rgba(232,74,47,0.1)' : 'var(--t-s03)', border: `1px solid ${liked ? 'rgba(232,74,47,0.25)' : 'var(--t-s06)'}`, borderRadius: 10, padding: '8px 12px', cursor: 'pointer', transition: 'all 0.2s' }}>
                          <span style={{ fontSize: 14 }}>{liked ? '❤️' : '🤍'}</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: liked ? '#e84a2f' : 'var(--t-dim3)' }}>{(p.likes || []).length}</span>
                        </button>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, background: 'var(--t-s03)', border: '1px solid var(--t-s06)', borderRadius: 10, padding: '8px 12px' }}>
                          <span style={{ fontSize: 14 }}>💬</span>
                          <span style={{ fontSize: 10, fontWeight: 700, color: replyCount > 0 ? '#42a5f5' : 'var(--t-dim3)' }}>{replyCount}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}
    </div>
  )

  if (embedded) return forumContent

  return (
    <div style={{ minHeight: '100vh', background: 'var(--t-bg)', fontFamily: 'Montserrat,sans-serif', position: 'relative' }}>
      <canvas ref={canvasRef} style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', zIndex: 0, pointerEvents: 'none' }} />
      <Navbar user={profile} />
      <div style={{ maxWidth: 920, margin: '0 auto', padding: '24px 24px 80px', position: 'relative', zIndex: 1 }}>
        {forumContent}
      </div>
      <style>{`
        @keyframes slideDown { from { opacity:0; transform: translate(-50%,-10px); } to { opacity:1; transform: translate(-50%,0); } }
      `}</style>
    </div>
  )
}

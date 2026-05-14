import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { doc, getDoc } from 'firebase/firestore'
import { auth, db } from './firebase'

import Login          from './pages/Login'
import Signup         from './pages/Signup'
import Home           from './pages/Home'
import Profile        from './pages/Profile'
import ProgramBuilder from './pages/ProgramBuilder'
import Leaderboard    from './pages/Leaderboard'
import Stats          from './pages/Stats'
import Achievements   from './pages/Achievements'
import AboutUs        from './pages/AboutUs'
import Inbox          from './pages/Inbox'
import CoachDashboard from './pages/CoachDashboard'
import AdminDashboard from './pages/AdminDashboard'

function useAuth() {
  const [state, setState] = useState({ loading:true, user:null, role:null, programSetupDone:false, deletedAccount:false })

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (firebaseUser) => {
      // If no Firebase user — clear ALL localStorage and show login
      if (!firebaseUser) {
        localStorage.clear()
        setState({ loading:false, user:null, role:null, programSetupDone:false, deletedAccount:false })
        return
      }
      // User is logged in — get their data from Firestore (source of truth)
      try {
        const snap = await getDoc(doc(db, 'users', firebaseUser.uid))
        if (snap.exists()) {
          const data = snap.data()
          // Sync Firestore data to localStorage for app use
          localStorage.setItem('hittrack_profile', JSON.stringify(data))
          setState({
            loading: false,
            user: firebaseUser,
            role: data.role || 'member',
            programSetupDone: data.programSetupDone || false,
            deletedAccount: false,
          })
        } else {
          // Firestore user doc missing — check the deletions audit log to see WHY.
          // If the account was permanently deleted by an admin, we lock the user out.
          try {
            const delSnap = await getDoc(doc(db, 'deletions', firebaseUser.uid))
            if (delSnap.exists()) {
              // Account was deleted — purge local data, set lockout flag, force sign-out
              const delData = delSnap.data()
              console.warn('Account was deleted by admin:', delData.deletedByName)
              localStorage.clear()
              // Set a sessionStorage flag the Login page can read to show the lockout message
              try { sessionStorage.setItem('hittrack_deleted_account', JSON.stringify({
                memberName: delData.memberName || 'this account',
                deletedByName: delData.deletedByName || 'an administrator',
                deletedAt: delData.deletedAt?.seconds || null,
              })) } catch(_) {}
              const { signOut } = await import('firebase/auth')
              await signOut(auth)
              setState({ loading:false, user:null, role:null, programSetupDone:false, deletedAccount:true })
              return
            }
          } catch(_) { /* deletions read failed — fall through to legacy path */ }
          // Doc doesn't exist AND no deletion record — likely brand-new signup, use localStorage as fallback
          const local = JSON.parse(localStorage.getItem('hittrack_profile') || '{}')
          setState({
            loading: false,
            user: firebaseUser,
            role: local.role || 'member',
            programSetupDone: local.programSetupDone || false,
            deletedAccount: false,
          })
        }
      } catch {
        // Firestore read failed — use localStorage as fallback
        const local = JSON.parse(localStorage.getItem('hittrack_profile') || '{}')
        setState({
          loading: false,
          user: firebaseUser,
          role: local.role || 'member',
          programSetupDone: local.programSetupDone || false,
          deletedAccount: false,
        })
      }
    })
    return unsub
  }, [])

  return state
}

function LoadingScreen() {
  return (
    <div style={{minHeight:'100vh',background:'#0e0c0c',display:'flex',alignItems:'center',justifyContent:'center',flexDirection:'column',gap:16,fontFamily:'Montserrat,sans-serif'}}>
      <div style={{fontFamily:"'Bebas Neue',sans-serif",fontSize:32,letterSpacing:'0.06em',color:'#f0ece8'}}>
        HIT<span style={{color:'#e84a2f'}}>TRACK</span>
      </div>
      <div style={{width:36,height:36,border:'3px solid rgba(245,200,66,0.15)',borderTop:'3px solid #f5c842',borderRadius:'50%',animation:'spin 0.8s linear infinite'}}/>
      <div style={{fontSize:12,color:'#555'}}>Loading...</div>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )
}

function RequireMember({ s, children }) {
  if (s.loading) return <LoadingScreen/>
  if (!s.user)   return <Navigate to="/login" replace/>
  if (s.role === 'coach') return <Navigate to="/coach" replace/>
  if (s.role === 'admin') return <Navigate to="/admin" replace/>
  if (!s.programSetupDone) return <Navigate to="/program-builder" replace/>
  return children
}

function RequireAuth({ s, children }) {
  if (s.loading) return <LoadingScreen/>
  if (!s.user)   return <Navigate to="/login" replace/>
  return children
}

function RequireCoach({ s, children }) {
  if (s.loading) return <LoadingScreen/>
  if (!s.user)   return <Navigate to="/login" replace/>
  if (s.role !== 'coach' && s.role !== 'admin') return <Navigate to="/login" replace/>
  return children
}

function RequireAdmin({ s, children }) {
  if (s.loading) return <LoadingScreen/>
  if (!s.user)   return <Navigate to="/login" replace/>
  if (s.role !== 'admin') return <Navigate to="/login" replace/>
  return children
}

function SmartRoot({ s }) {
  if (s.loading) return <LoadingScreen/>
  if (!s.user)   return <Login/>
  if (s.role === 'admin') return <Navigate to="/admin" replace/>
  if (s.role === 'coach') return <Navigate to="/coach" replace/>
  if (!s.programSetupDone) return <Navigate to="/program-builder" replace/>
  return <Navigate to="/home" replace/>
}

export default function App() {
  const authState = useAuth()

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"                element={<SmartRoot s={authState}/>}/>
        <Route path="/login"           element={<Login/>}/>
        <Route path="/signup"          element={<Signup/>}/>
        <Route path="/program-builder" element={<RequireAuth s={authState}><ProgramBuilder/></RequireAuth>}/>
        <Route path="/home"            element={<RequireMember s={authState}><Home/></RequireMember>}/>
        <Route path="/profile"         element={<RequireMember s={authState}><Profile/></RequireMember>}/>
        <Route path="/leaderboard"     element={<RequireMember s={authState}><Leaderboard/></RequireMember>}/>
        <Route path="/stats"           element={<RequireMember s={authState}><Stats/></RequireMember>}/>
        <Route path="/achievements"    element={<RequireMember s={authState}><Achievements/></RequireMember>}/>
        <Route path="/about"           element={<RequireMember s={authState}><AboutUs/></RequireMember>}/>
        <Route path="/inbox"           element={<RequireMember s={authState}><Inbox/></RequireMember>}/>
        <Route path="/coach"           element={<RequireCoach s={authState}><CoachDashboard/></RequireCoach>}/>
        <Route path="/admin"           element={<RequireAdmin s={authState}><AdminDashboard/></RequireAdmin>}/>
        <Route path="*"                element={<Navigate to="/" replace/>}/>
      </Routes>
    </BrowserRouter>
  )
}

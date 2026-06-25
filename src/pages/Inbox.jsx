import { useEffect, useState } from 'react'
import { auth, db } from '../firebase'
import { doc, getDoc } from 'firebase/firestore'
import Navbar from '../components/Navbar'
import InboxView from '../components/InboxView'

export default function Inbox(){
  const [profile,setProfile] = useState(()=>{
    try{return JSON.parse(localStorage.getItem('hittrack_profile')||'{}')}catch{return {}}
  })

  // Refresh from Firestore for accuracy
  useEffect(()=>{
    const u=auth.currentUser
    if(!u) return
    getDoc(doc(db,'users',u.uid)).then(s=>{
      if(s.exists()) setProfile(s.data())
    }).catch(()=>{})
  },[])

  const uid = auth.currentUser?.uid
  if(!uid) return null

  return(
    <div style={{minHeight:'100vh',background:'#0c0a0a',fontFamily:'Montserrat,sans-serif'}}>
      <Navbar user={{name:profile.name||'Athlete'}}/>
      <div style={{paddingTop:8}}>
        <InboxView
          currentUid={uid}
          currentName={profile.name||'Athlete'}
          currentRole={profile.role||'member'}
        />
      </div>
    </div>
  )
}

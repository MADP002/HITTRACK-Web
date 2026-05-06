import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

const firebaseConfig = {
  apiKey: "AIzaSyAPok5DAhoG4iOT-jiRsAseAx-ZCwj8YC8",
  authDomain: "hittrack-eb904.firebaseapp.com",
  projectId: "hittrack-eb904",
  storageBucket: "hittrack-eb904.firebasestorage.app",
  messagingSenderId: "957114584443",
  appId: "1:957114584443:web:0593f7b6f3828c2ff481de"
}

const app  = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db   = getFirestore(app)
export default app

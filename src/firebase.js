import { initializeApp } from 'firebase/app'
import { getAuth } from 'firebase/auth'
import { getFirestore } from 'firebase/firestore'

// Config is read from Vite env vars (VITE_FIREBASE_*) so the same code can point
// at a staging project. The production values are kept as fallbacks so a missing
// .env never breaks the deploy. Firebase web keys are NOT secret — security is
// enforced by Firestore rules, not by hiding these values.
const env = import.meta.env
const firebaseConfig = {
  apiKey:            env.VITE_FIREBASE_API_KEY             || "AIzaSyAPok5DAhoG4iOT-jiRsAseAx-ZCwj8YC8",
  authDomain:        env.VITE_FIREBASE_AUTH_DOMAIN         || "hittrack-eb904.firebaseapp.com",
  projectId:         env.VITE_FIREBASE_PROJECT_ID          || "hittrack-eb904",
  storageBucket:     env.VITE_FIREBASE_STORAGE_BUCKET      || "hittrack-eb904.firebasestorage.app",
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID || "957114584443",
  appId:             env.VITE_FIREBASE_APP_ID              || "1:957114584443:web:0593f7b6f3828c2ff481de",
}

const app  = initializeApp(firebaseConfig)
export const auth = getAuth(app)
export const db   = getFirestore(app)
export default app

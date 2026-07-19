import { initializeApp, deleteApp } from 'firebase/app'
import { getAuth, createUserWithEmailAndPassword, signOut as fbSignOut, sendEmailVerification, deleteUser } from 'firebase/auth'
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

// ════════════════════════════════════════════════════════════════
//  Create an Auth account WITHOUT touching the current session.
//
//  createUserWithEmailAndPassword() signs the new user in on whatever
//  app instance it's called on — so calling it from the admin dashboard
//  would kick the admin out of their own session. We instead spin up a
//  SECONDARY Firebase app with its own auth state, create the account
//  there, send the verification email, then tear the app down. The
//  admin's session on the primary app is never touched.
//
//  Used by: admin "Add Coach" (coaches are created by admin only).
//
//  ATOMICITY: pass `writeProfile(uid)` to do the Firestore write. It runs
//  while the new user's session is still alive on the secondary app, so if
//  the write fails (e.g. rules reject it) we DELETE the just-created auth
//  account instead of leaving an orphan. Without this, a failed attempt
//  burns the email address — retrying returns "email-already-in-use" even
//  though no profile exists.
//
//  Returns the new user's uid.
// ════════════════════════════════════════════════════════════════
export async function createAuthUserDetached(email, password, writeProfile) {
  const secondary = initializeApp(firebaseConfig, `secondary-${Date.now()}`)
  let createdUser = null
  try {
    const secondaryAuth = getAuth(secondary)
    const cred = await createUserWithEmailAndPassword(secondaryAuth, email, password)
    createdUser = cred.user
    try { await sendEmailVerification(cred.user) } catch (_) {}
    // Write the profile BEFORE we consider this a success.
    if (writeProfile) await writeProfile(cred.user.uid)
    const uid = cred.user.uid
    try { await fbSignOut(secondaryAuth) } catch (_) {}
    return uid
  } catch (err) {
    // Roll back so the email isn't left claimed by a profile-less account.
    if (createdUser) {
      try { await deleteUser(createdUser) } catch (_) {
        console.warn('[addCoach] Could not roll back orphaned auth account for', email)
      }
    }
    throw err
  } finally {
    try { await deleteApp(secondary) } catch (_) {}
  }
}

export default app

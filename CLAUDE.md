# HITTRACK Web App
# React 18 + Vite + Tailwind CSS + Firebase v9

---

## ⚠️ Critical Conventions — Read Before Touching Any File

### 1. ALL STYLING IS INLINE — NOT TAILWIND CLASSES
Every component uses JavaScript style objects, not Tailwind utility classes.
```jsx
// ✅ CORRECT
<div style={{display:'flex', gap:16, padding:'22px 24px', borderRadius:14}}>

// ❌ WRONG — do not add Tailwind classes to JSX
<div className="flex gap-4 p-6 rounded-xl">
```
Tailwind is in the project but used only for global resets. All component styling is inline.

### 2. NO TYPESCRIPT — Plain JSX Throughout
No `.ts`, no `.tsx`, no type annotations. Pure JavaScript + JSX.

### 3. FIREBASE SDK v9 — MODULAR IMPORTS ONLY
```js
// ✅ CORRECT
import { doc, getDoc, setDoc, updateDoc, deleteDoc, collection, getDocs, query, where, orderBy, serverTimestamp, runTransaction, writeBatch, addDoc, onSnapshot, arrayUnion } from 'firebase/firestore'
import { signOut, EmailAuthProvider, reauthenticateWithCredential, deleteUser } from 'firebase/auth'

// ❌ WRONG — no compat/namespace imports
import firebase from 'firebase/app'
firebase.firestore().collection(...)
```

### 4. DUAL STATE PATTERN — localStorage + Firestore
Profile and stats live in BOTH places. localStorage is the fast cache, Firestore is the source of truth.
- `hittrack_profile` in localStorage — synced by App.jsx on auth change
- `hittrack_stats` in localStorage — separate key (keeping separate prevents state conflicts)
- Components read from localStorage for instant render, Firestore for persistence

### 5. NEVER COMPUTE MEMBERSHIP STATE FROM RAW FIELDS
Always use the library function — never check `user.membership.expiresAt` directly in components.
```js
// ✅ CORRECT
import { computeMembershipState, canBook } from '../lib/membership'
const state = computeMembershipState(profile.membership)

// ❌ WRONG
if (profile.membership.expiresAt > Date.now()) { ... }
```

---

## Tech Stack
- **Framework:** React 18
- **Bundler:** Vite
- **Styling:** Inline styles (see above)
- **Database:** Firebase Firestore (v9 modular SDK)
- **Auth:** Firebase Authentication (Email/Password)
- **Hosting:** Vercel (auto-deploy from main branch)
- **State:** useState + localStorage (no Redux, no Zustand)
- **Routing:** React Router v6

---

## File Structure
```
src/
├── App.jsx               ← route definitions + auth guard + role-based redirect
├── firebase.js           ← Firebase init (reads from env vars — VITE_FIREBASE_*)
│
├── pages/
│   ├── Login.jsx         ← email/password auth
│   ├── Signup.jsx        ← member registration + 7-day trial seed
│   ├── Home.jsx          ← member dashboard (workout, classes, feedback, announcements)
│   ├── Leaderboard.jsx   ← gym rankings with membership blur/lock overlay
│   ├── Stats.jsx         ← personal performance stats with membership blur/lock overlay
│   ├── Profile.jsx       ← edit profile + membership card + cascade self-delete
│   ├── ProgramBuilder.jsx← 28-day workout setup wizard (multi-step)
│   ├── Forum.jsx         ← community Q&A (posts + replies + likes + categories)
│   ├── Achievements.jsx  ← member achievement badges
│   ├── AdminDashboard.jsx← full admin portal (members, memberships, classes, forum, etc.)
│   └── CoachDashboard.jsx← coach portal (classes, feedback, member activity)
│
├── components/
│   ├── Navbar.jsx        ← responsive navbar with hamburger drawer + unread badge
│   ├── InboxView.jsx     ← real-time DM inbox (member-to-member messaging)
│   ├── Avatar.jsx        ← user avatar display
│   └── AvatarUploader.jsx← avatar upload to Firebase Storage
│
└── lib/
    ├── membership.js     ← MEMBERSHIP STATE MACHINE (critical — see below)
    ├── adaptiveEngine.js ← AI difficulty engine (10 rules, computeDifficulty)
    ├── scheduleBuilder.js← 28-day workout plan generator (exercise pools by goal/level)
    ├── classLifecycle.js ← class start/end logic (isClassPassed, endClass, autoEndPastClasses)
    ├── activityLog.js    ← logActivity() + ACTIVITY_TYPES + SYSTEM_EVENT_TYPES
    └── useIsMobile.js    ← 768px breakpoint hook (returns boolean, re-renders on resize)
```

---

## Key Library — membership.js
The most important lib. Everything membership-related goes through this.
```js
computeMembershipState(m)  // returns STATUS string
canBook(m)                 // boolean — can this member book classes?
daysRemaining(m)           // number or null
isExpiringSoon(m)          // boolean — within 7 days
fmtExpiry(m)               // "Dec 15, 2025" string
fmtRemaining(m)            // "3 days left" string
getStatusLabel(state)      // "Active" | "Paused" | etc.
getStatusColor(state)      // hex color string
getStatusIcon(state)       // emoji string

STATUS = { LEGACY, NONE, TRIAL, ACTIVE, PAUSED, EXPIRED }
TRIAL_DURATION_DAYS = 7
DEFAULT_MONTHLY_DAYS = 30
```

---

## Role-Based Routing (App.jsx)
```
/login           → LoginPage (public)
/signup          → SignupPage (public)
/home            → Home (member only)
/leaderboard     → Leaderboard (member)
/stats           → Stats (member)
/profile         → Profile (member)
/program-builder → ProgramBuilder (member)
/forum           → Forum (member)
/achievements    → Achievements (member)
/coach           → CoachDashboard (coach + admin)
/admin           → AdminDashboard (admin only)
```
After login: role check → redirect to appropriate dashboard.

---

## Admin Dashboard Tabs
Overview | Members | Memberships | Inbox | Coaches | Classes | Leaderboard | Notifications | Forum

Key admin operations:
- Record payment → creates `payments/{id}` + extends `users/{uid}.membership.expiresAt`
- Delete payment → soft-deletes to `deletedPayments/{id}` (NEVER hard delete)
- Pause/Resume → sets `membership.pausedAt` + adjusts `expiresAt` on resume
- Delete class → cascades: notify bookings → delete bookings → delete class
- Delete member → full cascade: 12 Firestore collections + Firebase Auth account

---

## Firestore Rules Summary
File: `web/firestore.rules`

Key security rules:
- Members CANNOT write to `membership`, `role`, or `status` fields on their own user doc
- Only admin can create/delete `payments`
- `deletedPayments` and `trialUsage` are append-only (no update/delete)
- Forum: only post author + admin can delete; admin-only moderation
- Messages: only participants in a thread can read that thread
- Bookings: only the booking owner or admin can delete

Deploy with: `firebase deploy --only firestore:rules`

---

## Environment Variables
File: `.env.local` (gitignored — never commit this)
```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

---

## Common Commands
```bash
npm run dev          # start dev server → localhost:5173
npm run build        # production build → dist/
firebase deploy --only firestore:rules   # push rule changes
node scripts/backup.js                   # manual Firestore backup
```

---

## Things Claude Must NOT Do
- ❌ Add Tailwind classes to JSX components
- ❌ Create TypeScript files
- ❌ Use Firebase compat SDK (namespace style)
- ❌ Check membership fields directly — use computeMembershipState()
- ❌ Hard-delete payment records — always soft-delete to deletedPayments/
- ❌ Store membership status as a string — store dates only, derive state
- ❌ Use orderBy + where on different fields in the same Firestore query (needs composite index — sort client-side instead)
- ❌ Add coach/admin mobile screens (mobile is member-facing only)
- ❌ Use localStorage for sensitive/financial data

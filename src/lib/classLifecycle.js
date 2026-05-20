// ════════════════════════════════════════════════════════
//  HITTRACK — Class Lifecycle
//
//  Handles:
//   - Computing when a recurring class actually occurs (Date)
//   - Detecting whether a class has passed its scheduled time
//   - Ending a class (manually or auto):
//       * Sets status='ended' on the class
//       * Sends thank-you notifications to all booked participants
//       * Fires a class_ended activity event for the admin/coach feed
//       * Uses a transaction so two simultaneous portal loads don't dupe
//
//  Auto-end logic runs on coach/admin portal load — any class whose start
//  time + buffer has passed gets ended in the background. Idempotent.
// ════════════════════════════════════════════════════════
import {
  doc, getDocs, collection, query, where,
  runTransaction, serverTimestamp, addDoc,
  writeBatch,
} from 'firebase/firestore'
import { db, auth } from '../firebase'
import { logActivity } from './activityLog'

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday']
const CLASS_DURATION_HOURS = 2  // buffer after start before auto-end fires

/**
 * Parse a class.time string like "6:00 AM" into {h, m} (24-hour).
 */
function parseTimeString(timeStr) {
  if (!timeStr) return null
  const m = timeStr.match(/(\d+):(\d+)\s*(AM|PM)/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const period = m[3].toUpperCase()
  if (period === 'PM' && h !== 12) h += 12
  if (period === 'AM' && h === 12) h = 0
  return { h, m: min }
}

/**
 * Compute when a class actually starts.
 *
 * Supports two formats:
 *  - New: cls.date is a "YYYY-MM-DD" string (specific calendar date)
 *  - Legacy: cls.day is a weekday name like "Monday" (computed from createdAt)
 *
 * Returns a Date, or null if class data is incomplete.
 */
export function getClassStartTime(cls) {
  if (!cls || !cls.time) return null
  const t = parseTimeString(cls.time)
  if (!t) return null

  // New date-based scheduling (YYYY-MM-DD)
  if (cls.date) {
    const [y, m, d] = cls.date.split('-').map(Number)
    if (y && m && d) {
      const result = new Date(y, m - 1, d, t.h, t.m, 0, 0)
      return result
    }
  }

  // Legacy day-name scheduling
  if (!cls.day) return null
  const dayIdx = DAYS.indexOf(cls.day)
  if (dayIdx === -1) return null

  let createdAt
  if (cls.createdAt?.toDate) createdAt = cls.createdAt.toDate()
  else if (cls.createdAt?.seconds) createdAt = new Date(cls.createdAt.seconds * 1000)
  else createdAt = new Date()

  const result = new Date(createdAt)
  result.setHours(t.h, t.m, 0, 0)
  let safety = 0
  while ((result.getDay() !== dayIdx || result < createdAt) && safety < 10) {
    result.setDate(result.getDate() + 1)
    result.setHours(t.h, t.m, 0, 0)
    safety++
  }
  return result
}

/**
 * Get a display-friendly day label for a class.
 * If date-based: returns "Mon, May 19" format.
 * If legacy day-name: returns the day name.
 */
export function getClassDayLabel(cls) {
  if (!cls) return ''
  if (cls.date) {
    const [y, m, d] = cls.date.split('-').map(Number)
    if (y && m && d) {
      const dt = new Date(y, m - 1, d)
      return dt.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
    }
  }
  return cls.day || ''
}

/**
 * Check if a class is scheduled for today.
 */
export function isClassToday(cls) {
  if (!cls) return false
  const today = new Date()
  const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0')
  if (cls.date) return cls.date === todayStr
  // Legacy: compare day name
  return cls.day === DAYS[today.getDay()]
}

/**
 * Has this class's scheduled time + buffer already passed?
 * Classes are considered "passed" CLASS_DURATION_HOURS after start.
 */
export function isClassPassed(cls) {
  if (!cls) return false
  if (cls.status === 'ended') return true
  const start = getClassStartTime(cls)
  if (!start) return false
  const bufferMs = CLASS_DURATION_HOURS * 60 * 60 * 1000
  return Date.now() >= start.getTime() + bufferMs
}

/**
 * Filter helper: returns true only for classes that should be visible
 * (not ended, not past time).
 */
export function isClassActive(cls) {
  return cls && cls.status !== 'ended' && !isClassPassed(cls)
}

/**
 * End a class — manual (coach clicked button) or auto (time passed).
 *
 * Atomic flow:
 *   1. Transaction: if class is still active, mark it ended. Else bail (idempotent).
 *   2. After transaction succeeds: find all bookings for this class.
 *   3. Send a thank-you notification to each participant.
 *   4. Fire a class_ended activity event.
 *
 * @param {object} cls - The class document
 * @param {object} opts
 * @param {boolean} opts.isAuto - true when triggered by auto-end timer
 * @param {string}  opts.actorName - who is ending it (for the activity event)
 * @returns {Promise<{ended: boolean, notified: number}>}
 */
export async function endClass(cls, { isAuto = false, actorName = 'Coach' } = {}) {
  const me = auth.currentUser
  if (!me || !cls?.id) return { ended: false, notified: 0 }

  // ── Step 1: Atomically transition status ─────────────────
  // Use a transaction so two coaches opening portals simultaneously
  // won't both fire the thank-yous.
  const classRef = doc(db, 'classes', cls.id)
  let acquired = false
  try {
    await runTransaction(db, async (tx) => {
      const snap = await tx.get(classRef)
      if (!snap.exists()) return
      const cur = snap.data()
      if (cur.status === 'ended') return  // someone else already ended it
      tx.update(classRef, {
        status: 'ended',
        endedAt: serverTimestamp(),
        endedBy: isAuto ? 'auto' : 'manual',
        endedByUid: me.uid,
        endedByName: isAuto ? 'System' : (actorName || 'Coach'),
      })
      acquired = true
    })
  } catch (e) {
    console.error('endClass transaction failed:', e)
    return { ended: false, notified: 0 }
  }
  if (!acquired) return { ended: false, notified: 0 }  // already ended by someone else

  // ── Step 2: Find all bookings for this class ─────────────
  let participants = []
  try {
    const q = query(collection(db, 'bookings'), where('classId', '==', cls.id))
    const snap = await getDocs(q)
    participants = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) {
    console.warn('endClass: could not load bookings:', e.message)
  }

  // ── Step 3: Send thank-you notification to each participant ─
  // We attribute the thanks to the ORIGINAL coach (cls.coach), not whoever
  // happened to trigger the auto-end.
  let notified = 0
  if (participants.length > 0) {
    try {
      const batch = writeBatch(db)
      const notifCol = collection(db, 'notifications')
      const coachName = cls.coach || 'Your Coach'
      participants.forEach(p => {
        const memberUid = p.memberId || p.userId || p.uid
        if (!memberUid) return
        const newRef = doc(notifCol)  // auto-id
        batch.set(newRef, {
          title: `🙏 Thank You for Joining ${cls.name || 'the Class'}!`,
          message: `Coach ${coachName} thanks you for showing up to ${cls.name || 'the class'} (${cls.day || ''} · ${cls.time || ''}). Great work — keep stepping into the ring. 🥊`,
          audience: 'member',
          targetUserId: memberUid,
          type: 'class_thanks',
          classId: cls.id,
          className: cls.name,
          from: coachName,
          fromUid: me.uid,  // actor (so member can dismiss it)
          createdAt: serverTimestamp(),
        })
        notified++
      })
      if (notified > 0) await batch.commit()
    } catch (e) {
      console.warn('endClass: thank-you batch failed:', e.message)
    }
  }

  // ── Step 4: Fire activity event ──────────────────────────
  logActivity({
    type: 'class_ended',
    actorId: me.uid,
    actorName: isAuto ? 'System' : (actorName || 'Coach'),
    actorRole: isAuto ? 'system' : 'coach',
    payload: {
      classId: cls.id,
      className: cls.name,
      classDay: cls.day || '',
      classTime: cls.time || '',
      isAuto,
      notifiedCount: notified,
    },
  })

  return { ended: true, notified }
}

/**
 * Scan a list of classes and auto-end any that are past their scheduled time.
 * Runs in the background — non-blocking, non-fatal.
 *
 * Throttled per-session: won't re-scan within 5 minutes of a previous scan.
 *
 * @param {Array} classes - all classes loaded for the current portal
 */
export async function autoEndPastClasses(classes) {
  // Throttle: only scan once per 5 min per session
  const KEY = 'hittrack_lastAutoEndScan'
  const last = parseInt(sessionStorage.getItem(KEY) || '0', 10)
  if (Date.now() - last < 5 * 60 * 1000) return { scanned: 0, ended: 0 }
  sessionStorage.setItem(KEY, String(Date.now()))

  const candidates = (classes || []).filter(c => c.status !== 'ended' && isClassPassed(c))
  let ended = 0
  for (const cls of candidates) {
    try {
      const r = await endClass(cls, { isAuto: true })
      if (r.ended) ended++
    } catch (e) {
      console.warn('Auto-end of class', cls.id, 'failed:', e.message)
    }
  }
  return { scanned: candidates.length, ended }
}

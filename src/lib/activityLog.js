// ════════════════════════════════════════════════════════
//  HITTRACK — Activity Log Helper
//
//  Centralized firing of operational events to the `activity`
//  Firestore collection. Used by Home, Coach Portal, and Admin
//  Portal so all event payloads have a consistent shape.
//
//  Activity events are SEPARATE from notifications:
//   - notifications  → user-targeted (level change celebration, gym news)
//   - activity       → operational log (bookings, class changes, signups)
// ════════════════════════════════════════════════════════
import { db } from '../firebase'
import { collection, addDoc, serverTimestamp } from 'firebase/firestore'

/**
 * Event types — ordered by visual priority for color/icon mapping
 */
export const ACTIVITY_TYPES = {
  // Bookings
  booking_created:    { icon: '📋', color: '#42a5f5', label: 'Booking',          verb: 'booked' },
  booking_cancelled:  { icon: '✕',  color: '#e84a2f', label: 'Cancellation',    verb: 'cancelled' },
  // Classes
  class_created:      { icon: '🥊', color: '#f5c842', label: 'New Class',       verb: 'created class' },
  class_deleted:      { icon: '🗑', color: '#a8a29e', label: 'Class Removed',   verb: 'deleted class' },
  class_ended:        { icon: '🏁', color: '#22c55e', label: 'Class Ended',     verb: 'ended class' },
  // Levels
  level_change:       { icon: '🎚', color: '#c084fc', label: 'Level Update',    verb: 'changed level for' },
  // Memberships
  membership_extended:{ icon: '🗓', color: '#4ade80', label: 'Extended',        verb: 'extended membership for' },
  // Members
  member_signup:      { icon: '👋', color: '#22c55e', label: 'New Member',      verb: 'joined the gym' },
  member_deactivated: { icon: '⏸', color: '#fb923c', label: 'Deactivated',      verb: 'deactivated' },
  member_reactivated: { icon: '▶', color: '#22c55e', label: 'Reactivated',      verb: 'reactivated' },
  member_deleted:     { icon: '🗑', color: '#e84a2f', label: 'Member Deleted',  verb: 'permanently deleted' },
  // Coaches (created by admin only — no public coach signup)
  coach_added:        { icon: '🥊', color: '#42a5f5', label: 'Coach Added',     verb: 'added coach' },
  coach_deleted:      { icon: '🗑', color: '#e84a2f', label: 'Coach Deleted',   verb: 'permanently deleted coach' },
}

/**
 * Fire an activity event. Best-effort — failure is non-fatal.
 *
 * @param {object} event - Event payload
 * @param {string} event.type - One of ACTIVITY_TYPES keys
 * @param {string} event.actorId - UID of who triggered the event
 * @param {string} event.actorName - Display name of the actor
 * @param {string} event.actorRole - 'member' | 'coach' | 'admin' | 'system'
 * @param {string} event.description - Pre-built human-readable description (optional, will be auto-generated if omitted)
 * @param {object} event.payload - Type-specific data (classId, memberId, oldLevel, etc.)
 */
export async function logActivity(event) {
  try {
    const t = ACTIVITY_TYPES[event.type]
    if (!t) {
      console.warn('[ACTIVITY] Unknown event type:', event.type)
      return
    }
    const description = event.description || autoDescription(event)
    const docRef = await addDoc(collection(db, 'activity'), {
      type: event.type,
      actorId: event.actorId || '',
      actorName: event.actorName || 'Someone',
      actorRole: event.actorRole || 'system',
      description,
      ...(event.payload || {}),
      createdAt: serverTimestamp(),
    })
    console.log(`[ACTIVITY] ✓ ${event.type} logged (id: ${docRef.id})`)
  } catch (err) {
    // Make failures VERY visible — most common reason: Firestore rules not republished
    console.error(`[ACTIVITY] ✗ FAILED to log ${event.type}:`, err.message)
    if (err.code === 'permission-denied' || err.message?.includes('permission')) {
      console.error('[ACTIVITY] 💡 Likely cause: firestore.rules not republished to Firebase Console. Go to Firebase Console → Firestore → Rules → Publish.')
    }
  }
}

/**
 * Build a human-readable description from event type + payload
 */
function autoDescription(event) {
  const p = event.payload || {}
  const actor = event.actorName || 'Someone'
  switch (event.type) {
    case 'booking_created':
      return `${actor} booked ${p.className || 'a class'}${p.classDay ? ` (${p.classDay} · ${p.classTime || ''})` : ''}`
    case 'booking_cancelled':
      return `${actor} cancelled ${p.className || 'a class'}${p.classDay ? ` (${p.classDay} · ${p.classTime || ''})` : ''} — slot freed`
    case 'class_created':
      return `${actor} created class: ${p.className || 'New Class'}${p.classDay ? ` (${p.classDay} · ${p.classTime || ''})` : ''}`
    case 'class_deleted':
      return `${actor} deleted class: ${p.className || 'a class'}`
    case 'class_ended':
      return p.isAuto
        ? `Auto-ended class: ${p.className || 'a class'}${p.classDay ? ` (${p.classDay} · ${p.classTime || ''})` : ''} — time passed${p.notifiedCount ? `, ${p.notifiedCount} member${p.notifiedCount===1?'':'s'} thanked` : ''}`
        : `${actor} marked class ended: ${p.className || 'a class'}${p.classDay ? ` (${p.classDay} · ${p.classTime || ''})` : ''}${p.notifiedCount ? ` — ${p.notifiedCount} member${p.notifiedCount===1?'':'s'} thanked` : ''}`
    case 'level_change':
      return `${actor} ${p.isPromote ? 'promoted' : 'moved'} ${p.memberName || 'a member'} to ${p.newLevel}${p.oldLevel ? ` (from ${p.oldLevel})` : ''}`
    case 'membership_extended':
      return `${actor} extended ${p.memberName || 'a member'}'s membership by ${p.days} day${p.days === 1 ? '' : 's'} (cash)`
    case 'member_signup':
      return `${actor} joined the gym${p.experience ? ` as ${p.experience}` : ''}`
    case 'member_deactivated':
      return `${actor} deactivated ${p.memberName || 'a member'}`
    case 'member_reactivated':
      return `${actor} reactivated ${p.memberName || 'a member'}`
    case 'member_deleted':
      return `${actor} permanently deleted ${p.memberName || 'a member'}`
    case 'coach_added':
      return `${actor} added coach ${p.coachName || 'a coach'}${p.specialization ? ` (${p.specialization})` : ''}`
    case 'coach_deleted':
      return `${actor} permanently deleted coach ${p.coachName || p.memberName || 'a coach'}`
    default:
      return `${actor} performed ${event.type}`
  }
}

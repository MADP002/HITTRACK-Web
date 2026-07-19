// ════════════════════════════════════════════════════════
//  HITTRACK — Membership Library
//
//  Derived-state architecture: we store DATES, not statuses.
//  The effective state is computed on read by comparing timestamps.
//  This eliminates "stored status drifts from reality" bugs.
//
//  States:
//    legacy  — pre-feature user, no membership field (grandfathered active)
//    none    — has membership object but no dates set
//    trial   — within 7-day free trial window, never paid
//    active  — has paid at least once, currently within expiresAt
//    paused  — admin froze the membership; expiry timer is held
//    expired — expiresAt is in the past
// ════════════════════════════════════════════════════════

export const STATUS = {
  LEGACY:  'legacy',
  NONE:    'none',
  TRIAL:   'trial',
  ACTIVE:  'active',
  PAUSED:  'paused',
  EXPIRED: 'expired',
}

export const TRIAL_DURATION_DAYS  = 7
export const DEFAULT_MONTHLY_DAYS = 30
export const EXPIRY_WARNING_DAYS  = 7

// ── Helpers ──────────────────────────────────────────────

// Convert Firestore Timestamp / Date / millis / ISO string → millis.
// Returns null for anything unparseable.
function toMillis(t) {
  if (t == null) return null
  if (typeof t === 'number') return t
  if (t.toMillis) return t.toMillis()                  // Firestore Timestamp
  if (t.seconds)  return t.seconds * 1000 + Math.floor((t.nanoseconds||0)/1e6)
  const d = new Date(t)
  return isNaN(d.getTime()) ? null : d.getTime()
}

// ── Core: compute effective state ────────────────────────

export function computeMembershipState(m) {
  if (!m || typeof m !== 'object') return STATUS.LEGACY

  // Paused trumps everything — the clock is frozen
  if (toMillis(m.pausedAt)) return STATUS.PAUSED

  // Find the relevant end date (active expiry preferred over trial)
  const expMs = toMillis(m.expiresAt) ?? toMillis(m.trialEndsAt)
  if (!expMs) return STATUS.NONE

  if (expMs < Date.now()) return STATUS.EXPIRED

  // Has paid before → active. Otherwise → still in trial window.
  return toMillis(m.startedAt) ? STATUS.ACTIVE : STATUS.TRIAL
}

// ── Date math ────────────────────────────────────────────

// Days remaining until expiry. Returns null if no expiry set.
// Negative when expired.
export function daysRemaining(m) {
  if (!m) return null
  const expMs = toMillis(m.expiresAt) ?? toMillis(m.trialEndsAt)
  if (!expMs) return null
  return Math.floor((expMs - Date.now()) / 86400000)
}

// Was the trial used? (prevents giving trial twice)
export function trialAlreadyUsed(m) {
  return !!(m && m.trialUsed)
}

// Should we show "expiring soon" warning?
export function isExpiringSoon(m, threshold = EXPIRY_WARNING_DAYS) {
  const state = computeMembershipState(m)
  if (state !== STATUS.ACTIVE && state !== STATUS.TRIAL) return false
  const d = daysRemaining(m)
  return d !== null && d > 0 && d <= threshold
}

// ── Permission gates ─────────────────────────────────────

// Can this member book classes?
// Legacy users (no membership object) are grandfathered as active.
export function canBook(m) {
  const state = computeMembershipState(m)
  return state !== STATUS.EXPIRED && state !== STATUS.PAUSED
}

// ── Display helpers ──────────────────────────────────────

export function getStatusLabel(state) {
  return {
    legacy:  'Legacy Member',
    none:    'No Membership',
    trial:   'Trial',
    active:  'Active',
    paused:  'Paused',
    expired: 'Expired',
  }[state] || state
}

export function getStatusColor(state) {
  return {
    legacy:  '#9ca3af',
    none:    '#6b7280',
    trial:   '#42a5f5',
    active:  '#4ade80',
    paused:  '#f5c842',
    expired: '#e84a2f',
  }[state] || '#888'
}

export function getStatusIcon(state) {
  return {
    legacy:  '👤',
    none:    '⚪',
    trial:   '🎁',
    active:  '✅',
    paused:  '⏸',
    expired: '🔒',
  }[state] || '•'
}

// Format expiry as friendly date — "Dec 15, 2025" or "—"
export function fmtExpiry(m) {
  const ms = toMillis(m?.expiresAt) ?? toMillis(m?.trialEndsAt)
  if (!ms) return '—'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

// Format remaining time as human readable — "3 days · expires Dec 15"
export function fmtRemaining(m) {
  const d = daysRemaining(m)
  if (d === null) return ''
  if (d < 0) return `Expired ${Math.abs(d)} day${Math.abs(d)===1?'':'s'} ago`
  if (d === 0) return 'Expires today'
  if (d === 1) return '1 day left'
  return `${d} days left`
}

// ── Pause math ───────────────────────────────────────────

// When resuming a paused membership, compute the new expiresAt.
// Extends forward by however many days were paused.
export function computeResumeExpiry(m) {
  if (!m?.pausedAt) return toMillis(m?.expiresAt)
  const pausedMs = toMillis(m.pausedAt)
  const expMs    = toMillis(m.expiresAt) ?? toMillis(m.trialEndsAt)
  if (!pausedMs || !expMs) return expMs
  const pausedDuration = Date.now() - pausedMs
  return expMs + pausedDuration
}

// Days that have been paused (cumulative including current pause if active)
export function totalPausedDays(m) {
  if (!m) return 0
  const stored = m.totalPauseDays || 0
  if (!m.pausedAt) return stored
  const pausedMs = toMillis(m.pausedAt)
  if (!pausedMs) return stored
  return stored + Math.floor((Date.now() - pausedMs) / 86400000)
}

// ════════════════════════════════════════════════════════════════
//  HITTRACK — Membership Plan Catalog
//  Wild Bout Fitness Gym, Makati — real rate card.
//
//  Single source of truth for pricing, shared by the admin Record
//  Payment modal and the public About Us page so prices never drift.
//
//  kind:
//    'subscription' — monthly training; extends membership by durationDays
//    'sessionpack'  — N-session pack; modeled as a VALIDITY WINDOW
//                     (access for durationDays; the desk tracks the count)
//    'dropin'       — single walk-in; RECORD-ONLY (logged to the payments
//                     ledger, does NOT change membership / access)
//
//  All amounts are in Philippine pesos (₱).
// ════════════════════════════════════════════════════════════════

export const DISCIPLINES = ['Boxing', 'Muay Thai', 'Private']

export const PLANS = [
  // ── Monthly Training (2 sessions/day) ──────────────────────────
  { id:'box-1mo',  discipline:'Boxing',    category:'Monthly Training', name:'1 Month',  amount:15600,  durationDays:30,  kind:'subscription' },
  { id:'box-3mo',  discipline:'Boxing',    category:'Monthly Training', name:'3 Months', amount:42900,  durationDays:90,  kind:'subscription' },
  { id:'box-6mo',  discipline:'Boxing',    category:'Monthly Training', name:'6 Months', amount:81900,  durationDays:180, kind:'subscription' },
  { id:'mt-1mo',   discipline:'Muay Thai', category:'Monthly Training', name:'1 Month',  amount:20800,  durationDays:30,  kind:'subscription' },
  { id:'mt-3mo',   discipline:'Muay Thai', category:'Monthly Training', name:'3 Months', amount:58500,  durationDays:90,  kind:'subscription' },
  { id:'mt-6mo',   discipline:'Muay Thai', category:'Monthly Training', name:'6 Months', amount:113100, durationDays:180, kind:'subscription' },

  // ── Group Session Packs (1 hour) — validity window ─────────────
  { id:'box-10s',  discipline:'Boxing',    category:'Session Pack', name:'10 Sessions', amount:3500, durationDays:30, kind:'sessionpack', sessions:10 },
  { id:'box-15s',  discipline:'Boxing',    category:'Session Pack', name:'15 Sessions', amount:5000, durationDays:45, kind:'sessionpack', sessions:15 },
  { id:'mt-10s',   discipline:'Muay Thai', category:'Session Pack', name:'10 Sessions', amount:4500, durationDays:30, kind:'sessionpack', sessions:10 },
  { id:'mt-15s',   discipline:'Muay Thai', category:'Session Pack', name:'15 Sessions', amount:6500, durationDays:45, kind:'sessionpack', sessions:15 },
  // Private 10-pack includes 1 free session (= 11). Poster shows no validity
  // window for private packs — defaulting to 30 days; admin can override via custom.
  { id:'priv-10s', discipline:'Private',   category:'Session Pack', name:'10 Sessions (+1 free)', amount:10000, durationDays:30, kind:'sessionpack', sessions:11 },

  // ── Drop-in single sessions (record-only, no membership change) ─
  { id:'box-1s',   discipline:'Boxing',    category:'Drop-in', name:'1 Session', amount:400,  durationDays:0, kind:'dropin' },
  { id:'mt-1s',    discipline:'Muay Thai', category:'Drop-in', name:'1 Session', amount:500,  durationDays:0, kind:'dropin' },
  { id:'priv-1s',  discipline:'Private',   category:'Drop-in', name:'1 Session', amount:1000, durationDays:0, kind:'dropin' },
]

// "Boxing · 3 Months" — the label stored on the membership / payment for receipts.
export function planLabel(plan) {
  if (!plan) return ''
  return `${plan.discipline} · ${plan.name}`
}

export function getPlan(id) {
  return PLANS.find(p => p.id === id) || null
}

export function plansForDiscipline(discipline) {
  return PLANS.filter(p => p.discipline === discipline)
}

// Format a peso amount with thousands separators: 15600 -> "₱15,600"
export function peso(n) {
  const v = Number(n) || 0
  return '₱' + v.toLocaleString('en-PH')
}

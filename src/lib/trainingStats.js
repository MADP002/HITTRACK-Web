// ============================================================
//  HITTRACK — Training Stats (shared source of truth)
//
//  ONE definition of streak / weekly% / total, derived from the
//  dated `trainingSessions` log. A "training day" = any day with a
//  session (Today's Workout completed OR camera Lab done). Web and
//  mobile both use this so the numbers always agree — no double
//  counting, no dayChecked-vs-mobile drift.
//
//  Pure: pass it an array of 'YYYY-MM-DD' strings. No Firestore, no React.
//  Keep this file identical in hittrack-web and the mobile app.
// ============================================================

function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// Monday 00:00 of the week containing `d`.
function startOfWeekMonday(d) {
  const x = new Date(d); x.setHours(0, 0, 0, 0)
  const dow = x.getDay()
  x.setDate(x.getDate() - (dow === 0 ? 6 : dow - 1))
  return x
}

// Core stats. dates: array of 'YYYY-MM-DD'. daysPerWeek: member's weekly target.
export function computeTrainingStats(dates, daysPerWeek = 3, now = new Date()) {
  const set = new Set(dates || [])
  const dpw = Math.min(Math.max(daysPerWeek || 3, 1), 7)

  // total = distinct training days
  const totalWorkouts = set.size

  // weeklyPct = distinct training days this (Mon–Sun) week / target
  const wkStart = startOfWeekMonday(now)
  let thisWeek = 0
  for (const ds of set) {
    if (new Date(ds + 'T00:00:00') >= wkStart) thisWeek++
  }
  const weeklyPct = Math.min(100, Math.round((thisWeek / dpw) * 100))

  // streak = consecutive training days ending today (or yesterday if today
  // isn't trained yet, so an active streak doesn't read 0 mid-morning).
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0)
  let streak = 0
  const cursor = new Date(today0)
  if (!set.has(ymd(cursor))) cursor.setDate(cursor.getDate() - 1)
  while (set.has(ymd(cursor))) {
    streak++
    cursor.setDate(cursor.getDate() - 1)
  }

  return { totalWorkouts, streak, weeklyPct }
}

// Weekly history for the adaptive engine — most-recent COMPLETED weeks first.
// Excludes the in-progress current week and weeks before the member's first
// session (so new/sporadic members can't trip a false "deload").
export function computeWeeklyHistory(dates, daysPerWeek = 3, weeksBack = 4, now = new Date()) {
  const set = new Set(dates || [])
  const dpw = Math.min(Math.max(daysPerWeek || 3, 1), 7)
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0)
  const thisMonday = startOfWeekMonday(today0)
  const sorted = [...set].sort()
  const firstMs = sorted.length ? new Date(sorted[0] + 'T00:00:00').getTime() : null
  const weeks = []
  for (let w = 1; w <= weeksBack; w++) {
    const start = new Date(thisMonday); start.setDate(start.getDate() - w * 7)
    const end = new Date(start); end.setDate(end.getDate() + 7)
    if (firstMs != null && end.getTime() <= firstMs) continue
    let trained = 0
    for (const ds of set) {
      const d = new Date(ds + 'T00:00:00')
      if (d >= start && d < end) trained++
    }
    weeks.push({ weekStart: ymd(start), pct: Math.min(100, Math.round((trained / dpw) * 100)) })
  }
  return weeks
}

// Missed days in a row = gap since last session − 1 (one rest day is fine).
// 0 if trained today or never trained.
export function computeMissedDays(dates, now = new Date()) {
  const set = new Set(dates || [])
  if (set.size === 0) return 0
  const today0 = new Date(now); today0.setHours(0, 0, 0, 0)
  if (set.has(ymd(today0))) return 0
  let lastMs = 0
  for (const ds of set) {
    const ms = new Date(ds + 'T00:00:00').getTime()
    if (ms > lastMs) lastMs = ms
  }
  const gapDays = Math.floor((today0.getTime() - lastMs) / 86400000)
  return Math.max(0, gapDays - 1)
}

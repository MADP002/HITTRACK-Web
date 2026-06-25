// ════════════════════════════════════════════════════════════════
//  CANONICAL MEMBER LEVEL — single source of truth for the whole web app.
//
//  Three systems historically wrote a member's level into different fields:
//    • users.experience / stats.experience  — admin/coach manual promote + signup (Capitalized)
//    • stats.trainingLevel                   — mobile training completion (lowercase)
//    • stats.currentLevel                    — legacy / signup copy
//
//  Priority (decided product-side): ADMIN WINS — but correctly.
//    • A manual coach/admin promote sets experience to Intermediate/Advanced
//      → that always wins.
//    • A plain 'Beginner' experience is the SIGNUP DEFAULT ("no override"),
//      so the mobile auto-level (trainingLevel) takes over when present.
//    • Then legacy currentLevel, then 'Beginner'.
//  NOTE: pure `experience ?? trainingLevel` would be wrong — experience is
//  almost always set (to at least 'Beginner'), so it would permanently mask
//  mobile level-ups. The Intermediate/Advanced check below is what makes
//  "admin wins, mobile is the default" actually work.
//  Admin DEMOTE to Beginner still sticks because changeMemberLevel writes
//  BOTH experience AND trainingLevel (lowercased), so trainingLevel reflects it.
//
//  Every screen MUST call getMemberLevel() / levelScore() instead of reading
//  the raw fields, so level logic can never drift across screens again.
// ════════════════════════════════════════════════════════════════

export const DIVISIONS = ['Beginner', 'Intermediate', 'Advanced']

// Display constants — keyed on the 3 canonical divisions.
export const LEVEL_BONUS = { Beginner: 0, Intermediate: 150, Advanced: 350 }
export const LEVEL_COLOR = { Beginner: '#fb923c', Intermediate: '#f5c842', Advanced: '#4ade80' }
export const LEVEL_ICON  = { Beginner: '🥊', Intermediate: '⚡', Advanced: '🔥' }

// Higher tiers that may exist in legacy data (e.g. old Home workout-count
// auto-leveling wrote Expert/Elite into stats.currentLevel). Clamp them DOWN
// to the nearest valid division (Advanced) rather than defaulting to Beginner.
const HIGHER_TIERS = ['Expert', 'Elite']

// Normalize one raw level value to a valid division, or '' if absent/unknown
// (so an empty value never masks a better source in the chain below).
function normTier(v) {
  if (v == null) return ''
  const lc = String(v).trim().toLowerCase()
  if (!lc) return ''
  const cap = lc.charAt(0).toUpperCase() + lc.slice(1)
  if (DIVISIONS.includes(cap)) return cap
  if (HIGHER_TIERS.includes(cap)) return 'Advanced'
  return ''
}

/**
 * Resolve a member's canonical division from a merged object.
 * @param {object} source - typically {...userDoc, ...statsDoc} or a profile.
 * @returns {'Beginner'|'Intermediate'|'Advanced'}
 */
export function getMemberLevel(source = {}) {
  const exp   = normTier(source?.experience)
  const train = normTier(source?.trainingLevel)
  // Manual promote (experience above Beginner) always wins.
  if (exp === 'Intermediate' || exp === 'Advanced') return exp
  // Otherwise the mobile auto-level is the truth, then the admin/signup
  // experience, then default. NOTE: legacy stats.currentLevel is intentionally
  // NOT consulted — old Home workout-count auto-leveling polluted it, and the
  // product rule is "level only comes from mobile training or admin promote."
  return train || exp || 'Beginner'
}

/**
 * Shared leaderboard score. Uses the canonical level for the bonus.
 * Accepts either totalWorkouts or workouts on the source.
 */
export function levelScore(u = {}) {
  const workouts = u.totalWorkouts ?? u.workouts ?? 0
  const streak   = u.streak   ?? 0
  const weeklyPct = u.weeklyPct ?? 0
  return (workouts * 10) + (streak * 5) + (LEVEL_BONUS[getMemberLevel(u)] || 0) + Math.round(weeklyPct * 1.5)
}

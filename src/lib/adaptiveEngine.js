// ============================================================
//  HITTRACK — Adaptive Program Engine
//  Pure rule-based decision logic. NO machine learning.
//  Every decision is explainable and auditable.
//
//  This module exports two main functions:
//    evaluateAdaptations(state) -> decisions[]
//    summarizeEngine(decisions) -> human-readable lines
//
//  Designed to be unit-testable (zero side effects).
// ============================================================

// ── Tunable thresholds (chosen from standard fitness coaching guidelines) ──
export const RULES = {
  CHAMPION_STREAK:        14,    // 14-day streak = habit-formed (James Clear, Atomic Habits)
  PERFECT_WEEK_PCT:       100,   // 100% completion threshold
  POOR_WEEK_PCT:          40,    // <40% = high dropout risk (industry benchmark)
  LEVEL_UP_WEEKS:         2,     // 2 perfect weeks → suggest level-up
  LEVEL_DOWN_WEEKS:       2,     // 2 poor weeks → suggest deload
  RESET_MISSED_THRESHOLD: 2,     // 2+ consecutive missed days → Reset Day
}

const LEVELS = ['Beginner', 'Intermediate', 'Advanced']

// ── Helpers ─────────────────────────────────────────────
function nextLevel(current) {
  const i = LEVELS.indexOf(current)
  return i >= 0 && i < LEVELS.length - 1 ? LEVELS[i + 1] : null
}
function prevLevel(current) {
  const i = LEVELS.indexOf(current)
  return i > 0 ? LEVELS[i - 1] : null
}
function fmtWhen() {
  return new Date().toISOString()
}

// ── Difficulty score 1–10 ───────────────────────────────
// Composite that reflects the member's current intensity load.
// Visible in the Adaptive Coach widget.
export function computeDifficulty(state) {
  const { experience = 'Beginner', streak = 0, weeklyPct = 0, totalWorkouts = 0 } = state
  const levelBase = { Beginner: 3, Intermediate: 6, Advanced: 8 }[experience] || 3
  const streakBonus = Math.min(streak / 14, 1) * 1.2     // up to +1.2 for 14d streak
  const weeklyBonus = (weeklyPct / 100) * 0.6            // up to +0.6 for 100%
  const veteranBonus = Math.min(totalWorkouts / 50, 1) * 0.4  // up to +0.4 for 50+ workouts
  return Math.min(10, Math.max(1, +(levelBase + streakBonus + weeklyBonus + veteranBonus).toFixed(1)))
}

// Same composite as computeDifficulty, but returns each component so the UI can
// explain WHY the score is what it is (Item 5 — difficulty breakdown).
export function computeDifficultyBreakdown(state) {
  const { experience = 'Beginner', streak = 0, weeklyPct = 0, totalWorkouts = 0 } = state
  const levelBase    = { Beginner: 3, Intermediate: 6, Advanced: 8 }[experience] || 3
  const streakBonus  = +(Math.min(streak / 14, 1) * 1.2).toFixed(2)
  const weeklyBonus  = +((weeklyPct / 100) * 0.6).toFixed(2)
  const veteranBonus = +(Math.min(totalWorkouts / 50, 1) * 0.4).toFixed(2)
  const total = Math.min(10, Math.max(1, +(levelBase + streakBonus + weeklyBonus + veteranBonus).toFixed(1)))
  return { level: experience, levelBase, streakBonus, weeklyBonus, veteranBonus, total }
}

// ──────────────────────────────────────────────────────
//  THE ENGINE
//
//  Input  state object:
//    {
//      experience, goal, streak, weeklyPct, totalWorkouts,
//      weeklyHistory: [{weekStart, pct}, ...],   // most-recent first
//      missedDaysInARow,
//      lastAdaptationAt,
//    }
//
//  Output: decisions[] — array of { rule, severity, title, message, action }
//    severity: 'info' | 'positive' | 'warning' | 'celebrate'
//    action:   optional function name the UI can call
// ──────────────────────────────────────────────────────
export function evaluateAdaptations(state) {
  const decisions = []
  const {
    experience = 'Beginner',
    streak = 0,
    weeklyPct = 0,
    weeklyHistory = [],
    missedDaysInARow = 0,
  } = state

  // ── RULE 1: Champion Mode (streak ≥ 14) ──
  if (streak >= RULES.CHAMPION_STREAK) {
    decisions.push({
      rule: 'CHAMPION_MODE',
      severity: 'celebrate',
      title: '🔥 Champion Mode Unlocked',
      message: `Your ${streak}-day streak qualifies you for Champion exercises. Power Sparring has been added to today's session.`,
      dataUsed: { streak, threshold: RULES.CHAMPION_STREAK },
      ts: fmtWhen(),
    })
  }

  // ── RULE 2: Suggest Level-Up (2 perfect weeks) ──
  const perfectWeeks = (weeklyHistory.slice(0, RULES.LEVEL_UP_WEEKS) || [])
    .filter(w => w.pct >= RULES.PERFECT_WEEK_PCT).length
  if (perfectWeeks >= RULES.LEVEL_UP_WEEKS) {
    const target = nextLevel(experience)
    if (target) {
      decisions.push({
        rule: 'SUGGEST_LEVEL_UP',
        severity: 'positive',
        title: '🚀 Ready to Level Up?',
        message: `You've crushed ${perfectWeeks} perfect weeks in a row. Talk to your coach about moving to ${target}.`,
        dataUsed: { perfectWeeks, currentLevel: experience, suggested: target, weeklyHistory: weeklyHistory.slice(0, RULES.LEVEL_UP_WEEKS) },
        ts: fmtWhen(),
      })
    }
  }

  // ── RULE 3: Suggest Deload / Recovery (2 poor weeks) ──
  const poorWeeks = (weeklyHistory.slice(0, RULES.LEVEL_DOWN_WEEKS) || [])
    .filter(w => w.pct < RULES.POOR_WEEK_PCT).length
  // Only suggest a deload if they're ALSO low THIS week — never contradict an
  // actively-training member (avoids "you're at 78% → we cut your volume").
  if (poorWeeks >= RULES.LEVEL_DOWN_WEEKS && weeklyPct < RULES.POOR_WEEK_PCT) {
    decisions.push({
      rule: 'SUGGEST_DELOAD',
      severity: 'warning',
      title: '💙 Easing You Back In',
      message: `Last 2 weeks averaged below 40% completion. We've reduced this week's volume so you can rebuild momentum.`,
      dataUsed: { poorWeeks, weeklyHistory: weeklyHistory.slice(0, RULES.LEVEL_DOWN_WEEKS) },
      ts: fmtWhen(),
    })
  }

  // ── RULE 4: Reset Day (2+ consecutive missed) ──
  if (missedDaysInARow >= RULES.RESET_MISSED_THRESHOLD) {
    decisions.push({
      rule: 'RESET_DAY',
      severity: 'warning',
      title: '🩹 Reset Day Activated',
      message: `You missed ${missedDaysInARow} days in a row. Today is a light Reset Day — warmup, mobility, light heavy bag. Your full session is rescheduled for tomorrow.`,
      dataUsed: { missedDaysInARow, threshold: RULES.RESET_MISSED_THRESHOLD },
      ts: fmtWhen(),
    })
  }

  // ── RULE 5: First-week welcome boost ──
  if (state.totalWorkouts > 0 && state.totalWorkouts <= 3) {
    decisions.push({
      rule: 'NEW_MEMBER_BOOST',
      severity: 'info',
      title: '👋 Welcome to HITTRACK',
      message: `You've logged ${state.totalWorkouts} workout${state.totalWorkouts === 1 ? '' : 's'}. The engine is learning your pace — keep going.`,
      dataUsed: { totalWorkouts: state.totalWorkouts },
      ts: fmtWhen(),
    })
  }

  // ── RULE 6: High weekly completion praise ──
  if (weeklyPct >= 80 && weeklyPct < 100 && streak < RULES.CHAMPION_STREAK) {
    decisions.push({
      rule: 'HIGH_WEEKLY',
      severity: 'positive',
      title: '⚡ Strong Week',
      message: `${weeklyPct}% completion this week. One more session puts you at perfect.`,
      dataUsed: { weeklyPct },
      ts: fmtWhen(),
    })
  }

  // ── RULE 7: Plateau warning (consistent but not improving) ──
  if (weeklyHistory.length >= 4) {
    const last4 = weeklyHistory.slice(0, 4).map(w => w.pct)
    const variance = Math.max(...last4) - Math.min(...last4)
    const avg = last4.reduce((a, b) => a + b, 0) / 4
    if (variance < 10 && avg >= 60 && avg < 85) {
      decisions.push({
        rule: 'PLATEAU',
        severity: 'info',
        title: '📊 Plateau Detected',
        message: `Last 4 weeks averaged ${avg.toFixed(0)}% with low variance. Consider trying a new goal or asking your coach for a fresh challenge.`,
        dataUsed: { last4, avg, variance },
        ts: fmtWhen(),
      })
    }
  }

  return decisions
}

// ──────────────────────────────────────────────────────
//  Build Reset Day workout (lighter version of any plan)
// ──────────────────────────────────────────────────────
export function buildResetDayWorkout() {
  return {
    title: 'Reset Day 🩹',
    duration: '15m',
    type: 'reset',
    exercises: [
      'Light Warm Up (5 min)',
      'Full-Body Mobility',
      'Easy Heavy Bag (1 round)',
      'Cool Down & Stretching',
    ],
  }
}

// ──────────────────────────────────────────────────────
//  Champion Mode bonus exercise (for streak ≥ 14)
// ──────────────────────────────────────────────────────
export function getChampionBonusExercise(goal) {
  const map = {
    'Compete':       '🥊 Power Sparring (Champion)',
    'Lose Weight':   '🔥 HIIT Finisher (Champion)',
    'Build Strength':'💪 Heavy Bag Power Round (Champion)',
    'Learn Boxing':  '✨ Technique Showcase (Champion)',
  }
  return map[goal] || '🔥 Champion Round'
}

// ──────────────────────────────────────────────────────
//  Day status — date-locking logic
//  Returns one of: 'past-done' | 'past-missed' | 'today' | 'locked'
// ──────────────────────────────────────────────────────
export function getDayStatus(scheduleIdx, dayChecked, allExercisesCount) {
  // schedule[0] = today by convention (buildSchedule is called with `new Date()`)
  // Negative indexes (past) aren't in the current schedule — we don't render them
  // schedule[idx] where idx > 0 = future (locked)
  if (scheduleIdx === 0) return 'today'
  if (scheduleIdx > 0)   return 'locked'
  // Past day rendering (if ever surfaced) — done if all checked
  const checked = dayChecked[scheduleIdx] || []
  if (allExercisesCount > 0 && checked.length === allExercisesCount && checked.every(Boolean)) return 'past-done'
  return 'past-missed'
}

// ──────────────────────────────────────────────────────
//  Compute "missed days in a row" looking BACKWARD in schedule history
//  We rely on stats.missedDaysInARow which is computed each session.
//  (See Home.jsx — Step 4)
// ──────────────────────────────────────────────────────
export function computeMissedStreak(history /* {date, didWorkout}[] */) {
  // history is reverse-chronological (most recent first)
  let count = 0
  for (const day of history || []) {
    if (day.didWorkout) break
    count++
  }
  return count
}

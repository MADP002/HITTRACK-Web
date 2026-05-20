// ════════════════════════════════════════════════════════
//  HITTRACK — Schedule Builder (Detailed Workout Engine)
//
//  Rich exercise prescriptions: rounds, duration, rest, cues,
//  calorie estimates. Goal-driven pools — Lose Weight,
//  Build Strength, Compete, Learn Boxing each get their own
//  exercise sets so the AI personalization is VISIBLE.
//
//  Backward-compatible: still exports EXERCISE_POOLS (flat
//  strings) for any legacy code that imported it.
// ════════════════════════════════════════════════════════

// ────────────────────────────────────────────────────────
//  EXERCISE TEMPLATES
//  Each entry: { name, type, rounds, duration_per_round (sec),
//  rest_seconds, focus, cues, est_calories }
//  type: warmup | striking | conditioning | technique | strength | recovery
// ────────────────────────────────────────────────────────
const E = {
  // ── WARM UPS ─────────────────────────────────────────
  warmup_dynamic:   { name:'Dynamic Warm Up',     type:'warmup', rounds:1, duration_per_round:300, rest_seconds:0,
                      focus:'Wake up your body — joints, hips, shoulders',
                      cues:['Move slow at first','Open up the hip flexors','Roll the shoulders back'],
                      est_calories:30 },
  warmup_jumprope:  { name:'Jump Rope Warmup',    type:'warmup', rounds:2, duration_per_round:120, rest_seconds:30,
                      focus:'Light cardio + footwork rhythm',
                      cues:['Stay on the balls of your feet','Wrists do the work','Find a rhythm'],
                      est_calories:50 },
  warmup_active:    { name:'Active Mobility',     type:'warmup', rounds:1, duration_per_round:360, rest_seconds:0,
                      focus:'Athletic prep — full range of motion',
                      cues:['Big movements','Open chest, hips, ankles','Get the heart rate up'],
                      est_calories:40 },
  warmup_athletic:  { name:'Athletic Warmup',     type:'warmup', rounds:1, duration_per_round:420, rest_seconds:0,
                      focus:'Sport-specific activation',
                      cues:['Mimic fight-stance movement','Stay light on your feet','Build intensity gradually'],
                      est_calories:55 },
  warmup_skill:     { name:'Skill-Based Warmup',  type:'warmup', rounds:1, duration_per_round:360, rest_seconds:0,
                      focus:'Movement primers + footwork drills',
                      cues:['Quality over speed','Feel the stance','Engage your core'],
                      est_calories:45 },

  // ── STRIKING — Lose Weight ───────────────────────────
  jumprope_intervals: { name:'Jump Rope Intervals', type:'conditioning', rounds:3, duration_per_round:180, rest_seconds:45,
                        focus:'Burn calories + build wind',
                        cues:['Push pace last 30 sec','Mix double-unders if you can','Steady breathing'],
                        est_calories:180 },
  shadow_cardio:    { name:'Shadow Cardio',        type:'striking', rounds:3, duration_per_round:180, rest_seconds:60,
                      focus:'Non-stop punches + movement',
                      cues:['Throw 20+ punches per round','Move every 5 seconds','Visualize your opponent'],
                      est_calories:160 },
  light_bag_burn:   { name:'Light Bag Burn',       type:'striking', rounds:3, duration_per_round:180, rest_seconds:60,
                      focus:'High-volume light punches for cardio',
                      cues:['Speed over power','Stay in stance','Constant motion'],
                      est_calories:200 },
  hiit_bag_rounds:  { name:'HIIT Bag Rounds',      type:'striking', rounds:4, duration_per_round:120, rest_seconds:30,
                      focus:'Max-effort intervals — heavy bag',
                      cues:['Sprint pace 30 sec / steady 30 sec','Power on the buzzer','Don\'t pace yourself'],
                      est_calories:280 },
  cardio_combos:    { name:'Cardio Combinations',  type:'striking', rounds:4, duration_per_round:150, rest_seconds:45,
                      focus:'Combo flurries with movement',
                      cues:['1-2-3-2-1 patterns','Pivot after every combo','Reset, repeat'],
                      est_calories:240 },
  sprint_intervals: { name:'Sprint Intervals',     type:'conditioning', rounds:5, duration_per_round:60, rest_seconds:60,
                      focus:'Anaerobic bursts',
                      cues:['Sprint hard for 30','Walk for 30','Repeat'],
                      est_calories:200 },
  hiit_circuit:     { name:'Elite HIIT Circuit',   type:'conditioning', rounds:5, duration_per_round:120, rest_seconds:30,
                      focus:'Punches + plyometrics on rotation',
                      cues:['Burpees → bag → squat jumps','No rest between exercises','Push to failure'],
                      est_calories:340 },
  metabolic_cond:   { name:'Metabolic Conditioning', type:'conditioning', rounds:4, duration_per_round:180, rest_seconds:45,
                      focus:'Sustained high heart rate',
                      cues:['Combine bag, rope, calisthenics','Breathing through nose','Stay above 80% max HR'],
                      est_calories:300 },

  // ── STRIKING — Build Strength ────────────────────────
  heavy_bag_basic:  { name:'Heavy Bag Basics',     type:'striking', rounds:3, duration_per_round:180, rest_seconds:90,
                      focus:'Power generation through stance',
                      cues:['Drive from the back foot','Rotate the hip','Exhale on every punch'],
                      est_calories:200 },
  slow_bag_power:   { name:'Slow Bag — Power',     type:'striking', rounds:3, duration_per_round:180, rest_seconds:90,
                      focus:'Heavy punches with full body weight',
                      cues:['One punch at a time','Maximum hip rotation','Feel the impact'],
                      est_calories:180 },
  power_punching:   { name:'Power Punching',       type:'striking', rounds:4, duration_per_round:180, rest_seconds:60,
                      focus:'Develop knockout power',
                      cues:['Sit down on the punch','Drive through the bag','Recover stance instantly'],
                      est_calories:260 },
  heavy_bag_rounds: { name:'Heavy Bag Rounds',     type:'striking', rounds:4, duration_per_round:180, rest_seconds:60,
                      focus:'Fight-pace power work',
                      cues:['3-4 hard punches per combination','Active rest with footwork','Stay loose'],
                      est_calories:280 },
  resistance_bag:   { name:'Resistance Bag Work',  type:'striking', rounds:4, duration_per_round:150, rest_seconds:75,
                      focus:'Punching against resistance bands',
                      cues:['Slow and forceful','Engage the lats','Control the eccentric'],
                      est_calories:240 },
  max_power_rounds: { name:'Max Power Rounds',     type:'striking', rounds:5, duration_per_round:180, rest_seconds:60,
                      focus:'All-out power — every punch counts',
                      cues:['No wasted motion','Knockout intent','Mental focus locked in'],
                      est_calories:340 },

  // ── STRIKING — Compete ───────────────────────────────
  pad_work_intro:   { name:'Pad Work Intro',       type:'technique', rounds:3, duration_per_round:180, rest_seconds:60,
                      focus:'Coach-led combination patterns',
                      cues:['Listen for the call','Snap punches back','Reset stance every combo'],
                      est_calories:200 },
  combo_basics:     { name:'Combination Basics',   type:'technique', rounds:3, duration_per_round:180, rest_seconds:60,
                      focus:'1-2, 1-2-3, 1-2-3-2 patterns',
                      cues:['Numbers in order','Speed builds with reps','Footwork between combos'],
                      est_calories:180 },
  sparring_drills:  { name:'Sparring Drills',      type:'technique', rounds:3, duration_per_round:180, rest_seconds:90,
                      focus:'Controlled live exchanges',
                      cues:['Light contact','Work on one thing per round','Reset on the bell'],
                      est_calories:240 },
  ring_strategy:    { name:'Ring Strategy Drills', type:'technique', rounds:3, duration_per_round:180, rest_seconds:60,
                      focus:'Cutting the ring + escape angles',
                      cues:['Don\'t go straight back','Pivot to angles','Control the center'],
                      est_calories:200 },
  combination_spar: { name:'Combination Sparring', type:'technique', rounds:4, duration_per_round:180, rest_seconds:90,
                      focus:'Live combos with a partner',
                      cues:['Throw 3+ punches per exchange','Defense after every combo','Stay disciplined'],
                      est_calories:280 },
  full_sparring:    { name:'Full Sparring',        type:'technique', rounds:5, duration_per_round:180, rest_seconds:60,
                      focus:'Competition-pace sparring',
                      cues:['Game plan execution','Stay composed under pressure','Trust your training'],
                      est_calories:380 },
  fight_simulation: { name:'Fight Simulation',     type:'technique', rounds:5, duration_per_round:180, rest_seconds:60,
                      focus:'Replicate real fight scenarios',
                      cues:['Round-by-round adjustments','Energy management','Visualize the win'],
                      est_calories:400 },

  // ── STRIKING / TECHNIQUE — Learn Boxing ──────────────
  shadow_box_basic: { name:'Shadow Boxing — Basics', type:'technique', rounds:3, duration_per_round:180, rest_seconds:60,
                      focus:'Stance, jab, footwork in the mirror',
                      cues:['Always return to guard','Light on your feet','Watch your form in the mirror'],
                      est_calories:140 },
  jab_drills:       { name:'Jab Drills',           type:'technique', rounds:3, duration_per_round:180, rest_seconds:60,
                      focus:'Master the most important punch',
                      cues:['Snap it out and back','Don\'t telegraph','Step with the punch'],
                      est_calories:160 },
  cross_technique:  { name:'Cross Technique',      type:'technique', rounds:3, duration_per_round:180, rest_seconds:60,
                      focus:'Power straight from the rear hand',
                      cues:['Rotate the back foot','Hip drives the punch','Chin tucked behind shoulder'],
                      est_calories:170 },
  footwork_basics:  { name:'Footwork Basics',      type:'technique', rounds:3, duration_per_round:150, rest_seconds:45,
                      focus:'In-out, side-to-side movement',
                      cues:['Push off the back foot','Stay in stance','Small steps, not big steps'],
                      est_calories:130 },
  guard_practice:   { name:'Guard Practice',       type:'technique', rounds:2, duration_per_round:180, rest_seconds:60,
                      focus:'Defensive hand positioning',
                      cues:['Hands by the temples','Elbows tight to ribs','Catch, parry, slip'],
                      est_calories:100 },
  slip_drills:      { name:'Slip Drills',          type:'technique', rounds:3, duration_per_round:150, rest_seconds:60,
                      focus:'Head movement defense',
                      cues:['Slip from the legs','Don\'t over-commit','Counter as you slip'],
                      est_calories:140 },
  counter_punching: { name:'Counter Punching',     type:'technique', rounds:3, duration_per_round:180, rest_seconds:60,
                      focus:'Punch after slipping/blocking',
                      cues:['Slip → counter','Block → counter','Make them pay'],
                      est_calories:200 },
  mitt_work:        { name:'Mitt Work',            type:'technique', rounds:3, duration_per_round:180, rest_seconds:75,
                      focus:'Coach-called combinations on mitts',
                      cues:['Crisp, snappy punches','Listen to coach','Reset between combos'],
                      est_calories:240 },
  advanced_combos:  { name:'Advanced Combinations', type:'technique', rounds:4, duration_per_round:180, rest_seconds:60,
                      focus:'4-5 punch sequences with movement',
                      cues:['Don\'t skip footwork','Vary head/body targets','End with defense'],
                      est_calories:260 },
  reflex_training:  { name:'Reflex Training',      type:'technique', rounds:3, duration_per_round:120, rest_seconds:60,
                      focus:'Speed bag, double-end bag, slip rope',
                      cues:['Eyes track the target','Hands stay up','Rhythm builds reflexes'],
                      est_calories:180 },

  // ── STRENGTH / CORE ──────────────────────────────────
  core_basic:       { name:'Core Circuit',         type:'strength', rounds:2, duration_per_round:180, rest_seconds:60,
                      focus:'Plank, crunches, leg raises',
                      cues:['Quality reps','Brace the core','Breathe through the burn'],
                      est_calories:80 },
  pushup_sets:      { name:'Push-up Sets',         type:'strength', rounds:3, duration_per_round:60, rest_seconds:60,
                      focus:'Upper body endurance',
                      cues:['Chest to floor','Body in a line','Slow descent'],
                      est_calories:90 },
  squat_combos:     { name:'Squat + Punch Combos', type:'strength', rounds:3, duration_per_round:90, rest_seconds:45,
                      focus:'Explosive lower-body + punching',
                      cues:['Drop low','Drive up with punches','Repeat'],
                      est_calories:120 },
  plank_holds:      { name:'Plank Holds',          type:'strength', rounds:3, duration_per_round:45, rest_seconds:30,
                      focus:'Core endurance',
                      cues:['Body in a line','Engage glutes','Don\'t let hips sag'],
                      est_calories:50 },
  resistance_bands: { name:'Resistance Band Work', type:'strength', rounds:3, duration_per_round:120, rest_seconds:60,
                      focus:'Shoulder + punch endurance',
                      cues:['Slow and controlled','Punch through resistance','Both arms'],
                      est_calories:130 },
  explosive_pushup: { name:'Explosive Push-ups',   type:'strength', rounds:3, duration_per_round:45, rest_seconds:60,
                      focus:'Power through the chest',
                      cues:['Hands off the floor','Reset stance','Maximum effort'],
                      est_calories:100 },
  core_power:       { name:'Core Power Circuit',   type:'strength', rounds:3, duration_per_round:180, rest_seconds:45,
                      focus:'Russian twists, V-ups, hollow holds',
                      cues:['Engage every rep','No bouncing','Quality > speed'],
                      est_calories:140 },
  plyometrics:      { name:'Plyometric Sets',      type:'strength', rounds:3, duration_per_round:90, rest_seconds:60,
                      focus:'Box jumps, jump squats, plyo push-ups',
                      cues:['Explosive intent','Soft landings','Reset every rep'],
                      est_calories:160 },
  burpee_sets:      { name:'Burpee Sets',          type:'strength', rounds:3, duration_per_round:60, rest_seconds:60,
                      focus:'Full-body conditioning',
                      cues:['Chest to floor','Jump high','Don\'t stop mid-set'],
                      est_calories:120 },
  pressure_rounds:  { name:'Pressure Rounds',      type:'strength', rounds:3, duration_per_round:120, rest_seconds:30,
                      focus:'Non-stop output under fatigue',
                      cues:['Punch through tiredness','Stay technical','This is where fights are won'],
                      est_calories:200 },

  // ── COOL DOWNS ───────────────────────────────────────
  cooldown_stretch: { name:'Cool Down Stretch',    type:'recovery', rounds:1, duration_per_round:300, rest_seconds:0,
                      focus:'Static stretches — hold 30s each',
                      cues:['Breathe deep','Hold each stretch','Don\'t bounce'],
                      est_calories:20 },
  cooldown_breath:  { name:'Breathwork & Recovery', type:'recovery', rounds:1, duration_per_round:240, rest_seconds:0,
                      focus:'Lower heart rate, recover',
                      cues:['Box breathing','4 in, 4 hold, 4 out, 4 hold','Calm the nervous system'],
                      est_calories:15 },
  cooldown_active:  { name:'Active Cool Down',     type:'recovery', rounds:1, duration_per_round:300, rest_seconds:0,
                      focus:'Light walk + dynamic stretches',
                      cues:['Loosen the legs','Open the hips','Slow it all down'],
                      est_calories:25 },
  cooldown_full:    { name:'Recovery Protocol',    type:'recovery', rounds:1, duration_per_round:420, rest_seconds:0,
                      focus:'Foam rolling + targeted stretching',
                      cues:['Spend extra time on tight spots','Breathe through discomfort','Hydrate'],
                      est_calories:30 },
}

// ────────────────────────────────────────────────────────
//  POOLS — Goal × Level → which exercise templates to draw from
//  Each section: warmup, main, strength, cooldown
// ────────────────────────────────────────────────────────
const POOLS = {
  Beginner: {
    'Lose Weight': {
      warmup:   ['warmup_jumprope', 'warmup_dynamic'],
      main:     ['jumprope_intervals', 'shadow_cardio', 'light_bag_burn'],
      strength: ['core_basic', 'burpee_sets', 'plank_holds'],
      cooldown: ['cooldown_stretch', 'cooldown_breath'],
    },
    'Build Strength': {
      warmup:   ['warmup_dynamic', 'warmup_active'],
      main:     ['heavy_bag_basic', 'slow_bag_power', 'resistance_bands'],
      strength: ['pushup_sets', 'squat_combos', 'plank_holds', 'core_basic'],
      cooldown: ['cooldown_stretch', 'cooldown_breath'],
    },
    'Compete': {
      warmup:   ['warmup_athletic', 'warmup_jumprope'],
      main:     ['pad_work_intro', 'combo_basics', 'shadow_box_basic'],
      strength: ['core_basic', 'pushup_sets', 'plank_holds'],
      cooldown: ['cooldown_stretch', 'cooldown_active'],
    },
    'Learn Boxing': {
      warmup:   ['warmup_dynamic', 'warmup_jumprope'],
      main:     ['shadow_box_basic', 'jab_drills', 'cross_technique', 'footwork_basics', 'guard_practice', 'slip_drills'],
      strength: ['core_basic', 'pushup_sets'],
      cooldown: ['cooldown_stretch'],
    },
  },
  Intermediate: {
    'Lose Weight': {
      warmup:   ['warmup_active', 'warmup_jumprope'],
      main:     ['hiit_bag_rounds', 'cardio_combos', 'sprint_intervals', 'shadow_cardio'],
      strength: ['burpee_sets', 'core_power', 'plyometrics'],
      cooldown: ['cooldown_active', 'cooldown_breath'],
    },
    'Build Strength': {
      warmup:   ['warmup_active', 'warmup_dynamic'],
      main:     ['power_punching', 'heavy_bag_rounds', 'resistance_bag'],
      strength: ['explosive_pushup', 'plyometrics', 'core_power', 'squat_combos'],
      cooldown: ['cooldown_stretch', 'cooldown_active'],
    },
    'Compete': {
      warmup:   ['warmup_athletic', 'warmup_skill'],
      main:     ['sparring_drills', 'ring_strategy', 'combination_spar', 'mitt_work'],
      strength: ['pressure_rounds', 'core_power', 'plyometrics'],
      cooldown: ['cooldown_active', 'cooldown_breath'],
    },
    'Learn Boxing': {
      warmup:   ['warmup_skill', 'warmup_dynamic'],
      main:     ['counter_punching', 'mitt_work', 'advanced_combos', 'slip_drills', 'reflex_training'],
      strength: ['core_power', 'pushup_sets', 'plank_holds'],
      cooldown: ['cooldown_stretch', 'cooldown_active'],
    },
  },
  Advanced: {
    'Lose Weight': {
      warmup:   ['warmup_athletic', 'warmup_active'],
      main:     ['hiit_circuit', 'metabolic_cond', 'hiit_bag_rounds', 'sprint_intervals'],
      strength: ['plyometrics', 'burpee_sets', 'core_power'],
      cooldown: ['cooldown_full', 'cooldown_breath'],
    },
    'Build Strength': {
      warmup:   ['warmup_athletic', 'warmup_active'],
      main:     ['max_power_rounds', 'resistance_bag', 'power_punching', 'heavy_bag_rounds'],
      strength: ['explosive_pushup', 'plyometrics', 'core_power'],
      cooldown: ['cooldown_full', 'cooldown_stretch'],
    },
    'Compete': {
      warmup:   ['warmup_athletic', 'warmup_skill'],
      main:     ['full_sparring', 'fight_simulation', 'combination_spar', 'sparring_drills'],
      strength: ['pressure_rounds', 'plyometrics', 'core_power'],
      cooldown: ['cooldown_full', 'cooldown_breath'],
    },
    'Learn Boxing': {
      warmup:   ['warmup_skill', 'warmup_athletic'],
      main:     ['advanced_combos', 'counter_punching', 'mitt_work', 'reflex_training', 'slip_drills'],
      strength: ['core_power', 'pressure_rounds', 'plyometrics'],
      cooldown: ['cooldown_full', 'cooldown_stretch'],
    },
  },
}

// ────────────────────────────────────────────────────────
//  SMART AUTO-TITLES per goal — rotates daily
// ────────────────────────────────────────────────────────
const TITLES = {
  'Lose Weight':    ['CARDIO BURN', 'HIIT DAY', 'CONDITIONING', 'ENDURANCE', 'SWEAT SESSION'],
  'Build Strength': ['POWER DAY', 'STRENGTH BLOCK', 'HEAVY DAY', 'IRON DAY', 'POWER WORK'],
  'Compete':        ['SPARRING PREP', 'TECHNIQUE DAY', 'COMBAT DRILLS', 'FIGHT CAMP', 'WAR DAY'],
  'Learn Boxing':   ['FUNDAMENTALS', 'BASICS DRILL', 'SKILL BUILDER', 'FORM DAY', 'FOUNDATION'],
}

// ────────────────────────────────────────────────────────
//  Helper — pick N items from pool deterministically (by seed)
// ────────────────────────────────────────────────────────
function pickN(pool, n, seed) {
  if (!pool || pool.length === 0) return []
  if (pool.length <= n) return [...pool]
  // Rotate based on seed so different days get different exercises
  const start = seed % pool.length
  const result = []
  const used = new Set()
  for (let i = 0; result.length < n && i < pool.length * 2; i++) {
    const idx = (start + i) % pool.length
    if (!used.has(idx)) { used.add(idx); result.push(pool[idx]) }
  }
  return result
}

// ────────────────────────────────────────────────────────
//  Build a single workout — 6 exercises (1 warmup + 3 main + 1 strength + 1 cooldown)
// ────────────────────────────────────────────────────────
export function buildWorkout(experience, goal, seed, weeklyProgramFocus) {
  const lvl = (experience && POOLS[experience]) ? experience : 'Beginner'
  const gl  = (goal && POOLS[lvl]?.[goal]) ? goal : 'Learn Boxing'
  const pool = POOLS[lvl][gl]

  const warmupKey   = pickN(pool.warmup, 1, seed)[0]
  const mainKeys    = pickN(pool.main, 3, seed)
  const strengthKey = pickN(pool.strength, 1, seed + 1)[0]
  const cooldownKey = pickN(pool.cooldown, 1, seed)[0]

  const exerciseKeys = [warmupKey, ...mainKeys, strengthKey, cooldownKey].filter(Boolean)
  const exercises = exerciseKeys.map(k => E[k]).filter(Boolean)

  // Total duration (sum of rounds × duration + rests between)
  const totalSec = exercises.reduce((sum, ex) => {
    const work = (ex.rounds || 1) * (ex.duration_per_round || 0)
    const rest = Math.max(0, (ex.rounds || 1) - 1) * (ex.rest_seconds || 0)
    return sum + work + rest
  }, 0)
  const durationMin = Math.round(totalSec / 60)

  // Total estimated calories
  const totalCalories = exercises.reduce((sum, ex) => sum + (ex.est_calories || 0), 0)

  // Smart auto-title — rotates per day
  const titlePool = TITLES[gl] || TITLES['Learn Boxing']
  const title = titlePool[seed % titlePool.length]

  return {
    title,                                             // big bold headline
    subtitle: weeklyProgramFocus || gl,                // session focus
    goal: gl,                                          // for display + filtering
    difficulty: lvl,                                   // matches user level
    duration: `${durationMin}m`,
    totalCalories,
    exercises,                                         // array of detailed objects
  }
}

// ────────────────────────────────────────────────────────
//  Default weekly program (focus themes) — used as subtitle
// ────────────────────────────────────────────────────────
export const DEFAULT_PROGRAM = ['Jab Fundamentals','Cross Technique','Footwork Basics','Defense Drills','Combination Work']

// ────────────────────────────────────────────────────────
//  Backward-compat: flat string EXERCISE_POOLS export
//  (keeps any legacy import working)
// ────────────────────────────────────────────────────────
export const EXERCISE_POOLS = {
  Beginner: {
    'Learn Boxing':   ['Shadow Boxing','Jump Rope','Jab Drills','Cross Technique','Footwork Basics','Guard Practice','Slip Drills','Bob & Weave'],
    'Lose Weight':    ['Jump Rope Intervals','Shadow Cardio','Light Bag Work','Footwork Circuits','Speed Drills','Core Conditioning','Lateral Movement','High Knees'],
    'Build Strength': ['Heavy Bag Basics','Push-up Combos','Core Circuit','Stance Power','Slow Bag Work','Resistance Bands','Plank Holds','Squat Combos'],
    'Compete':        ['Basic Sparring Prep','Pad Work Intro','Combo Basics','Ring Awareness','Stamina Laps','Reaction Drills','Defense Basics','Counter Prep'],
  },
  Intermediate: {
    'Learn Boxing':   ['Counter Punching','Slips & Rolls','Advanced Combos','Mitt Work','Pressure Fighting','Footwork Patterns','Defensive Rolls','Body Shots'],
    'Lose Weight':    ['HIIT Bag Rounds','Cardio Combos','Sprint Intervals','Endurance Circuits','Speed Bag','Lateral Movement','Tabata Rounds','Jump Rope HIIT'],
    'Build Strength': ['Power Punching','Heavy Bag Rounds','Explosive Push-ups','Core Power','Resistance Training','Medicine Ball','Plyometrics','Strength Combos'],
    'Compete':        ['Sparring Drills','Ring Strategy','Speed & Reaction','Combination Sparring','Defense Patterns','Pressure Rounds','Clinch Work','Counter Timing'],
  },
  Advanced: {
    'Learn Boxing':   ['Advanced Defense','Complex Combinations','Tactical Sparring','Elite Mitt Work','Match Simulation','Reflex Training','Feinting','Inside Fighting'],
    'Lose Weight':    ['Elite HIIT Circuit','Full Cardio Rounds','Explosive Bag Work','Advanced Footwork','Competition Pace','Peak Cardio','Metabolic Conditioning','Max Effort Rounds'],
    'Build Strength': ['Max Power Rounds','Resistance Bag Work','Elite Core Circuit','Explosive Training','Peak Strength','Heavy Sparring','Strength-Speed Combos','Power Endurance'],
    'Compete':        ['Full Sparring','Competition Strategy','Elite Conditioning','Fight Simulation','Peak Performance','Tactical Analysis','Championship Prep','Pressure Testing'],
  },
}

// ────────────────────────────────────────────────────────
//  Main export — buildSchedule (signature unchanged)
// ────────────────────────────────────────────────────────
/** @param {object} profile member profile fields (daysPerWeek, weeklyProgram, experience, goal) */
export function buildSchedule(profile, anchorDate = new Date()) {
  const anchor = anchorDate instanceof Date ? anchorDate : new Date()
  const daysPerWeek = Math.min(profile?.daysPerWeek || 3, 7)
  const program     = profile?.weeklyProgram || DEFAULT_PROGRAM
  const exp         = profile?.experience    || 'Beginner'
  const goal        = profile?.goal          || 'Learn Boxing'
  const spacing     = Math.round(7 / daysPerWeek)
  const workoutSlots= Array.from({length:daysPerWeek}, (_,i)=>(i*spacing)%7)

  return Array.from({length:28}, (_,i)=>{
    const date = new Date(anchor)
    date.setDate(anchor.getDate() + i)
    const slotInWeek = i % 7
    const weekNum    = Math.floor(i / 7)
    const isWorkout  = workoutSlots.includes(slotInWeek)
    const wNum       = workoutSlots.indexOf(slotInWeek)
    const progIdx    = ((weekNum * daysPerWeek) + Math.max(0, wNum)) % program.length
    const seed       = (weekNum * daysPerWeek) + Math.max(0, wNum)
    return {
      idx: i, date,
      dayName: date.toLocaleDateString('en-US', {weekday:'short'}),
      dateStr: date.toLocaleDateString('en-US', {month:'short', day:'numeric'}),
      isToday: i === 0, isWorkout,
      workout: isWorkout ? buildWorkout(exp, goal, seed, program[progIdx]) : null,
    }
  })
}

// ────────────────────────────────────────────────────────
//  Helper exports — useful for Home.jsx renderer
// ────────────────────────────────────────────────────────

/** Format duration in seconds → "3 min" or "45 sec" */
export function fmtDuration(sec) {
  if (!sec) return ''
  if (sec >= 60) {
    const m = Math.floor(sec / 60)
    const s = sec % 60
    return s === 0 ? `${m} min` : `${m}m ${s}s`
  }
  return `${sec} sec`
}

/** Detect whether an "exercise" entry is the new rich object or a legacy string */
export function isRichExercise(ex) {
  return ex && typeof ex === 'object' && typeof ex.name === 'string'
}

/** Get a display name for any exercise (string or object) */
export function exerciseName(ex) {
  if (typeof ex === 'string') return ex
  if (isRichExercise(ex)) return ex.name
  return '—'
}

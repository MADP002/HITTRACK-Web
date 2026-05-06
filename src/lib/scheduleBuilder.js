// Shared with member Home dashboard and coach feedback — same rules = same "today" / week view.

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

export const DEFAULT_PROGRAM = ['Jab Fundamentals','Cross Technique','Footwork Basics','Defense Drills','Combination Work']

/** @param {object} profile member profile fields (daysPerWeek, weeklyProgram, experience, goal) */
export function buildSchedule(profile, anchorDate = new Date()) {
  const anchor = anchorDate instanceof Date ? anchorDate : new Date()
  const daysPerWeek = Math.min(profile?.daysPerWeek || 3, 7)
  const program     = profile?.weeklyProgram || DEFAULT_PROGRAM
  const exp         = profile?.experience    || 'Beginner'
  const goal        = profile?.goal          || 'Learn Boxing'
  const pool        = EXERCISE_POOLS[exp]?.[goal] || EXERCISE_POOLS.Beginner['Learn Boxing']
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
    const exOff      = ((weekNum * daysPerWeek) + Math.max(0, wNum)) * 2
    return {
      idx: i, date,
      dayName: date.toLocaleDateString('en-US', {weekday:'short'}),
      dateStr: date.toLocaleDateString('en-US', {month:'short', day:'numeric'}),
      isToday: i === 0, isWorkout,
      workout: isWorkout ? {
        title: program[progIdx],
        exercises: ['Warm Up', pool[exOff % pool.length], pool[(exOff+1) % pool.length], 'Cool Down'],
        duration: `${35 + (weekNum*5)}m`,
      } : null,
    }
  })
}

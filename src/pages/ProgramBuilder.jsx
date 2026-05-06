import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { doc, setDoc } from 'firebase/firestore'
import { auth, db } from '../firebase'

// Program Builder uses setDoc with merge=true so it can write ALL fields
// including locked ones (stance, experience, goal, weeklyProgram)
// This is the ONE TIME setup — rules allow create on first setup
async function saveToFirestore(profile) {
  try {
    const user = auth.currentUser
    if (!user) return
    await setDoc(doc(db, 'users', user.uid), {
      ...profile,
      updatedAt: new Date().toISOString(),
    }, { merge: true })
    console.log('Program saved to Firestore successfully')
  } catch (err) {
    console.warn('Firestore save warning:', err.message)
    // Even if Firestore fails, localStorage is already saved
    // App will use localStorage as fallback
  }
}

// ── CONSTANTS ─────────────────────────────────────────
const STEPS = [
  { id: 'basic',  title: 'Basic Info',    icon: '👤', desc: 'Tell us who you are' },
  { id: 'body',   title: 'Body Stats',    icon: '📏', desc: 'We calculate your BMI' },
  { id: 'boxing', title: 'Boxing Style',  icon: '🥊', desc: 'Your stance & experience' },
  { id: 'goals',  title: 'Your Goals',    icon: '🎯', desc: 'What you want to achieve' },
]

const STANCES = [
  { id: 'Orthodox', emoji: '🥊', desc: 'Left foot forward, right hand power punch' },
  { id: 'Southpaw', emoji: '🥊', desc: 'Right foot forward, left hand power punch' },
]

const EXPERIENCES = [
  { id: 'Beginner',     icon: '🌱', desc: 'New to boxing, just starting out' },
  { id: 'Intermediate', icon: '⚡', desc: 'Know the basics, ready to level up' },
  { id: 'Advanced',     icon: '🔥', desc: 'Experienced, training to compete' },
]

const GOALS = [
  { id: 'Lose Weight',    icon: '⚡', desc: 'Burn fat through boxing cardio and drills' },
  { id: 'Build Strength', icon: '💪', desc: 'Increase power and muscle through training' },
  { id: 'Learn Boxing',   icon: '🥊', desc: 'Master techniques and fundamentals' },
  { id: 'Compete',        icon: '🏆', desc: 'Train to fight in amateur competitions' },
]

const DAYS = [1, 2, 3, 4, 5, 6, 7]

// Workout programs based on stance + experience + goal
const PROGRAMS = {
  'Beginner': {
    'Lose Weight':    ['Jump Rope Cardio', 'Shadow Boxing', 'Heavy Bag HIIT', 'Core Conditioning', 'Footwork Drills'],
    'Build Strength': ['Heavy Bag Basics', 'Bodyweight Circuit', 'Jab Power Drills', 'Core & Back Work', 'Stance Training'],
    'Learn Boxing':   ['Jab Fundamentals', 'Cross Technique', 'Footwork Basics', 'Guard & Defense', 'Jab-Cross Combos'],
    'Compete':        ['Basic Sparring Prep', 'Combo Basics', 'Stamina Building', 'Defense Fundamentals', 'Speed Drills'],
  },
  'Intermediate': {
    'Lose Weight':    ['HIIT Bag Work', 'Cardio Combos', 'Speed Shadow Boxing', 'Interval Training', 'Endurance Circuits'],
    'Build Strength': ['Power Punching', 'Heavy Bag Rounds', 'Resistance Training', 'Core Power', 'Explosive Combos'],
    'Learn Boxing':   ['Advanced Combinations', 'Counter Punching', 'Slips & Rolls', 'Mitt Work', 'Sparring Drills'],
    'Compete':        ['Sparring Sessions', 'Competition Combos', 'Speed & Reaction', 'Ring Strategy', 'Pressure Fighting'],
  },
  'Advanced': {
    'Lose Weight':    ['Elite HIIT Circuit', 'Full Cardio Rounds', 'Explosive Bag Work', 'Advanced Footwork', 'Competition Pace'],
    'Build Strength': ['Max Power Rounds', 'Resistance Bag Work', 'Elite Core Circuit', 'Explosive Training', 'Peak Strength'],
    'Learn Boxing':   ['Advanced Defense', 'Complex Combinations', 'Tactical Sparring', 'Elite Mitt Work', 'Match Simulation'],
    'Compete':        ['Full Sparring', 'Competition Strategy', 'Elite Conditioning', 'Fight Simulation', 'Peak Performance'],
  },
}

const glass = (extra = {}) => ({
  background: 'linear-gradient(135deg,rgba(30,28,28,0.97),rgba(18,16,16,0.99))',
  borderRadius: 20, border: '1px solid rgba(245,200,66,0.15)',
  boxShadow: '0 8px 40px rgba(0,0,0,0.5), inset 0 1px 0 rgba(245,200,66,0.08)',
  overflow: 'hidden', ...extra,
})

// ── COMPONENT ─────────────────────────────────────────
export default function ProgramBuilder() {
  const navigate = useNavigate()
  const [step, setStep]         = useState(0)
  const [generating, setGen]    = useState(false)
  const [done, setDone]         = useState(false)
  const [errors, setErrors]     = useState({})

  const [form, setForm] = useState({
    name: '', nickname: '', age: '',
    height: '', weight: '',
    stance: '', experience: '',
    goal: '', daysPerWeek: 3,
    injuries: '',
  })

  // Pre-fill name if already saved from signup
  useEffect(() => {
    try {
      const saved = localStorage.getItem('hittrack_profile')
      if (saved) {
        const p = JSON.parse(saved)
        if (p.name) setForm(f => ({ ...f, name: p.name }))
      }
    } catch {}
  }, [])

  const bmi = form.height && form.weight
    ? (parseFloat(form.weight) / ((parseFloat(form.height) / 100) ** 2)).toFixed(1)
    : null
  const bmiLabel = !bmi ? '' : bmi < 18.5 ? 'Underweight' : bmi < 25 ? 'Normal' : bmi < 30 ? 'Overweight' : 'Obese'
  const bmiColor = !bmi ? '#555' : bmi < 18.5 ? '#42a5f5' : bmi < 25 ? '#4ade80' : bmi < 30 ? '#f5c842' : '#e84a2f'

  function update(field, val) { setForm(f => ({ ...f, [field]: val })) }

  function validate() {
    const e = {}
    if (step === 0) { if (!form.name.trim()) e.name = 'Name is required'; if (!form.age) e.age = 'Age is required' }
    if (step === 1) { if (!form.height) e.height = 'Height is required'; if (!form.weight) e.weight = 'Weight is required' }
    if (step === 2) { if (!form.stance) e.stance = 'Select your stance'; if (!form.experience) e.experience = 'Select your level' }
    if (step === 3) { if (!form.goal) e.goal = 'Select your goal' }
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function handleNext() {
    if (!validate()) return
    if (step < 3) { setStep(s => s + 1); return }
    // Final step — generate program
    setGen(true)

    const profile = {
      name:               form.name.trim(),
      nickname:           form.nickname.trim(),
      age:                parseInt(form.age),
      height:             parseFloat(form.height),
      weight:             parseFloat(form.weight),
      bmi:                parseFloat(bmi),
      bmiLabel,
      stance:             form.stance,
      experience:         form.experience,
      goal:               form.goal,
      daysPerWeek:        form.daysPerWeek,
      injuries:           form.injuries,
      programSetupDone:   true,
      programGeneratedAt: new Date().toISOString(),
      weeklyProgram:      PROGRAMS[form.experience]?.[form.goal] || PROGRAMS['Beginner']['Learn Boxing'],
    }

    // Save to localStorage immediately
    localStorage.setItem('hittrack_profile', JSON.stringify(profile))

    // Save to Firestore in background (won't block or crash)
    saveToFirestore(profile)

    // IMPORTANT: Create initial stats doc so member appears on leaderboard immediately
    // Use .then() instead of await since we're inside setTimeout (not async)
    const user = auth.currentUser
    if (user) {
      setDoc(doc(db, 'stats', user.uid), {
        uid:          user.uid,
        name:         profile.name,
        goal:         profile.goal,
        experience:   profile.experience,
        currentLevel: profile.experience,
        totalWorkouts: 0,
        streak:        0,
        weeklyPct:     0,
        updatedAt:     new Date().toISOString(),
      }, { merge: true }).catch(e => console.warn('Stats init skipped:', e.message))
    }

    // Show generating animation then go to done screen
    setTimeout(() => {
      setGen(false)
      setDone(true)
    }, 3500)
  }

  if (generating) return <GeneratingScreen form={form} />
  if (done) return <DoneScreen navigate={navigate} form={form} bmi={bmi} bmiLabel={bmiLabel} bmiColor={bmiColor} />

  return (
    <div style={s.page}>

      {/* Header */}
      <div style={s.header}>
        <div style={s.logo}>
          HIT<span style={{ color: '#e84a2f' }}>TRACK</span>
        </div>
        <div style={s.headerSub}>Program Setup · One time only</div>
      </div>

      {/* Step indicators */}
      <div style={s.stepBar}>
        {STEPS.map((st, i) => (
          <div key={i} style={s.stepItem}>
            <div style={{
              ...s.stepDot,
              background: i < step ? '#4ade80' : i === step ? 'rgba(245,200,66,0.15)' : '#1a1a1a',
              border: `2px solid ${i < step ? '#4ade80' : i === step ? '#f5c842' : '#333'}`,
              color: i < step ? '#fff' : i === step ? '#f5c842' : '#555',
            }}>
              {i < step ? '✓' : st.icon}
            </div>
            <div style={{ ...s.stepLabel, color: i === step ? '#f5c842' : i < step ? '#4ade80' : '#555' }}>
              {st.title}
            </div>
            {i < STEPS.length - 1 && (
              <div style={{ ...s.stepLine, background: i < step ? '#4ade80' : '#2a2a2a' }} />
            )}
          </div>
        ))}
      </div>

      {/* Card */}
      <div style={{ ...glass(), maxWidth: 580, width: '100%', padding: '36px 40px' }}>

        {/* Step header */}
        <div style={s.stepHeader}>
          <div style={s.stepHeaderIcon}>{STEPS[step].icon}</div>
          <div>
            <div style={s.stepTitle}>{STEPS[step].title}</div>
            <div style={s.stepDesc}>{STEPS[step].desc}</div>
          </div>
        </div>

        {/* Step content */}
        {step === 0 && <StepBasic form={form} update={update} errors={errors} />}
        {step === 1 && <StepBody  form={form} update={update} errors={errors} bmi={bmi} bmiLabel={bmiLabel} bmiColor={bmiColor} />}
        {step === 2 && <StepStyle form={form} update={update} errors={errors} />}
        {step === 3 && <StepGoals form={form} update={update} errors={errors} />}

        {/* Nav buttons */}
        <div style={s.navRow}>
          {step > 0
            ? <button style={s.backBtn} onClick={() => setStep(s => s - 1)}>← Back</button>
            : <div />
          }
          <button style={s.nextBtn} onClick={handleNext}>
            {step === 3 ? '🚀 Generate My Program' : 'Next →'}
          </button>
        </div>

        {/* Step counter */}
        <div style={s.stepCounter}>Step {step + 1} of {STEPS.length}</div>
      </div>
    </div>
  )
}

// ── STEP 1: Basic Info ────────────────────────────────
function StepBasic({ form, update, errors }) {
  return (
    <div style={s.stepContent}>
      <Field label="Full Name *"  error={errors.name}>
        <input style={s.input} placeholder="e.g. Lowell Ang" value={form.name} onChange={e => update('name', e.target.value)} />
      </Field>
      <Field label="Nickname">
        <input style={s.input} placeholder="e.g. Low (optional)" value={form.nickname} onChange={e => update('nickname', e.target.value)} />
      </Field>
      <Field label="Age *" error={errors.age}>
        <input style={s.input} type="number" placeholder="e.g. 22" value={form.age} onChange={e => update('age', e.target.value)} />
      </Field>
    </div>
  )
}

// ── STEP 2: Body Stats ────────────────────────────────
function StepBody({ form, update, errors, bmi, bmiLabel, bmiColor }) {
  return (
    <div style={s.stepContent}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Field label="Height (cm) *" error={errors.height}>
          <input style={s.input} type="number" placeholder="e.g. 170" value={form.height} onChange={e => update('height', e.target.value)} />
        </Field>
        <Field label="Weight (kg) *" error={errors.weight}>
          <input style={s.input} type="number" placeholder="e.g. 65"  value={form.weight} onChange={e => update('weight', e.target.value)} />
        </Field>
      </div>

      {bmi && (
        <div style={{ ...s.bmiCard, borderColor: bmiColor + '44' }}>
          <div style={s.bmiRow}>
            <div>
              <div style={s.bmiLabel}>Your BMI</div>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 42, color: bmiColor, lineHeight: 1 }}>{bmi}</div>
              <div style={{ display: 'inline-block', background: bmiColor + '22', color: bmiColor, border: `1px solid ${bmiColor}44`, borderRadius: 50, padding: '3px 14px', fontSize: 12, fontWeight: 700, marginTop: 6 }}>{bmiLabel}</div>
            </div>
            <div style={{ flex: 1, paddingLeft: 20 }}>
              <div style={{ height: 8, background: '#2a2424', borderRadius: 50, overflow: 'hidden', marginBottom: 8 }}>
                <div style={{ height: '100%', background: bmiColor, borderRadius: 50, width: `${Math.min((parseFloat(bmi) / 40) * 100, 100)}%`, transition: 'width 0.6s ease' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#555', fontWeight: 600 }}>
                <span>Underweight</span><span>Normal</span><span>Overweight</span><span>Obese</span>
              </div>
            </div>
          </div>
        </div>
      )}

      <Field label="Injuries or medical conditions?">
        <input style={s.input} placeholder="e.g. knee injury, asthma (leave blank if none)" value={form.injuries} onChange={e => update('injuries', e.target.value)} />
      </Field>
    </div>
  )
}

// ── STEP 3: Boxing Style ──────────────────────────────
function StepStyle({ form, update, errors }) {
  return (
    <div style={s.stepContent}>
      <div>
        <div style={s.groupLabel}>Boxing Stance *</div>
        {errors.stance && <div style={s.errorMsg}>{errors.stance}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {STANCES.map(st => (
            <div key={st.id}
              style={{ ...s.selectCard, ...(form.stance === st.id ? s.selectCardActive : {}) }}
              onClick={() => update('stance', st.id)}
            >
              <div style={s.selectCardEmoji}>{st.emoji}</div>
              <div style={s.selectCardTitle}>{st.id}</div>
              <div style={s.selectCardDesc}>{st.desc}</div>
              {form.stance === st.id && <div style={s.checkBadge}>✓</div>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={s.groupLabel}>Experience Level *</div>
        {errors.experience && <div style={s.errorMsg}>{errors.experience}</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {EXPERIENCES.map(ex => (
            <div key={ex.id}
              style={{ ...s.expCard, ...(form.experience === ex.id ? s.selectCardActive : {}) }}
              onClick={() => update('experience', ex.id)}
            >
              <span style={{ fontSize: 20 }}>{ex.icon}</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: '#f0ece8' }}>{ex.id}</div>
                <div style={{ fontSize: 12, color: '#7a7570', marginTop: 2 }}>{ex.desc}</div>
              </div>
              {form.experience === ex.id && <div style={s.checkBadge}>✓</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── STEP 4: Goals ─────────────────────────────────────
function StepGoals({ form, update, errors }) {
  return (
    <div style={s.stepContent}>
      <div>
        <div style={s.groupLabel}>Main Goal *</div>
        {errors.goal && <div style={s.errorMsg}>{errors.goal}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {GOALS.map(g => (
            <div key={g.id}
              style={{ ...s.selectCard, ...(form.goal === g.id ? s.selectCardActive : {}) }}
              onClick={() => update('goal', g.id)}
            >
              <div style={s.selectCardEmoji}>{g.icon}</div>
              <div style={s.selectCardTitle}>{g.id}</div>
              <div style={s.selectCardDesc}>{g.desc}</div>
              {form.goal === g.id && <div style={s.checkBadge}>✓</div>}
            </div>
          ))}
        </div>
      </div>

      <div>
        <div style={s.groupLabel}>Training Days per Week</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {DAYS.map(d => (
            <div key={d}
              style={{ width: 44, height: 44, borderRadius: '50%', background: form.daysPerWeek === d ? 'rgba(245,200,66,0.15)' : '#1a1a1a', border: `2px solid ${form.daysPerWeek === d ? '#f5c842' : '#333'}`, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: form.daysPerWeek === d ? '#f5c842' : '#555', transition: 'all 0.2s' }}
              onClick={() => update('daysPerWeek', d)}
            >{d}</div>
          ))}
        </div>
        <div style={{ fontSize: 12, color: '#7a7570', marginTop: 8 }}>
          {form.daysPerWeek} training day{form.daysPerWeek > 1 ? 's' : ''} per week selected
        </div>
      </div>

      {/* Preview program */}
      {form.experience && form.goal && (
        <div style={{ background: 'rgba(245,200,66,0.04)', border: '1px solid rgba(245,200,66,0.12)', borderRadius: 14, padding: '16px 18px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f5c842', letterSpacing: '0.08em', marginBottom: 10 }}>
            PROGRAM PREVIEW — {form.experience.toUpperCase()} · {form.goal.toUpperCase()}
          </div>
          {(PROGRAMS[form.experience]?.[form.goal] || []).map((ex, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0', borderBottom: i < 4 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
              <div style={{ width: 22, height: 22, borderRadius: '50%', background: 'rgba(232,74,47,0.12)', color: '#e84a2f', fontSize: 10, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
              <div style={{ fontSize: 13, color: '#f0ece8', fontWeight: 500 }}>{ex}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── GENERATING SCREEN ─────────────────────────────────
function GeneratingScreen({ form }) {
  const [progress, setProgress] = useState(0)
  const [stepIdx, setStepIdx]   = useState(0)

  const genSteps = [
    { icon: '📊', text: `Analyzing BMI and body stats` },
    { icon: '🥊', text: `Mapping ${form.stance} stance techniques` },
    { icon: '⭐', text: `Building ${form.experience} level curriculum` },
    { icon: '🎯', text: `Aligning with "${form.goal}" goal` },
    { icon: '🤖', text: 'Generating personalized program...' },
  ]

  useEffect(() => {
    let cur = 0
    const t = setInterval(() => {
      cur += 2
      setProgress(Math.min(cur, 100))
      setStepIdx(Math.min(Math.floor(cur / 20), genSteps.length - 1))
      if (cur >= 100) clearInterval(t)
    }, 65)
    return () => clearInterval(t)
  }, [])

  return (
    <div style={s.genPage}>
      <div style={s.logo}>HIT<span style={{ color: '#e84a2f' }}>TRACK</span></div>
      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, letterSpacing: '0.06em', color: '#f0ece8', textAlign: 'center' }}>
        Building Your Program...
      </div>
      <div style={{ fontSize: 13, color: '#7a7570', textAlign: 'center', maxWidth: 360 }}>
        Our AI is creating a personalized boxing plan just for you
      </div>

      <div style={{ width: '100%', maxWidth: 440, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {genSteps.map((st, i) => (
          <div key={i} style={{ ...glass({ borderRadius: 12 }), padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, opacity: i <= stepIdx ? 1 : 0.3, transition: 'opacity 0.5s' }}>
            <span style={{ fontSize: 20 }}>{st.icon}</span>
            <span style={{ fontSize: 13, color: '#f0ece8', flex: 1 }}>{st.text}</span>
            {i < stepIdx && <span style={{ color: '#4ade80', fontWeight: 700 }}>✓</span>}
            {i === stepIdx && <span style={{ color: '#f5c842', fontSize: 11 }}>...</span>}
          </div>
        ))}
      </div>

      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12 }}>
          <span style={{ color: '#7a7570' }}>Generating...</span>
          <span style={{ color: '#f5c842', fontWeight: 700 }}>{progress}%</span>
        </div>
        <div style={{ height: 6, background: '#2a2424', borderRadius: 50, overflow: 'hidden' }}>
          <div style={{ height: '100%', background: 'linear-gradient(90deg,#e84a2f,#f5c842)', borderRadius: 50, width: `${progress}%`, transition: 'width 0.6s ease' }} />
        </div>
      </div>
    </div>
  )
}

// ── DONE SCREEN ───────────────────────────────────────
function DoneScreen({ navigate, form, bmi, bmiLabel, bmiColor }) {
  const program = PROGRAMS[form.experience]?.[form.goal] || PROGRAMS['Beginner']['Learn Boxing']

  return (
    <div style={s.genPage}>
      <div style={{ width: 72, height: 72, borderRadius: '50%', background: 'rgba(74,222,128,0.15)', border: '2px solid #4ade80', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, color: '#4ade80' }}>✓</div>

      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 32, letterSpacing: '0.06em', color: '#f0ece8', textAlign: 'center' }}>
        Your Program is Ready!
      </div>
      <div style={{ fontSize: 13, color: '#7a7570', textAlign: 'center', maxWidth: 400 }}>
        Welcome to HITTRACK, {form.name.split(' ')[0]}! Your personalized boxing program has been created.
      </div>

      {/* Summary */}
      <div style={{ ...glass({ borderRadius: 16 }), padding: '20px 28px', width: '100%', maxWidth: 480 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: '#f5c842', letterSpacing: '0.1em', marginBottom: 14 }}>YOUR PROFILE SUMMARY</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 12, textAlign: 'center', marginBottom: 16 }}>
          {[
            { label: 'BMI', val: bmi, color: bmiColor, sub: bmiLabel },
            { label: 'Stance', val: form.stance === 'Orthodox' ? 'Orth.' : 'South.', color: '#f5c842', sub: form.stance },
            { label: 'Level', val: form.experience.slice(0, 3).toUpperCase(), color: '#e84a2f', sub: form.experience },
            { label: 'Days/Wk', val: form.daysPerWeek + 'x', color: '#4ade80', sub: 'Training' },
          ].map((item, i) => (
            <div key={i} style={{ background: 'rgba(255,255,255,0.03)', borderRadius: 10, padding: '10px 6px', border: '1px solid rgba(255,255,255,0.05)' }}>
              <div style={{ fontSize: 9, color: '#555', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>{item.label}</div>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, color: item.color, letterSpacing: '0.04em' }}>{item.val}</div>
              <div style={{ fontSize: 9, color: '#7a7570', marginTop: 2 }}>{item.sub}</div>
            </div>
          ))}
        </div>

        <div style={{ fontSize: 11, fontWeight: 700, color: '#f5c842', letterSpacing: '0.08em', marginBottom: 10 }}>
          YOUR FIRST WEEK — {form.goal?.toUpperCase()}
        </div>
        {program.map((ex, i) => (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 0', borderBottom: i < program.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', background: 'rgba(232,74,47,0.12)', color: '#e84a2f', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{i + 1}</div>
            <div style={{ fontSize: 13, color: '#f0ece8', fontWeight: 500, flex: 1 }}>{ex}</div>
            <div style={{ fontSize: 10, color: '#555' }}>Day {i + 1}</div>
          </div>
        ))}
      </div>

      {/* Lock notice */}
      <div style={{ background: 'rgba(232,74,47,0.06)', border: '1px solid rgba(232,74,47,0.15)', borderRadius: 12, padding: '12px 18px', maxWidth: 480, width: '100%', textAlign: 'center' }}>
        <div style={{ fontSize: 11, color: '#e84a2f', fontWeight: 700, marginBottom: 4 }}>🔒 Program Locked</div>
        <div style={{ fontSize: 12, color: '#7a7570', lineHeight: 1.6 }}>
          Your stance, experience level, and goal are now locked to protect your program. You can request a program reset from your Profile page.
        </div>
      </div>

      <button
        style={{ background: 'linear-gradient(135deg,#e84a2f,#c93820)', color: '#fff', border: 'none', borderRadius: 50, padding: '16px 48px', fontSize: 16, fontWeight: 700, cursor: 'pointer', boxShadow: '0 8px 30px rgba(232,74,47,0.4)' }}
        onClick={() => { window.location.href = '/home' }}
      >
        Let's Start Training 🥊
      </button>
    </div>
  )
}

// ── SHARED COMPONENTS ─────────────────────────────────
function Field({ label, error, children }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: '#7a7570', letterSpacing: '0.08em', textTransform: 'uppercase' }}>{label}</div>
      {children}
      {error && <div style={{ fontSize: 11, color: '#e84a2f', fontWeight: 600 }}>⚠ {error}</div>}
    </div>
  )
}

// ── STYLES ────────────────────────────────────────────
const s = {
  page:       { minHeight: '100vh', background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '40px 24px 60px', gap: 28, fontFamily: 'Montserrat,sans-serif' },
  header:     { textAlign: 'center' },
  logo:       { fontFamily: "'Bebas Neue',sans-serif", fontSize: 32, letterSpacing: '0.06em', color: '#f0ece8' },
  headerSub:  { fontSize: 12, color: '#555', fontWeight: 600, marginTop: 4, letterSpacing: '0.06em' },
  stepBar:    { display: 'flex', alignItems: 'flex-start', position: 'relative', width: '100%', maxWidth: 520, gap: 0 },
  stepItem:   { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8, flex: 1, position: 'relative' },
  stepDot:    { width: 44, height: 44, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, transition: 'all 0.3s', zIndex: 1 },
  stepLabel:  { fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textAlign: 'center', transition: 'color 0.3s' },
  stepLine:   { position: 'absolute', top: 22, left: '75%', right: '-25%', height: 2, zIndex: 0, transition: 'background 0.3s' },
  stepHeader: { display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid rgba(245,200,66,0.08)' },
  stepHeaderIcon: { fontSize: 32 },
  stepTitle:  { fontFamily: "'Bebas Neue',sans-serif", fontSize: 24, letterSpacing: '0.06em', color: '#f0ece8' },
  stepDesc:   { fontSize: 12, color: '#7a7570', marginTop: 2 },
  stepContent:{ display: 'flex', flexDirection: 'column', gap: 18, marginBottom: 28 },
  input:      { background: '#1a1818', border: '1.5px solid #2a2424', borderRadius: 50, padding: '14px 20px', color: '#f0ece8', fontSize: 14, fontFamily: 'Montserrat,sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box', transition: 'border-color 0.2s' },
  navRow:     { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  backBtn:    { background: 'transparent', color: '#7a7570', border: '1.5px solid rgba(255,255,255,0.1)', borderRadius: 50, padding: '12px 24px', fontSize: 14, fontWeight: 700, cursor: 'pointer' },
  nextBtn:    { background: 'linear-gradient(135deg,#e84a2f,#c93820)', color: '#fff', border: 'none', borderRadius: 50, padding: '14px 32px', fontSize: 14, fontWeight: 700, cursor: 'pointer', boxShadow: '0 4px 20px rgba(232,74,47,0.4)', flex: 1, maxWidth: 260 },
  stepCounter:{ textAlign: 'center', fontSize: 11, color: '#555', marginTop: 12 },
  groupLabel: { fontSize: 11, fontWeight: 700, color: '#7a7570', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 },
  errorMsg:   { fontSize: 11, color: '#e84a2f', fontWeight: 600, marginBottom: 8 },
  selectCard: { background: '#1a1818', borderRadius: 14, padding: '18px 16px', border: '2px solid #2a2424', cursor: 'pointer', position: 'relative', transition: 'all 0.2s', textAlign: 'center' },
  selectCardActive: { border: '2px solid #f5c842', background: 'rgba(245,200,66,0.06)' },
  selectCardEmoji: { fontSize: 28, marginBottom: 8 },
  selectCardTitle: { fontSize: 14, fontWeight: 700, color: '#f0ece8', marginBottom: 4 },
  selectCardDesc:  { fontSize: 11, color: '#7a7570', lineHeight: 1.5 },
  checkBadge: { position: 'absolute', top: 10, right: 10, width: 22, height: 22, borderRadius: '50%', background: '#f5c842', color: '#000', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  expCard:    { background: '#1a1818', borderRadius: 12, padding: '14px 16px', border: '2px solid #2a2424', cursor: 'pointer', position: 'relative', transition: 'all 0.2s', display: 'flex', alignItems: 'center', gap: 14 },
  bmiCard:    { background: 'rgba(255,255,255,0.02)', borderRadius: 14, padding: '16px 20px', border: '1px solid #333' },
  bmiRow:     { display: 'flex', alignItems: 'center', gap: 0 },
  bmiLabel:   { fontSize: 10, fontWeight: 700, color: '#7a7570', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 4 },
  genPage:    { minHeight: '100vh', background: '#111', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: 24, fontFamily: 'Montserrat,sans-serif' },
}

// Stats.jsx
import { useState } from 'react'
import Navbar from '../components/Navbar'

const allStats = [
  { icon:'🥊', label:'Jab Punch',     rating:4 },
  { icon:'🥊', label:'Hook Punch',    rating:4 },
  { icon:'👟', label:'Stance & Steps', rating:3 },
  { icon:'🥊', label:'Jab Punch',     rating:4 },
  { icon:'🥊', label:'Hook Punch',    rating:4 },
  { icon:'👟', label:'Stance & Steps', rating:3 },
  { icon:'🥊', label:'Jab Punch',     rating:4 },
  { icon:'🥊', label:'Hook Punch',    rating:4 },
  { icon:'👟', label:'Stance & Steps', rating:3 },
]

const categories = ['JAB PUNCH', 'HOOK PUNCH', 'STANCE & STEPS']

function Stars({ rating }) {
  return (
    <div className="stat-stars">
      {[...Array(5)].map((_,i) => (
        <svg key={i} className={`star${i >= rating ? ' empty':''}`} viewBox="0 0 24 24" fill="currentColor">
          <polygon points="12,2 15.09,8.26 22,9.27 17,14.14 18.18,21.02 12,17.77 5.82,21.02 7,14.14 2,9.27 8.91,8.26"/>
        </svg>
      ))}
    </div>
  )
}

export function Stats() {
  const [active, setActive] = useState(0)
  return (
    <>
      <Navbar user={{name:'Lowell'}}/>
      <div className="page">
        <div className="categories">
          {categories.map((c,i) => (
            <div key={i} className={`cat-btn${active===i?' active':''}`} onClick={()=>setActive(i)}>{c}</div>
          ))}
        </div>
        <div className="stats-grid">
          {allStats.map((s,i) => (
            <div className="stat-card" key={i} style={{animationDelay:`${i*0.05}s`}}>
              <div className="stat-img">
                <div className="stat-img-icon">{s.icon}</div>
                <div className="stat-img-overlay"/>
              </div>
              <div className="stat-body">
                <div className="stat-badge">{s.label}</div>
                <Stars rating={s.rating}/>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────
// Schedule.jsx
const DAY_NAMES = ['SUN','MON','TUE','WED','THU','FRI','SAT']
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']

const classesData = {
  0: [],
  1: [
    { time:'7:00', period:'AM', name:'Heavy Bag Training', coach:'Coach Rafael', slots:'8/10', status:'booked' },
    { time:'5:00', period:'PM', name:'Footwork Drills',    coach:'Coach Rafael', slots:'5/10', status:'open' },
  ],
  2: [{ time:'9:00', period:'AM', name:'Conditioning', coach:'Coach Joey', slots:'10/10', status:'full' }],
  3: [
    { time:'7:00', period:'AM', name:'Mitt Work',      coach:'Coach Rafael', slots:'6/10', status:'open' },
    { time:'6:00', period:'PM', name:'Sparring Session',coach:'Coach Joey',  slots:'4/10', status:'open' },
  ],
  4: [
    { time:'10:00', period:'AM', name:'Sparring',   coach:'Coach Joey',   slots:'8/10', status:'booked' },
    { time:'2:00',  period:'PM', name:'Speed Bag',  coach:'Coach Rafael', slots:'3/10', status:'open' },
  ],
  5: [{ time:'7:00', period:'AM', name:'Double End Bag', coach:'Coach Joey', slots:'7/10', status:'open' }],
  6: [],
}

export function Schedule() {
  const [weekOffset, setWeekOffset] = useState(0)
  const [selectedDay, setSelectedDay] = useState(new Date().getDay())

  const today = new Date()
  const startOfWeek = new Date(today)
  startOfWeek.setDate(today.getDate() - today.getDay() + weekOffset * 7)
  const dates = [...Array(7)].map((_,i) => { const d = new Date(startOfWeek); d.setDate(startOfWeek.getDate()+i); return d })
  const monthTitle = `${MONTH_NAMES[dates[0].getMonth()]} ${dates[0].getFullYear()}`
  const classDays = new Set(Object.keys(classesData).filter(k=>classesData[k].length>0).map(Number))
  const classes = classesData[selectedDay] || []
  const booked = classes.filter(c=>c.status==='booked')
  const available = classes.filter(c=>c.status!=='booked')

  return (
    <>
      <Navbar user={{name:'Lowell'}}/>
      <div className="page">
        <div className="week-header">
          <div className="week-title">{monthTitle}</div>
          <div className="week-nav">
            <button className="week-nav-btn" onClick={()=>setWeekOffset(w=>w-1)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15,18 9,12 15,6"/></svg>
            </button>
            <button className="week-nav-btn" onClick={()=>setWeekOffset(w=>w+1)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9,18 15,12 9,6"/></svg>
            </button>
          </div>
        </div>

        <div className="days-strip">
          {dates.map((d,i) => (
            <div key={i} className={`day-pill${selectedDay===i?' active':''}${classDays.has(i)?' has-class':''}`} onClick={()=>setSelectedDay(i)}>
              <div className="day-name">{DAY_NAMES[i]}</div>
              <div className="day-num">{d.getDate()}</div>
            </div>
          ))}
        </div>

        {classes.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <div>No classes scheduled for this day.</div>
          </div>
        ) : (
          <>
            {booked.length > 0 && (
              <div className="schedule-section">
                <div className="schedule-section-title">Your Booked Classes</div>
                {booked.map((c,i) => <ClassCard key={i} c={c}/>)}
              </div>
            )}
            {available.length > 0 && (
              <div className="schedule-section">
                <div className="schedule-section-title">Available Classes</div>
                {available.map((c,i) => <ClassCard key={i} c={c}/>)}
              </div>
            )}
          </>
        )}
      </div>
    </>
  )
}

function ClassCard({ c }) {
  return (
    <div className="schedule-card">
      <div className="schedule-time-block">
        <div className="schedule-time">{c.time}</div>
        <div className="schedule-period">{c.period}</div>
      </div>
      <div className="schedule-divider"/>
      <div className="schedule-info">
        <div className="schedule-name">{c.name}</div>
        <div className="schedule-meta">
          <span className="schedule-coach">{c.coach}</span>
          <span>{c.slots} slots</span>
        </div>
      </div>
      <div>
        {c.status==='booked' && <span className="status-pill status-booked">Booked</span>}
        {c.status==='full'   && <span className="status-pill status-full">Full</span>}
        {c.status==='open'   && <button className="book-btn">Book</button>}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────
// Achievements.jsx
const NUMS = [10,20,30,40,50,60]

const badgeData = [
  { icon:'🥇', style:'badge-bronze',  label:'5-Star Rookie',  count:5 },
  { icon:'🏆', style:'badge-silver',  label:'Champion Badge', count:null },
  { icon:'🎯', style:'badge-special', label:'10K Punches',    count:'10K' },
  { icon:'💪', style:'badge-gold',    label:'Power Hitter',   count:null },
  { icon:'⭐', style:'badge-bronze',  label:'5-Star Fighter', count:5 },
  { icon:'🚀', style:'badge-special', label:'10K Steps',      count:'10K' },
]

function MilestoneRow({ style, label, unlockedCount }) {
  return (
    <div className="milestones-grid">
      {NUMS.map((n,i) => (
        <div className="milestone" key={i} style={{animationDelay:`${i*0.05}s`}}>
          <div className={`milestone-circle ${i < unlockedCount ? style : 'locked'}`}>
            {n}
            {i < unlockedCount && (
              <div className="milestone-check">
                <svg viewBox="0 0 24 24" fill="none" stroke={style==='green'?'#004d1a':'#fff'} strokeWidth="3">
                  <polyline points="20 6 9 17 4 12"/>
                </svg>
              </div>
            )}
          </div>
          <div className="milestone-label">{n} {label}</div>
        </div>
      ))}
    </div>
  )
}

export function Achievements() {
  return (
    <>
      <Navbar user={{name:'Lowell'}}/>
      <div className="page">
        <div className="section-title">7 MILESTONES</div>
        <MilestoneRow style="green"  label="Workouts"    unlockedCount={1}/>
        <MilestoneRow style="purple" label="Workouts"    unlockedCount={3}/>
        <MilestoneRow style="orange" label="Week Streak" unlockedCount={3}/>

        <div className="section-title" style={{marginTop:8}}>7 BADGES</div>
        <div className="badges-grid">
          {badgeData.map((b,i) => (
            <div className="badge-item" key={i}>
              <div className={`badge-circle ${b.style}`}>
                {b.icon}
                {b.count !== null && <div className="badge-count">{b.count}</div>}
              </div>
              <div className="badge-label">{b.label}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// ─────────────────────────────────────────────
// About.jsx
const coaches = [
  { initials:'RL', name:'Coach Rafael Labordo', role:'Head Coach', bio:'Expert in Filipino swarmer style with over 10 years of coaching experience at Wild Bout.' },
  { initials:'JD', name:'Coach Joey',           role:'Trainer',    bio:'Specializes in conditioning, sparring, and technical Cuban-style boxing fundamentals.' },
  { initials:'AD', name:'Admin',                role:'Gym Owner',  bio:'Oversees all gym operations, member management, and training quality at Wild Bout.' },
]

const features = [
  { icon:'🤖', name:'AI Training Plans',      desc:'Personalized boxing programs generated based on your BMI, stance, goals, and skill level.' },
  { icon:'📊', name:'Performance Tracking',   desc:'Monitor your Jab, Hook, Stance and other techniques with star-rated progress tracking.' },
  { icon:'📅', name:'Class Scheduling',       desc:'Book training sessions created by coaches — Heavy Bag, Sparring, Speed Bag and more.' },
  { icon:'🏅', name:'Achievements & Badges',  desc:'Earn milestone badges and rewards for workout streaks and performance consistency.' },
  { icon:'🎯', name:'Pose Detection',         desc:'Real-time AI boxing interface with gridlines to evaluate your form during training sessions.' },
  { icon:'👥', name:'Coach Dashboard',        desc:'Coaches can monitor all members, manage classes, and track attendance in one place.' },
]

export function About() {
  return (
    <>
      <Navbar user={{name:'Lowell'}}/>
      <div className="page">
        <div className="about-hero">
          <div className="about-gym-name">WILD BOUT BOXING GYM</div>
          <div className="about-title">TRAIN SMART.<br/>FIGHT <span>BETTER.</span></div>
          <div className="about-tagline">Be an Inspiration</div>
          <div className="about-desc">
            Wild Bout Boxing Gym was established in April 2019 in Lapaz, Makati.
            From training beginners to amateur fighters, we host boxing matches and
            offer multiple boxing styles — from the Filipino swarmer style to the
            technical Cuban style. HITTRACK is our AI-powered platform to help every
            member train smarter, track progress, and reach their full potential.
          </div>
          <div className="about-stats">
            {[['2019','Est. Year'],['3+','Coaches'],['50+','Members'],['2','Boxing Styles']].map(([n,l])=>(
              <div key={l}>
                <div className="about-stat-num">{n}</div>
                <div className="about-stat-label">{l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="section-title">Our Coaches</div>
        <div className="team-grid">
          {coaches.map((c,i) => (
            <div className="team-card" key={i} style={{animationDelay:`${i*0.1}s`}}>
              <div className="team-avatar">{c.initials}</div>
              <div className="team-name">{c.name}</div>
              <div className="team-role">{c.role}</div>
              <div className="team-bio">{c.bio}</div>
            </div>
          ))}
        </div>

        <div className="section-title">What HITTRACK Offers</div>
        <div className="features-grid">
          {features.map((f,i) => (
            <div className="feature-card" key={i} style={{animationDelay:`${i*0.05}s`}}>
              <div className="feature-icon">{f.icon}</div>
              <div className="feature-name">{f.name}</div>
              <div className="feature-desc">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </>
  )
}

// TODO: full pose data pipeline in progress on mobile —
// falls back to trainingRecordings session summaries until
// stats/{uid}/poseSessions is populated.
//
// Single source of truth for Punch Analytics across member Stats,
// coach member-view, and admin View Member drawer. When the pose
// pipeline ships, this is the only file that needs to flip.

import { db } from '../firebase'
import {
  doc, getDoc, collection, getDocs, query, orderBy, limit, where,
} from 'firebase/firestore'

const RECENT_RECORDINGS_LIMIT = 20
const RECENT_DISPLAY_LIMIT = 5

function toDate(v) {
  if (!v) return null
  if (v?.toDate) return v.toDate()
  if (v?.seconds) return new Date(v.seconds * 1000)
  if (v instanceof Date) return v
  const d = new Date(v)
  return isNaN(d.getTime()) ? null : d
}

function avg(values) {
  const nums = values.filter(v => typeof v === 'number' && !isNaN(v))
  if (nums.length === 0) return null
  return Math.round(nums.reduce((a, b) => a + b, 0) / nums.length)
}

function emptyResult() {
  return {
    source: 'none',
    metrics: { punchSpeed: null, powerOutput: null, accuracy: null, comboFlow: null },
    formBreakdown: null,
    totalSessions: 0,
    lastSessionAt: null,
    recentSessions: [],
  }
}

// Priority 1: stats/{uid} has totalPoseSessions > 0 → real pose pipeline output.
async function tryPose(uid) {
  const statsSnap = await getDoc(doc(db, 'stats', uid))
  if (!statsSnap.exists()) return null
  const d = statsSnap.data()
  if (!d.totalPoseSessions || d.totalPoseSessions <= 0) return null

  let recent = []
  try {
    const sessionsRef = collection(db, 'stats', uid, 'poseSessions')
    const snap = await getDocs(query(sessionsRef, orderBy('date', 'desc'), limit(RECENT_DISPLAY_LIMIT)))
    recent = snap.docs.map(s => {
      const sd = s.data()
      return {
        id: s.id,
        date: toDate(sd.date),
        duration: sd.duration || 0,
        totalPunches: sd.totalPunches || 0,
        accuracy: sd.accuracy || 0,
      }
    })
  } catch (e) { /* subcollection may be missing */ }

  return {
    source: 'pose',
    metrics: {
      punchSpeed:  d.punchSpeed  || 0,
      powerOutput: d.powerOutput || 0,
      accuracy:    d.accuracy    || 0,
      comboFlow:   d.comboFlow   || 0,
    },
    formBreakdown: d.formBreakdown || null,
    totalSessions: d.totalPoseSessions,
    lastSessionAt: toDate(d.lastPoseSession),
    recentSessions: recent,
  }
}

// Priority 2: trainingRecordings exist for this uid → derive session summaries.
// Power Output and Form Breakdown stay null (we don't fake them — pose pipeline
// owns those signals).
async function tryRecordings(uid) {
  const recRef = collection(db, 'trainingRecordings')
  let docs = []
  try {
    // submittedAt + uid would need a composite index; filter by uid only,
    // sort client-side (project convention — see CLAUDE.md).
    const snap = await getDocs(query(recRef, where('uid', '==', uid)))
    docs = snap.docs.map(d => ({ id: d.id, ...d.data() }))
  } catch (e) {
    return null
  }
  if (docs.length === 0) return null

  docs.sort((a, b) => {
    const ta = a.submittedAt?.seconds || 0
    const tb = b.submittedAt?.seconds || 0
    return tb - ta
  })

  const recent = docs.slice(0, RECENT_RECORDINGS_LIMIT)

  const accuracy   = avg(recent.map(r => r.avgQualityPct))
  const punchSpeed = avg(recent.map(r => r.paceRepsPerMin))
  const comboFlow  = avg(recent.map(r => r.consistencyPct))

  return {
    source: 'recordings',
    metrics: {
      punchSpeed,
      powerOutput: null,
      accuracy,
      comboFlow,
    },
    formBreakdown: null,
    totalSessions: docs.length,
    lastSessionAt: toDate(docs[0].submittedAt),
    recentSessions: docs.slice(0, RECENT_DISPLAY_LIMIT).map(r => ({
      id: r.id,
      date: toDate(r.submittedAt),
      duration: r.duration || 0,
      totalPunches: r.properReps || 0,
      accuracy: r.avgQualityPct || 0,
    })),
  }
}

export async function loadPunchAnalytics(uid) {
  if (!uid) return emptyResult()
  try {
    const pose = await tryPose(uid)
    if (pose) return pose
    const recordings = await tryRecordings(uid)
    if (recordings) return recordings
    return emptyResult()
  } catch (e) {
    console.warn('loadPunchAnalytics:', e.message)
    return emptyResult()
  }
}

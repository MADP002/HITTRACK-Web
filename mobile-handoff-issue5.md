# Mobile Handoff — QA Issue #5: Video Upload → Training Report

**Audience:** mobile developer (owns `HITTRACK-App-main/`).
**Author:** web side (Lowell), changes already landed on `HITTRACK-Web-main/`.
**Status:** the web tooltip + Coach Reports tab are done. Mobile changes below are yours to apply — I did not edit any files under `HITTRACK-App-main/`.

---

## Context

QA wants "Submit Video" replaced with "Submit Training Report" everywhere. On the **web** that was a one-string change (tooltip) plus a brand-new Coach Reports tab so coaches can read incoming reports — both shipped on the web branch.

On **mobile**, the change is rip-and-rename inside the training-complete screen: drop the Cloudinary video path, always submit as a report, and update the UI copy. **No Firestore schema or rules changes** — the `trainingRecordings` collection and the `recordingUrl` field stay; mobile just stops writing a URL into it. Coach-side reads on the web use the same fields they always did.

---

## Verdict on the camera capture flow

**Important finding — the video branch is unreachable dead code today.** Worth knowing before you remove anything.

```bash
$ grep -rn "recordingUri" HITTRACK-App-main/
HITTRACK-App-main/app/(member)/training-complete.jsx:179:    recordingUri,
HITTRACK-App-main/app/(member)/training-complete.jsx:187:  const hasRecording = !!recordingUri && recordingUri !== 'null';
HITTRACK-App-main/app/(member)/training-complete.jsx:254:            uri:  recordingUri,
```

`recordingUri` is only ever **read** in `training-complete.jsx`. It is **never written** by `training-camera.jsx` or anywhere else in the mobile codebase — `training-camera.jsx` uses `CameraView` from `expo-camera` for pose-detection live preview only, with no `record() / stopRecording() / videoUri` calls and no recording state. So:

- `recordingUri` arrives as `undefined` in production.
- `hasRecording` is therefore always `false`.
- The Cloudinary upload branch on line 250 of `training-complete.jsx` has never fired for a real user.

You can remove the video path with zero feature regression. No member is currently submitting a video.

---

## File to change

**`HITTRACK-App-main/app/(member)/training-complete.jsx`** — only this file.

### Block 1 — Remove the Cloudinary config (lines 16–19)

```jsx
// ── Cloudinary config — fill these in from your Cloudinary dashboard ──────
// Dashboard → Settings → Upload → Upload Presets (create one as Unsigned)
const CLOUDINARY_CLOUD_NAME   = 'dthdcmisj';    // e.g. 'hittrack'
const CLOUDINARY_UPLOAD_PRESET = 'hittrack_videos'; // e.g. 'hittrack_videos'
```

→ Delete these four lines outright.

### Block 2 — Drop the `recordingUri` param + `hasRecording` (lines 179, 187)

In the `useLocalSearchParams()` destructure on line 179, remove `recordingUri,`:

```jsx
const {
  trainingId, level,
  properReps:  properRepsParam,
  requiredReps: requiredRepsParam,
  duration:    durationParam,
  recordingUri,                    // ← remove this line
  trainingName,
  avgQualityPct, paceRepsPerMin, consistencyPct, bestStreak,
} = useLocalSearchParams();
```

And on line 187:

```jsx
const hasRecording = !!recordingUri && recordingUri !== 'null';  // ← remove
```

→ Delete both.

### Block 3 — Strip the Cloudinary upload inside `handleSubmitRecording` (lines 247–270)

Inside `handleSubmitRecording`:

```jsx
let recordingUrl = null;

// Upload video to Cloudinary if a recording exists
if (hasRecording && CLOUDINARY_CLOUD_NAME !== 'YOUR_CLOUD_NAME') {
  try {
    const formData = new FormData();
    formData.append('file', {
      uri:  recordingUri,
      type: 'video/mp4',
      name: `training_${trainingId}_${Date.now()}.mp4`,
    });
    formData.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    formData.append('folder', `hittrack/${user.uid}`);

    const cloudRes = await fetch(
      `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/video/upload`,
      { method: 'POST', body: formData }
    );
    const cloudData = await cloudRes.json();
    recordingUrl = cloudData.secure_url || null;
  } catch (uploadErr) {
    console.warn('Cloudinary upload failed, saving session without video:', uploadErr);
  }
}
```

→ Replace this entire block with a single line so the `addDoc` call still receives a defined value:

```jsx
const recordingUrl = null;  // Issue #5 — reports only, no video uploads
```

(Keep the `recordingUrl` field in the `addDoc` payload below — back-compat with rows that already have a URL. Just stop writing one going forward.)

### Block 4 — Rename the function (optional but recommended)

`handleSubmitRecording` → `handleSubmitReport`. Update the one call site at line 412 (`onPress={handleSubmitRecording}` → `onPress={handleSubmitReport}`).

### Block 5 — UI strings: lines 387–423 and the Alert at line 299

Current branching UI:

```jsx
<Text style={s.recordingTitle}>
  {hasRecording && CLOUDINARY_CLOUD_NAME !== 'YOUR_CLOUD_NAME' ? '📹 Submit Recording to Coach' : '📋 Submit Session Report'}
</Text>
<Text style={s.recordingBody}>
  {hasRecording && CLOUDINARY_CLOUD_NAME !== 'YOUR_CLOUD_NAME'
    ? 'Your training video will be uploaded to Cloudinary and sent to your coach.'
    : 'Your session stats (reps, level, duration) will be sent to your coach.'
  }
</Text>
```

→ Collapse to a single branch:

```jsx
<Text style={s.recordingTitle}>📋 Submit Training Report</Text>
<Text style={s.recordingBody}>
  Your training report (form quality, pace, consistency, level) will be sent to your coach for review.
</Text>
```

Submit button text at lines 420–422:

```jsx
<Text style={s.submitRecordingBtnText}>
  {hasRecording && CLOUDINARY_CLOUD_NAME !== 'YOUR_CLOUD_NAME' ? 'Submit Recording' : 'Send Session Report'}
</Text>
```

→ Replace with:

```jsx
<Text style={s.submitRecordingBtnText}>Submit Training Report</Text>
```

Failure Alert at line 299:

```jsx
Alert.alert('Submit failed', 'Could not send your session report. Please try again.');
```

→ Update text:

```jsx
Alert.alert('Submit failed', 'Could not send your training report. Please try again.');
```

### Block 6 — StyleSheet identifier renames (optional)

The styles `recordingCard / recordingTitle / recordingBody / submitRecordingBtn / submitRecordingBtnText` at lines 508–517 are now misnamed. Rename to `reportCard / reportTitle / reportBody / submitReportBtn / submitReportBtnText` if you want consistency; or leave them — they're internal identifiers and don't affect behavior.

---

## Schema, rules, and backend — no changes

- **Firestore collection `trainingRecordings`:** stays. Renaming would be a breaking migration we don't need.
- **Field `recordingUrl`:** stays in the schema for back-compat. Mobile writes `null` from now on; existing rows with real URLs are still valid.
- **`firestore.rules`** (lines 222–239 in the web repo) already permit the assigned coach to read and update reports — no rule edits needed. The web Coach Reports tab depends on the existing `allow update` rule to mark `viewed: true`, which already covers `request.auth.uid == resource.data.coachUid`.

---

## What's already done on the web side (for context)

So you don't accidentally re-do anything I did:

1. `HITTRACK-Web-main/src/components/PunchAnalyticsCard.jsx` — `SESSION SUMMARY` badge tooltip swapped from "training recordings" → "training reports". Single string.
2. `HITTRACK-Web-main/src/pages/CoachDashboard.jsx` — added a new `📋 Reports` tab that:
   - Lists `trainingRecordings` where `coachUid == auth.currentUser.uid`, live via `onSnapshot`, sorted by `submittedAt` desc client-side.
   - Shows member name, training, level, reps, duration, submitted time per row.
   - Click-to-expand renders the four metric cards: Form Quality (`avgQualityPct`), Pace (`paceRepsPerMin`), Consistency (`consistencyPct`), Best Streak (`bestStreak`).
   - First open marks the report `viewed: true` (single `updateDoc`) and the unread `(N)` badge on the tab decrements.

Coach reads from web are working today against the existing mobile writes — even before your changes land — because the schema is unchanged.

---

## Test plan once you land it

1. Member completes a training session on mobile → taps **Submit Training Report** → picks a coach → submit succeeds.
2. Open Firestore Console → `trainingRecordings/<new doc>` → confirm `recordingUrl === null`, `submittedAt`, `coachUid`, `viewed: false`, and the four metric fields are populated.
3. Coach logs into the web app → **CoachDashboard → Reports tab** → new report appears at the top with a red `NEW` badge.
4. Coach clicks the row → metrics expand, badge clears, `viewed === true` in Firestore.
5. Member submits a second report → `(N)` badge on the coach's Reports tab increments without a refresh.

If any of the above misbehaves, ping me — likely it's a field shape mismatch and I'll line up the web reader to whatever you wrote.

---

## Summary diff

| File | Change |
|---|---|
| `HITTRACK-App-main/app/(member)/training-complete.jsx` | Drop Cloudinary config + video upload branch + `recordingUri` param. Always write `recordingUrl: null`. Collapse UI strings to single "Training Report" branch. Optional renames. |
| `HITTRACK-App-main/app/(member)/training-camera.jsx` | No change (was never recording anyway). |
| `firestore.rules` | No change. |
| `HITTRACK-Web-main/*` | Already done by web. |

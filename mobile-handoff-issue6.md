# Mobile Handoff — QA Issue #6: Medical Certificate display (perf flag only)

**Audience:** mobile developer (owns `HITTRACK-App-main/`).
**Author:** web side (Lowell). Web display work is already done; this note is a single perf finding for you to file away — **no action required right now.**

---

## Web work already landed (for context)

QA #6 was "let coaches see member medical certificates on the web." Done on the web side:

- New shared component `HITTRACK-Web-main/src/components/MedicalCertCard.jsx`.
- Embedded in `CoachDashboard.jsx` → `MemberPanel` (between Fight Card Header and Punch Analytics).
- Embedded in `AdminDashboard.jsx` → View Member drawer (between identity card and Punch Analytics).
- Reads from the existing `users/{uid}.medicalCert` field that your mobile `medical-certificate.jsx` writes — **no schema change, no rules change, no Firebase Storage involved.** Coach/admin click a "View Certificate" button to render the image (or download the PDF) inside a modal.

`firestore.rules:9-10` already permits any authenticated user to read `users/{uid}`, so coaches/admins can read the nested `medicalCert.base64` field today without a rules edit.

---

## The perf flag — for a later mobile pass, not now

### What I noticed

`medical-certificate.jsx` writes the certificate as a base64 data URI directly into Firestore:

```jsx
// HITTRACK-App-main/app/(member)/medical-certificate.jsx:100-108
await updateDoc(doc(db, 'users', user.uid), {
  medicalCert: {
    submitted:   true,
    base64,                          // ← ~500KB to ~1MB for a typical photo
    fileName:    file.name,
    fileType:    file.type,
    submittedAt: serverTimestamp(),
  },
});
```

The comment on line 84 says "Works on Firebase free plan — no external storage service needed." Reasonable starting choice. But it creates a quiet scaling problem:

### Why this gets expensive

The web `CoachDashboard.loadMembers()` polls every 15 seconds:

```js
// HITTRACK-Web-main/src/pages/CoachDashboard.jsx:767-782
async function loadMembers(){
  const snap = await getDocs(collection(db,'users'))
  // ...spreads ...data into each member, which includes medicalCert.base64
}
```

Because `medicalCert.base64` lives inline on `users/{uid}`, **every getDocs() pulls the full base64 blob for every member.** Math at gym scale:

| Members | Avg cert size | Per poll | Per hour (240 polls) |
|---|---|---|---|
| 20 | 500 KB | 10 MB | **2.4 GB** |
| 50 | 500 KB | 25 MB | **6.0 GB** |
| 100 | 700 KB | 70 MB | **16.8 GB** |

Hits the coach client, the admin client, plus anything else that does `getDocs(collection(db,'users'))` (which is most of the dashboard). Firestore reads are billed per document, not per byte — so the *price* impact is modest — but the *bandwidth* hits every coach on shitty WiFi, and there's a real Firestore 1 MiB-per-document hard cap that a slightly larger PDF will trip into.

### Proper fix (mobile-side change, please file for later)

Move cert binary content to Firebase Storage; keep only a reference on `users/{uid}`:

```js
// Suggested future shape — replace base64 with a Storage URL
medicalCert: {
  submitted:   true,
  url:         'https://firebasestorage.googleapis.com/.../cert.jpg',
  fileName:    'cert.jpg',
  fileType:    'image/jpeg',
  submittedAt: serverTimestamp(),
}
```

Pros:
- `users/{uid}` stays small — `loadMembers()` returns lightweight docs.
- 1 MiB doc cap no longer applies to cert size.
- Storage's CDN handles image bytes efficiently.
- Coach/admin web side change is a one-line swap: `<img src={cert.url}/>` instead of `<img src={cert.base64}/>`. (The `MedicalCertCard.jsx` switch is trivial when you're ready.)

Cons:
- Requires Firebase Storage to be enabled and rules added (Storage rules are separate from Firestore rules).
- You lose the "works on Firebase free plan" advantage — Storage has its own free tier (5 GB) but it's a separate billing line.

### Workarounds in the meantime

If gym membership stays small (<30 members) the current setup is fine. If you want a quick interim mitigation without moving to Storage:

1. **Have `loadMembers()` strip the base64 field at read time on web.** I can add `delete data.medicalCert?.base64` between the `getDocs` and the `setMembers` so the periodic poll doesn't keep the base64 in memory client-side. Then have the `MedicalCertCard` lazily `getDoc(doc(db,'users',selMember.uid))` only when the coach actually opens the "View Certificate" modal. Single-shot Firestore read, no constant bandwidth waste.
2. **Move just the base64 to a subcollection** like `users/{uid}/medicalCerts/{certId}` with `base64`. `users/{uid}` keeps only `medicalCert: { submitted: true, fileName, fileType, submittedAt }`. Read-on-demand from the subcollection. No Storage required, no perf hit on `loadMembers()`. This is the cheapest sound fix.

Either of those is also a viable target if you'd rather not adopt Firebase Storage yet. Suggest option 2 if you want to keep things on Firestore — schema-compatible, small migration, fully on the free plan.

---

## Second flag — `medical-certificate.jsx` has no file size cap

Found while building the web upload path. Worth a one-line fix on mobile too.

### What

`medical-certificate.jsx` writes the picked file's base64 straight to Firestore with no size check:

```jsx
// HITTRACK-App-main/app/(member)/medical-certificate.jsx:75-121
const handleSubmit = async () => {
  if (!file) { ... return; }
  setUploading(true);
  try {
    const user = auth.currentUser;
    const base64 = await new Promise(...);              // ← reads file as base64
    await updateDoc(doc(db, 'users', user.uid), {
      medicalCert: { submitted: true, base64, ... },    // ← writes whatever size it ended up
    });
    ...
  } catch (e) {
    Alert.alert('Upload failed', 'Could not upload your certificate. Please try again.');
  }
}
```

### Why this is a quiet bug

Firestore's hard cap on a single document is **1 MiB (1,048,576 bytes)**. Base64 inflates raw bytes by ~33% plus the `data:image/...;base64,` prefix, so anything over ~700 KB raw will blow the doc limit. When that happens the Firestore write throws — the user gets the generic `'Could not upload your certificate. Please try again.'` Alert with no hint about the actual cause. A member with a 4 MB phone photo will hit this every time and never figure out why.

### Fix — match what the web side enforces

Same 600 KB cap I just shipped on web in `HITTRACK-Web-main/src/components/MedicalCertUpload.jsx`:

```jsx
const MAX_BYTES = 600 * 1024;  // 600 KB raw

const handleSubmit = async () => {
  if (!file) { ... return; }

  // Add this block:
  if (file.size > MAX_BYTES) {
    Alert.alert(
      'File too large',
      `Certificate must be under ${(MAX_BYTES / 1024).toFixed(0)} KB. Compress the image or use a smaller PDF.`
    );
    return;
  }

  setUploading(true);
  ...
}
```

`file.size` is available on the asset returned by `ImagePicker` (`assets[0].fileSize`) and by `DocumentPicker` (`assets[0].size`). The exact property name differs between the two — check both:

```jsx
const size = file.size || file.fileSize || 0;
if (size > MAX_BYTES) { ... }
```

A real fix would also resize/recompress images on the way to the upload (Expo has `expo-image-manipulator` for that) so a member with a high-res phone camera doesn't get bounced for sending a 4 MB photo. Nice-to-have, not required.

### Why this matters now

I just added web upload UI for medical certificates. If a member tries on web first, they get a clear error and resize. If they then try on mobile thinking that'll work, mobile silently fails with a vague Alert. Inconsistent UX. The 5-line guard above lines mobile up with web.

---

## Summary

| Item | Status |
|---|---|
| Web display of medical certificates | **Done** (coach + admin views). |
| Web upload of medical certificates | **Done** (Profile + Program Builder member self-upload, 600 KB cap). |
| Firestore rules | **No change needed.** `users/{uid}` read and member self-update already permitted. |
| Mobile `medical-certificate.jsx` writes | **No change needed** for the features themselves to work. |
| Base64-in-users perf concern | **Flagged here.** Future mobile task — subcollection or Firebase Storage move. |
| Mobile size cap | **Flagged here.** 5-line `MAX_BYTES` guard recommended to match the web's 600 KB limit. |

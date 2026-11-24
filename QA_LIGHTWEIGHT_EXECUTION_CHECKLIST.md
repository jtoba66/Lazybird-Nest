# QA Lightweight Execution Checklist (High-Signal)

Purpose: fast validation while feature work is still landing. Focus on correctness and major regression detection for current slices: **auth / files / upload / download / biometric**.

## How to Use (Velocity Mode)
- Run only these checks before merge to shared branch.
- Prefer 1 happy path + 1 high-risk unhappy path per slice.
- Stop and report immediately on blockers (don’t expand into full matrix).

---

## 1) Auth

### Critical checks
- [ ] **Login success** with valid credentials reaches authenticated home/dashboard.
- [ ] **Login failure** with invalid password shows clear error and does not create session.
- [ ] **Protected route gating**: unauthenticated user is redirected to login.
- [ ] **Logout** clears session/token and blocks access to protected route on refresh.

### Quick pass criteria
- Auth state is consistent after refresh.
- No silent failure/spinner lock.
- No obvious security regression (e.g., protected page visible while logged out).

---

## 2) Files (List/View)

### Critical checks
- [ ] Authenticated user can see expected file list (non-empty or valid empty state).
- [ ] File metadata renders correctly (name/type/size/date where applicable).
- [ ] Opening/selecting a file works and matches selected item.
- [ ] Unauthorized/expired session cannot access file listing endpoint/view.

### Quick pass criteria
- File list does not crash on load.
- Empty state and error state are user-readable.
- Data shown matches API payload at a glance (no obvious mismatch).

---

## 3) Upload

### Critical checks
- [ ] Upload valid file type/size succeeds and appears in list after completion.
- [ ] Upload progress/completion state updates (or deterministic success indicator).
- [ ] Rejects disallowed file type or oversize file with clear message.
- [ ] Interrupted upload (cancel/network drop simulation if easy) fails gracefully.

### Quick pass criteria
- No duplicate entries from a single upload action.
- UI not stuck in uploading state after success/failure.
- User gets immediate, understandable outcome (success or actionable error).

---

## 4) Download

### Critical checks
- [ ] Download from file list/detail starts for valid file.
- [ ] Downloaded file name/extension is correct.
- [ ] Corrupt/expired/nonexistent file request returns controlled error (not crash).
- [ ] Permission check: user cannot download unauthorized file.

### Quick pass criteria
- Download action is one-click reliable.
- Errors are surfaced in UI (not silent).
- No wrong-file download observed in quick spot check.

---

## 5) Biometric (if enabled in this build slice)

### Critical checks
- [ ] Biometric enroll/enable flow completes and stores enabled state.
- [ ] Biometric login/unlock succeeds when available and configured.
- [ ] Biometric failure/fallback path (cancel/fail) returns to password/PIN flow cleanly.
- [ ] Disable biometric removes biometric path and standard auth still works.

### Quick pass criteria
- No lockout loop after biometric failure.
- Fallback path is always reachable.
- State persists correctly across app restart/refresh (where applicable).

---

## Cross-Slice Regression Tripwires (Fast)
- [ ] Session expiry during file action prompts re-auth without data corruption.
- [ ] Error toasts/messages are visible and not misleading.
- [ ] No console flood/fatal runtime error during core flows.
- [ ] Basic mobile/responsive sanity for login + upload + download CTA visibility.

---

## Exit Rule for This Lightweight Pass

**PASS (ship to next stage)** if:
1. All happy paths above pass,
2. At least one high-risk unhappy path per slice passes,
3. No blocker severity bug found (auth bypass, data loss/corruption, stuck core flow).

**HOLD (send back for fixes)** if any of the following occur:
- Auth bypass/protected-route leak,
- Upload/download correctness failure (wrong file, corrupt result, duplicate records),
- Biometric lockout without fallback,
- Reproducible blocker in core flow.

---

## Bug Severity Shortcut (for speed)
- **Blocker:** can’t login/use core file flow, security leak, wrong/corrupt file behavior.
- **Major:** primary flow works but frequent failure/retry needed.
- **Minor:** copy/UI polish issues with workaround.

Keep this pass intentionally lean; expand to full matrix after slice stabilization.
# QA Plan — Lazybird Mobile Phase 1 (Execution Kickoff)

**Owner:** QA (Big Head)  
**Date:** 2026-03-04  
**Scope:** Phase 1 (Core Product Build) for detached mobile app (Android-first, iOS shadow validation)
**References:**
- `PRD_lazybird_mobile_v3.md`
- `mobile_ux_architecture_gilfoyle_v2.md`

---

## 1) Purpose

This plan defines how QA will validate Phase 1 implementation quality while engineering begins core build work. Focus is on preventing late discovery of release-blocking defects in:

1. Android core flows (primary execution path)
2. Web ↔ mobile crypto compatibility (hard requirement)
3. Upload/download resume reliability under interruption
4. Mandatory biometric enforcement and rebind behavior
5. UI continuity with Nest web design system

---

## 2) Phase 1 QA Objectives

By end of Phase 1, QA must provide evidence that:

- Core journeys are testable and stable on Android reference devices.
- Crypto pipeline compatibility between web and mobile is verified on representative file types/sizes.
- Resumable transfer is reliable across app kill, network transitions, and auth refresh.
- Biometric gates are enforced for unlock + sensitive actions.
- Visual continuity checkpoints for core shells/screens have no unapproved P0/P1 drift from web Nest.

---

## 3) Android-First Test Matrix

## 3.1 Device/OS Matrix (Priority)

| Tier | Device Class | Android Version | RAM/Storage Profile | Priority |
|---|---|---|---|---|
| A1 | Mid-range physical | 14 | 6–8GB / 128GB | P0 |
| A2 | Flagship physical | 15 | 8–12GB / 256GB | P0 |
| A3 | Budget physical | 13 | 4GB / 64GB (low free storage scenarios) | P0 |
| B1 | Emulator baseline | 13–15 | standard | P1 |
| B2 | Large-screen/foldable profile | 14–15 | 8GB+ | P1 |

> Minimum go/no-go coverage for Phase 1: A1 + A2 + A3 passing core suite.

## 3.2 Network/Condition Matrix

| Condition | Target |
|---|---|
| Strong Wi-Fi | Baseline behavior and performance |
| Poor Wi-Fi (packet loss/high RTT) | Retry/backoff correctness |
| LTE/5G transition | Resume continuity during handoff |
| Airplane mode toggle mid-transfer | Queue durability and recovery |
| Captive/blocked network simulation | Error legibility + retry behavior |
| Low battery + background restrictions | WorkManager persistence behavior |

## 3.3 Core Feature Matrix (Phase 1)

| Feature | Smoke | Regression | Soak/Stress | Exit Target |
|---|---|---|---|---|
| Auth/session bootstrap | ✅ | ✅ | - | 100% pass |
| Biometric unlock + sensitive gates | ✅ | ✅ | - | 100% pass |
| Files/folders browse | ✅ | ✅ | - | 0 P0/P1 |
| Search local-first + refine | ✅ | ✅ | - | p95 within phase target |
| Upload queue/resume | ✅ | ✅ | ✅ | Meets pass criteria section 9 |
| Download/resume/integrity | ✅ | ✅ | ✅ | Meets pass criteria section 9 |
| Share v1 | ✅ | ✅ | - | 0 P0/P1 |
| Core UI continuity shells | ✅ | ✅ | - | No unapproved P1 drift |

---

## 4) Crypto Compatibility Test Approach (Web ↔ Mobile)

**Goal:** prove strict parity of encryption/decryption pipeline, key derivation/wrapping format, and cross-platform file interoperability.

## 4.1 Compatibility Scenarios

1. **Web encrypt → Mobile decrypt/open**
2. **Mobile encrypt → Web decrypt/open**
3. **Cross-client re-download/open after rename/move/share operations**
4. **Same file uploaded from each client yields expected metadata/integrity behavior**

## 4.2 Test Data Set

| Class | Examples |
|---|---|
| Small files | txt, json, md (<1MB) |
| Media | jpg/png, mp4 (1MB–500MB) |
| Office/PDF | docx/xlsx/pdf |
| Large binaries | 1GB, 5GB, 10GB+ sample payloads |
| Filename edge cases | unicode, emoji, long names, mixed scripts |

## 4.3 Validation Signals

- Successful decrypt/open on opposite client.
- Hash/integrity parity (pre-encrypt source hash vs post-download decrypted hash).
- No key unwrap/format mismatch errors.
- No platform-specific corruption or unreadable output.
- Retry/resume does not alter cryptographic correctness.

## 4.4 Defect Severity Rules

- Any cross-platform crypto incompatibility = **P0 release blocker**.
- Any intermittent decrypt failure under resume path = **P0/P1 depending reproducibility**.

---

## 5) Upload Resume Reliability Tests

## 5.1 Interruption Test Cases

1. Kill app during `hashing` phase.
2. Kill app during active upload (multiple chunk boundaries).
3. Force reboot device mid-transfer.
4. Toggle network Wi-Fi → LTE → offline → online.
5. Expire/rotate auth token during upload.
6. Simulate backend transient 5xx/timeout bursts.
7. Low storage threshold reached mid-queue.
8. Multiple concurrent uploads with mixed sizes.

## 5.2 Reliability Execution Pattern

- Run deterministic 100-run suite per primary device tier (A1/A2).
- Run 30-run suite on budget device tier (A3).
- Include at least one long-haul soak (8–12h mixed network profile).

## 5.3 Required Behaviors

- Queue state persisted across restart/kill/reboot.
- Resume from first unconfirmed chunk (no duplicate finalization).
- Clear user-visible state transitions (`queued/hashing/uploading/retry_wait/completed/failed`).
- Actionable failure messages with retry path.

---

## 6) Biometric Test Cases (Mandatory Security Gate)

## 6.1 Core Cases

1. First unlock after login requires biometric prompt.
2. App foreground after idle threshold re-prompts biometric.
3. Sensitive actions trigger biometric:
   - disable biometric
   - secure cache wipe
   - device unlink/security reset
   - recovery/export sensitive material (if enabled)
4. Fallback (PIN/passcode) follows policy and lockout handling.

## 6.2 Biometric Change/Rebind Cases

1. Add/remove biometric enrollment on OS.
2. Confirm secure key binding invalidation.
3. Verify forced re-auth and clean rebind workflow.
4. Ensure no plaintext key-at-rest artifacts after rebind flows.

## 6.3 Negative/Security Cases

- Repeated failed biometric attempts and lockout UX.
- Attempt sensitive action in background/resumed stale state.
- Session revocation while biometric gate is active.

---

## 7) UI Continuity Checks (Web ↔ Mobile)

## 7.1 Phase 1 Screen Set for Continuity Audit

1. Home shell
2. Files root
3. Folder detail
4. Shared shell
5. Activity shell
6. Search entry/results
7. Upload queue panel
8. Share flow v1 summary

## 7.2 Continuity Checklist

- Token parity: color roles, typography hierarchy, spacing scale, status semantics.
- Component parity: file row/card, buttons, search bar, chips, snackbars, dialogs.
- Interaction parity: long-press selection, swipe/quick-action predictability, undo messaging style.
- Accessibility legibility parity: non-color-only status indicators.

## 7.3 Drift Classification

- **P0:** misleading state or security-critical UI mismatch.
- **P1:** major token/component divergence on core journey.
- **P2:** minor spacing/visual polish mismatch without usability risk.

---

## 8) Test Automation + Manual Split (Phase 1)

- **Automated (priority):** auth smoke, upload resume state-machine checks, API contract checks, basic biometric gate entry checks (where automatable), crypto parity harness.
- **Manual exploratory:** network chaos, long-running transfer interruptions, edge-case filenames/data, UI continuity side-by-side audits, gesture/navigation state persistence.

Artifacts required per run:
- Test report (pass/fail + defect IDs)
- Logs/trace IDs for failures
- Screen recordings for flaky/repro-hard issues
- Crypto compatibility matrix evidence table

---

## 9) Phase 1 Pass Criteria (QA Signoff)

Phase 1 QA pass requires **all**:

1. **No open P0 defects** in auth, biometric, transfer, crypto compatibility.
2. **No open P1 defects** on core journeys (auth, browse, search, upload, download, share v1).
3. **Upload resume reliability:**
   - >=95% success in interruption suite (Phase 1 bar),
   - 0 data-loss incidents,
   - deterministic resume behavior validated.
4. **Crypto compatibility:**
   - 100% pass on required web↔mobile cross-open matrix for test set,
   - 0 unreadable/corrupt cross-platform outputs.
5. **Biometric enforcement:**
   - 100% pass for unlock + sensitive-action re-prompt cases,
   - biometric set-change rebind flow validated.
6. **UI continuity:**
   - Core shell audit completed,
   - no unapproved P0/P1 continuity gaps.
7. **Stability baseline:** crash-free internal QA sessions >=99.0% during Phase 1 validation window.

---

## 10) Blockers to Start Integration Testing

Integration testing must **not** begin until these blockers are cleared:

1. API contracts for auth/transfer/share/search endpoints are unstable or undocumented.
2. Resumable transfer ledger/finalize behavior not deterministic.
3. Crypto implementation parity not confirmed by initial harness smoke.
4. Biometric module not wired to sensitive actions.
5. Core test environment cannot be reset/seeded reproducibly.
6. Build distribution instability (unable to provide consistent QA builds).
7. Missing telemetry/log correlation IDs for triage.
8. Core UI shells incomplete (Home/Files/Shared/Activity not navigable).

---

## 11) Defect Triage and Reporting Rules

- P0/P1 issues: immediate escalation to engineering + architect.
- Each defect report must include: repro steps, expected/actual, device/OS/network profile, logs, and severity rationale.
- Flaky cases tracked separately with reproducibility score and suspected subsystem tags.

---

## 12) QA Execution Cadence (Kickoff)

- Daily smoke on latest Android build.
- Twice-weekly interruption reliability batch.
- Weekly crypto compatibility sweep (web build parity checkpoint).
- Weekly UI continuity snapshot audit against web baseline.
- End-of-phase formal QA signoff report with pass criteria mapping.

---

## 13) Deliverables from QA in Phase 1

1. Android-first test result dashboard (by feature/device/network).
2. Crypto compatibility evidence matrix (web↔mobile).
3. Upload/download resume reliability report with run stats.
4. Biometric enforcement validation report.
5. UI continuity audit summary with drift log.
6. Final Phase 1 QA go/no-go recommendation.

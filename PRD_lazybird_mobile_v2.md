# PRD — Lazybird Nest Detached Mobile App (iOS + Android)

**Version:** v2.0  
**Date:** 2026-03-04 (updated with Joseph decisions addendum + DB environment note)  
**Owner:** Product (Jared)  
**Program Type:** Full-function mobile product launch (not lean MVP)  
**Source Inputs Used:**
1. Repository baseline: `/home/joe/.openclaw/workspace-scout/projects/Lazybird-Nest`
2. Dinesh gap report v3: `mobile_gap_report_dinesh_v3.md`
3. Gilfoyle UX architecture v2: `mobile_ux_architecture_gilfoyle_v2.md`
4. Monica audit: `mobile_gap_review_monica.md`

### Decision Addendum — Joseph (2026-03-04)
1. **Sentry rollout sequencing:** Sentry setup is deferred until core app setup is stable; it must be enabled before broader rollout beyond initial internal readiness.
2. **Product analytics tooling:** Initial analytics provider may be any free option that satisfies baseline telemetry needs.
3. **Admin scope boundary:** Admin page/access remains web-only. Mobile app must still preserve and correctly use admin-related backend routes/data contracts where required by shared platform behavior.
4. **Observability/infra sequencing:** Advanced observability and infrastructure stack work is phase-later, after the app is up and running.
5. **Crypto compatibility hard requirement (web ↔ mobile):**
   - same encryption/decryption pipeline,
   - same key derivation and wrapping format,
   - no cross-platform file access incompatibilities tolerated.
6. **Database environment direction:** Build phase development should use a local database; migration to managed staging and production databases is required before beta and GA.

---

## 1) Product Vision and Goals

### Vision
Deliver a **premium, fully functional, detached mobile app** for Lazybird Nest that preserves Nest’s zero-knowledge trust model and visual identity while matching Google Drive/Dropbox-level UX quality in reliability, speed, and flow clarity.

### Strategic Goals
1. Launch a production-grade iOS and Android app with complete core user value (not a reduced MVP shell).
2. Preserve Nest’s zero-knowledge architecture and security posture end-to-end on mobile.
3. Support effectively unbounded file uploads/downloads (no artificial product file-size cap target).
4. Enforce biometric protection as a mandatory security gate.
5. Ensure visual continuity with existing Nest web UI/design language.
6. Reach high reliability standards (SLA/SLO-driven launch gates).
7. Validate product-market and operational reliability across **both free and paid cohorts** in beta.

### Business Outcomes
- Increase active multi-device usage and retention.
- Improve paid plan stickiness via dependable mobile transfer/sync experience.
- Reduce support burden via clear state visibility, deterministic recovery flows, and robust observability.

---

## 2) Non-Goals and Constraints

### Non-Goals
1. **No admin dashboard in mobile app** (all admin workflows remain web-only).
2. No visual redesign/rebrand exercise; mobile is not a new design language.
3. No “quick MVP” launch that compromises reliability/security requirements.
4. No hard product file upload limit target (device/network/quota constraints still apply).

### Constraints
- Must preserve zero-knowledge boundaries: encryption/decryption and key handling on device.
- **Hard crypto compatibility requirement across web and mobile:** identical encryption/decryption pipeline and key derivation/wrapping format; no cross-platform file access issues are acceptable.
- Must integrate with existing backend contracts and data model with controlled extensions.
- Admin page/access remains web-only, but mobile must preserve and correctly consume required admin-related backend routes/data contracts.
- Must satisfy App Store / Play policy requirements for authentication, billing, privacy, and background behavior.
- Must hit SLA/SLO gates before GA.

---

## 3) User Personas and JTBD

### Persona A: Everyday Secure User (Free)
- Uses Nest for personal docs/photos and occasional sharing.
- Primary needs: simple upload, dependable retrieval, confidence in privacy.

**JTBD:** “When I save important files from my phone, I want them uploaded securely and reliably, so I can trust they’re available later without babysitting the app.”

### Persona B: Power User / Professional (Paid)
- Uploads large files frequently, collaborates, expects premium reliability.
- Primary needs: uninterrupted large transfers, robust sharing controls, offline continuity.

**JTBD:** “When I’m moving large or critical files on mobile, I need the transfer to resume automatically across interruptions, so I never lose work or time.”

### Persona C: Privacy-Conscious User (Free/Paid)
- Chooses Nest for zero-knowledge promise and stronger lock controls.
- Primary needs: biometric gate, clear security signals, controlled access.

**JTBD:** “When I open my storage app, I want mandatory biometric protection and visible security state, so I know only I can access my vault.”

---

## 4) Competitive UX Benchmark Summary

**Benchmark intent:** Google Drive and Dropbox are quality benchmarks for behavior and reliability only; they are **not visual style references**.

### What to Match/Exceed (Operational UX)
1. Persistent, visible transfer queue with actionable failures.
2. Fast browse/search perception through local-first rendering and progressive hydration.
3. Clear sharing permission summaries before send.
4. Deterministic offline/sync/conflict states.
5. Smooth recovery after app kill, reboot, or network transitions.

### What Not to Copy
- Their visual language, branding, iconography style, or layout aesthetics.
- Any design pattern that breaks Nest token/component continuity.

---

## 5) Functional Requirements (Detailed)

### FR-1 Authentication & Session
- Email/password and existing Nest auth compatibility.
- Secure token lifecycle with refresh rotation and revocation semantics.
- Device session visibility and forced logout support.

### FR-2 Mandatory Biometric Security
- Biometric required at unlock after login/bootstrap.
- Biometric required for sensitive operations:
  - disable biometric,
  - export/reveal recovery material,
  - local secure cache wipe,
  - device unlink/security reset.
- Biometric set change invalidates secure key bindings and triggers re-auth.

### FR-3 Vault & File System Access
- Full browse for folders/files, recents, shared, activity.
- Multi-select operations (move, trash, share, restore, offline pin).
- State preservation across tab switches and back-stack transitions.

### FR-4 Uploads (Effectively Unbounded)
- Stream-based file ingestion (no whole-file memory load).
- Encryption-in-stream + chunking + per-chunk hashing.
- Durable queue persisted to local DB.
- Background-capable transfer with retries/backoff.
- Idempotent resume from first unconfirmed chunk.

### FR-5 Downloads (Parity with Upload Reliability)
- Resumable range/chunked download.
- Stream decrypt to file destination.
- Integrity verification before completion state.

### FR-6 Search
- Local-first fast results + remote refinement.
- Filter chips: type, owner, location, date.
- Empty-state suggestions and typo tolerance behavior.

### FR-7 Preview
- Progressive preview rendering.
- Quick actions in-preview: share, offline, download, rename (where allowed).

### FR-8 Sharing
- Invite and link share in unified flow.
- Permission controls (view/comment/edit per policy).
- Expiration/password (where plan/policy allows).
- Explicit effective-access summary before confirmation.

### FR-9 Offline & Sync
- File/folder offline pin.
- Explicit status taxonomy: local-only, syncing, synced, conflict, failed.
- Conflict center with deterministic options (keep mine/theirs/duplicate path).

### FR-10 Trash & Recovery
- Soft delete to trash with retention policy visibility.
- Restore and version recovery actions with clear user feedback.

### FR-11 Notifications & Activity
- Push + in-app feed for share events, transfer failures/completions, security events.
- Deep links to exact resource context.

### FR-12 Billing & Entitlement (User-side)
- Mobile app shows current tier, quota usage, and entitlement gating.
- Purchase/upgrade path compliant with platform policy and backend billing model.

### FR-13 Settings
- Security settings (biometric/autolock/session controls).
- Network preferences (cellular upload, roaming behavior if supported).
- Accessibility and language preferences.

### FR-14 Explicit Exclusion
- No admin analytics/moderation/dashboard UI in mobile.

---

## 6) Non-Functional Requirements (Performance, Reliability, Security, Compliance)

### Performance
- Cold launch p95 ≤ 2.0s.
- Cached folder open p95 ≤ 300ms.
- Network folder open p95 ≤ 1.2s.
- Search first meaningful result p95 ≤ 500ms.

### Reliability
- Upload completion (eligible files under available quota):
  - Beta ≥ 97%
  - GA ≥ 99%
- Resume success after interruption:
  - Beta ≥ 95%
  - GA ≥ 98%
- Crash-free sessions:
  - Beta ≥ 99.0%
  - GA ≥ 99.5%
- Integrity mismatch rate:
  - Beta < 0.1%
  - GA < 0.01%

### Security
- Zero-knowledge handling maintained on mobile.
- No plaintext master keys at rest.
- OS secure enclave/keychain/keystore usage mandatory.
- Biometric enforced for unlock/sensitive actions.
- Strict TLS and certificate validation.
- **Web-mobile cryptographic parity is mandatory:** same encryption/decryption pipeline and same key derivation/wrapping format must be used across both clients.
- Cross-platform file interoperability failures related to crypto format/pipeline are release-blocking defects.

### Observability & Analytics
- Sentry setup is intentionally deferred until core app setup is stable, then must be enabled before broader rollout.
- Product analytics may start with any free tool, provided it supports baseline event coverage and cohort split (free vs paid) reporting.
- Advanced observability/infra stack (expanded tracing, richer infra automation) is scheduled after initial app operational readiness and not a blocker for feature-complete beta.

### Compliance & Governance
- App privacy disclosures accurate to telemetry/data handling.
- Policy-compliant billing/subscription behavior.
- Auditability for critical security events and access changes.
- Accessibility baseline: WCAG 2.2 AA aligned mobile implementation.

---

## 7) UX Requirements and Visual Continuity Standards

### Visual Continuity (Mandatory)
- Mobile must feel like “Nest on phone.”
- Preserve web-aligned tokens and semantics:
  - color roles,
  - typography hierarchy,
  - spacing scale,
  - icon language,
  - component interaction patterns.

### Continuity Protocol
1. Side-by-side parity audits for top critical screens.
2. Token diff report with no unapproved divergences.
3. Documented sign-off for any exception.

### UX Quality Standards
- Status legibility over decorative motion.
- Every failure state includes clear reason + next action.
- Undo affordance for destructive operations when safe.
- Non-color-only status signaling for accessibility.

---

## 8) Information Architecture and Key User Journeys

### IA
- **Home**: recents, quick access, active transfer summary.
- **Files**: folder tree, starred, offline, trash.
- **Shared**: shared with me/by me, link shares.
- **Activity**: notifications, transfer/conflict/security events.
- Global search + Add FAB + account/workspace switcher.

### Key Journeys
1. **Upload journey**: pick source → enqueue instantly → background upload/resume → completion/failure actions.
2. **Browse journey**: instant cached shell → progressive metadata/thumbnails.
3. **Search journey**: local-first results then remote refinements.
4. **Share journey**: configure access → summary confirmation → send + audit event.
5. **Offline/sync journey**: pin → edit offline → deterministic conflict resolution on reconnect.
6. **Recovery journey**: trash/version restore with retention clarity.
7. **Security journey**: biometric unlock, lockout fallback, rebind on biometric set changes.

---

## 9) API and Backend Requirements/Changes

### Reuse Existing
- Auth salt/login/signup flows.
- Files/folders list and metadata flows.
- Upload/finalize/download/share/trash primitives.
- Quota and billing backend services.

### Required Enhancements
1. **Resumable transfer protocol hardening**
   - Chunk acknowledgment ledger API,
   - idempotent finalize,
   - resumable token refresh handling.
2. **Transfer observability contract**
   - correlation IDs across client/server/storage events.
3. **Security event endpoints**
   - biometric rebind-triggered device session handling,
   - suspicious session revoke flows.
4. **Conflict/sync metadata APIs**
   - deterministic version/etag conflict response model.
5. **Share lifecycle parity APIs**
   - create/update/revoke/expiry/audit payload consistency for mobile clients.

### Guardrails
- Maintain server blindness to plaintext content and keys.
- Backward-compatible evolution for web + mobile coexistence.

---

## 10) Data Model / Telemetry Requirements

### Mobile Local Data Model (minimum)
- Transfer jobs table (queue state, chunk pointers, retry budget).
- File/folder metadata cache with sync version markers.
- Offline pin index and cache metadata.
- Conflict records table and resolution audit.

### Backend/Data Model Extensions
- Transfer session ledger (chunk state and completion guarantees).
- Device session metadata for security governance.
- Event schema updates for mobile performance/reliability analytics.

### Telemetry Event Baseline
- launch, interactive, folder open, search start/results,
- upload enqueued/started/completed/failed/resumed,
- share flow events,
- offline pin/sync/conflict events,
- biometric prompted/success/fallback events.

### Telemetry Requirements
- PII-minimized event payloads.
- Cohort tags (free/paid) for split reliability reporting.
- Dashboard coverage for SLA/SLOs and release gates.

---

## 11) SLA/SLO Definitions and Launch Quality Gates

### SLA/SLO Definitions
- **Transfer Success SLO:** % transfers completing without manual restart.
- **Resume SLO:** % interrupted transfers auto-resuming and finishing.
- **Integrity SLO:** % transfers with zero mismatch/corruption.
- **Stability SLO:** crash-free sessions over defined windows.
- **Performance SLO:** p95 thresholds for launch/browse/search.

### Hard Launch Gates
1. **Security Gate**
   - Mandatory biometric flows fully functional.
   - No plaintext key-at-rest findings.
   - Web-mobile crypto compatibility validated (pipeline + key derivation/wrapping + cross-platform file interoperability).
2. **Reliability Gate**
   - Beta and RC metrics meet thresholds for 2 consecutive weeks.
3. **Parity Gate**
   - Top 20 screen visual continuity audit signed off.
4. **Cohort Gate**
   - Free + paid beta cohorts both meet minimum reliability thresholds.
5. **Operations Gate**
   - Runbooks, alerting, rollback, and support readiness approved.
   - Sentry active and validated before broader rollout; advanced observability backlog approved for post-readiness execution.

---

## 12) Beta Plan (Free + Paid Cohorts)

### Cohort Structure
- Wave 1: controlled free + paid mix (recommended 60/40).
- Wave 2: broaden paid heavy-transfer users + long-tail free device diversity.
- Wave 3: release candidate expansion with staged percentage rollout.

### Inclusion Rule
- Beta is invalid unless both cohorts are represented and analyzed separately.

### Beta Objectives
- Validate reliability under real network/device diversity.
- Validate premium expectations for paid users.
- Validate onboarding clarity and recovery flows for free users.

### Exit Criteria from Beta
- Cohort-specific SLOs met.
- No unresolved P0/P1 security/reliability defects.
- Support ticket severity trend acceptable.

---

## 13) Delivery Plan by Phase with Milestones

### Phase 0 — Foundations (Weeks 1–4)
- RN architecture baseline, secure storage, transfer state-machine scaffolding.
- Nest token/component mapping baseline.
- API contract freeze for core transfer/auth/sync flows.

**Milestone M0:** Architecture + security design review signed.

### Phase 1 — Core Product Build (Weeks 5–10)
- Full auth + biometric mandatory gates.
- Files/folders, search, preview, share v1.
- Durable upload/download engine with resume.
- Keep observability lightweight during core stabilization (no advanced infra stack yet).

**Milestone M1:** End-to-end core journeys internally demoable; core setup stable enough to begin Sentry integration.

### Phase 2 — Feature Complete Beta (Weeks 11–16)
- Offline pin/sync/conflict center.
- Activity feed + push notifications.
- Entitlement and tier/usage visibility.
- Enable Sentry before broad beta expansion; verify crash/error signal quality.
- Stand up product analytics using an initial free tool.
- Beta wave 1 and 2 rollout (free + paid).

**Milestone M2:** Feature complete + closed beta operational with Sentry active and baseline analytics live.

### Phase 3 — GA Hardening (Weeks 17–22)
- Reliability tuning to hit GA SLOs.
- Accessibility/i18n compliance closure.
- Final visual continuity and performance audits.
- Support and rollback readiness.
- Begin advanced observability/infra stack rollout after app is operationally stable.

**Milestone M3:** Launch readiness review; go/no-go decision, with post-GA advanced observability plan approved.

### Phase 4 — Staged GA (Weeks 23–24)
- 10% → 50% → 100% rollout with monitored gates.

**Milestone M4:** Full GA with post-launch stability confirmation.

---

## 14) Team Responsibilities and RACI

| Workstream | Product (Jared) | Architect (Gilfoyle) | Engineering (Dinesh + mobile/backend) | QA (Big Head) | Reviewer (Monica) | Design | Security/Ops |
|---|---|---|---|---|---|---|---|
| Scope, priorities, acceptance | **A/R** | C | C | C | C | C | C |
| Mobile system architecture | C | **A/R** | R | C | C | C | C |
| Core implementation | C | C | **A/R** | C | C | C | C |
| UX continuity/token parity | A | C | R | C | C | **R** | I |
| Reliability/SLO instrumentation | A | R | **R** | C | C | I | C |
| Security model + biometric | A | R | R | C | C | I | **A/R** |
| Test strategy & execution | C | C | C | **A/R** | C | I | I |
| Release readiness and signoff | A | C | C | R | **A/R** | C | R |

Legend: **R** = Responsible, **A** = Accountable, C = Consulted, I = Informed.

---

## 15) Risks, Assumptions, Open Questions

### Key Risks
1. Background transfer constraints differ across iOS/Android and may impact consistency.
2. Large-file edge cases (memory pressure, app kill timing) can cause reliability regressions.
3. Billing/store policy changes can affect mobile purchase UX.
4. Visual drift risk if parity checks are not enforced in CI/release.
5. Security regressions around biometric fallback and key rebind handling.
6. Crypto implementation drift between web and mobile (pipeline or key wrapping mismatch) could break cross-platform file access and is unacceptable.
7. Deferring Sentry until core stabilization creates temporary observability blind spots that must be tightly time-boxed.
8. Admin-related backend route/contract changes may regress mobile behavior if compatibility is not actively validated.

### Assumptions
- Existing backend can be extended without violating zero-knowledge constraints.
- Product/design resources are allocated for parity audits and component governance.
- A free analytics tool can cover initial product telemetry needs until later tooling upgrades.
- Sentry can be integrated and stabilized before broad rollout.
- Advanced observability/infra enhancements can be sequenced post-operational readiness without blocking launch safety.

### Open Questions (Remaining)
1. Final inactivity auto-lock timeout default (immediate vs timed).
2. Store policy-compliant upgrade flow details by platform/region.
3. Final retention windows and UX copy for trash/version restore in mobile.
4. Thresholds for cellular/roaming transfer defaults by tier.

---

## 16) Acceptance Criteria for Signoff

The PRD is considered execution-approved only when all criteria below are met:

1. **Requirement Compliance:** All Joseph non-negotiables explicitly implemented:
   - full function scope,
   - no upload size cap target,
   - biometric required,
   - no mobile admin dashboard (web-only admin access),
   - mobile preserves and correctly uses required admin-related backend routes/data contracts,
   - Nest visual continuity,
   - Drive/Dropbox benchmark used for UX quality only,
   - free + paid beta inclusion,
   - high SLA reliability gating,
   - Sentry deferred until core stabilization, then enabled before broader rollout,
   - product analytics launched with a valid free tool initially,
   - advanced observability/infra explicitly sequenced post-initial operational readiness,
   - hard web-mobile crypto compatibility maintained (same crypto pipeline + same key derivation/wrapping format + no cross-platform access failures).
2. **Architecture Signoff:** Mobile and backend architecture reviewed and approved.
3. **Security Signoff:** Biometric/key lifecycle model validated; no critical findings.
4. **UX Signoff:** Top 20 screen parity and interaction standards approved by Product + Design.
5. **Quality Signoff:** Test coverage and defect severity thresholds pass.
6. **Reliability Signoff:** SLA/SLO metrics meet launch gates for two consecutive weeks in RC.
7. **Operational Signoff:** Monitoring, on-call runbooks, rollback plan, support SOPs complete.
8. **Cohort Signoff:** Free and paid beta cohort outcomes both meet acceptance thresholds.

---

## Appendix A — Feature Completeness Definition (v1)
A “fully functional” v1 mobile app includes: auth + mandatory biometric, browse/search/preview, upload/download with durable resume, sharing with permission controls, offline pin/sync/conflict resolution, trash/recovery flows, notifications/activity, account/tier/quota visibility, accessibility baseline, and production observability.

## Appendix B — Explicit Exclusion Reminder
No admin dashboard/admin moderation/admin analytics tools are to be shipped in mobile app v1.

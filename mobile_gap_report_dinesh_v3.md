# Lazybird Nest → Mobile App Gap Analysis (Revised Full-Scope Plan)

**Author:** Dinesh (subagent analysis)
**Date:** 2026-03-04
**Repo analyzed:** `/home/joe/.openclaw/workspace-scout/projects/Lazybird-Nest`
**Revision intent:** Incorporates Joseph’s explicit product requirements for a full-featured mobile launch plan (not lean MVP), including a UI continuity directive tied to Nest web brand language.

---

## Executive Summary (What changed in this revision)

This v3 plan makes seven explicit changes:
1. **No lean MVP framing**: roadmap now targets a **fully functional app scope** delivered in phased releases (Foundation → Feature Complete Beta → GA Hardening).
2. **No practical upload size ceiling target**: architecture now supports **effectively unbounded large files** via chunking, streaming encryption/decryption, resumable background transfer, integrity checks, and durable queueing.
3. **Biometric security is mandatory**: app unlock and key access must require biometric verification (with secure fallback policy).
4. **No mobile admin dashboard**: all admin operations are **web-only**; mobile scope excludes admin UI.
5. **Beta includes free + paid cohorts**: test plan explicitly includes both user segments.
6. **SLA/reliability (item 7) clarified** in plain language with recommended measurable targets.
7. **UI continuity is explicit**: mobile visual language must stay aligned with existing Lazybird Nest web brand; Google Drive/Dropbox are UX quality bars only, not visual references.

---

## 1) Current repo snapshot (validated baseline)

### 1.1 High-level structure
- **Web frontend (root):** React + TypeScript + Vite (`src/*`)
- **Backend API (server):** Node.js + Express + TypeScript (`server/src/*`)
- **Infra/deploy:** Docker Compose + Caddy + GitHub Actions
- **Data layer:** Postgres + Drizzle ORM
- **Observability:** Sentry (web + server)

### 1.2 Existing modules reusable for mobile
- Auth and account routes
- File/folder lifecycle routes (init/chunk/finalize/list/download/share/trash)
- Storage quota routes
- Billing backend (Stripe-based server workflows)
- Background job/retry services

### 1.3 Existing constraints from current web implementation
- Web client relies on browser APIs (`window`, `localStorage`, blob download patterns).
- Crypto and transfer logic are conceptually portable but need mobile-safe implementations.

---

## 2) Updated product scope decisions (Joseph requirements mapped)

| Requirement | Decision in v3 plan |
|---|---|
| Not a lean MVP | Build toward full functional scope in phases; no “bare-minimum” launch target. |
| No upload size limit target | Engineer for effectively unbounded transfer workflows (device/network bounded, not product-capped). |
| Biometric required | Mandatory biometric gate for app unlock + key unwrapping. |
| No admin dashboard in app | Admin tools remain web-only; mobile app excludes admin screens/APIs in client UX. |
| Beta includes free + paid | Beta cohort intentionally split across free and paid usage profiles. |
| Clarify SLA/reliability | Added plain-language reliability model + target metrics + acceptance criteria. |
| Preserve Nest visual language | Mobile UI must mirror Nest brand system (typography, spacing rhythm, icon style, color tokens, navigation metaphors); Google Drive/Dropbox are UX benchmark references only. |

---


## UI Continuity Directive

Mobile must feel like **Lazybird Nest on a phone**, not a redesign inspired by third-party products.

- **Primary visual reference:** existing Lazybird Nest web app design language.
- **Brand continuity requirements:** preserve Nest typography scale, spacing rhythm, icon style, color tokens, and familiar navigation metaphors wherever platform constraints allow.
- **Benchmark clarification:** Google Drive and Dropbox remain **UX quality benchmarks** (flow clarity, transfer feedback, reliability cues), but are **not** visual style references.
- **Exception policy:** any intentional visual divergence from Nest web patterns requires explicit product/design sign-off and documentation in release notes.

## 3) Mobile readiness assessment (reframed)

### Verdict
- **Backend:** strong base and largely reusable.
- **Mobile client:** requires dedicated native/RN implementation; web SPA cannot be reused directly.
- **Feasibility:** high, provided early investment in transfer reliability + mobile key security.

### Practical readiness score
- Backend/API reuse: **7/10**
- Crypto protocol reuse: **6/10** (implementation work required)
- Direct UI reuse: **2/10**
- Overall readiness for a full-featured app: **4/10 today**, but tractable with planned execution.

---

## 4) Target mobile architecture (full-functional scope)

## 4.1 Platform recommendation
**React Native (TypeScript) + native modules for critical paths**
- Keep team velocity via TS ecosystem.
- Use native modules for heavy crypto and file streaming/background I/O.

## 4.2 Architectural layers
1. **Presentation layer:** RN screens/navigation/components.
2. **Domain layer:** shared TS types/validators/flow orchestration.
3. **Security layer:** secure enclave/keychain-backed secret storage + biometric policies.
4. **Transfer engine:** chunk scheduler + persistent queue + retry/resume orchestration.
5. **Data/cache layer:** encrypted metadata cache + sync state + conflict handling.
6. **Integration layer:** REST API client + telemetry + push notifications.

## 4.3 Explicit out-of-scope in mobile app
- Admin analytics dashboard
- Admin moderation/ops workflows
- Admin account tooling

These remain in web admin interfaces only.

---

## 5) Large-file architecture (effectively unbounded uploads/downloads)

This section is now mandatory and central.

## 5.1 Design goals
- No hard product cap like “max 2GB”; support very large files constrained only by storage/quota/network/device limits.
- Never load whole file into memory.
- Survive app kills, reboots, network changes, and OS backgrounding.

## 5.2 Upload pipeline (required behavior)
1. **File handle acquisition** (URI/path stream, not full read).
2. **Streaming encryption**: encrypt data incrementally while reading.
3. **Chunking**: split encrypted stream into fixed/adaptive chunks (e.g., 8–64MB tunable).
4. **Per-chunk hashing** (integrity metadata recorded).
5. **Durable queue write** before transfer attempt.
6. **Background-capable transport** with retries and exponential backoff.
7. **Server ack ledger** tracked by chunk index + hash.
8. **Finalize call** with manifest (chunk hashes, sizes, total count, file hash/merkle root if adopted).

## 5.3 Resume across restarts
- Persist transfer session state in local durable DB.
- On app relaunch, rehydrate queue and ask server for last confirmed chunk.
- Resume from first unconfirmed chunk (idempotent re-send allowed).
- Handle token expiry mid-transfer via refresh/re-auth policy without losing session state.

## 5.4 Integrity and correctness checks
- **Client side:** per-chunk hash before upload; optional final file hash.
- **Server side:** verify each chunk hash + byte count before commit.
- **Finalize guard:** reject finalize if any chunk missing/corrupt.
- **Download path:** verify decrypted output against expected digest when available.

## 5.5 Queueing and prioritization
- Durable multi-item queue with states: `queued`, `running`, `paused`, `failed`, `awaiting_network`, `completed`.
- Prioritization rules:
  - User-initiated foreground item gets priority boost.
  - Large background jobs get fair scheduling (no starvation).
  - Retry budget per item with user-visible failure reasons.

## 5.6 Low-memory path (mandatory)
- Stream read → encrypt/decrypt → write chunk/file directly.
- No full-file buffers.
- Adaptive chunk downshift on memory pressure.
- OS memory warnings trigger throttle/pause checkpoint.

## 5.7 Download architecture parity
- Mirror upload reliability for downloads:
  - Range/chunked fetch
  - Resume from saved offset/checkpoint
  - Stream decrypt directly to destination file
  - Integrity validation before marking complete

---

## 6) Mandatory biometric security model (exact user flows)

Biometric is required for app unlock and key access.

## 6.1 Flow A — First login on device
1. User logs in with email/password.
2. App derives/obtains encrypted key material.
3. App requires user to **enable biometric unlock** before entering main app.
4. App stores wrapped key/token secrets in secure storage bound to biometric policy.
5. User reaches home only after successful biometric enrollment check.

## 6.2 Flow B — Normal app unlock
1. User opens app.
2. Lock screen appears immediately.
3. Biometric prompt shown (Face ID / fingerprint).
4. On success, app unwraps key material in secure enclave context.
5. Session unlocked; data sync and transfers resume.

## 6.3 Flow C — Biometric failure / fallback
1. After configurable failed attempts, app offers fallback (device passcode or account password per policy).
2. Fallback unlocks app temporarily.
3. App requires biometric re-validation on next cold start and after inactivity timeout.

## 6.4 Flow D — Biometric settings changed on device
1. OS reports biometric set changed (new face/fingerprint).
2. App invalidates cached key-unlock tokens.
3. User must re-authenticate with account credentials.
4. App rebinds secrets to updated biometric set.

## 6.5 Flow E — Sensitive operations
Require fresh biometric confirmation for:
- Viewing recovery key / exporting recovery material
- Disabling biometric lock
- Wiping local encrypted cache
- Device unlink / security reset

## 6.6 Security policy notes
- No plaintext master key in app storage.
- Secrets only in OS-backed secure storage.
- Configurable auto-lock timer (e.g., immediate on background + mandatory unlock on foreground).

---

## 7) SLA & reliability target (plain language + recommended metrics)

### 7.1 Plain-language definition for Joseph
“Reliability” here means: **if a user starts a file transfer, the app should finish it successfully even when phone conditions are imperfect** (app backgrounded, weak network, temporary disconnects, or restart), without forcing them to start over.

### 7.2 Recommended targets (beta → GA)
1. **Upload completion success (<=10GB files, stable quota):**
   - Beta target: **97%** complete without manual restart
   - GA target: **99%** complete without manual restart

2. **Resume success after interruption (network drop/app restart):**
   - Beta: **95%** resume and finish automatically
   - GA: **98%** resume and finish automatically

3. **Data integrity mismatch rate (chunk/file hash failure):**
   - Beta: **<0.1%** of transfers
   - GA: **<0.01%** of transfers

4. **Time to recover from transient network failure:**
   - Beta: auto-retry begins within **30 seconds**
   - GA: within **10 seconds** when network returns

5. **Crash-free transfer sessions:**
   - Beta: **99.0%**
   - GA: **99.5%+**

### 7.3 Acceptance criteria before broad launch
- Soak tests with multi-GB files on iOS + Android pass target thresholds.
- Resume works after forced app kill and device reboot.
- Transfer state is never “lost” silently.
- User always sees clear status (`paused`, `retrying`, `needs action`, `done`).

---

## 8) Beta strategy (free + paid cohorts)

## 8.1 Cohort composition
- **Free cohort:** broad device/network diversity, smaller average file sizes.
- **Paid cohort:** heavy usage patterns, larger files, higher reliability expectations.

## 8.2 Why both cohorts are required
- Free users validate onboarding, usability, and baseline reliability.
- Paid users stress throughput, durability, and premium value/performance expectations.

## 8.3 Beta gating plan
1. Internal alpha (team + trusted testers)
2. Closed beta wave 1 (balanced free/paid mix)
3. Closed beta wave 2 (expand paid heavy-upload users)
4. Release candidate with SLA target validation

## 8.4 Metrics split by cohort
Track all reliability metrics separately for free vs paid to detect skew and protect paid experience quality.

---

## 9) Full-functional phased launch roadmap (not lean MVP)

## Phase 1 — Foundation (Weeks 1–6)
- RN app scaffolding, navigation, and **Nest design-system parity baseline**
- Auth/session core with secure token lifecycle
- Port Nest typography, spacing, iconography, and color-token primitives into mobile component library
- Mandatory biometric unlock framework
- Core file/folder browse operations
- Transfer engine skeleton with durable queue state model
- API contract/error taxonomy alignment

## Phase 2 — Feature-Complete Beta Build (Weeks 7–14)
- Full upload/download lifecycle with streaming encrypt/decrypt
- Resume across restarts + background transfer handling
- Sharing, trash/restore, settings, billing status/access
- Offline-aware metadata cache + retry UX
- Push notifications for transfer/security events
- Telemetry dashboards for SLA metrics
- UI continuity QA pass against web Nest patterns before each beta wave
- Beta rollout to both free and paid cohorts

## Phase 3 — GA Hardening (Weeks 15–22)
- Reliability tuning against SLA thresholds
- Final brand-consistency audit (visual regression + interaction language)
- Cross-device stress/perf optimization (memory, CPU, battery)
- Security hardening (biometric edge-cases, session revocation, device controls)
- Store compliance and release operations hardening
- Final launch gate based on SLA pass/fail criteria

---

## 10) Actionable implementation checklist

## P0 (must complete for feature-complete beta)
- [ ] RN app + architecture layers established
- [ ] Secure storage + biometric mandatory flows implemented
- [ ] Upload/download streaming with chunking and integrity checks
- [ ] Durable transfer queue persisted locally
- [ ] Resume across restart/kill/reboot functional
- [ ] Clear user transfer states and error recovery UX
- [ ] Admin surfaces excluded from mobile app
- [ ] Nest visual token/component parity implemented for core screens
- [ ] Google Drive/Dropbox inspiration limited to UX behavior, not visual styling
- [ ] Beta ops prepared for free + paid cohorts

## P1 (required for GA)
- [ ] SLA dashboards and alerting per cohort
- [ ] Brand-continuity regression checks in release pipeline
- [ ] Advanced retry tuning + adaptive chunk sizing
- [ ] Background reliability refinements (iOS/Android specifics)
- [ ] Security hardening for biometric changes and device migration flows
- [ ] Performance tuning under large-file stress

## P2 (post-GA optimization)
- [ ] Rich previews and quality-of-life polish
- [ ] More advanced sharing controls and automation
- [ ] Cost/performance optimization for transfer backend workloads

---

## 11) Updated risks and mitigations

1. **Crypto parity risk**
   - Mitigation: cross-platform test vectors, deterministic encryption/decryption conformance suite.

2. **Very large file transfer instability**
   - Mitigation: durable queue, resumable protocol, low-memory streaming, aggressive chaos testing.

3. **OS background limits**
   - Mitigation: platform-specific background transfer strategies and user-visible fallback behaviors.

4. **Billing policy variance (store compliance)**
   - Mitigation: early legal/policy review and product-path decisions before GA.

5. **Biometric lockout edge-cases**
   - Mitigation: explicit fallback and rebind flows with strict audit logging.

6. **Visual drift from Nest web brand**
   - Mitigation: tokenized design primitives, continuity QA checklist, and sign-off requirement for exceptions.

---

## 12) Open decisions Joseph should confirm now

1. Accept recommended SLA targets in Section 7 (or provide stricter thresholds).
2. Confirm inactivity auto-lock duration policy (e.g., immediate/1 min/5 min).
3. Confirm beta cohort percentages (recommended: 60% free / 40% paid initially).
4. Confirm purchase flow policy for mobile platform compliance.
5. Confirm approval workflow owner for any required UI divergence from Nest web language.

---

## 13) Short glossary (plain language)

- **Streaming encryption:** Encrypting data piece-by-piece while it is being read, instead of all at once.
- **Chunking:** Splitting a big file into smaller parts for safer transfer and retry.
- **Resumable transfer:** If upload/download stops, it continues from where it left off, not from zero.
- **Integrity check (hash):** A fingerprint used to confirm data was not corrupted.
- **Durable queue:** A saved task list that survives app restarts/reboots.
- **Low-memory path:** Processing files in small pieces so the app does not run out of RAM.
- **Biometric unlock:** Using fingerprint/face authentication to unlock app/key access.
- **SLA target:** A measurable reliability promise (for example, success rate of uploads).

---

## Final recommendation
Proceed with a **full-functional React Native mobile program** using the existing backend and zero-knowledge protocol, with **biometric-required security**, **large-file-first transfer architecture**, and **strict UI continuity with the Nest web brand** as first-class priorities. Keep admin capabilities web-only, treat Google Drive/Dropbox as UX quality benchmarks (not visual references), run beta across both free and paid users, and gate GA on clear reliability + brand-consistency targets rather than feature checklists alone.
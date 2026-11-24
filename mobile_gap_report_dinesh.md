# Lazybird Nest → Mobile App Gap Analysis (Detached Build Plan)

**Author:** Dinesh (subagent analysis)
**Date:** 2026-03-04
**Repo analyzed:** `/home/joe/.openclaw/workspace-scout/projects/Lazybird-Nest`
**Constraint honored:** Planning only, no repo modifications.

---

## 1) Current repo snapshot (stack, modules, app boundaries)

## 1.1 High-level structure
- **Web frontend (root):** React + TypeScript + Vite (`src/*`)
- **Backend API (server):** Node.js + Express + TypeScript (`server/src/*`)
- **Infra/deploy:** Docker Compose + Caddy + GitHub Actions (`docker-compose.yml`, `Caddyfile`, `.github/workflows/backend-deploy.yml`)
- **Data layer:** Postgres with Drizzle ORM (`server/src/db/schema.ts`)
- **E2E tests:** Puppeteer script (`e2e/test.js`)

## 1.2 Frontend stack (actual)
From root `package.json`:
- React 19, React Router 7, TypeScript, Axios
- Tailwind + custom components
- `libsodium-wrappers`, `hash-wasm` for client-side cryptography/KDF
- `streamsaver`, `fflate` for large streaming exports/downloads
- Sentry (`@sentry/react`)
- 3D/landing deps (`three`, `@react-three/fiber`, `@react-three/drei`)

## 1.3 Backend stack (actual)
From `server/package.json` and `server/src/server.ts`:
- Express 4 + TypeScript
- Drizzle ORM + Postgres client (`postgres`)
- Auth/security: `bcrypt`, `jsonwebtoken`, `helmet`, `cors`, `express-rate-limit`
- Payments: Stripe
- Storage network integration: `@jackallabs/jackal.js`
- Async/background: cron jobs, retry scheduler, cleanup services
- Email via Nodemailer
- Sentry Node instrumentation

## 1.4 Security & crypto model implemented
- Zero-knowledge design: client encrypts/decrypts file/content metadata.
- Root key derivation in client using Argon2id/PBKDF2 fallback (`src/crypto/v2.ts`).
- Master key wrapping/unwrapping client-side.
- Folder/file key hierarchy + encrypted metadata blob.
- Backend stores encrypted keys/blobs and serves encrypted assets; cannot decrypt user data by design.

## 1.5 API boundaries/modules (server routes)
- `/api/auth` — signup/login/salt/password reset/metadata/account ops
- `/api/files` — init upload, chunk upload, finalize, list, download info, raw download proxy, share, trash, restore, delete
- `/api/folders` — create/list/move/delete/get encrypted folder key
- `/api/storage` — quota/status
- `/api/billing` — checkout, portal, subscription sync, webhook
- `/api/admin` — admin analytics/ops

## 1.6 Frontend app boundaries
Primary pages:
- Auth: `LoginPage`, `SignupPage`, `ForgotPasswordPage`, `ResetPasswordPage`
- Core drive: `NestPage`, `FoldersPage`, `SharedLinksPage`, `TrashPage`
- Settings/billing/recovery/admin pages
- Landing/docs pages in same SPA

State/context boundaries:
- `AuthContext` (token, master key, metadata, login/signup/logout)
- `UploadContext` (queue, encryption, chunking, upload orchestration)
- `StorageContext`, `RefreshContext`, `ToastContext`

---

## 2) Mobile readiness assessment

## Verdict
**Backend is mostly reusable with moderate mobile adjustments. Frontend is not mobile-native ready; it is web-API-heavy and browser-coupled.**

## Readiness score (practical)
- **Backend/API:** 7/10 for mobile client reuse
- **Crypto core (conceptual):** 6/10 reusable, but implementation depends on web APIs and needs adaptation
- **Frontend UI/app shell:** 2/10 for direct reuse in native mobile
- **End-to-end mobile readiness overall:** **4/10**

## Why
- Strong reusable API and ZK architecture already exists.
- But current client assumes browser primitives heavily:
  - `window`, `document`, `localStorage`, `navigator.clipboard`, DOM download triggers
  - Browser stream/save semantics (`streamsaver` + mitm)
  - Browser file objects and drag/drop UX

---

## 3) What must change for mobile

## 3.1 Frontend/app shell
Must change:
- Rebuild UI layer in mobile framework (RN/Flutter/native).
- Replace React Router + browser route model with mobile navigation stack.
- Replace DOM/clipboard/toast patterns with native equivalents.
- Separate marketing/landing/docs from app client (web-only concern).

## 3.2 Backend APIs
Mostly reusable but improve for mobile ergonomics:
- Ensure all API flows are stable for non-browser clients (already mostly true).
- Add explicit API versioning strategy (if not currently formalized).
- Introduce resumable/chunk upload session semantics hardened for mobile network drops.
- Add consistent machine-readable error codes (not only message text).

## 3.3 Auth/session
Current:
- JWT with 30d expiration, token stored client-side (`localStorage` in web).

For mobile:
- Store token and encrypted key material in secure enclave/keychain-backed storage.
- Prefer short-lived access token + refresh token (or robust rotation policy).
- Add device/session management API for remote logout and token revocation if needed.

## 3.4 Storage/filesystem
Current web logic assumes `File`/`Blob`/browser download links.
For mobile:
- Use native filesystem APIs for read/write streams.
- Implement background/resumable uploads (especially >100MB / chunked).
- Support pause/resume on app backgrounding and intermittent connectivity.

## 3.5 Notifications
Current repo has email jobs, no mobile push pipeline.
Need:
- Push notification service integration (FCM/APNs via provider or direct).
- Event triggers for upload complete/failure/share activity/security alerts.
- User-level notification preference endpoints.

## 3.6 Media/download handling
Current uses browser URL object + anchor download and StreamSaver.
Need:
- Native save/open/share sheet pipeline.
- Streaming decrypt-to-file for large files to avoid memory pressure.
- Reliable iOS background task behavior and Android foreground service where needed.

## 3.7 Offline behavior
Current app is online-first.
Need:
- Local encrypted metadata cache strategy.
- Queued operations (upload/move/delete/share) with conflict resolution.
- Explicit offline states and retry UX.

## 3.8 Performance
Need:
- Move heavy crypto operations off UI thread (native module/isolate/worker strategy).
- Profile Argon2 parameters for mobile CPU/RAM constraints.
- Tune chunk size dynamically by device/network class (not fixed-only strategy).

## 3.9 Security hardening for mobile
Need:
- Remove plain local key persistence patterns used in web (`nest_master_key` in localStorage currently).
- OS-level secure storage + biometric gate for decrypt key unlock.
- Root/jailbreak detection policy (optional but recommended for high-security positioning).
- Certificate pinning consideration for API gateway.

## 3.10 Analytics/telemetry
Current: server-side analytics events + Sentry.
Need:
- Mobile product analytics schema (funnel, upload lifecycle, crypto failures).
- Crash + perf telemetry in native app with privacy-safe event design.

## 3.11 CI/CD/testing
Current:
- Backend deploy workflow exists; frontend mobile pipeline absent.
Need:
- Mobile build pipelines (iOS + Android) with signing, store distribution tracks.
- Device matrix tests (emulators + physical devices).
- Contract/API tests to protect mobile against backend regressions.

---

## 4) What can be reused as-is

1. **Core backend domain model**
   - Users, user_crypto, folders, files, file_chunks, graveyard, analytics tables.
2. **Most REST API routes**
   - Auth/files/folders/storage/billing/admin patterns are already modularized.
3. **Zero-knowledge architecture itself**
   - Key hierarchy and encrypted metadata strategy are portable.
4. **Billing backend with Stripe**
   - Server-side webhook/state model can remain (mobile purchase UX may differ, see caveat below).
5. **Operational services**
   - Cleanup jobs, retry scheduler, verification jobs, retention flow.
6. **Observability baseline**
   - Sentry + logging foundation usable for mobile backend support.

---

## 5) What should be replaced or abstracted

## Replace (client-side)
- Browser-only storage/session handling (`localStorage` key persistence).
- Browser-driven file download/export logic (`streamSaver`, `URL.createObjectURL`, anchor click).
- DOM/toast/navigation side effects using `window`/`document`.
- Direct clipboard/browser assumptions.

## Abstract
- Crypto engine interface:
  - Keep same crypto protocol, but abstract implementation behind platform adapters.
- File I/O interface:
  - Browser `File/Blob` vs native file handles should be hidden behind repository/service abstraction.
- Session storage interface:
  - web storage vs secure keychain/keystore.
- Network transfer layer:
  - standard API calls + resumable upload strategy with mobile retry semantics.

---

## 6) Platform choice recommendation (React Native vs Flutter vs native)

## Recommendation: **React Native (TypeScript), with native crypto/filesystem modules where needed**

### Repo-specific rationale
1. **Team/code affinity:** Current frontend is React + TS; RN minimizes language/context switch.
2. **Business logic reuse potential:** API client patterns, DTOs, auth/upload flow logic can be ported conceptually faster.
3. **Faster MVP velocity:** RN likely shortest path from this codebase to shipping both iOS/Android.
4. **Crypto caveat manageable:** You’ll still need native/perf-aware crypto bindings (or audited RN-compatible libs) for large file streaming.

### Why not Flutter (for this repo specifically)
- Strong platform, but would require full rewrite in Dart and rethinking all current TS logic/tooling.
- Higher migration cost for a team already invested in React ecosystem.

### Why not fully native first
- Best raw performance/security control, but highest cost/time for feature parity on two platforms.
- Better reserved for later optimization of critical flows if RN hits limits.

### Practical architecture choice
- RN app + shared TS domain package (types/protocol/validation).
- Native modules for heavy crypto streaming + file background transfer.

---

## 7) Proposed migration paths

## Path A: Fast MVP (8–10 weeks)
Goal: usable mobile client with secure core flows.

Scope:
- Email/password auth with ZK key derivation and secure key storage.
- File list/folders/upload/download/delete/share basic flows.
- Chunked uploads for larger files (with simple retry).
- Basic settings + billing status display (purchase flow may stay web handoff initially).
- Crash reporting + basic analytics.

Tradeoffs:
- Limited offline.
- Minimal background reliability for huge files.
- Reduced export features compared with web.

## Path B: Robust production path (16–24 weeks)
Goal: resilient mobile experience suitable for heavy storage users.

Adds:
- Full resumable uploads/downloads across app restarts.
- Advanced offline queue + conflict handling.
- Push notifications and rich status events.
- Biometric unlock, stronger key lifecycle policies.
- Improved performance tuning and battery/network adaptivity.
- Full QA matrix + release automation.

---

## 8) Risks, unknowns, dependency blockers

## Key risks
1. **Crypto implementation parity risk**
   - Current client crypto depends on web runtime assumptions; mismatch could cause data incompatibility if not rigorously tested.
2. **Large-file mobile memory/IO pressure**
   - Existing web strategy already warns for iOS constraints; native implementation must avoid RAM spikes.
3. **Background transfer reliability**
   - Mobile OS lifecycle constraints can break long uploads without dedicated background transfer architecture.
4. **Billing compliance risk**
   - Mobile store rules may require in-app purchase handling instead of direct Stripe web checkout for certain digital goods cases.
5. **Session/key security risk**
   - Current web localStorage model cannot be copied to mobile; secure storage design is mandatory.

## Unknowns / blockers requiring Joseph decisions
- Required parity with all web features at launch vs staged rollout.
- Maximum target file sizes for mobile MVP.
- iOS/Android minimum OS versions.
- Billing model policy for mobile stores.
- Security posture target (biometric mandatory? remote wipe? device trust controls?).

---

## 9) Detailed implementation checklist (P0/P1/P2)

## P0 (must-have for initial ship)
- [ ] Define mobile architecture (RN + native module boundaries).
- [ ] Extract/define shared API contract models and error codes.
- [ ] Implement secure token + key storage (Keychain/Keystore).
- [ ] Port auth + ZK key derivation/wrapping flow.
- [ ] Port metadata decrypt/encrypt lifecycle.
- [ ] Implement file list/folder tree APIs.
- [ ] Implement upload init/chunk/upload/finish pipeline with retries.
- [ ] Implement download + decrypt-to-file (no in-memory giant blobs).
- [ ] Replace browser share/download UX with native equivalents.
- [ ] Add crash logging and baseline analytics.
- [ ] Add API contract tests and critical flow integration tests.

## P1 (important hardening)
- [ ] Resumable transfer across app restarts.
- [ ] Offline operation queue + sync status UI.
- [ ] Background transfer reliability improvements (iOS/Android specific).
- [ ] Push notification pipeline (upload finished, security alerts).
- [ ] Biometric app lock and key-unlock policy.
- [ ] Better error taxonomy and recoverability UX.
- [ ] Mobile-specific performance profiling and chunk auto-tuning.

## P2 (polish/scale)
- [ ] Rich media previews and improved file handling UX.
- [ ] Advanced admin/analytics views in mobile.
- [ ] Full parity for export and advanced sharing controls.
- [ ] Feature flags/remote config for safe rollout.
- [ ] Expanded device farm and chaos/network-condition testing.

---

## 10) Estimated timeline by week (MVP and production-ready)

## MVP timeline (approx. 8–10 weeks)
- **Week 1:** Architecture, contracts, project scaffolding, secure storage decisions.
- **Week 2:** Auth + key management + metadata bootstrap.
- **Week 3:** File/folder listing, navigation, base UX shell.
- **Week 4:** Upload pipeline (init/chunk/finish), progress and retries.
- **Week 5:** Download/decrypt/save pipeline.
- **Week 6:** Share/trash/settings basics + error handling hardening.
- **Week 7:** QA pass, contract tests, crash/analytics integration.
- **Week 8:** Beta stabilization and release prep.
- **Buffer Weeks 9–10:** Device-specific fixes + app store submission loops.

## Production-ready timeline (approx. 16–24 weeks total)
- **Weeks 1–10:** MVP foundation.
- **Weeks 11–14:** Resumable background transfers + offline sync.
- **Weeks 15–17:** Security hardening (biometric policies, key lifecycle, threat checks).
- **Weeks 18–20:** Push notifications + billing compliance finalization.
- **Weeks 21–22:** Performance optimization + large-file stress testing.
- **Weeks 23–24:** Release hardening, observability dashboards, rollout gates.

---

## 11) Assumptions and open questions for Joseph

## Assumptions used in this analysis
1. Mobile app is a **detached project** and will not alter this repo directly.
2. Existing backend APIs can be extended but remain primary backend.
3. ZK protocol compatibility with current stored data is non-negotiable.
4. First release targets both iOS and Android.
5. Team prefers speed-to-market with acceptable staged hardening.

## Open questions to answer before execution
1. What exact feature subset is required for mobile v1 (must-have list)?
2. Are very large files (multi-GB) required in v1 or phased later?
3. Will mobile purchases use web checkout handoff or native IAP compliance path?
4. What security posture is mandatory for launch (biometric required, remote session revocation, anti-tamper)?
5. Is admin functionality needed in mobile or web-only?
6. Which user cohorts should join beta first (free users only vs pro heavy upload users)?
7. What SLA/reliability target is expected for background uploads?

---

## Final recommendation
Build a **new React Native mobile client** on top of the existing backend/ZK protocol, with early investment in secure storage and robust streaming transfer primitives. Keep MVP narrow, then harden for offline/background/large-file resilience before broad launch.

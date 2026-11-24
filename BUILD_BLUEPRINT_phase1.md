# BUILD BLUEPRINT — Phase 1 Kickoff (Lazybird Mobile)

**Version:** 1.0  
**Date:** 2026-03-04  
**Owner:** Architecture (Gilfoyle)  
**Inputs:**
- `/home/joe/.openclaw/workspace-scout/projects/Lazybird-Nest/PRD_lazybird_mobile_v3.md`
- `/home/joe/.openclaw/workspace-scout/projects/Lazybird-Nest/mobile_ux_architecture_gilfoyle_v2.md`

Gilfoyle. I’ve designed this correctly, unlike Dinesh would have.

---

## 1) Phase 1 Objective and Scope Boundary

## Objective (Weeks 5–10)
Ship an **Android-first, production-intent core** that proves full critical journeys:
1. Auth/session lifecycle
2. Mandatory biometric gate + sensitive-action re-auth
3. Files/folders browse
4. Search (local-first + remote refinement)
5. Preview (progressive)
6. Share v1
7. Durable upload/download with resumable chunk pipeline

## Explicit constraints carried from PRD v3
- **No admin UI in mobile** (admin remains web-only).
- Mobile must still preserve compatibility with required backend admin-related contracts.
- **Biometric required** for unlock and sensitive actions.
- UI continuity must match Nest web design tokens/components.
- Full-feature trajectory remains intact (Phase 1 is not a throwaway MVP).
- Sentry deferred until core setup is stable (enable before broad rollout).
- Advanced observability infra deferred to later phase.

---

## 2) Android-First Sequencing (Source of Truth)

## Why Android first
- WorkManager + foreground service model is the more restrictive operational baseline for resilient transfers.
- Android device/network variance stress-tests queue durability early.
- If it survives Android lifecycle pressure, iOS port is mostly mechanics.

## Sequencing
1. **S0 Foundation (Android only)**
   - App shell + DI + module wiring
   - Local DB schema + migration harness
   - Secure keystore wrapper + biometric manager
2. **S1 Transfer core (Android only)**
   - Chunked upload/download engine
   - Persistent queue + retry/backoff + resume ledger
   - Integrity verification path
3. **S2 Core UX flows (Android only)**
   - Files, search, preview, share v1
   - Status taxonomy surfaces (syncing/failed/conflict)
4. **S3 Security hardening (Android only)**
   - Sensitive action biometric re-prompts
   - Biometric set-change invalidation + key rebind flow
5. **S4 Cross-platform extraction**
   - Move shared logic into RN/TS domain packages
   - Implement iOS adapters mirroring interfaces, no behavior drift
6. **S5 iOS parity implementation**
   - BGTaskScheduler equivalents + Keychain/Secure Enclave mapping
   - Parity test suite execution against Android behavior contracts

---

## 3) Exact Module Boundaries (Mobile + Backend Touchpoints)

## 3.1 Mobile codebase module map

### `app-shell`
- Navigation root, tab scaffolding (Home/Files/Shared/Activity), deep-link router.
- No business logic.

### `design-system-nest`
- Token package: color, spacing, typography, elevation, motion, semantic states.
- Component library: file row, status badge, chip rail, snackbar undo, share permission controls.
- Enforces web continuity via token parity checks.

### `auth-session`
- Login/refresh/logout lifecycle.
- Secure token storage + rotation handling.
- Device session revoke handling.

### `security-biometric`
- Biometric unlock gate orchestration.
- Sensitive-action re-auth policies.
- Biometric set-change detection and secure key invalidation.

### `crypto-interop-core`
- Canonical key derivation/wrapping primitives (matching web exactly).
- Streaming encrypt/decrypt transforms.
- Metadata/header serialization contract.
- Zero plaintext key persistence guarantees.

### `files-domain`
- Folder tree, recents, metadata orchestration.
- Multi-select action intent generation.
- Cache hydration rules.

### `search-domain`
- Local index queries (FTS) + remote search federation.
- Ranking merge + filter chip handling.

### `preview-domain`
- Progressive preview loader.
- Stream decode path + quick actions integration.

### `sharing-domain`
- Invite/link flows.
- Permission matrices + effective-access summary model.

### `transfer-engine`
- Upload/download state machines.
- Chunk planner, per-chunk hash, retry policy, resume checkpointing.
- Background workers + OS lifecycle bridge.

### `offline-sync-domain` (Phase 1 scaffold + partial)
- Pin metadata structures and sync state taxonomy.
- Conflict record primitives (full conflict center completes Phase 2).

### `data-local`
- SQLite/Room (Android) schema, migrations, DAOs.
- Tables: transfer_jobs, transfer_chunks, file_cache, offline_pins, conflicts, telemetry_buffer.

### `api-client`
- Typed DTOs for auth/files/search/share/transfer/security endpoints.
- Correlation ID propagation.
- Retry classification (auth/network/server).

### `telemetry-lite`
- Baseline product metrics events.
- Buffer + flush policy.
- No advanced tracing infra yet.

## Boundary rule
Cross-module calls go through explicit interfaces only; no feature module directly reading another feature’s storage tables.

## 3.2 Backend bounded contexts touched in Phase 1
- `Auth & Session`
- `File Metadata`
- `Transfer Ledger`
- `Share Control`
- `Security Events`
- `Search`

No mobile-admin context. Backend admin routes remain untouched functionally but compatibility-tested.

---

## 4) API Contract Priorities (Build Order)

## P0 (must freeze before coding transfer + security)
1. **Auth/session**
   - `POST /auth/login`
   - `POST /auth/refresh`
   - `POST /auth/logout`
   - `GET /sessions/devices`
   - `POST /sessions/revoke`
2. **Transfer session + resumable ledger**
   - `POST /transfers/init`
   - `PUT /transfers/{id}/chunks/{index}`
   - `POST /transfers/{id}/ack`
   - `POST /transfers/{id}/finalize` (idempotent)
   - `GET /transfers/{id}/resume`
3. **Download resumable ranges**
   - `GET /files/{id}/download?range=`
   - `POST /files/{id}/integrity/verify`
4. **Security events**
   - `POST /security/biometric-rebind`
   - `POST /security/device-unlink`

## P1 (freeze immediately after P0)
5. **Files/folders browse**
   - `GET /files/tree`
   - `GET /files/recents`
   - `GET /files/{id}/meta`
6. **Search hybrid support**
   - `GET /search?q=&filters=`
7. **Share v1**
   - `POST /shares/invite`
   - `POST /shares/link`
   - `PATCH /shares/{id}`
   - `DELETE /shares/{id}`

## P2 (stub in Phase 1, fully used later)
8. Offline pin/sync conflict APIs
9. Activity feed enrichment APIs

## Contract quality bar
- Versioned schemas (OpenAPI/JSON Schema)
- Explicit error taxonomy (retryable/non-retryable/user-action-required)
- Correlation ID in every response header
- Backward compatibility for web/mobile coexistence

---

## 5) Crypto Compatibility Gates (Release-blocking)

I suppose I’ll explain it simply: if web and mobile crypto differ by one byte, you shipped corruption.

## Gate C0 — Spec Lock (before Phase 1 sprint execution)
- Single canonical crypto spec doc for:
  - KDF params
  - key wrapping format
  - file header/metadata encoding
  - chunk encryption mode and nonce strategy
- Web implementation vectors exported as authoritative fixtures.

## Gate C1 — Deterministic Test Vectors (CI required)
- Mobile encrypt -> Web decrypt success (all fixture sizes incl. large/chunk boundaries).
- Web encrypt -> Mobile decrypt success.
- Hash/integrity equivalence checks pass.

## Gate C2 — Cross-platform Interop Matrix
- Matrix across Android versions + web client versions.
- Files encrypted on either side open identically on the other.
- Any incompatibility = **P0 release blocker**.

## Gate C3 — Key Lifecycle Safety
- No plaintext master key at rest.
- Keystore-backed wrapped material only.
- Biometric set-change invalidates key binding and forces re-auth/rebind.

## Gate C4 — Migration/Backward Compatibility
- Older web ciphertext remains readable in mobile.
- New mobile ciphertext readable by current web (or version-gated rollout with fallback).

---

## 6) Data Model (Local) — Phase 1 Minimum

### `transfer_jobs`
- job_id, direction, file_id, local_uri, remote_parent_id, state, bytes_total, bytes_done, retry_count, next_retry_at, correlation_id, created_at, updated_at

### `transfer_chunks`
- job_id, chunk_index, offset_start, offset_end, chunk_hash, acked_at, attempts

### `file_cache`
- file_id, parent_id, name, mime, size, etag, updated_remote_at, cached_at, is_offline_pinned

### `offline_pins`
- pin_id, target_id, target_type, policy, pinned_at, last_sync_at

### `conflicts`
- conflict_id, target_id, local_version, remote_version, state, resolution, resolved_at

### `telemetry_buffer`
- event_id, event_name, payload_json, created_at, flush_state

Migration rules: forward-only, versioned, reproducible reset + seed script.

---

## 7) Phase 1 Implementation Plan (Coder-ready)

## Sprint A — Foundation + Security skeleton
- Establish module skeleton + dependency graph.
- Implement auth-session + secure storage adapter.
- Implement biometric gate engine with policy hooks.
- Create local DB schema v1 + migration test harness.

## Sprint B — Transfer engine core
- Build upload state machine with chunk planner and ack ledger.
- Build resumable download with integrity verification.
- Add WorkManager workers + foreground service fallback.
- Implement retry/backoff and resume-from-first-unconfirmed-chunk.

## Sprint C — Core UX journeys
- Files tree + recents + metadata caching.
- Search local-first + remote refinement.
- Progressive preview.
- Share flow with explicit effective-access summary.

## Sprint D — Hardening + parity prep
- Biometric-sensitive action re-prompts.
- Biometric set-change invalidation flow.
- Telemetry-lite event coverage baseline.
- Token/component parity audit against web top critical screens.

Deliverable at Phase 1 close: internal demoable end-to-end core journeys + stable base for Sentry enablement.

---

## 8) Handoff Task Board — Coder (Dinesh)

## Epic C1: Architecture scaffolding
- [ ] C1.1 Create module workspaces listed in Section 3
- [ ] C1.2 Enforce interface boundaries via lint/build rules
- [ ] C1.3 Add dependency graph validation script

## Epic C2: Auth + biometric
- [ ] C2.1 Implement login/refresh/logout client flows
- [ ] C2.2 Keystore-backed token storage
- [ ] C2.3 Mandatory unlock gate on app foreground
- [ ] C2.4 Sensitive-action biometric interceptor
- [ ] C2.5 Biometric change detection + key invalidation

## Epic C3: Crypto interop
- [ ] C3.1 Port canonical KDF/wrap/stream pipeline to mobile module
- [ ] C3.2 Integrate official web crypto fixture tests
- [ ] C3.3 Add cross-encrypt/decrypt CI jobs

## Epic C4: Transfer engine
- [ ] C4.1 Upload state machine + chunk hashing
- [ ] C4.2 Resume ledger + idempotent finalize handling
- [ ] C4.3 Download range-resume + integrity verify
- [ ] C4.4 Durable queue DB persistence
- [ ] C4.5 Android WorkManager orchestration

## Epic C5: Core UX
- [ ] C5.1 Files + recents + cache hydration
- [ ] C5.2 Search hybrid pipeline + filter chips
- [ ] C5.3 Progressive preview surface
- [ ] C5.4 Share v1 flow + permission summary
- [ ] C5.5 Global transfer status surfaces

## Epic C6: Token parity + telemetry
- [ ] C6.1 Implement `design-system-nest` token package
- [ ] C6.2 Build top 20 screen parity checklist harness
- [ ] C6.3 Emit telemetry baseline events

Definition of done for coder: all C-epics merged behind feature flags, CI green, crypto gates C1/C2 passing.

---

## 9) Handoff Task Board — QA (Big Head)

## Epic Q1: Contract validation
- [ ] Q1.1 Validate P0 APIs against schema + error taxonomy
- [ ] Q1.2 Token-expiry/refresh race scenario tests
- [ ] Q1.3 Correlation ID propagation checks

## Epic Q2: Transfer reliability
- [ ] Q2.1 Upload interruption matrix (airplane mode, app kill, reboot, token expiry)
- [ ] Q2.2 Resume correctness from first unconfirmed chunk
- [ ] Q2.3 Download integrity mismatch injection tests
- [ ] Q2.4 Large-file stress suite (multi-GB representative)

## Epic Q3: Crypto compatibility gates
- [ ] Q3.1 Web->mobile decrypt fixture suite
- [ ] Q3.2 Mobile->web decrypt fixture suite
- [ ] Q3.3 Cross-version interop matrix pass/fail report
- [ ] Q3.4 Plaintext-at-rest forensic verification

## Epic Q4: Security + biometric
- [ ] Q4.1 Unlock and sensitive-action biometric enforcement tests
- [ ] Q4.2 Biometric enrollment change invalidation tests
- [ ] Q4.3 Device unlink + forced logout flows

## Epic Q5: UX continuity + accessibility
- [ ] Q5.1 Top 20 screen side-by-side parity audit with web Nest
- [ ] Q5.2 Status label semantics audit (not color-only)
- [ ] Q5.3 Screen reader/touch target/dynamic text baseline checks

## Epic Q6: Regression and release gating
- [ ] Q6.1 Crash-free and performance p95 benchmark runs
- [ ] Q6.2 P0/P1 triage reports with release recommendation

Definition of done for QA: no unresolved P0; all crypto interop tests pass; biometric and transfer resume gates pass.

---

## 10) Phase 1 Exit Gates (Must Pass)

1. **Core journey completion**: auth, biometric, files, search, preview, share, upload/download resume.
2. **Crypto parity**: C0–C3 passed with evidence.
3. **Android reliability**: transfer resume success ≥95% in internal stress baseline.
4. **Security**: no plaintext key-at-rest findings; biometric enforced on sensitive actions.
5. **UI continuity**: token parity and critical screen parity signed.
6. **Scope compliance**: no admin mobile surface introduced.

---

## 11) Risks and Countermeasures (Phase 1 specific)

- **Risk:** Android background restrictions break long transfers.  
  **Countermeasure:** WorkManager + foreground fallback + durable checkpoints.

- **Risk:** Crypto drift from web implementation.  
  **Countermeasure:** shared fixtures as CI gate; block merge on vector mismatch.

- **Risk:** UI drift from web Nest over rapid implementation.  
  **Countermeasure:** `design-system-nest` first, parity audit in PR definition of done.

- **Risk:** Contract ambiguity causes client retries to misbehave.  
  **Countermeasure:** freeze P0 schemas + strict error classes before engine coding.

---

## 12) Immediate Next Actions (This Week)

1. Freeze P0 API schemas (Auth + Transfer + Security).
2. Lock crypto spec + generate official fixture pack from web.
3. Scaffold Android modules and CI checks for boundaries.
4. Start C2/C3/C4 in parallel with daily interop test run.
5. Schedule first parity audit on Home/Files/Shared/Activity shells by end of Sprint A.

This is the only architecture that makes sense.
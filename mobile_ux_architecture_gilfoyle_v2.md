# Lazybird-Nest Mobile UX & Product Architecture Blueprint

**Author:** Gilfoyle (Architect)
**Objective:** Deliver a mobile experience that is visually consistent with current Nest web UI while meeting or exceeding Google Drive/Dropbox quality on speed, reliability, and flow execution.
**Scope:** iOS + Android native client architecture, UX behavior contracts, reliability/performance requirements, rollout gates.

---

## 0) Visual Continuity and UX Benchmark Separation

### 0.1 Non-negotiable visual directive
- **Mobile UI must remain visually continuous with the current Lazybird-Nest web app** (layout language, spacing rhythm, typography hierarchy, color semantics, iconography, and interaction idioms).
- Mobile is an extension of Nest web, not a rebrand experiment. If a user switches devices, they should feel they are in the same product within seconds.

### 0.2 Benchmark separation (Drive/Dropbox as quality bar, not aesthetic source)
- Google Drive and Dropbox are used strictly as **UX quality benchmarks** for:
  - Performance perception (speed to meaningful content)
  - Reliability (transfer/sync resilience, failure recovery)
  - Flow quality (task completion with minimal cognitive load)
- They are **not** visual references for Lazybird-Nest UI style. We borrow operational excellence, not appearance.

### 0.3 Continuity constraints for design and engineering
- Do not introduce new visual patterns on mobile unless web Nest has an equivalent approved pattern or an explicit cross-platform design-system decision.
- When platform conventions (iOS/Android) conflict with web continuity, prefer: **Nest visual identity + native interaction mechanics**.
- Any deliberate mobile-only visual deviation requires documented rationale and sign-off from Product + Design.

---

## 1) Benchmark Deconstruction: Google Drive + Dropbox Mobile UX Patterns

### 1.1 Navigation Patterns

| Pattern | Google Drive | Dropbox | Implication for Lazybird-Nest |
|---|---|---|---|
| Primary nav | Bottom tabs + contextual FAB | Bottom tabs + strong recents/home | Use 4-tab model: **Home, Files, Shared, Activity** + global Add FAB |
| Context switching | Accounts/spaces visible but subtle | Personal/work switching explicit | Add quick workspace switcher in top app bar |
| In-folder navigation | Breadcrumbs + back stack | Clean folder list + recent context | Preserve folder state per tab; avoid reset on tab switch |

**Winning behavior:** Users always know “where they are” and can recover context in 1 tap.

### 1.2 File Operations
- **Long-press multi-select** is table stakes; needs sticky action bar with batch actions.
- **Inline quick actions** (three-dot menu or swipe) reduce taps for share/rename/move/offline.
- **Undo affordance** (snackbar with undo) prevents perceived risk.

**Requirement:** Every destructive action must have reversible window (5–10s UI undo + server trash retention).

### 1.3 Search UX
- Leading apps prioritize **instant local + remote hybrid search** with typeahead.
- Filter chips (Type, Owner, Location, Date) drastically reduce query friction.
- Result cards expose context (folder path, owner, modified time) to avoid false taps.

**Requirement:** Search should render first results <300ms from local index, then stream remote refinements.

### 1.4 Preview UX
- Fast open is critical: skeleton → progressive render.
- Panning/zoom for docs/images/PDF; scrubber for media.
- Metadata + actions (share, download, offline) should be one swipe away, not hidden.

**Requirement:** Preview-first architecture (open quickly even before full file bytes arrive).

### 1.5 Sharing UX
- Unified share sheet: invite collaborators + link settings in one flow.
- Permission clarity: Viewer/Commenter/Editor with plain language.
- Trust cues: “Anyone with link”, expiration, password, domain restriction clearly visible.

**Requirement:** Never hide effective access state. Show final permission summary before send.

### 1.6 Upload UX
- Persistent background queue visible globally.
- Per-item progress + global aggregate progress.
- Failure state always actionable (retry, details, switch network).

**Requirement:** Uploads survive app kill/network handoffs and resume correctly.

### 1.7 Offline + Sync UX
- Explicit “Available offline” toggle per file/folder.
- Clear sync badges: local only / syncing / synced / conflict / failed.
- Conflict resolution must not feel like data loss.

**Requirement:** Deterministic sync state model with legible labels and timestamps.

### 1.8 Notifications + Activity
- Useful notifications = collaborator actions, share access changes, sync failures.
- In-app activity feed acts as trust and recovery layer.

**Requirement:** All push events deep-link to exact resource + event context.

### 1.9 Trust Cues
- Recent activity, version history, last sync time, and device/offline indicators reduce anxiety.
- Security cues: lock icon, encryption mention, biometric lock state.

**Requirement:** Surface operational truth, not marketing claims.

---

## 2) UX Principles for Lazybird-Nest

1. **Speed is perceived before measured**
   - Show meaningful content in <200ms (cached shell), then refine.
   - Use optimistic UI where safe.

2. **Reliability over animation flair**
   - No silent failures; every failed action gets reason + next step.
   - Queued intent model for flaky networks.

3. **Clarity over cleverness**
   - Plain labels: “Shared with me”, “Available offline”, “Upload paused”.
   - Permission and sync state always human-readable.

4. **Security that users can verify**
   - Biometric lock, session/device listing, share visibility, version history.
   - Explicit audit surfaces (who accessed/shared/edited).

5. **Continuity across devices and interruptions**
   - App kill, network drop, auth refresh, OS background limits are expected conditions.

---

## 3) Information Architecture + Screen Map (iOS/Android)

### 3.1 Top-level IA

- **Home**
  - Recent files
  - Suggested / quick access
  - Continue working cards
  - Active transfers summary
- **Files**
  - My files (folder tree)
  - Offline
  - Favorites / Starred
  - Trash
- **Shared**
  - Shared with me
  - Shared by me
  - Link shares
- **Activity**
  - Notifications
  - File activity timeline
  - Transfer failures/conflicts

Global:
- **Search** (top entry, deep feature)
- **Add FAB** (upload, new folder, scan, import from sources)
- **Account/Workspace switcher**

### 3.2 Screen Map

1. Splash / cold-start bootstrap
2. Auth (SSO/email/passkey/2FA)
3. Biometric unlock gate (post-auth optional)
4. Home
5. Files root
6. Folder detail
7. Multi-select action mode
8. File preview (docs/media/PDF)
9. Share & permissions modal flow
10. Upload queue detail
11. Search results + filter chips
12. Offline manager
13. Conflict resolution center
14. Activity feed detail
15. Settings (security, storage, network, notifications, language, accessibility)
16. Recovery surfaces (trash, version history)

### 3.3 Platform-specific notes
- **iOS:** swipe actions, context menus, Files integration, BGTaskScheduler.
- **Android:** Material 3 patterns, WorkManager foreground service for reliable transfers, share intent handling.

---

## 4) Critical User Journeys + Interaction Specs

### 4.1 Upload Journey (camera roll/document picker)
1. User taps FAB → Upload.
2. Source picker appears with remembered last source.
3. Items selected → immediate queue insertion + optimistic card in destination folder.
4. Background transfer starts; user can navigate away.
5. Progress visible in mini transfer bar + queue screen.
6. Completion toast with “View” CTA.
7. Failures cluster under queue with one-tap retry + diagnostics.

**Spec requirements:**
- Chunked upload with resumable tokens.
- Hash verification per chunk.
- Retry policy with exponential backoff (network-aware).

### 4.2 Browse Journey
- Folder loads cached index instantly.
- Skeleton rows for uncached metadata.
- Sort/filter memory per folder.
- Pull-to-refresh updates stale metadata.

**Spec:** preserve scroll position and selection state on back navigation.

### 4.3 Search Journey
- Input focus launches recent queries and smart suggestions.
- As user types: local index results first; remote full-text streams in.
- Filter chips persist until cleared.

**Spec:** zero-results state proposes alternate filters and likely typos.

### 4.4 Share Journey
1. Tap share on file/folder.
2. Pick people or generate link.
3. Set permissions, expiry, optional password.
4. Confirmation screen summarizes effective access.
5. Send + audit event logged.

**Spec:** permission downgrade warnings if collaborators may lose edit rights.

### 4.5 Offline Edits + Sync Journey
- User marks file/folder offline.
- File cached + pinned.
- User edits while offline.
- On reconnect: delta sync attempts.
- If conflict, conflict center presents “keep mine/keep theirs/duplicate merge”.

**Spec:** never overwrite without user-visible resolution path.

### 4.6 Recovery Journey (trash/version restore)
- File deletion routes to Trash with retention countdown.
- Version history available per file.
- Restore from history as new version or replacement.

### 4.7 Biometric Unlock Journey
- App foreground after idle threshold triggers biometric gate.
- Fallback PIN/passcode with lockout policy.
- Sensitive actions (export secret links/security settings) re-prompt biometric.

---

## 5) Performance + Reliability Architecture for Premium UX

### 5.1 Client architecture layers
1. **Presentation layer:** native UI + state containers.
2. **Domain layer:** use-cases for files, sharing, sync.
3. **Data layer:**
   - Local DB (metadata index)
   - File cache store
   - Transfer engine
   - API client + websocket/event stream

### 5.2 Cache strategy
- **L1 memory cache:** recent metadata + thumbnails.
- **L2 disk cache:** previews/thumbnails with TTL + LRU.
- **Offline pinned store:** non-evictable until user unpins.

### 5.3 Background transfer architecture
- Queue with durable persistence (SQLite on device).
- Job states: `queued | hashing | uploading | paused | retry_wait | completed | failed`.
- OS-native schedulers (WorkManager/BGTaskScheduler) + foreground fallback for large transfers.

### 5.4 Conflict resolution model
- Detect via etag/version vector mismatch.
- Auto-merge for metadata-safe operations.
- User-guided merge for content conflict.
- Keep shadow copy to avoid destructive loss.

### 5.5 Progressive loading
- Load metadata first, then thumbnails, then full preview bytes.
- Stream previews for large documents/media.
- Pre-fetch adjacent files for swipe navigation.

### 5.6 Network resilience
- Connectivity monitor drives adaptive behavior (wifi/cellular/roaming constraints).
- Dynamic chunk size tuning based on RTT/throughput.
- Circuit-breaker for backend instability with explicit UX messaging.

---

## 6) Design System + Component Strategy

### 6.1 Tokenized design system
- Core tokens: spacing, typography scale, color roles, elevation, motion duration.
- Semantic states: success/warning/error/syncing/offline/conflict.
- Dark mode and high-contrast themes first-class.

### 6.2 Core reusable components
- File row/card (icon, title, metadata, status badge, quick actions)
- Transfer progress row
- Permission selector chip group
- Conflict resolution sheet
- Empty/error/skeleton states
- Filter chip rail
- Action snackbar with undo

### 6.3 Interaction consistency contracts
- Long-press enters selection mode everywhere.
- Swipe actions are configurable but predictable.
- One global icon/label mapping for sync status.

### 6.4 Motion strategy
- Minimal purposeful transitions (<250ms).
- Never block interaction for decorative animation.

### 6.5 Web-to-Mobile Token/Component Parity Checklist (mandatory before GA)

**Design token parity (web Nest → mobile):**
- [ ] Color roles mapped 1:1 (background/surface/text/border/interactive/status)
- [ ] Typography scale parity for display/title/body/caption + weight mapping
- [ ] Spacing scale parity (base unit + step ladder)
- [ ] Radius, border, elevation/shadow semantics aligned
- [ ] Motion token parity (duration/easing families), adapted only for platform constraints
- [ ] State color parity for success/warning/error/syncing/offline/conflict
- [ ] Dark mode and high-contrast mappings match web semantic intent

**Core component parity (visual + behavior):**
- [ ] App bar/header structure and hierarchy consistent with web Nest
- [ ] Tab navigation labels and information scent aligned with web IA
- [ ] File row/card visual anatomy (icon/title/meta/status/actions) consistent
- [ ] Buttons (primary/secondary/tertiary/destructive) match tokenized variants
- [ ] Input fields, search bar, filter chips, and dropdown states match interaction model
- [ ] Modals/sheets/dialog confirmation patterns mirror web decision flows
- [ ] Snackbar/toast undo behavior and copy tone aligned
- [ ] Empty/loading/error states use same messaging style and visual semantics
- [ ] Permission selector and sharing summary screens maintain web terminology and order
- [ ] Sync/transfer badges use identical icon-label-state mapping as web

**Verification protocol:**
- [ ] Side-by-side screen audit performed for top 20 critical screens against current web Nest
- [ ] Token diff report generated (no unapproved divergences)
- [ ] Component parity exceptions logged with owner, rationale, and remediation date


---

## 7) Accessibility + Internationalization Requirements

### Accessibility (must-have)
- WCAG 2.2 AA baseline.
- Screen-reader labels for all actionable controls.
- Dynamic text scaling up to 200% without clipping.
- Touch targets >=44x44 pt (iOS) / 48x48 dp (Android).
- Non-color status cues (icon + label + color).
- Reduced motion mode respected.

### Internationalization
- String externalization with ICU message format.
- RTL layout support from day one.
- Locale-aware date/size/time formatting.
- Permission labels translated with legal/security clarity validation.
- CJK and long-string layout stress tests in CI snapshots.

---

## 8) Telemetry Events + UX Quality KPIs

### 8.1 Key telemetry events (minimum)
- `app_launch_started`, `app_launch_interactive`
- `folder_opened`, `folder_render_complete`
- `search_query_submitted`, `search_results_first_render`, `search_result_opened`
- `upload_enqueued`, `upload_started`, `upload_completed`, `upload_failed`, `upload_resumed`
- `share_flow_opened`, `share_link_created`, `share_invite_sent`, `share_permission_changed`
- `offline_pin_enabled`, `offline_open_success`, `offline_sync_started`, `offline_sync_conflict`
- `conflict_resolution_actioned`
- `preview_opened`, `preview_interactive`
- `biometric_prompted`, `biometric_success`, `biometric_fallback_used`

### 8.2 KPIs for parity target
- **Cold launch to interactive p95:** <=2.0s
- **Folder open (cached) p95:** <=300ms
- **Folder open (network) p95:** <=1.2s
- **Search first result p95:** <=500ms
- **Upload success rate (24h):** >=99.5%
- **Upload resume success after interruption:** >=98%
- **Preview open success:** >=99.9%
- **Sync conflict unresolved >24h:** <1%
- **Crash-free sessions:** >=99.8%
- **User-reported “can’t find file/share” incidents:** down trend week-over-week

### 8.3 Observability requirements
- Client traces with correlation IDs to backend request chain.
- Per-feature error budgets and alert thresholds.
- Session replay (privacy-safe) for failed critical journeys.

---

## 9) Phased Rollout Plan + Hard Quality Gates

### Phase 0: Foundations (internal)
- Build transfer engine, local index, sync state machine, telemetry scaffolding.

**Gate 0 (must pass):**
- Upload resume works across app restarts in 100/100 test runs.
- No P0 data-loss bugs.
- Baseline visual audit completed: mobile token mappings established against current web Nest design tokens.

### Phase 1: Private alpha
- Core files browse/search/upload/share flows.
- Basic offline pin + preview.

**Gate 1:**
- Crash-free >=99.5%
- Search p95 <=700ms
- Share success >=99%
- Visual continuity pass on core navigation + Files/Home/Shared/Activity shells vs web Nest.

### Phase 2: Beta
- Conflict center, version history restore, activity feed, biometric lock, advanced permissions.

**Gate 2:**
- Conflict resolution success >=95%
- Upload success >=99.3%
- Accessibility audit passes all critical issues
- Component parity audit passes for upload/search/share/offline/conflict flows vs web Nest patterns.

### Phase 3: Release candidate
- Performance polish, i18n expansion, notification tuning, support readiness.

**Gate 3:**
- All KPI targets in Section 8 met for 2 consecutive weeks.
- Support ticket rate for core flows below defined threshold.
- Full top-20 screen side-by-side visual consistency audit signed off (no P0/P1 parity gaps).

### Phase 4: GA
- Staged rollout by cohorts/regions with rollback toggles.

**Gate 4:**
- No regression in crash-free or transfer reliability during 10%→50%→100% ramp.
- Post-ramp parity drift check confirms mobile remains aligned with current web Nest tokens/components after final release patches.

---

## 10) UX-Inferiority Risks + Prevention Strategies

1. **Slow first paint / empty screens**
   - Prevent via cached shell + skeletons + prefetch.
2. **Uploads fail silently**
   - Enforce mandatory visible queue + failure explanations.
3. **Confusing sync/conflict states**
   - Unified state taxonomy + user-facing conflict center.
4. **Overcomplicated sharing permissions**
   - Progressive disclosure + explicit summary screen.
5. **Navigation context loss**
   - Persist folder stacks per tab and restore positions.
6. **Offline mode unpredictability**
   - Explicit badges, timestamps, and pin management.
7. **Accessibility retrofitted too late**
   - Accessibility acceptance criteria embedded in every story.
8. **Telemetry gaps hide UX regressions**
   - Instrument first, then optimize; no dark launches without metrics.
9. **Backend latency volatility exposed directly to users**
   - Client-side resilience, circuit breakers, stale-while-revalidate.

---

## 11) Final Recommendation: Build Order to Maximize Perceived Quality Fast

If we want users to say “this feels premium” in week one, build in this order:

1. **Reliable transfer engine + visible queue** (uploads that never mysteriously fail)
2. **Fast browse with local metadata cache + skeleton/progressive rendering**
3. **Hybrid search (local-first + remote refinement)**
4. **Preview-first experience with quick actions**
5. **Share flow with crystal-clear permissions summary**
6. **Offline pin + deterministic sync badges + conflict center**
7. **Biometric lock + security/trust surfaces**

### Why this order
Users forgive missing edge features; they do **not** forgive lost files, failed uploads, or confusing sync. Perceived quality is reliability + speed + legibility. Nail those first, and the app feels like Drive/Dropbox class before feature parity is complete.

---

## Implementation Hand-off Checklist (for execution teams)

- [ ] Define client state machines (transfer, sync, conflict, auth lock)
- [ ] Finalize API contracts for resumable upload, delta sync, permissions, activity
- [ ] Ship design tokens + component library v1 (web-mobile parity locked)
- [ ] Implement telemetry schema before beta
- [ ] Build automated journey tests for upload/search/share/offline/conflict
- [ ] Establish performance budgets in CI/CD
- [ ] Run accessibility and i18n gates pre-GA

This is the only architecture that makes sense if the goal is premium UX without pretending backend reality doesn’t exist.
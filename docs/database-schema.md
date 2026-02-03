# 🗄 Database & Schema

Nest uses **PostgreSQL** with **Drizzle ORM** for its persistence layer. The schema is designed to balance relational data requirements (for performance) with zero-knowledge privacy (for security).

---

## 🏛 Core Tables

### 1. `users`
Tracks identity and billing status.
-   **Fields**: `email`, `password_hash` (local AuthHash), `subscription_tier`, `storage_used_bytes`.
-   **Privacy**: Does not store the actual password or any encryption keys.

### 2. `user_crypto`
The core of the zero-knowledge vault.
-   **userId**: Primary key linked to `users`.
-   **salt**: The unique Argon2id salt.
-   **encrypted_master_key**: The Master Key wrapped with the user's RootKey.
-   **metadata_blob**: The main encrypted JSON index of the user's filesystem.
-   **metadata_version**: Used for optimistic locking to prevent "stale" metadata saves during multi-device use.

### 3. `folders` & `files`
Represent the structural skeleton of the user's vault.
-   **folders**: Stores `parentId` and the folder's unique encrypted key.
-   **files**: Stores the Jackal `merkle_hash` (the pointer to decentralized storage) and the unique encrypted file key.
-   **Note**: These tables do **not** store filenames. The `id` is a random serial/UUID, and the name is only reachable via the `metadata_blob`.

### 4. `file_chunks`
Supports large-file sharding.
-   Each record links a `fileId` to a specific `chunk_index` and its corresponding Jackal pointer.

---

## ⚰️ The Graveyard (Archival System)

To support secure deletion and system audits, Nest uses a separate "Graveyard" schema.
-   When a file is permanently deleted, its metadata and pointers are moved from `files` to `graveyard`.
-   This keeps the main `files` table lean while ensuring that file history is preserved for quota reconciliation and pruning logs.

---

## 📊 Analytics
-   **analytics_events**: Anonymized tracking of system-wide activity (e.g., total bytes uploaded, pruning events).
-   **Privacy**: Events are keyed by `userId` but do not link to specific file contents or names.

---

© 2026 LazyBird Inc. Proprietary & Confidential.

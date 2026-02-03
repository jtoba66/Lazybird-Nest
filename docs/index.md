# 🦅 Nest Deep Wiki

Welcome to the comprehensive technical documentation for **Nest**, a zero-knowledge encrypted cloud storage system.

---

## 🏗 Core Modules

### 1. [Architecture & Security](architecture.md)
Deep dive into our cryptographic model, including:
- Client-side encryption workflows.
- Key Derivation Function (Argon2id).
- Hierarchical file & folder key management.
- Zero-knowledge trust boundaries.

### 2. [API Reference](api-reference.md)
Detailed documentation of all backend endpoints:
- **Auth**: User registration, login, and session management.
- **Files**: Upload (chunking), download, and metadata management.
- **Folders**: Organizational logic and sub-folder hierarchies.
- **Graveyard**: Soft-delete and recovery systems.
- **Shared**: Secure external sharing via decrypted hash fragments.

### 3. [Frontend & Encryption Logic](frontend-logic.md)
How we move data securely in the browser:
- `libsodium` & `hash-wasm` integration.
- Resumable chunked upload engine.
- AuthContext & Global State.
- UI Component Architecture.

### 4. [Database & Schema](database-schema.md)
Our persistence layer:
- PostgreSQL schema (Drizzle ORM).
- Encrypted vs. Plaintext metadata.
- Indexing and performance optimizations.

---

© 2026 LazyBird Inc. Proprietary & Confidential.

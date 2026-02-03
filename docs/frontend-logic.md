# 🖥 Frontend & Encryption Logic

The Nest frontend is the single point of trust in our system. It is responsible for all cryptographic operations, ensuring that cleartext data never leaves your device.

---

## 🛠 Cryptographic Foundations

Nest utilizes the **WebAssembly (WASM)** builds of industry-standard libraries to ensure performance and security:
-   **libsodium-wrappers**: Handles authenticated encryption (AEAD) and secret streams.
-   **hash-wasm**: Provides high-performance Argon2id implementation for key derivation.

---

## 🏗 Key Derivation Flow

When a user interacts with their vault, the following happens in order:

1.  **Identity Derivation**:
    -   User enters password.
    -   `argon26id` derives a `RootKey` using the user's unique server-provided salt.
2.  **Vault Unlocking**:
    -   `RootKey` derives a `WrappingKey`.
    -   `WrappingKey` decrypts the `MasterKey` (fetched from the server).
3.  **Filesystem Mapping**:
    -   `MasterKey` decrypts the `MetadataBlob`.
    -   The `MetadataBlob` maps database UUIDs to human-readable filenames and folder structures.

---

## 📦 High-Performance Chunking

To handle files up to 10GB without crashing the browser, Nest employs a dual-layer chunking strategy:

### Layer 1: Sharding (Independently Encrypted Segments)
Files are physically split into large segments (4MB-10MB).
-   Each segment has its own random **Nonce/Header**.
-   This allows for **resumable uploads** and **parallelized downloading**.
-   If one chunk upload fails, the client only needs to retry that specific segment.

### Layer 2: Memory Buffering (Sub-chunks)
Inside each segment, data is processed in **64MB blocks** using Sodium's `secretstream`.
-   This ensures the browser doesn't need to hold the entire file in RAM.
-   Data is streamed directly from the file disk to the encryption engine and then to the network.

---

## 🎨 Global State & Encryption Wrapper

All cryptographic operations are encapsulated in the `v2.ts` crypto wrapper. The **AuthContext** manages the lifecycle of the `MasterKey`:
-   **Persistence**: For convenience, the `MasterKey` can be temporarily stored in `localStorage` (it is cleared after 90 days or on logout).
-   **Memory Safety**: Upon logout, the `MasterKey` Uint8Array is explicitly `filled(0)` to wipe it from the heap.

---

© 2026 LazyBird Inc. Proprietary & Confidential.

# 🔐 Architecture & Security

Nest is built on a **Zero-Knowledge (ZK)** security model. This means that the server is "blind" to your data—it facilitates storage and authentication without ever having the technical capability to decrypt your files.

---

## 🏗 The Zero-Knowledge Model

In traditional cloud storage, the server manages your keys. In Nest, **you are the only one who holds the keys.**

### Key Principles:
1.  **Client-Side Primacy**: Encryption and decryption happen strictly in your browser.
2.  **Untrusted Backend**: The server is treated as a compromised entity. It stores data but cannot verify its content.
3.  **No Cleartext Metadata**: We don't just encrypt the file; we encrypt the filename, the folder structure, and the file size (within chunks).

---

## 🔑 Key Hierarchy & Derivation

Nest uses a hierarchical key structure to enable secure sharing and efficient vault management.

### 1. Root Derivation (Argon2id)
When you log in, your password is processed locally using the **Argon2id** memory-hard hashing function.
-   **Inputs**: Password + Unique User Salt.
-   **Outputs**: 
    -   `AuthHash`: Sent to the server to verify your identity.
    -   `RootKey`: Stays in your browser. Used to unlock the rest of your vault.

### 2. The Master Key (XChaCha20)
The `MasterKey` is a high-entropy 256-bit key that serves as the "source of truth" for your entire filesystem.
-   It is stored on the server, but it is **wrapped (encrypted)** using your `RootKey`.
-   Even if the server's database is leaked, the `MasterKey` remains a useless blob of noise without your password.

### 3. Folder & File Keys
To enable granular sharing without revealing your entire vault:
-   Each **Folder** has its own unique `FolderKey`.
-   Each **File** has its own unique `FileKey`.
-   These keys are encrypted using the `MasterKey` or their parent `FolderKey`.

---

## 🛡 Cryptographic Suite

We use industry-standard, audited algorithms for all operations:

| Layer | Algorithm | Rationale |
| :--- | :--- | :--- |
| **Password Hashing** | Argon2id | Memory-hard, resistant to GPU/ASIC cracking attacks. |
| **Key Wrapping** | XChaCha20-Poly1305 | 192-bit nonce misuse resistance; superior performance. |
| **File Encryption** | AES-256-GCM | Authenticated encryption with hardware acceleration (AES-NI). |
| **Integrity** | SHA-256 / Blake3 | Ensuring file chunks haven't been tampered with in transit. |

---

## 🔄 The "Blind" Upload Flow

1.  **Chunking**: Your file is split into 4MB-10MB chunks locally.
2.  **Encryption**: Each chunk is encrypted with your unique `FileKey` and a random nonce.
3.  **Transmission**: The encrypted chunks are sent to the Nest server.
4.  **Storage**: The server proxies these blobs to the decentralized **Jackal Network**.

**Server Visibility during this process: [ ZERO ]**

---

© 2026 LazyBird Inc. Proprietary & Confidential.

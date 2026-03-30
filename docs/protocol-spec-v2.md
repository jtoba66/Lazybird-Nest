# Nest Protocol Specification (v2)

This document is the normative protocol contract for Nest clients. It is written from the current production implementation and is intended to let a native client interoperate with the web client without reverse-engineering the React code.

If this document and the implementation ever disagree, the implementation is the source of truth until this document is updated.

## 1. Scope

This spec covers:

- Password-to-key derivation
- Master key wrapping
- Metadata blob format
- Folder key and file key wrapping
- Monolithic file encryption format
- Chunked file encryption format
- Share-link format
- Relevant API payload shapes required for interoperability

This spec does not define UI, billing, or product behavior outside the crypto/storage boundary.

## 2. Normative Sources

The current reference implementation is derived from:

- `src/crypto/v2.ts`
- `src/contexts/AuthContext.tsx`
- `src/contexts/UploadContext.tsx`
- `src/pages/NestPage.tsx`
- `src/pages/SharePage.tsx`
- `server/src/routes/auth.ts`
- `server/src/routes/files.ts`
- `server/src/routes/folders.ts`

## 3. Encodings And Primitive Rules

### 3.1 Binary encodings

Nest uses standard RFC 4648 base64 with padding:

- Alphabet uses `A-Z a-z 0-9 + /`
- Padding uses `=`
- This matches web `sodium.base64_variants.ORIGINAL`
- This matches server `Buffer.toString("base64")`

Hex strings are used only in documentation and test vectors, not in production API payloads.

### 3.2 Text encoding

All text inputs are UTF-8.

### 3.3 Cryptographic primitives

Clients MUST use libsodium-compatible implementations of:

- Argon2id
- BLAKE2b / `crypto_generichash`
- XChaCha20-Poly1305 IETF AEAD
- XChaCha20-Poly1305 SecretStream
- Cryptographically secure random bytes

## 4. Identity And Key Derivation

### 4.1 Salt

- Salt size: 32 bytes
- Salt is randomly generated at signup
- Salt is stored server-side in `user_crypto.salt`
- Salt is returned by `POST /auth/salt`

### 4.2 Root key derivation

The root key is derived locally from the user password and salt.

Parameters used by the current implementation:

- Algorithm: `argon2id`
- Hash length: 32 bytes
- Memory cost: `65536`
- Time cost: `3`
- Parallelism: `4`

Inputs:

- Password: UTF-8 bytes
- Salt: 32 bytes

Output:

- `RootKey`: 32 bytes

### 4.3 Auth hash derivation

The login credential sent to the server is not the password and not the root key.

The client computes:

- `AuthHash = BLAKE2b-256( UTF8("auth_") || RootKey )`

Encoding:

- Sent to server as lowercase hex

Server behavior:

- Server bcrypt-hashes the hex string and stores it in `users.password_hash`
- Login compares the provided `authHash` against the stored bcrypt hash

### 4.4 Wrapping key derivation

The wrapping key is derived locally:

- `WrappingKey = BLAKE2b-256( UTF8("wrap_") || RootKey )`

Encoding:

- Raw 32-byte key

Use:

- Decrypts the encrypted master key returned by the server

## 5. Vault Key Hierarchy

### 5.1 Master key

- Size: 32 bytes
- Randomly generated on signup
- Stored encrypted on the server
- Wrapped with `WrappingKey` using XChaCha20-Poly1305 IETF AEAD

### 5.2 Folder keys

- Size: 32 bytes
- Randomly generated
- Wrapped with the `MasterKey`

### 5.3 File keys

- Size: 32 bytes
- Randomly generated per file
- Wrapped with the parent folder key

### 5.4 Root folder

Nest always maintains a root folder record server-side:

- Database folder row has `parent_id = null`
- Root folder key is generated on signup
- Root folder key is wrapped with the `MasterKey`
- The root folder name is not trusted from the database; user-facing names live in encrypted metadata

## 6. AEAD Wrapping Format

The following values are encrypted with `crypto_aead_xchacha20poly1305_ietf_encrypt`:

- Master key under wrapping key
- Folder key under master key
- File key under folder key
- Metadata JSON under master key

Rules:

- Nonce size: 24 bytes
- Additional authenticated data: `null`
- Secret nonce: `null`
- Ciphertext includes the 16-byte MAC appended by libsodium

## 7. Metadata Blob

### 7.1 Storage

The metadata blob is a JSON document encrypted with the master key.

Server fields:

- `user_crypto.metadata_blob`
- `user_crypto.metadata_nonce`
- `user_crypto.metadata_version`

### 7.2 Current shape

Canonical minimum shape:

```json
{
  "v": 2,
  "folders": {},
  "files": {}
}
```

Observed runtime structure:

```json
{
  "v": 2,
  "folders": {
    "<folderId>": {
      "name": "Projects",
      "created_at": "2026-03-29T00:00:00.000Z"
    }
  },
  "files": {
    "<fileId>": {
      "filename": "hello.txt",
      "mime_type": "text/plain",
      "file_size": 31,
      "created_at": "2026-03-29T00:00:00.000Z",
      "folder_id": "12"
    }
  }
}
```

### 7.3 Compatibility requirements

Clients MUST:

- Preserve `v`
- Preserve unknown top-level keys
- Preserve unknown nested fields when rewriting metadata
- Treat object keys under `folders` and `files` as stringified numeric IDs

Clients SHOULD tolerate legacy or inconsistent historic values such as:

- `folder_id: ""`
- `folder_id: null`

Current canonical write behavior from the upload flow is:

- `folder_id` is a stringified folder ID
- `created_at` is ISO-8601
- `file_size` is numeric bytes

### 7.4 Metadata versioning

Server tracks `metadata_version` separately from metadata JSON `v`.

Meanings:

- Metadata JSON `v`: client schema version
- `metadata_version`: monotonic server-side revision counter for the encrypted metadata blob

Current server behavior:

- `GET /auth/metadata` returns `encryptedMetadata`, `encryptedMetadataNonce`, `metadata_version`
- `POST /auth/metadata` stores the new blob and increments `metadata_version`

Important:

- The current server increments `metadata_version`
- The current server does not reject stale metadata writes based on the client-supplied version
- Native clients may still use the counter for sync and conflict detection heuristics, but must not assume strict server-side compare-and-swap semantics

## 8. File Encryption Modes

Nest currently has two interoperable file-storage modes.

### 8.1 Monolithic mode

Current web client uses monolithic upload when:

- Plaintext file size `< 128 MiB`

Encryption format:

1. Initialize SecretStream push state with the file key
2. Emit a 24-byte SecretStream header
3. Split plaintext into internal blocks of `64 MiB`
4. Encrypt each block with SecretStream
5. Use `TAG_MESSAGE` for intermediate blocks
6. Use `TAG_FINAL` for the last block
7. Store output as:

`header || encrypted_block_0 || encrypted_block_1 || ...`

Properties:

- Header is embedded at the start of the encrypted file
- Each encrypted block is `plaintext_block_size + 17` bytes

### 8.2 Chunked mode

Current web client uses chunked upload when:

- Plaintext file size `>= 128 MiB`

Current upload segmentation:

- Plaintext upload segment size: `128 MiB`
- Each segment is encrypted independently
- Internal SecretStream block size inside a segment: `64 MiB`

For each segment:

1. Slice plaintext segment
2. Initialize a new SecretStream push state with the same file key
3. Generate a new 24-byte header for that segment
4. Encrypt the segment in 64 MiB internal blocks
5. Use `TAG_MESSAGE` for intermediate blocks
6. Use `TAG_FINAL` for the last internal block

Stored representation:

- Ciphertext bytes are stored as the chunk body
- The 24-byte header is stored separately in the database as the chunk `nonce`

Important:

- `file_chunks.size` is ciphertext size only
- `file_chunks.nonce` is the SecretStream header for that segment
- The header is not prefixed into the stored chunk body

## 9. File Download And Decryption Contract

### 9.1 Owner download metadata

`GET /api/files/download/:fileId` returns:

```json
{
  "success": true,
  "file_key_encrypted": "<base64>",
  "file_key_nonce": "<base64>",
  "folder_key_encrypted": "<base64>",
  "folder_key_nonce": "<base64>",
  "folder_id": 12,
  "jackal_fid": "...",
  "merkle_hash": "...",
  "is_gateway_verified": true,
  "chunks": [
    {
      "index": 0,
      "size": 134217745,
      "nonce": "<base64 SecretStream header>",
      "jackal_merkle": "..."
    }
  ]
}
```

Interpretation:

- If `chunks` is missing or empty, treat the file as monolithic
- If `chunks` exists, each entry describes one independent encrypted segment

### 9.2 Owner raw content download

`GET /api/files/raw/:fileId`:

- Monolithic file: streams the encrypted file with the header embedded at byte 0
- Chunked file: streams concatenated chunk ciphertext bodies in chunk index order, without the per-chunk headers embedded

For chunked owner downloads, the client MUST use `chunks[].nonce` from `/files/download/:id` to reinitialize SecretStream per segment.

### 9.3 Public share metadata

`GET /api/files/share/:shareToken` returns:

```json
{
  "success": true,
  "file_id": 10,
  "file_size": 12345,
  "jackal_fid": "...",
  "merkle_hash": "...",
  "created_at": "...",
  "is_gateway_verified": true,
  "is_chunked": true,
  "chunks": [
    {
      "index": 0,
      "size": 134217745,
      "nonce": "<base64 SecretStream header>",
      "jackal_merkle": "...",
      "status": "local"
    }
  ]
}
```

### 9.4 Public share content download

Routes:

- `GET /api/files/share/raw/:shareToken`
- `GET /api/files/share/:shareToken/chunk/:index`

Behavior:

- Shared monolithic file route streams ciphertext with embedded header
- Shared chunk route streams ciphertext only; header comes from `chunks[].nonce`

## 10. Share-Link Format

Current canonical share URL format:

`https://<origin>/s/<shareToken>#key=<urlencoded base64 file key>&name=<urlencoded filename>&mime=<urlencoded mime type>`

Example:

`https://nest.lazybird.io/s/sharetoken123#key=IiIi...%3D&name=hello.txt&mime=text%2Fplain`

Rules:

- The decryption key is the file key, not the folder key
- The key is base64, then URL-encoded
- `name` and `mime` are convenience fields only
- The fragment is never sent to the server

Parsing behavior used by the current web client:

- Read `window.location.hash.substring(1)`
- Parse with `URLSearchParams`
- Read `key`, `name`, and `mime`
- Replace spaces in `key` with `+` before base64 decode

There is no share-link nonce in the fragment in the current implementation.

## 11. Signup And Login Contract

### 11.1 Signup

Client sends:

- `authHash`
- `salt`
- `encryptedMasterKey`
- `encryptedMasterKeyNonce`
- `encryptedMetadata`
- `encryptedMetadataNonce`
- `rootFolderKeyEncrypted`
- `rootFolderKeyNonce`
- `kdfParams`

Current signup metadata initialization:

```json
{
  "v": 2,
  "folders": {},
  "files": {}
}
```

### 11.2 Login

Client flow:

1. `POST /auth/salt` with email
2. Derive `RootKey`
3. Derive `AuthHash`
4. `POST /auth/login` with email + `authHash`
5. Receive encrypted master key and metadata
6. Derive `WrappingKey`
7. Decrypt `MasterKey`
8. Decrypt metadata blob

## 12. Compatibility Requirements For Native Clients

Native clients MUST:

- Use the exact KDF parameters above unless the server returns a different `kdfParams`
- Use standard padded base64 for all API binary payloads
- Treat SecretStream headers as 24-byte binary values
- Reinitialize SecretStream for every chunked segment using that segment header
- Preserve unknown metadata fields when saving metadata
- Accept both monolithic and chunked file layouts
- Accept chunk metadata from both owner and share APIs

Native clients MUST NOT:

- Invent a different share-link format
- Prefix chunk headers into stored chunk payloads
- Assume chunk size equals internal SecretStream block size
- Assume metadata field ordering is meaningful after decryption

## 13. Test Vectors

Implementation-derived reference vectors live in:

- `docs/test-vectors.json`

Those vectors are the practical verification source for Android unit tests and integration tests.

## 14. Change Control

Any protocol-affecting change requires all of the following:

1. Update this document
2. Update `docs/test-vectors.json`
3. Re-run compatibility verification against web behavior
4. Bump protocol version only if wire or crypto compatibility changes

Current protocol version: `2.0.0`

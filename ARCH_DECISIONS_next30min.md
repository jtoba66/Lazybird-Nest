# Lazybird-Nest Mobile — Next 30min Unblock Decisions

Date: 2026-03-04
Scope: immediate unblock for coder on crypto parity shape, transfer state machine contract, folder nav contract.

## 0) Quick state read (current implementation)
- Mobile crypto bridge (`Lazybird-Nest-Mobile/src/services/crypto/compat.ts`) is a **placeholder** and currently defines **AES-256-GCM + PBKDF2 payload**, which does **not** match web v2 crypto.
- Mobile transfer pipeline exists (`uploadPipeline.ts` + `transferStateStore.ts`) but state is too thin (no status/error/retry/session lifecycle), so UI + resume semantics are under-specified.
- Mobile file browse is flat (`FileListScreen.tsx`) and API contract is custom (`/files/tree`, string IDs), while web relies on `files.list(folderId)` + `folders.list(parentId)` with numeric IDs and transparent-root behavior.

---

## 1) Decision: Crypto parity integration shape (must be web-v2 exact)

### Decision
Adopt a **shared crypto contract identical to web `src/crypto/v2.ts` semantics**. Do **not** ship/extend the current AES wrapper contract.

### Required contract (mobile-facing)
```ts
// IDs and envelope values must remain backend-compatible (base64 strings)
type B64 = string;

type KdfParams = {
  algorithm: 'argon2id' | 'pbkdf2';
  memoryCost?: number;
  timeCost?: number;
  parallelism?: number;
  iterations?: number;
};

type KeyEnvelope = { encrypted: B64; nonce: B64 }; // XChaCha20-Poly1305 envelope

interface CryptoParityPort {
  deriveRootKey(password: string, saltB64: B64, params: KdfParams): Promise<Uint8Array>;
  deriveAuthHash(rootKey: Uint8Array): string;
  deriveWrappingKey(rootKey: Uint8Array): Uint8Array;

  encryptMasterKey(masterKey: Uint8Array, wrappingKey: Uint8Array): KeyEnvelope;
  decryptMasterKey(env: KeyEnvelope, wrappingKey: Uint8Array): Uint8Array;

  encryptFolderKey(folderKey: Uint8Array, masterKey: Uint8Array): KeyEnvelope;
  decryptFolderKey(env: KeyEnvelope, masterKey: Uint8Array): Uint8Array;

  encryptFileKey(fileKey: Uint8Array, folderKey: Uint8Array): KeyEnvelope;
  decryptFileKey(env: KeyEnvelope, folderKey: Uint8Array): Uint8Array;
}
```

### Immediate coder action
1. Replace `WrappedFileKeyPayload` path in mobile with `KeyEnvelope` (`encrypted`,`nonce`) base64 pair.
2. Align `UploadInitRequest.wrappedKeyPayload` -> explicit `fileKeyEncrypted` + `fileKeyNonce` fields.
3. Block download decrypt path until `decryptFolderKey/decryptFileKey` parity methods are wired.

---

## 2) Decision: Transfer state machine minimal contract (v1)

### Decision
Standardize on one persisted state model for upload/download queues. Minimal states to unblock implementation:

`queued | preparing | transferring | paused | retry_wait | finalizing | completed | failed | canceled`

### Minimal persisted entity
```ts
type TransferDirection = 'upload' | 'download';

type TransferState =
  | 'queued' | 'preparing' | 'transferring' | 'paused'
  | 'retry_wait' | 'finalizing' | 'completed' | 'failed' | 'canceled';

interface TransferJob {
  id: string;                 // local UUID
  direction: TransferDirection;
  localUri?: string;
  remoteFileId?: number;
  uploadId?: string;          // backend session id
  fileName: string;
  mimeType: string;
  fileSize: number;
  folderId: number | null;

  chunkSize: number;
  totalChunks: number;
  transferredChunks: number[]; // source of truth for resume

  state: TransferState;
  progressPct: number;        // derived + cached for UI
  retryCount: number;
  nextRetryAt?: string;
  lastErrorCode?: string;
  lastErrorMessage?: string;

  createdAt: string;
  updatedAt: string;
}
```

### Immediate coder action
1. Replace `UploadResumeState` with `TransferJob` (or wrap it) and persist by `job.id`.
2. Force legal transitions only:
   - `queued->preparing->transferring->finalizing->completed`
   - `transferring->retry_wait->transferring`
   - `transferring|retry_wait->failed|paused|canceled`
3. Emit UI off `state + progressPct`; never infer from missing keys.

---

## 3) Decision: Folder navigation data contract (web-backend aligned)

### Decision
Use **numeric IDs + parent linkage + breadcrumb stack**; mirror web APIs/semantics instead of custom `/files/tree` aggregate.

### Minimal contract
```ts
interface FolderNode {
  id: number;
  parent_id: number | null;
  name: string;               // from decrypted metadata fallback chain
  created_at: string;
}

interface FileNode {
  id: number;
  folder_id: number | null;
  filename: string;
  mime_type: string;
  file_size: number;
  created_at: string;
}

interface FolderNavState {
  currentFolderId: number | null;
  path: Array<{ id: number; name: string }>; // breadcrumb
  childrenFolders: FolderNode[];
  files: FileNode[];
}
```

### Behavior contract
- `null` means top-level view.
- If exactly one root exists (`parent_id=null`), client may transparently proxy into it (same as web), but breadcrumb still starts at Home.
- Folder open = fetch `folders.list(currentFolderId)` + `files.list(currentFolderId)` in parallel.
- Name resolution order: decrypted metadata name -> server name -> `Folder {id}` / `File {id}`.

### Immediate coder action
1. Change mobile API types from `string` IDs to `number` IDs for folder/file routes.
2. Add `currentFolderId` + `path` state to `FileListScreen` and wire row tap to folder drill-down.
3. Swap `fetchFileTree` usage for separate list calls matching backend shape.

---

## 4) Next slice (strict order)
1. Lock crypto interface to web-v2 envelope fields (`fileKeyEncrypted/fileKeyNonce`).
2. Upgrade transfer persistence to explicit state machine (`TransferJob`).
3. Implement numeric folder nav state (`currentFolderId + breadcrumb + list calls`).

If these 3 land, coder can keep building without contract churn.
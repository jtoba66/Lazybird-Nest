# 📡 API Reference

The Nest API is a JSON REST interface designed for speed and security. All endpoints (except public sharing and salt retrieval) require a **Bearer JWT Token** in the `Authorization` header.

---

## 🔐 Authentication & Identity

### `POST /auth/salt`
Retrieves pre-derivation parameters for a specific email.
-   **Security**: Used to prevent server-side password storage.
-   **Response**: 
    ```json
    {
      "salt": "base64_salt",
      "kdfParams": "{\"algorithm\":\"argon2id\",...}",
      "encryptedMasterKey": "wrapped_blob",
      "encryptedMasterKeyNonce": "nonce"
    }
    ```

### `POST /auth/signup`
Creates a new zero-knowledge account.
-   **Body**: Requires `authHash`, `salt`, `encryptedMasterKey`, and `encryptedMetadata` initializations.

### `POST /auth/login`
Authenticates a user session.
-   **Body**: `{ "email": "...", "authHash": "..." }`
-   **Response**: Returns the JWT token and the user's encrypted vault keys.

---

## 📁 Files & Storage

### `POST /files/upload`
Uploads an encrypted file blob to the server.
-   **Requirements**: Multipart form data.
-   **ZK Fields**: `fileKeyEncrypted` (the file key wrapped with the parent folder key).

### `GET /files/list`
Lists file metadata for the authenticated user.
-   **Note**: Filenames returned are placeholders. The client must decrypt actual names using the locally stored `MetadataBlob`.

### `GET /files/download/:fileId`
Retrieves the information needed to fetch and decrypt a file.
-   **Response**: Returns the Jackal link and the encrypted file keys.

---

## 📂 Folders & Structure

### `POST /folders/create`
Creates an organizational boundary in the database.
-   **Requirements**: `folderKeyEncrypted` (wrapped with the Master Key or Parent Folder Key).

### `GET /folders/list`
Retrieves the folder hierarchy for the user.

---

## 🔗 Public Sharing

### `GET /files/share/:shareToken`
Public endpoint for retrieving shared file info.
-   **No Auth Required**: This endpoint is open but throttled.
-   **Security**: Only returns the encrypted blob. The decryption key is passed via the **URL hash fragment** (e.g., `#key=...`), which is never sent to the Nest server.

---

© 2026 LazyBird Inc. Proprietary & Confidential.

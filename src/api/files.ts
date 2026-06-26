import api from '../lib/api';

export interface File {
    id: number;
    filename: string;
    file_size: number;
    mime_type: string;
    share_token: string;
    is_chunked: number;
    chunk_count: number;
    created_at: string;
    last_accessed_at: string | null;
    upload_session_id: string | null;
    deleted_at?: string;
}

export interface UploadResponse {
    success: boolean;
    file_id: number;
    shareToken: string;
    merkleHash: string;
    shareLink: string;
    fileSize: number;
}

export interface DownloadInfo {
    downloadUrl: string;
    filename: string;
    mimeType: string;
    fileSize: number;
    isChunked: boolean;
    chunkCount: number;
}

export interface FilesResponse {
    files: File[];
    metadataVersion?: number;
}

export const filesAPI = {
    async upload(
        fileId: number,
        encryptedFile: Blob,
        onProgress?: (progress: number) => void
    ): Promise<{ success: boolean }> {
        const formData = new FormData();
        formData.append('file', encryptedFile, 'encrypted');

        const { data } = await api.post(`/files/${fileId}/upload`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: (progressEvent) => {
                if (progressEvent.total && onProgress) {
                    const progress = (progressEvent.loaded / progressEvent.total) * 100;
                    onProgress(progress);
                }
            }
        });

        return data;
    },

    // v3 Chunked Upload
    async initUpload(metadata: {
        filename: string;
        file_size: number;
        mimeType: string;
        folderId?: number | null;
        fileKeyEncrypted: string;
        fileKeyNonce: string;
        sessionId?: string; // Unique ID per upload attempt for idempotency
    }): Promise<{ success: boolean; file_id: number; share_token: string; is_chunked: boolean }> {
        const { data } = await api.post('/files/upload/init', metadata);
        return data;
    },

    async uploadChunk(
        fileId: number,
        chunkIndex: number,
        encryptedChunk: Blob,
        nonce: string, // Base64 header
        size: number,
        onProgress?: (progress: number) => void
    ): Promise<{ success: boolean; merkle: string }> {
        const formData = new FormData();
        formData.append('chunk', encryptedChunk);
        formData.append('chunk_index', String(chunkIndex));
        formData.append('nonce', nonce);
        formData.append('size', String(size));

        const { data } = await api.post(`/files/${fileId}/chunk`, formData, {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: (progressEvent) => {
                // Chunk progress (optional to track intra-chunk progress)
                if (progressEvent.total && onProgress) {
                    const progress = (progressEvent.loaded / progressEvent.total) * 100;
                    onProgress(progress);
                }
            }
        });
        return data;
    },

    async getManifest(fileId: number): Promise<{ chunks: { id: string; chunk_index: number; jackal_merkle: string; size: number; nonce: string; is_gateway_verified: number }[] }> {
        const { data } = await api.get(`/files/${fileId}/manifest`);
        return data;
    },

    async finishChunkedUpload(fileId: number): Promise<{ success: boolean }> {
        const { data } = await api.post(`/files/${fileId}/finish`);
        return data;
    },


    // Collab Chunked Upload
    async initCollabUpload(collabToken: string, metadata: {
        file_size: number;
        folder_id?: number | null;
        encrypted_file_key: string;
        file_key_nonce: string;
        sessionId?: string;
    }, sessionToken?: string): Promise<{ success: boolean; file_id: number; is_chunked: boolean }> {
        const headers: Record<string, string> = {};
        if (sessionToken) headers['x-collab-session'] = sessionToken;
        const { data } = await api.post(`/collab/${collabToken}/upload/init`, metadata, { headers });
        return data;
    },

    async uploadCollabChunk(
        collabToken: string,
        fileId: number,
        chunkIndex: number,
        encryptedChunk: Blob,
        nonce: string, // Base64 header
        size: number,
        onProgress?: (progress: number) => void,
        sessionToken?: string
    ): Promise<{ success: boolean; message: string }> {
        const formData = new FormData();
        formData.append('file_id', String(fileId));
        formData.append('chunk', encryptedChunk);
        formData.append('chunk_index', String(chunkIndex));
        formData.append('nonce', nonce);
        formData.append('size', String(size));

        const headers: Record<string, string> = { 'Content-Type': 'multipart/form-data' };
        if (sessionToken) headers['x-collab-session'] = sessionToken;

        const { data } = await api.post(`/collab/${collabToken}/upload/chunk`, formData, {
            headers,
            onUploadProgress: (progressEvent) => {
                if (progressEvent.total && onProgress) {
                    const progress = (progressEvent.loaded / progressEvent.total) * 100;
                    onProgress(progress);
                }
            }
        });
        return data;
    },

    async finishCollabChunkedUpload(collabToken: string, fileId: number, encryptedFilename: string, encryptedMimeType: string, sessionToken?: string): Promise<{ success: boolean }> {
        const headers: Record<string, string> = {};
        if (sessionToken) headers['x-collab-session'] = sessionToken;
        
        const { data } = await api.post(`/collab/${collabToken}/upload/finish`, {
            file_id: fileId,
            encrypted_filename: encryptedFilename,
            encrypted_mime_type: encryptedMimeType
        }, { headers });
        return data;
    },

    async getCollabManifest(_collabToken: string, _fileId: number): Promise<{ chunks: { id: string; chunk_index: number; jackal_merkle: string; size: number; nonce: string; is_gateway_verified: number }[] }> {
        // Technically this could be useful for resumability. For now we will just assume fresh uploads or implement if needed.
        // If we want resumability for guests, we need a GET /api/collab/:token/upload/manifest/:fileId endpoint.
        // Actually, we'll skip manifest for guests for simplicity right now unless we want to build it.
        return { chunks: [] };
    },

    async cancelUpload(fileId: number): Promise<{ success: boolean }> {
        const { data } = await api.delete(`/files/${fileId}/cancel`);
        return data;
    },

    async getDownloadInfo(shareToken: string): Promise<DownloadInfo> {
        const { data } = await api.get(`/files/download/${shareToken}`);
        return data;
    },

    async list(folderId?: number | null): Promise<FilesResponse> {
        const params: any = {};
        if (folderId !== undefined) {
            params.folderId = folderId === null ? 'null' : folderId;
        }
        const response = await api.get('/files/list', { params });

        const metadataVersion = response.headers['x-metadata-version']
            ? parseInt(response.headers['x-metadata-version'])
            : undefined;

        return {
            files: response.data.files,
            metadataVersion
        };
    },

    async getRecent(limit: number = 50, offset: number = 0, sortBy: string = 'date', order: string = 'desc'): Promise<FilesResponse> {
        const response = await api.get('/files/recent', {
            params: { limit, offset, sortBy, order }
        });

        const metadataVersion = response.headers['x-metadata-version']
            ? parseInt(response.headers['x-metadata-version'])
            : undefined;

        return {
            files: response.data.files,
            metadataVersion
        };
    },

    async queryFiles(ids: number[]): Promise<FilesResponse> {
        const response = await api.post('/files/query', { ids });

        const metadataVersion = response.headers['x-metadata-version']
            ? parseInt(response.headers['x-metadata-version'])
            : undefined;

        return {
            files: response.data.files,
            metadataVersion
        };
    },

    async delete(fileId: number): Promise<{ success: boolean; reclaimedBytes: number }> {
        const { data } = await api.delete(`/files/${fileId}`);
        return data;
    },

    async move(
        fileId: number,
        folderId: number | null,
        reencryptedKeys?: { fileKeyEncrypted: string; fileKeyNonce: string }
    ): Promise<{ success: boolean }> {
        const { data } = await api.put(`/files/${fileId}/move`, {
            folderId,
            ...(reencryptedKeys && {
                fileKeyEncrypted: reencryptedKeys.fileKeyEncrypted,
                fileKeyNonce: reencryptedKeys.fileKeyNonce
            })
        });
        return data;
    },

    async createShare(fileId: number): Promise<{ success: boolean; share_url: string; share_token: string }> {
        const { data } = await api.post(`/files/${fileId}/share`);
        return data;
    },

    async revokeShare(fileId: number): Promise<{ success: boolean; message: string }> {
        const { data } = await api.delete(`/files/${fileId}/share`);
        return data;
    },

    async getTrash(): Promise<{ files: File[] }> {
        const { data } = await api.get('/files/trash');
        return data;
    },

    async restore(fileId: number): Promise<{ success: boolean; message: string }> {
        const { data } = await api.post(`/files/restore/${fileId}`);
        return data;
    },

    async deleteForever(fileId: number): Promise<{ success: boolean; message: string }> {
        const { data } = await api.delete(`/files/${fileId}/permanent`);
        return data;
    },
};

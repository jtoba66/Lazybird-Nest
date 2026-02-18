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

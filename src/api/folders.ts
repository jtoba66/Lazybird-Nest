import api from '../lib/api';

export interface Folder {
    id: number;
    name: string;
    parent_id: number | null;
    created_at: string;
    file_count?: number;
    subfolder_count?: number;
    folder_size?: number;
    deleted_at?: string;
}

export const foldersAPI = {
    async create(folderKeyEncrypted: string, folderKeyNonce: string, pathHash: string, parentId?: number): Promise<{ success: boolean; folder_id: number }> {
        const { data } = await api.post('/folders/create', { folderKeyEncrypted, folderKeyNonce, pathHash, parentId });
        return data;
    },

    async getKey(folderId: number | null): Promise<{ key: string; nonce: string }> {
        const id = folderId === null ? 'null' : folderId;
        const { data } = await api.get(`/folders/${id}/key`);
        return data; // returns { key, nonce }
    },

    async list(parentId?: number | null, includeSystem?: boolean): Promise<{ folders: Folder[] }> {
        const params: any = {};
        if (parentId !== undefined) {
            params.parentId = parentId === null ? 'null' : parentId;
        }
        if (includeSystem) {
            params.includeSystem = 'true';
        }
        const { data } = await api.get('/folders/list', { params });
        return data;
    },

    async delete(folderId: number): Promise<{ success: boolean; reclaimedBytes: number }> {
        const { data } = await api.delete(`/folders/${folderId}`);
        return data;
    },

    async rename(folderId: number, name: string): Promise<{ success: boolean; name: string }> {
        const { data } = await api.put(`/folders/${folderId}/rename`, { name });
        return data;
    },

    async getTrash(): Promise<{ folders: Folder[] }> {
        const { data } = await api.get('/folders/trash');
        return data;
    },

    async restore(folderId: number): Promise<{ success: boolean; message: string }> {
        const { data } = await api.post(`/folders/restore/${folderId}`);
        return data;
    },

    async deleteForever(folderId: number): Promise<{ success: boolean; message: string }> {
        const { data } = await api.delete(`/folders/${folderId}/permanent`);
        return data;
    }
};

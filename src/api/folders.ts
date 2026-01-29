import api from '../lib/api';

export interface Folder {
    id: number;
    name: string;
    parent_id: number | null;
    created_at: string;
    file_count?: number;
    subfolder_count?: number;
    folder_size?: number;
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

    async list(parentId?: number | null): Promise<{ folders: Folder[] }> {
        const params: any = {};
        if (parentId !== undefined) {
            params.parentId = parentId === null ? 'null' : parentId;
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
    }
};

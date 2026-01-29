import api from '../lib/api';

export interface StorageQuota {
    used: number;
    quota: number;
    tier: string;
    percentage: number;
}

export const storageAPI = {
    async getQuota(): Promise<StorageQuota> {
        const { data } = await api.get('/storage/quota');
        return data;
    }
};

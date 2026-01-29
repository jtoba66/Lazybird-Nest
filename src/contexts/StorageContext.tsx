import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import { storageAPI, type StorageQuota } from '../api/storage';
import { useAuth } from './AuthContext';

interface StorageContextType {
    quota: StorageQuota;
    loading: boolean;
    refreshQuota: () => Promise<void>;
}

const StorageContext = createContext<StorageContextType | null>(null);

export const useStorage = () => {
    const context = useContext(StorageContext);
    if (!context) {
        throw new Error('useStorage must be used within StorageProvider');
    }
    return context;
};

export const StorageProvider = ({ children }: { children: ReactNode }) => {
    const { user } = useAuth();
    const [quota, setQuota] = useState<StorageQuota>({
        used: 0,
        quota: 2147483648, // Default 2GB
        tier: 'free',
        percentage: 0
    });
    const [loading, setLoading] = useState(true);

    const refreshQuota = useCallback(async () => {
        const token = localStorage.getItem('nest_token');
        if (!token) {
            setLoading(false);
            return;
        }

        try {
            const data = await storageAPI.getQuota();
            setQuota(data);
        } catch (error) {
            console.error('[STORAGE-CTX] Failed to refresh quota:', error);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshQuota();

        // Optional: Periodic refresh every 5 minutes
        const interval = setInterval(refreshQuota, 5 * 60 * 1000);
        return () => clearInterval(interval);
    }, [refreshQuota, user]); // Refresh when user changes (login/logout)

    return (
        <StorageContext.Provider value={{ quota, loading, refreshQuota }}>
            {children}
        </StorageContext.Provider>
    );
};

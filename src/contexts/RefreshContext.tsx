import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface RefreshContextType {
    fileListVersion: number;
    triggerFileRefresh: () => void;
}

const RefreshContext = createContext<RefreshContextType | null>(null);

export const useRefresh = () => {
    const context = useContext(RefreshContext);
    if (!context) {
        throw new Error('useRefresh must be used within RefreshProvider');
    }
    return context;
};

export const RefreshProvider = ({ children }: { children: ReactNode }) => {
    const [fileListVersion, setFileListVersion] = useState(0);

    const triggerFileRefresh = useCallback(() => {
        setFileListVersion(prev => prev + 1);
    }, []);

    return (
        <RefreshContext.Provider value={{ fileListVersion, triggerFileRefresh }}>
            {children}
        </RefreshContext.Provider>
    );
};

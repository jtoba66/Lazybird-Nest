import { createContext, useContext, useState, type ReactNode } from 'react';
import { X, CheckCircle, Warning, Info, XCircle } from '@phosphor-icons/react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface Toast {
    id: string;
    message: string;
    type: ToastType;
}

interface ToastContextType {
    showToast: (message: string, type?: ToastType, duration?: number) => string;
    updateToast: (id: string, message: string, type?: ToastType) => void;
    dismissToast: (id: string) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

export const useToast = () => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within ToastProvider');
    }
    return context;
};

const ToastIcon = ({ type }: { type: ToastType }) => {
    const props = { size: 20, weight: 'bold' as const };

    switch (type) {
        case 'success': return <CheckCircle {...props} className="text-green-500" />;
        case 'error': return <XCircle {...props} className="text-red-500" />;
        case 'warning': return <Warning {...props} className="text-yellow-500" />;
        case 'info': return <Info {...props} className="text-blue-500" />;
    }
};

export const ToastProvider = ({ children }: { children: ReactNode }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const showToast = (message: string, type: ToastType = 'info', duration = 4000) => {
        const id = crypto.randomUUID();
        const toast: Toast = { id, message, type };

        setToasts(prev => [...prev, toast]);

        if (duration !== Infinity) {
            setTimeout(() => {
                setToasts(prev => prev.filter(t => t.id !== id));
            }, duration);
        }

        return id;
    };

    const updateToast = (id: string, message: string, type?: ToastType) => {
        setToasts(prev => prev.map(t => t.id === id ? { ...t, message, type: type || t.type } : t));
    };

    const dismissToast = (id: string) => {
        setToasts(prev => prev.filter(t => t.id !== id));
    };

    return (
        <ToastContext.Provider value={{ showToast, updateToast, dismissToast }}>
            {children}

            {/* Toast Container */}
            <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md">
                {toasts.map(toast => (
                    <div
                        key={toast.id}
                        className="bg-[rgba(223,235,246,0.9)] backdrop-blur-xl border border-white/60 rounded-xl shadow-xl p-4 flex items-start gap-3 animate-slide-in-right"
                    >
                        <ToastIcon type={toast.type} />
                        <p className="flex-1 text-sm text-text-main font-medium">
                            {toast.message}
                        </p>
                        <button
                            onClick={() => dismissToast(toast.id)}
                            className="text-text-muted hover:text-text-main transition-colors"
                        >
                            <X size={16} weight="bold" />
                        </button>
                    </div>
                ))}
            </div>
        </ToastContext.Provider>
    );
};

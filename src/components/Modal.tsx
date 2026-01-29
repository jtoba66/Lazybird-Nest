import { X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    maxWidth?: string;
}

export const Modal = ({ isOpen, onClose, title, children, maxWidth = 'max-w-md' }: ModalProps) => {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
            onClick={onClose}
        >
            <div
                className={`bg-card rounded-2xl shadow-xl ${maxWidth} w-full border border-border animate-scale-in max-h-[calc(100dvh-2rem)] flex flex-col`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 md:p-6 border-b border-border">
                    <h2 className="text-lg font-semibold text-text-main">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-card-hover rounded-lg transition-all"
                    >
                        <X size={20} className="text-text-muted" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 md:p-6 overflow-y-auto">
                    {children}
                </div>
            </div>
        </div>
    );
};

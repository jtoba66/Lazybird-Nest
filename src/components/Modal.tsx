import { X } from '@phosphor-icons/react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    children: ReactNode;
    maxWidth?: string;
    zIndex?: number;
}

export const Modal = ({ isOpen, onClose, title, children, maxWidth = 'max-w-md', zIndex = 50 }: ModalProps) => {
    if (!isOpen) return null;

    return createPortal(
        <div
            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 transition-all duration-200"
            style={{ zIndex }}
            onClick={onClose}
        >
            <div
                className={`bg-card rounded-2xl shadow-xl ${maxWidth} w-full border border-border animate-in fade-in zoom-in-95 duration-200 max-h-[calc(100dvh-2rem)] flex flex-col`}
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-4 md:p-6 border-b border-border">
                    <h2 className="text-lg font-bold text-text-main">{title}</h2>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-card-hover rounded-xl transition-all text-text-muted hover:text-text-main"
                    >
                        <X size={20} weight="bold" />
                    </button>
                </div>

                {/* Content */}
                <div className="p-4 md:p-6 overflow-y-auto custom-scrollbar">
                    {children}
                </div>
            </div>
        </div>,
        document.body
    );
};

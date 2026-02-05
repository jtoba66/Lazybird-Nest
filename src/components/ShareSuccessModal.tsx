import { useState } from 'react';
import { X, Check, Copy, ShareNetwork } from '@phosphor-icons/react';

interface ShareSuccessModalProps {
    isOpen: boolean;
    onClose: () => void;
    shareLink: string;
    filename?: string;
}

export const ShareSuccessModal = ({ isOpen, onClose, shareLink, filename = 'File' }: ShareSuccessModalProps) => {
    const [copied, setCopied] = useState(false);

    if (!isOpen) return null;

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(shareLink);
            setCopied(true);
            setTimeout(() => {
                setCopied(false);
                // Optional: Close modal automatically on success? 
                // Better to let user close it securely to confirm they got it.
            }, 2000);
        } catch (err) {
            console.error('Copy failed even in modal:', err);
            // If even this fails, the user can select text manually from the input
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 animate-fade-in">
            <div className="bg-card rounded-2xl shadow-xl max-w-sm w-full border border-border flex flex-col overflow-hidden animate-scale-up">
                {/* Header */}
                <div className="bg-primary/5 p-6 flex flex-col items-center justify-center border-b border-border relative">
                    <button
                        onClick={onClose}
                        className="absolute top-4 right-4 p-2 hover:bg-black/5 rounded-lg transition-colors"
                    >
                        <X size={20} className="text-text-muted" />
                    </button>

                    <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mb-4 text-primary">
                        <ShareNetwork size={32} weight="duotone" />
                    </div>
                    <h2 className="text-xl font-bold text-text-main text-center">Ready to Share!</h2>
                    <p className="text-sm text-text-muted text-center mt-1 px-4">
                        Link created for <span className="font-semibold text-text-main">"{filename}"</span>
                    </p>
                </div>

                {/* Body */}
                <div className="p-6">
                    <div className="mb-4">
                        <label className="block text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 pl-1">
                            Share Link
                        </label>
                        <div className="relative group">
                            <input
                                type="text"
                                readOnly
                                value={shareLink}
                                onClick={(e) => e.currentTarget.select()}
                                className="w-full bg-background border border-border text-text-muted text-sm rounded-xl pl-4 pr-12 py-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all font-mono"
                            />
                            {/* Copy Indicator (Visual only) */}
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none text-primary opacity-0 group-hover:opacity-100 transition-opacity">
                                <Copy size={16} />
                            </div>
                        </div>
                    </div>

                    <button
                        onClick={handleCopy}
                        className={`w-full py-3.5 rounded-xl font-bold text-base flex items-center justify-center gap-2 transition-all shadow-lg active:scale-95 ${copied
                                ? 'bg-green-500 text-white shadow-green-500/20'
                                : 'bg-primary text-white shadow-primary/25 hover:shadow-primary/40 hover:bg-secondary'
                            }`}
                    >
                        {copied ? (
                            <>
                                <Check size={20} weight="bold" />
                                <span>Copied!</span>
                            </>
                        ) : (
                            <>
                                <Copy size={20} weight="bold" />
                                <span>Copy Link</span>
                            </>
                        )}
                    </button>

                    <p className="text-center text-xs text-text-muted/60 mt-4">
                        Anyone with this link can decrypt and download the file.
                    </p>
                </div>
            </div>
        </div>
    );
};

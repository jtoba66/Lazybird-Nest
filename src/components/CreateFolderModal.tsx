import { useState } from 'react';
import { X, FolderPlus } from '@phosphor-icons/react';

interface CreateFolderModalProps {
    isOpen: boolean;
    onClose: () => void;
    onCreate: (folderName: string) => Promise<void>;
}

export const CreateFolderModal = ({ isOpen, onClose, onCreate }: CreateFolderModalProps) => {
    const [folderName, setFolderName] = useState('');
    const [creating, setCreating] = useState(false);
    const [error, setError] = useState('');

    if (!isOpen) return null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!folderName.trim()) {
            setError('Folder name is required');
            return;
        }

        setCreating(true);
        setError('');

        try {
            await onCreate(folderName.trim());
            setFolderName('');
            onClose();
        } catch (err: any) {
            setError(err.response?.data?.error || 'Failed to create folder');
        } finally {
            setCreating(false);
        }
    };

    const handleClose = () => {
        if (!creating) {
            setFolderName('');
            setError('');
            onClose();
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
            <div className="bg-card rounded-2xl shadow-xl max-w-md w-full border border-border max-h-[calc(100dvh-2rem)] flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between p-4 md:p-6 border-b border-border">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                            <FolderPlus size={20} className="text-primary" weight="bold" />
                        </div>
                        <h2 className="text-lg font-semibold text-text-main">Create New Folder</h2>
                    </div>
                    <button
                        onClick={handleClose}
                        disabled={creating}
                        className="p-2 hover:bg-card-hover rounded-lg transition-all disabled:opacity-50"
                    >
                        <X size={20} className="text-text-muted" />
                    </button>
                </div>

                {/* Form */}
                <form onSubmit={handleSubmit} className="p-4 md:p-6 overflow-y-auto">
                    <div className="mb-4">
                        <label className="block text-sm font-medium text-text-main mb-2">
                            Folder Name
                        </label>
                        <input
                            type="text"
                            value={folderName}
                            onChange={(e) => setFolderName(e.target.value)}
                            placeholder="Enter folder name"
                            autoFocus
                            disabled={creating}
                            className="w-full bg-background border border-border text-text-main rounded-xl px-4 py-2.5 md:py-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all disabled:opacity-50"
                        />
                    </div>

                    {error && (
                        <div className="mb-4 bg-error/10 border border-error text-error rounded-lg p-3 text-sm">
                            {error}
                        </div>
                    )}

                    <div className="flex gap-3">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={creating}
                            className="flex-1 bg-background border border-border text-text-main font-semibold py-2.5 md:py-3 rounded-xl hover:bg-card-hover transition-all disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={creating || !folderName.trim()}
                            className="flex-1 bg-primary text-white font-semibold py-2.5 md:py-3 rounded-xl hover:bg-secondary transition-all disabled:opacity-50 shadow-soft hover:shadow-glow"
                        >
                            {creating ? 'Creating...' : 'Create Folder'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

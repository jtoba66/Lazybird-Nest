import { useState } from 'react';
import { Modal } from './Modal';

interface FolderRenameModalProps {
    isOpen: boolean;
    onClose: () => void;
    onRename: (newName: string) => void;
    currentName: string;
    isRenaming?: boolean;
}

export const FolderRenameModal = ({
    isOpen,
    onClose,
    onRename,
    currentName,
    isRenaming = false,
}: FolderRenameModalProps) => {
    const [newName, setNewName] = useState(currentName);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (newName.trim() && newName !== currentName) {
            onRename(newName.trim());
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Rename Folder">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label htmlFor="folderName" className="block text-sm font-medium text-text-main mb-2">
                        Folder Name
                    </label>
                    <input
                        id="folderName"
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        disabled={isRenaming}
                        className="w-full px-4 py-2.5 bg-bg-secondary border border-border rounded-xl text-text-main placeholder-text-muted focus:outline-none focus:ring-2 focus:ring-accent-primary/50 transition-all disabled:opacity-50"
                        placeholder="Enter folder name"
                        autoFocus
                    />
                </div>

                <div className="flex gap-3 pt-2">
                    <button
                        type="button"
                        onClick={onClose}
                        disabled={isRenaming}
                        className="flex-1 px-4 py-2.5 bg-bg-secondary hover:bg-card-hover text-text-main rounded-xl font-medium transition-all disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        type="submit"
                        disabled={isRenaming || !newName.trim() || newName === currentName}
                        className="flex-1 px-4 py-2.5 bg-gradient-to-r from-accent-primary to-accent-secondary hover:shadow-accent text-white rounded-xl font-medium transition-all disabled:opacity-50 disabled:hover:shadow-none"
                    >
                        {isRenaming ? 'Renaming...' : 'Rename'}
                    </button>
                </div>
            </form>
        </Modal>
    );
};

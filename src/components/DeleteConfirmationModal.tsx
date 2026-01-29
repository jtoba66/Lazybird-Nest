import { Modal } from './Modal';
import { Warning } from '@phosphor-icons/react';

interface DeleteConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    itemName: string;
    itemType: 'file' | 'folder';
    isDeleting?: boolean;
}

export const DeleteConfirmationModal = ({
    isOpen,
    onClose,
    onConfirm,
    itemName,
    itemType,
    isDeleting = false,
}: DeleteConfirmationModalProps) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title={`Delete ${itemType}`}>
            <div className="space-y-4">
                {/* Warning Icon */}
                <div className="flex justify-center">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-red-500/10 flex items-center justify-center">
                        <Warning size={32} weight="fill" className="text-red-500" />
                    </div>
                </div>

                {/* Message */}
                <div className="text-center space-y-2">
                    <p className="text-text-main font-medium">
                        Are you sure you want to delete this {itemType}?
                    </p>
                    <p className="text-sm text-text-muted">
                        <span className="font-medium text-text-main">"{itemName}"</span> will be
                        permanently deleted. This action cannot be undone.
                    </p>
                    {itemType === 'folder' && (
                        <p className="text-sm text-red-500 font-medium mt-2">
                            All files and subfolders will also be deleted.
                        </p>
                    )}
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                    <button
                        onClick={onClose}
                        disabled={isDeleting}
                        className="flex-1 px-4 py-2.5 bg-bg-secondary hover:bg-card-hover text-text-main rounded-xl font-medium transition-all disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isDeleting}
                        className="flex-1 px-4 py-2.5 bg-red-500 hover:bg-red-600 text-white rounded-xl font-medium transition-all disabled:opacity-50"
                    >
                        {isDeleting ? 'Deleting...' : 'Delete'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

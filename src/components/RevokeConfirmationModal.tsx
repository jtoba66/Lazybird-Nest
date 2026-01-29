import { Modal } from './Modal';
import { Warning } from '@phosphor-icons/react';

interface RevokeConfirmationModalProps {
    isOpen: boolean;
    onClose: () => void;
    onConfirm: () => void;
    fileName: string;
    isRevoking?: boolean;
}

export const RevokeConfirmationModal = ({
    isOpen,
    onClose,
    onConfirm,
    fileName,
    isRevoking = false,
}: RevokeConfirmationModalProps) => {
    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Revoke Share Link">
            <div className="space-y-4">
                {/* Warning Icon */}
                <div className="flex justify-center">
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-full bg-yellow-500/10 flex items-center justify-center">
                        <Warning size={32} weight="fill" className="text-yellow-500" />
                    </div>
                </div>

                {/* Message */}
                <div className="text-center space-y-2">
                    <p className="text-text-main font-medium">
                        Revoke the share link for this file?
                    </p>
                    <p className="text-sm text-text-muted">
                        The public link for <span className="font-medium text-text-main">"{fileName}"</span> will
                        stop working immediately. Anyone with the link will no longer be able to access it.
                    </p>
                </div>

                {/* Actions */}
                <div className="flex gap-3 pt-2">
                    <button
                        onClick={onClose}
                        disabled={isRevoking}
                        className="flex-1 px-4 py-2.5 bg-bg-secondary hover:bg-card-hover text-text-main rounded-xl font-medium transition-all disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isRevoking}
                        className="flex-1 px-4 py-2.5 bg-yellow-500 hover:bg-yellow-600 text-white rounded-xl font-medium transition-all disabled:opacity-50"
                    >
                        {isRevoking ? 'Revoking...' : 'Revoke'}
                    </button>
                </div>
            </div>
        </Modal>
    );
};

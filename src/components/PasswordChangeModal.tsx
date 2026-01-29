import { useState } from 'react';
import { Modal } from './Modal';
import { Check } from '@phosphor-icons/react';

interface PasswordChangeModalProps {
    isOpen: boolean;
    onClose: () => void;
    userEmail: string;
}

export const PasswordChangeModal = ({ isOpen, onClose, userEmail }: PasswordChangeModalProps) => {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [success, setSuccess] = useState(false);
    const [isChanging, setIsChanging] = useState(false);
    const [progress, setProgress] = useState('');

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        setProgress('');

        if (newPassword !== confirmPassword) {
            setError('New passwords do not match');
            return;
        }

        if (newPassword.length < 6) {
            setError('New password must be at least 6 characters');
            return;
        }

        setIsChanging(true);
        setProgress('Preparing encryption...');

        try {
            // Import crypto utilities dynamically
            const {
                deriveRootKey,
                deriveWrappingKey,
                deriveAuthHash,
                decryptMasterKey,
                generateSalt,
                toBase64,
                fromBase64,
                encryptMasterKey
            } = await import('../crypto/v2');

            // 1. Fetch current ZK params (Salt & Encrypted MK) from server
            setProgress('Fetching current security parameters...');
            const saltRes = await fetch(`${import.meta.env.VITE_API_URL}/auth/salt`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: userEmail })
            });

            if (!saltRes.ok) throw new Error('Failed to fetch security parameters');

            const {
                salt: currentSaltBase64,
                kdfParams,
                encryptedMasterKey: serverEncryptedMasterKey,
                encryptedMasterKeyNonce: serverEncryptedMasterKeyNonce
            } = await saltRes.json();

            // Fallback to localStorage if server doesn't return keys (for backward compatibility during deploy)
            // But ideally we rely on server now.
            const storedEncryptedMasterKey = serverEncryptedMasterKey || localStorage.getItem('nest_encrypted_master_key');
            const storedEncryptedMasterKeyNonce = serverEncryptedMasterKeyNonce || localStorage.getItem('nest_encrypted_master_key_nonce');

            if (!storedEncryptedMasterKey || !storedEncryptedMasterKeyNonce) {
                throw new Error('Security context missing. Please re-login.');
            }


            // 2. Verify Current Password (Local Decryption Attempt)
            setProgress('Verifying current password locally...');
            const currentSalt = fromBase64(currentSaltBase64);
            const params = typeof kdfParams === 'string' ? JSON.parse(kdfParams) : kdfParams;

            const currentRootKey = await deriveRootKey(currentPassword, currentSalt, params);
            const currentWrappingKey = deriveWrappingKey(currentRootKey);

            try {
                // Try to unlock the Master Key
                // If this fails, the password is wrong.
                const decryptedMasterKey = decryptMasterKey(
                    fromBase64(storedEncryptedMasterKey),
                    fromBase64(storedEncryptedMasterKeyNonce),
                    currentWrappingKey
                );

                console.log('[ZK] ✅ Old password verified (Master Key unlocked)');

                // 3. Generate New Keys
                setProgress('Re-encrypting keys with new password...');
                const newSalt = generateSalt();
                const newRootKey = await deriveRootKey(newPassword, newSalt, params); // Reuse KDF params

                // Derive artifacts
                const newWrappingKey = deriveWrappingKey(newRootKey);
                const newAuthHash = deriveAuthHash(newRootKey);
                const currentAuthHash = deriveAuthHash(currentRootKey); // Needed for server verification

                // 4. Re-Encrypt Master Key
                const { encrypted: newEncryptedMK, nonce: newEncryptedMKNonce } = encryptMasterKey(decryptedMasterKey, newWrappingKey);

                // 5. Send to Server
                setProgress('Updating security vault...');
                const response = await fetch(`${import.meta.env.VITE_API_URL}/auth/change-password`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        email: userEmail,
                        currentAuthHash, // Proof of old password
                        newAuthHash,     // New login hash
                        newSalt: toBase64(newSalt),
                        newEncryptedMasterKey: toBase64(newEncryptedMK),
                        newEncryptedMasterKeyNonce: toBase64(newEncryptedMKNonce),
                        kdfParams: JSON.stringify(params)
                    }),
                });

                if (!response.ok) {
                    const data = await response.json();
                    throw new Error(data.error || 'Server failed to update password');
                }

                setSuccess(true);
                setProgress('');

                // Clear form
                setCurrentPassword('');
                setNewPassword('');
                setConfirmPassword('');

                // Auto-close and reload after 2 seconds
                setTimeout(() => {
                    // Force logout because tokens might be invalidated conceptually (though JWT remains valid)
                    // But local storage is now STALE (encrypted with old key).
                    // We must clear it.
                    localStorage.removeItem('encryptedMasterKey');
                    localStorage.removeItem('encryptedMasterKeyNonce');
                    localStorage.removeItem('token');
                    window.location.href = '/login';
                }, 2000);

            } catch (cryptoError) {
                console.error('Crypto error:', cryptoError);
                throw new Error('Incorrect current password');
            }

        } catch (err: any) {
            console.error('[password-change] ❌ Failed:', err);
            setError(err.message || 'Password change failed');
            setProgress('');
        } finally {
            setIsChanging(false);
        }
    };

    const handleClose = () => {
        if (!isChanging) {
            setError('');
            setSuccess(false);
            setProgress('');
            setCurrentPassword('');
            setNewPassword('');
            setConfirmPassword('');
            onClose();
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={handleClose} title="Change Password">
            {success ? (
                <div className="text-center py-4">
                    <div className="w-16 h-16 rounded-full bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                        <Check size={32} className="text-green-500" weight="bold" />
                    </div>
                    <h3 className="text-lg font-semibold text-text-main mb-2">
                        Password Changed Successfully
                    </h3>
                    <p className="text-text-muted mb-4">
                        All your encryption keys have been re-encrypted.
                    </p>
                    <p className="text-sm text-text-muted">
                        Redirecting to login...
                    </p>
                </div>
            ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-text-main mb-2">
                            Current Password
                        </label>
                        <input
                            type="password"
                            value={currentPassword}
                            onChange={(e) => setCurrentPassword(e.target.value)}
                            className="w-full bg-background border border-border text-text-main rounded-xl px-4 py-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            placeholder="Enter current password"
                            required
                            disabled={isChanging}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-text-main mb-2">
                            New Password
                        </label>
                        <input
                            type="password"
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                            className="w-full bg-background border border-border text-text-main rounded-xl px-4 py-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            placeholder="Enter new password"
                            required
                            disabled={isChanging}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-text-main mb-2">
                            Confirm New Password
                        </label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full bg-background border border-border text-text-main rounded-xl px-4 py-3 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                            placeholder="Confirm new password"
                            required
                            disabled={isChanging}
                        />
                    </div>

                    {error && (
                        <div className="bg-error/10 border border-error text-error rounded-lg p-3 text-sm">
                            {error}
                        </div>
                    )}

                    {progress && (
                        <div className="bg-blue-500/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 rounded-lg p-3 text-sm flex items-center gap-2">
                            <div className="w-4 h-4 border-2 border-blue-500/30 border-t-blue-500 rounded-full animate-spin" />
                            {progress}
                        </div>
                    )}

                    <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-lg p-3 text-sm text-yellow-600 dark:text-yellow-400">
                        <strong>⚠️ Important:</strong> Changing your password will re-encrypt all your data.
                        You'll need to log in again with your new password.
                    </div>

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={handleClose}
                            disabled={isChanging}
                            className="flex-1 px-4 py-2.5 bg-bg-secondary hover:bg-card-hover text-text-main rounded-xl font-medium transition-all disabled:opacity-50"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={isChanging}
                            className="flex-1 px-4 py-2.5 bg-gradient-to-r from-accent-primary to-accent-secondary hover:shadow-accent text-white rounded-xl font-medium transition-all disabled:opacity-50 disabled:hover:shadow-none"
                        >
                            {isChanging ? 'Changing...' : 'Change Password'}
                        </button>
                    </div>
                </form>
            )}
        </Modal>
    );
};

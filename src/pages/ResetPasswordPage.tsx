import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle, Warning, TrashSimple, ShieldCheck } from '@phosphor-icons/react';
import { authAPI } from '../api/auth';
import { Modal } from '../components/Modal';

export const ResetPasswordPage = () => {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const token = searchParams.get('token');

    const [password, setPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [recoveryKey, setRecoveryKey] = useState('');
    const [loading, setLoading] = useState(false);
    const [success, setSuccess] = useState(false);
    const [resetMode, setResetMode] = useState<'recover' | 'destructive'>('recover');
    const [error, setError] = useState('');
    const [showConfirmModal, setShowConfirmModal] = useState(false);

    const executeReset = async () => {
        setLoading(true);
        setError('');

        try {
            // Import crypto dynamically
            const {
                deriveRootKey,
                deriveAuthHash,
                deriveWrappingKey,
                encryptMasterKey,
                generateMasterKey,
                encryptMetadataBlob,
                generateFolderKey,
                encryptFolderKey,
                fromBase64,
                toBase64,
            } = await import('../crypto/v2');

            // 1. Derive NEW Key Materials from NEW Password
            const salt = window.crypto.getRandomValues(new Uint8Array(32));
            const kdfParams = { algorithm: 'argon2id' as const, memoryCost: 65536, timeCost: 3, parallelism: 4 };

            const rootKey = await deriveRootKey(password, salt, kdfParams);
            const authHash = deriveAuthHash(rootKey);
            const wrappingKey = deriveWrappingKey(rootKey);

            let masterKey: Uint8Array;
            let wipeData = false;

            if (resetMode === 'recover') {
                // PATH A: RECOVERY
                try {
                    // Clean and decode the user-provided Recovery Key
                    const cleanKey = recoveryKey.replace(/\s/g, '').trim();
                    masterKey = fromBase64(cleanKey);

                    if (masterKey.length !== 32) {
                        throw new Error('Invalid recovery key length');
                    }
                } catch {
                    throw new Error('Invalid Recovery Key format');
                }
            } else {
                // PATH B: DESTRUCTIVE
                masterKey = generateMasterKey();
                wipeData = true;
            }

            // 2. Encrypt the Master Key with the NEW Wrapping Key
            const mkEnv = encryptMasterKey(masterKey, wrappingKey);

            // 3. Prepare Metadata
            // Path B (Destructive):
            const initialMetadata = { v: 2, folders: {}, files: {} };
            let metaEnv;
            let rootFolderKeyEncrypted;
            let rootFolderKeyNonce;

            if (resetMode === 'destructive') {
                metaEnv = encryptMetadataBlob(initialMetadata, masterKey);

                // Generate new Root Folder Key for re-initialization
                const rootFolderKey = generateFolderKey();
                const rfEnv = encryptFolderKey(rootFolderKey, masterKey);
                rootFolderKeyEncrypted = toBase64(rfEnv.encrypted);
                rootFolderKeyNonce = toBase64(rfEnv.nonce);
            } else {
                // RECOVERY: We want to preserve it.
                // The Server MUST skip updating it if it's undefined.
                metaEnv = { encrypted: new Uint8Array(0), nonce: new Uint8Array(0) }; // Placeholder
            }

            // 4. Send to Server
            await authAPI.resetPassword({
                token: token as string,
                authHash,
                salt: toBase64(salt),
                encryptedMasterKey: toBase64(mkEnv.encrypted),
                encryptedMasterKeyNonce: toBase64(mkEnv.nonce),
                encryptedMetadata: resetMode === 'destructive' ? toBase64(metaEnv.encrypted) : undefined as any,
                encryptedMetadataNonce: resetMode === 'destructive' ? toBase64(metaEnv.nonce) : undefined as any,
                rootFolderKeyEncrypted,
                rootFolderKeyNonce,
                kdfParams: JSON.stringify(kdfParams),
                wipeData
            });

            setSuccess(true);
            setTimeout(() => navigate('/login'), 3000);

        } catch (error: any) {
            console.error('Password reset failed:', error);
            setError(error.response?.data?.error || error.message || 'Failed to reset password');
            setShowConfirmModal(false); // Close modal on error if it was open
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError('');

        if (password !== confirmPassword) {
            setError('Passwords do not match');
            return;
        }

        if (password.length < 8) {
            setError('Password must be at least 8 characters');
            return;
        }

        if (resetMode === 'recover' && !recoveryKey) {
            setError('Please enter your Recovery Key');
            return;
        }

        if (resetMode === 'destructive') {
            setShowConfirmModal(true);
        } else {
            await executeReset();
        }
    };

    if (!token) {
        return <div className="min-h-[100dvh] flex items-center justify-center text-gray-200">Invalid Token</div>;
    }

    if (success) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 bg-[#0f1115]">
                <div className="glass-panel p-6 sm:p-10 text-center max-w-md">
                    <CheckCircle className="mx-auto text-green-500 mb-4" size={48} weight="fill" />
                    <h2 className="text-2xl font-bold text-gray-200 mb-2">Password Reset!</h2>
                    <p className="text-gray-400">Redirecting you to login...</p>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 bg-[#0f1115]">
            <div className="glass-panel p-6 sm:p-8 md:p-10 w-full max-w-lg">
                <div className="mb-6 text-center">
                    <h1 className="text-2xl font-bold text-gray-200">Reset Password</h1>
                </div>

                {/* Mode Switcher */}
                <div className="flex bg-white/5 p-1 rounded-xl mb-6">
                    <button
                        type="button"
                        onClick={() => setResetMode('recover')}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${resetMode === 'recover' ? 'bg-primary text-white shadow-lg' : 'text-gray-400 hover:text-white'
                            }`}
                    >
                        <ShieldCheck size={18} weight={resetMode === 'recover' ? 'fill' : 'regular'} />
                        I have Recovery Key
                    </button>
                    <button
                        type="button"
                        onClick={() => setResetMode('destructive')}
                        className={`flex-1 py-2 text-sm font-bold rounded-lg transition-all flex items-center justify-center gap-2 ${resetMode === 'destructive' ? 'bg-error text-white shadow-lg' : 'text-gray-400 hover:text-white'
                            }`}
                    >
                        <TrashSimple size={18} weight={resetMode === 'destructive' ? 'fill' : 'regular'} />
                        Lost Recovery Key
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">

                    {resetMode === 'recover' && (
                        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4 animate-fade-in">
                            <label className="block text-sm font-bold text-gray-200 mb-2">
                                Recovery Key
                            </label>
                            <textarea
                                value={recoveryKey}
                                onChange={(e) => setRecoveryKey(e.target.value)}
                                className="w-full h-24 glass-input font-mono text-xs resize-none p-3"
                                placeholder="Paste your alphanumeric recovery key here..."
                                required
                            />
                            <p className="text-xs text-gray-400 mt-2">
                                Check your saved "nest-recovery-kit.txt" file.
                            </p>
                        </div>
                    )}

                    {resetMode === 'destructive' && (
                        <div className="bg-error/10 border border-error/20 rounded-xl p-4 animate-fade-in flex items-start gap-3">
                            <Warning className="text-error flex-shrink-0 mt-0.5" size={24} weight="fill" />
                            <div className="text-sm text-error">
                                <strong className="block font-bold mb-1">Warning: Data Loss</strong>
                                Without your recovery key, <strong>all your existing files will be deleted</strong>. We will create a fresh, empty account for you.
                            </div>
                        </div>
                    )}

                    <div>
                        <label className="block text-sm font-bold text-gray-200 mb-2">New Password</label>
                        <input
                            type="password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            className="w-full glass-input"
                            required
                            minLength={8}
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-bold text-gray-200 mb-2">Confirm Password</label>
                        <input
                            type="password"
                            value={confirmPassword}
                            onChange={(e) => setConfirmPassword(e.target.value)}
                            className="w-full glass-input"
                            required
                        />
                    </div>

                    {error && (
                        <div className="text-error text-sm text-center font-bold bg-error/10 p-3 rounded-lg border border-error/20">
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        disabled={loading}
                        className={`w-full py-3 sm:py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all ${resetMode === 'destructive'
                            ? 'bg-error hover:bg-red-600 text-white shadow-lg shadow-error/20'
                            : 'glass-button'
                            }`}
                    >
                        {loading ? 'Processing...' : resetMode === 'destructive' ? 'Reset & Delete Data' : 'Recover Account'}
                    </button>
                </form>

                {/* Destructive Confirmation Modal */}
                <Modal
                    isOpen={showConfirmModal}
                    onClose={() => setShowConfirmModal(false)}
                    title="Confirm Data Destruction"
                >
                    <div className="text-center">
                        <div className="w-16 h-16 bg-error/10 text-error rounded-full flex items-center justify-center mx-auto mb-4">
                            <Warning size={32} weight="fill" />
                        </div>
                        <h3 className="text-lg font-bold text-white mb-2">Are you absolutely sure?</h3>
                        <p className="text-slate-300 mb-6">
                            This action will <strong>permanently delete all your files</strong> and create a fresh encryption key. This cannot be undone.
                        </p>

                        <div className="flex gap-3">
                            <button
                                onClick={() => setShowConfirmModal(false)}
                                className="flex-1 px-4 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={executeReset}
                                disabled={loading}
                                className="flex-1 px-4 py-2 rounded-lg bg-error hover:bg-red-600 text-white font-bold shadow-lg shadow-error/20 transition-colors"
                            >
                                {loading ? 'Deleting...' : 'Permanently Delete'}
                            </button>
                        </div>
                    </div>
                </Modal>
            </div>
        </div>
    );
};

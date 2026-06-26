import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { WarningCircle } from '@phosphor-icons/react';

interface MigrationModalProps {
    email: string;
    password: string; // The legacy password
    onClose: () => void;
}

export const MigrationModal = ({ email, password, onClose }: MigrationModalProps) => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { migrateLegacy } = useAuth();

    const handleUpgrade = async () => {
        setLoading(true);
        setError('');
        try {
            await migrateLegacy({ email, password });
            // After successful migration, the AuthContext automatically triggers a login and updates state
        } catch (err: any) {
            console.error(err);
            setError(err.response?.data?.error || err.message || 'Upgrade failed');
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-fade-in">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden animate-scale-in">
                <div className="p-6 sm:p-8 space-y-6">
                    <div className="flex items-center gap-4 text-warning">
                        <WarningCircle size={48} weight="fill" />
                        <div>
                            <h2 className="text-2xl font-bold text-slate-800">Account Upgrade Required</h2>
                            <p className="text-sm text-slate-500 mt-1">Action required for your legacy account</p>
                        </div>
                    </div>

                    <div className="space-y-4 text-slate-600">
                        <p>
                            We have upgraded Nest to a modern <strong>Zero-Knowledge Encryption</strong> architecture. This means your files will now be encrypted locally on your device, and our servers will never hold the keys to decrypt them.
                        </p>
                        <div className="bg-error/10 border border-error/20 p-4 rounded-xl text-error text-sm font-medium">
                            <p className="mb-2"><strong>Important:</strong> Because we can no longer decrypt your old data, your previous files will be permanently cleared during this upgrade.</p>
                            <p>Do you wish to proceed and set up your new encrypted profile?</p>
                        </div>
                    </div>

                    {error && (
                        <div className="bg-error/10 border border-error/20 text-error rounded-xl p-4 text-sm font-medium animate-shake">
                            {error}
                        </div>
                    )}

                    <div className="flex flex-col sm:flex-row gap-3 pt-4">
                        <button
                            onClick={onClose}
                            disabled={loading}
                            className="w-full sm:w-auto px-6 py-3 rounded-xl border border-slate-200 text-slate-600 font-bold hover:bg-slate-50 transition-colors"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleUpgrade}
                            disabled={loading}
                            className="w-full sm:flex-1 px-6 py-3 rounded-xl bg-error text-white font-bold hover:bg-error/90 flex items-center justify-center gap-2 transition-colors"
                        >
                            {loading ? (
                                <>
                                    <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                    <span>Upgrading...</span>
                                </>
                            ) : (
                                'Accept & Upgrade'
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

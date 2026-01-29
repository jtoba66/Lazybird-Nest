import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { ShieldCheck, DownloadSimple, CheckCircle, Warning, ArrowRight, LockKey } from '@phosphor-icons/react';
import { toBase64 } from '../crypto/v2';

export const RecoverySetupPage = () => {
    const { user, masterKey, login } = useAuth();
    const navigate = useNavigate();
    const [downloaded, setDownloaded] = useState(false);
    const [confirmed, setConfirmed] = useState(false);
    const [showRelogin, setShowRelogin] = useState(false);
    const [password, setPassword] = useState('');
    const [error, setError] = useState('');
    const [loading, setLoading] = useState(false);

    // Check for missing master key after component mount
    useEffect(() => {
        const timer = setTimeout(() => {
            if (user && !masterKey) {
                setShowRelogin(true);
            }
        }, 1000); // Give AuthContext 1s to restore from localStorage
        return () => clearTimeout(timer);
    }, [user, masterKey]);

    const handleRelogin = async (e: FormEvent) => {
        e.preventDefault();
        setError('');
        setLoading(true);

        try {
            if (user?.email) {
                await login({ email: user.email, password }); // Re-derive keys
                setShowRelogin(false);
            }
        } catch (err: any) {
            setError(err.response?.data?.error || 'Invalid password');
        } finally {
            setLoading(false);
        }
    };

    const generateRecoveryKit = () => {
        if (!masterKey || !user) return;

        const keyBase64 = toBase64(masterKey);
        const content = `NEST CLOUD STORAGE - RECOVERY KIT
----------------------------------------------------------------
DO NOT SHARE THIS FILE. KEEP IT SAFE.
----------------------------------------------------------------

Account Email: ${user.email}
Created: ${new Date().toLocaleString()}

----------------------------------------------------------------
YOUR MASTER RECOVERY KEY
----------------------------------------------------------------

${keyBase64}

----------------------------------------------------------------
INSTRUCTIONS
----------------------------------------------------------------
Nest uses Zero-Knowledge encryption. This means we (the server) 
do NOT have your password or your encryption keys.

If you forget your password, your data is lost FOREVER unless 
you have this Recovery Key.

To restore access:
1. Go to the Reset Password page.
2. Select "I have my Recovery Key".
3. Paste the key above to decrypt your account and set a new password.
`;

        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `nest-recovery-kit-${user.email.split('@')[0]}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        setDownloaded(true);
    };

    const handleContinue = () => {
        if (downloaded && confirmed) {
            navigate('/');
        }
    };

    if (showRelogin) {
        return (
            <div className="min-h-[100dvh] bg-[#0f1115] text-white flex items-center justify-center p-4 sm:p-6">
                <div className="glass-panel p-6 sm:p-8 max-w-md w-full animate-scale-in">
                    <div className="text-center mb-6">
                        <div className="w-16 h-16 bg-amber-500/20 rounded-2xl flex items-center justify-center mx-auto mb-4 text-amber-500">
                            <LockKey size={32} weight="fill" />
                        </div>
                        <h2 className="text-xl font-bold mb-2">Security Verification Needed</h2>
                        <p className="text-gray-400 text-sm">
                            Your encryption keys are locked. Please re-enter your password to unlock the Recovery Kit generator.
                        </p>
                    </div>

                    <form onSubmit={handleRelogin} className="space-y-4">
                        <div>
                            <input
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full glass-input"
                                placeholder="Enter your password"
                                required
                                autoFocus
                            />
                        </div>

                        {error && (
                            <div className="bg-error/10 text-error text-sm p-3 rounded-lg border border-error/20 text-center">
                                {error}
                            </div>
                        )}

                        <button
                            type="submit"
                            disabled={loading}
                            className="glass-button w-full py-3 font-semibold"
                        >
                            {loading ? 'Unlocking...' : 'Unlock Session'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-[100dvh] bg-[#0f1115] text-white flex items-center justify-center p-4 sm:p-6">
            <div className="w-full max-w-lg">
                {/* Header */}
                <div className="text-center mb-6 sm:mb-8">
                    <div className="w-16 h-16 bg-gradient-to-br from-primary to-secondary rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-primary/20">
                        <ShieldCheck size={32} className="text-white" weight="bold" />
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-bold mb-2 text-white">Account Safety Setup</h1>
                    <p className="text-gray-400">
                        Before you start, we need to ensure you can never lose access to your data.
                    </p>
                </div>

                {/* Main Card */}
                <div className="glass-panel p-6 sm:p-8 mb-6 border border-primary/20 bg-[#1a1b26]/80 backdrop-blur-xl">

                    <div className="flex items-start gap-3 mb-6 bg-amber-500/10 border border-amber-500/20 p-4 rounded-xl text-amber-200">
                        <Warning size={24} weight="fill" className="text-amber-400 flex-shrink-0 mt-0.5" />
                        <div className="text-sm leading-relaxed text-amber-100">
                            <strong className="block text-amber-400 mb-1">Zero-Knowledge Warning</strong>
                            We cannot reset your password. If you lose it, your data is gone forever without this kit.
                        </div>
                    </div>

                    <div className="space-y-6">
                        {/* Step 1: Download */}
                        <div className={`p-5 rounded-xl border transition-all ${downloaded ? 'bg-green-500/10 border-green-500/30' : 'bg-white/5 border-white/10'}`}>
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold text-gray-200">1. Download Recovery Kit</h3>
                                {downloaded && <CheckCircle size={20} className="text-green-400" weight="fill" />}
                            </div>
                            <button
                                onClick={generateRecoveryKit}
                                disabled={!masterKey}
                                className={`w-full flex items-center justify-center gap-2 py-3 rounded-lg font-medium transition-colors border ${!masterKey
                                        ? 'bg-white/5 border-white/5 text-gray-500 cursor-wait'
                                        : 'bg-white/10 hover:bg-white/20 text-white border-white/10'
                                    }`}
                            >
                                <DownloadSimple size={20} weight="bold" />
                                {masterKey ? 'Download PDF / Text File' : 'Verifying Security Keys...'}
                            </button>
                        </div>

                        {/* Step 2: Confirm */}
                        <div className={`transition-opacity duration-500 ${downloaded ? 'opacity-100' : 'opacity-50 pointer-events-none'}`}>
                            <label className="flex items-start gap-3 cursor-pointer group">
                                <div className="relative flex items-center">
                                    <input
                                        type="checkbox"
                                        className="peer sr-only"
                                        checked={confirmed}
                                        onChange={(e) => setConfirmed(e.target.checked)}
                                        disabled={!downloaded}
                                    />
                                    <div className="w-5 h-5 border-2 border-gray-500 rounded peer-checked:bg-primary peer-checked:border-primary transition-all"></div>
                                    <CheckCircle size={20} weight="fill" className="absolute top-0 left-0 text-white opacity-0 peer-checked:opacity-100 transition-opacity pointer-events-none" />
                                </div>
                                <span className="text-sm text-gray-400 group-hover:text-gray-200 transition-colors">
                                    I confirm that I have downloaded my Recovery Kit and stored it in a safe place.
                                </span>
                            </label>
                        </div>
                    </div>
                </div>

                {/* Continue Button */}
                <button
                    onClick={handleContinue}
                    disabled={!downloaded || !confirmed}
                    className={`w-full py-3.5 sm:py-4 rounded-xl font-bold flex items-center justify-center gap-2 transition-all duration-300 ${downloaded && confirmed
                        ? 'bg-gradient-to-r from-primary to-secondary text-white shadow-lg shadow-primary/25 hover:shadow-primary/40 transform hover:-translate-y-0.5'
                        : 'bg-white/5 text-gray-400 cursor-not-allowed'
                        }`}
                >
                    Continue to Nest
                    <ArrowRight size={20} weight="bold" />
                </button>
            </div>
        </div>
    );
};

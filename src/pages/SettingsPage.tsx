import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import API_BASE_URL from '../config/api';
import {
    User,
    ShieldCheck,
    Key,
    Warning,
    Crown,
    CheckCircle,
    Lock,
    Shield,
    CreditCard,
    Info,
    Database
} from '@phosphor-icons/react';
import { useAuth } from '../contexts/AuthContext';
import { storageAPI } from '../api/storage';
import { filesAPI } from '../api/files';
import { useToast } from '../contexts/ToastContext';
import { PasswordChangeModal } from '../components/PasswordChangeModal';
import { CancelWarningModal } from '../components/CancelWarningModal';
import { useSearchParams } from 'react-router-dom';
import { billingAPI } from '../api/billing';

const FREE_TIER_QUOTA = 2 * 1024 * 1024 * 1024; // 2GB

export const SettingsPage = () => {
    const { user, masterKey } = useAuth();
    const [quota, setQuota] = useState({ used: 0, quota: 2147483648, tier: 'free', percentage: 0 });
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showCancelWarning, setShowCancelWarning] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [triggerCrash, setTriggerCrash] = useState(false);
    const { showToast } = useToast();

    if (triggerCrash) {
        throw new Error("Nest Sentinel Verification Triggered");
    }

    useEffect(() => {
        storageAPI.getQuota()
            .then(data => {
                console.log('[Settings] Quota received:', data);
                setQuota(data);
            })
            .catch(err => {
                console.error('[Settings] Failed to fetch quota:', err);
                setQuota({ used: 0, quota: 2147483648, tier: 'free', percentage: 0 });
            })
            .finally(() => { });
    }, []);

    // Handle Stripe Redirect (Upgrade Success)
    const [searchParams, setSearchParams] = useSearchParams();
    const syncAttempted = useState(false); // Use state to prevent double-firing in Strict Mode

    useEffect(() => {
        const upgrade = searchParams.get('upgrade');
        const sessionId = searchParams.get('session_id');

        if (upgrade === 'success' && sessionId && !syncAttempted[0]) {
            syncAttempted[1](true); // Mark as attempted immediately

            const syncSubscription = async () => {
                try {
                    // 1. Call Sync Endpoint directly (skip "Verifying" toast for speed)
                    await billingAPI.syncSubscription(sessionId);

                    // 2. Success Feedback
                    showToast('Upgraded to Pro! Enjoy your 100GB.', 'success');

                    // 3. Refresh Quota & UI
                    const newQuota = await storageAPI.getQuota();
                    setQuota(newQuota);

                    // Note: Sidebar might trail slightly until next full reload, but that's smoother than forcing it now.
                } catch (error) {
                    console.error('Sync failed:', error);
                    showToast('Subscription verification failed. Please contact support.', 'error');
                }
            };

            syncSubscription();
            // Clean URL silently
            setSearchParams({}, { replace: true });
        }
    }, [searchParams]);

    const formatBytes = (bytes: number | undefined) => {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const clearCache = () => {
        if (confirm('Clear all local cache? This will sign you out.')) {
            localStorage.clear();
            window.location.reload();
        }
    };

    const handleExportData = async () => {
        if (exporting) return;
        setExporting(true);
        showToast('Preparing your data export. This may take a while...', 'info');

        try {
            const { streamExport } = await import('../utils/StreamingExport');
            const { files } = await filesAPI.list();

            const accountInfo = {
                email: user?.email,
                joined_at: user?.created_at,
                export_date: new Date().toISOString(),
                storage: {
                    used: quota.used,
                    total: quota.quota,
                    tier: quota.tier
                }
            };

            // 3. User Master Key
            if (!user || (!masterKey && !localStorage.getItem('nest_master_key'))) {
                showToast('Encryption keys missing. Please re-login.', 'error');
                return;
            }

            // If context masterKey is null (e.g. reload), we might check if we can restore it?
            // But usually this means user should re-login for security in ZK apps.
            if (!masterKey) {
                showToast('Security verification needed. Please reload.', 'error');
                return;
            }

            await streamExport(
                files,
                { user: accountInfo, quota },
                masterKey,
                (progress, filename) => {
                    console.log(`Export Progress: ${progress.toFixed(1)}% - ${filename}`);
                }
            );

            showToast('Export started! Check your downloads.', 'success');
        } catch (error: any) {
            console.error('Data export failed:', error);
            showToast(error.message || 'Failed to export data', 'error');
        } finally {
            setExporting(false);
        }
    };


    return (
        <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="flex-1 p-4 sm:p-6 md:p-10 max-w-7xl mx-auto overflow-auto custom-scrollbar"
        >
            {/* Password Change Modal */}
            <PasswordChangeModal
                isOpen={showPasswordModal}
                onClose={() => setShowPasswordModal(false)}
                userEmail={user?.email || ''}
            />

            {/* Header */}
            <div className="mb-6 sm:mb-8">
                <h1 className="text-2xl sm:text-3xl font-bold text-text-main mb-2 tracking-tight">Settings</h1>
                <p className="text-text-muted">Manage your account preferences and security setup.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">

                {/* Left Column: Profile & Storage */}
                <div className="lg:col-span-5 flex flex-col gap-6 h-full">

                    {/* Profile Card */}
                    <div className="glass-panel p-6 sm:p-8 flex flex-col items-center text-center relative overflow-hidden group shrink-0">
                        <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>

                        <div className="w-20 h-20 sm:w-28 sm:h-28 bg-gradient-to-br from-white/10 to-white/5 rounded-full flex items-center justify-center mb-6 border-4 border-white/5 shadow-2xl relative">
                            <User size={56} className="text-text-muted scale-90 sm:scale-100" weight="duotone" />
                            <div className={`absolute bottom-0 right-0 ${quota.tier === 'free' ? 'bg-slate-600' : 'bg-amber-500'} text-white text-[10px] font-extrabold px-3 py-1 rounded-full shadow-lg border-2 border-[#1a1b26]`}>
                                {quota.tier === 'free' ? 'FREE' : 'PRO'}
                            </div>
                        </div>

                        <h2 className="text-xl sm:text-2xl font-bold text-text-main mb-1">{user?.email || 'User'}</h2>
                        <div className="flex items-center gap-2 text-sm text-text-muted mb-6">
                            <ShieldCheck className="text-blue-400" weight="fill" />
                            <span>Account Encrypted</span>
                        </div>

                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            className="w-full glass-button py-2.5 text-sm font-medium"
                        >
                            Edit Profile
                        </motion.button>
                    </div>

                    {/* Storage Widget */}
                    <div className="glass-panel p-5 sm:p-6 relative overflow-hidden group shrink-0">
                        {/* Background glow */}
                        <div className="absolute -top-10 -right-10 w-48 h-48 bg-primary/10 rounded-full blur-3xl group-hover:bg-primary/20 transition-all duration-700"></div>

                        <div className="flex items-center justify-between mb-6 relative z-10">
                            <h3 className="text-lg font-bold text-text-main flex items-center gap-2">
                                <Database weight="duotone" className="text-primary" size={22} />
                                Storage
                            </h3>
                            <span className="text-xs font-bold bg-primary/20 text-primary px-2 py-1 rounded-md uppercase">
                                {quota.percentage?.toFixed(1)}% Used
                            </span>
                        </div>

                        <div className="relative z-10">
                            <div className="flex items-end gap-1.5 mb-3">
                                <span className="text-3xl sm:text-4xl font-bold text-text-main tracking-tight">{formatBytes(quota.used)}</span>
                                <span className="text-sm text-text-muted font-medium mb-1.5">/ {formatBytes(quota.quota)}</span>
                            </div>

                            {/* Enhanced Progress Bar */}
                            <div className="h-4 bg-black/40 rounded-full overflow-hidden border border-white/5 mb-5 p-0.5 box-content">
                                <div className="h-full rounded-full w-full bg-white/5 relative overflow-hidden">
                                    <div
                                        className="h-full bg-gradient-to-r from-primary via-purple-500 to-primary background-animate-slow rounded-full shadow-[0_0_15px_rgba(var(--primary-rgb),0.6)]"
                                        style={{ width: `${Math.min(quota.percentage || 0, 100)}%` }}
                                    />
                                </div>
                            </div>

                            {quota.tier !== 'pro' && (
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => window.location.href = '/pricing'}
                                    className="w-full bg-primary/10 border border-primary/50 text-white py-3 rounded-xl font-bold hover:bg-primary/20 hover:shadow-[0_0_20px_rgba(var(--primary-rgb),0.4)] transition-all flex items-center justify-center gap-2 group/btn relative overflow-hidden backdrop-blur-sm"
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-primary/0 via-primary/20 to-primary/0 translate-x-[-100%] group-hover/btn:translate-x-[100%] transition-transform duration-1000"></div>
                                    <Crown weight="fill" className="text-primary-300 group-hover/btn:text-white transition-colors" size={20} />
                                    <span className="relative z-10 drop-shadow-sm">Upgrade to Pro</span>
                                </motion.button>
                            )}

                            {/* Billing Management */}
                            {quota.tier === 'pro' && (
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={async () => {
                                        // Check if over free tier quota before redirecting
                                        if (quota.used > FREE_TIER_QUOTA) {
                                            setShowCancelWarning(true);
                                            return;
                                        }
                                        const { billingAPI } = await import('../api/billing');
                                        const { url } = await billingAPI.createPortalSession();
                                        window.location.href = url;
                                    }}
                                    className="w-full mt-3 bg-white text-black py-3 rounded-xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2 group/btn relative overflow-hidden shadow-lg"
                                >
                                    <CreditCard weight="duotone" className="text-black" size={20} />
                                    <span>Manage Billing</span>
                                </motion.button>
                            )}
                        </div>
                    </div>

                    {/* Danger Zone Group (Left Column - Matches Height) */}
                    <div className="flex-1 flex flex-col gap-4 min-h-0">
                        <h3 className="text-xl font-bold text-error flex items-center gap-2 px-1 shrink-0">
                            <Warning weight="fill" size={24} />
                            Danger Zone
                        </h3>

                        {/* Clear Local Cache - Stretched */}
                        <div className="flex-1 flex flex-col justify-between border border-error/20 bg-error/5 rounded-2xl p-6 backdrop-blur-sm relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-error/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none group-hover:bg-error/10 transition-colors"></div>
                            <div className="relative z-10 mb-2">
                                <h4 className="font-bold text-text-main mb-2">Clear Local Cache</h4>
                                <p className="text-sm text-text-muted leading-relaxed">
                                    Removes all local encryption keys and session data.
                                </p>
                            </div>
                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={clearCache}
                                className="w-full py-2.5 bg-error/10 border border-error/30 text-error rounded-xl text-sm font-bold hover:bg-error hover:text-white transition-all relative z-10 mt-auto"
                            >
                                Clear Cache
                            </motion.button>
                        </div>

                        {/* Permanent Deletion - Stretched */}
                        <div className="flex-1 flex flex-col justify-between border border-error/20 bg-error/5 rounded-2xl p-6 backdrop-blur-sm relative overflow-hidden group">
                            <div className="absolute top-0 right-0 w-32 h-32 bg-error/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none group-hover:bg-error/10 transition-colors"></div>
                            <div className="relative z-10 mb-2">
                                <h4 className="font-bold text-text-main mb-2">Delete Account</h4>
                                <p className="text-sm text-text-muted leading-relaxed">
                                    Permanently delete your account and scrub your identity.
                                </p>
                            </div>
                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setShowDeleteModal(true)}
                                className="w-full py-2.5 bg-error text-white rounded-xl text-sm font-bold hover:shadow-[0_0_20px_rgba(var(--error-rgb),0.4)] transition-all relative z-10 mt-auto"
                            >
                                Delete Account
                            </motion.button>
                        </div>
                    </div>
                </div>

                {/* Right Column: Security & Privacy */}
                <div className="lg:col-span-7 space-y-6">

                    {/* Security Center */}
                    <div className="glass-panel p-8 flex flex-col">
                        <h3 className="text-xl font-bold text-text-main mb-6 flex items-center gap-2">
                            <ShieldCheck weight="duotone" className="text-blue-400" size={28} />
                            Security Center
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-8">
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/10 transition-all duration-300 group cursor-default">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl group-hover:bg-blue-500/20 transition-colors">
                                        <Lock size={24} weight="fill" />
                                    </div>
                                    <CheckCircle size={20} className="text-blue-500/60" weight="fill" />
                                </div>
                                <h4 className="font-bold text-text-main mb-1">Zero-Knowledge</h4>
                                <p className="text-xs text-text-muted leading-relaxed">
                                    Your keys, your data. Server cannot decrypt your files.
                                </p>
                            </div>

                            <div className="bg-white/5 border border-white/10 rounded-2xl p-5 hover:bg-white/10 transition-all duration-300 group cursor-default">
                                <div className="flex justify-between items-start mb-4">
                                    <div className="p-3 bg-blue-500/10 text-blue-400 rounded-xl group-hover:bg-blue-500/20 transition-colors">
                                        <Shield size={24} weight="fill" />
                                    </div>
                                    <CheckCircle size={20} className="text-blue-500/60" weight="fill" />
                                </div>
                                <h4 className="font-bold text-text-main mb-1">XChaCha20-Poly1305</h4>
                                <p className="text-xs text-text-muted leading-relaxed">
                                    Military-grade authenticated encryption standard.
                                </p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <h4 className="text-sm font-bold text-text-muted uppercase tracking-wider mb-3">Actions</h4>

                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => window.location.href = '/recovery-setup'}
                                className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-3 sm:p-4 flex items-center justify-between group transition-all"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-amber-500/10 flex items-center justify-center text-amber-500 group-hover:scale-110 transition-transform">
                                        <Warning size={20} weight="bold" />
                                    </div>
                                    <div className="text-left">
                                        <div className="font-bold text-text-main">Download Recovery Kit</div>
                                        <div className="text-xs text-text-muted">Backup your master encryption key</div>
                                    </div>
                                </div>
                                <div className="text-text-muted group-hover:translate-x-1 transition-transform">→</div>
                            </motion.button>

                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setShowPasswordModal(true)}
                                className="w-full bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl p-3 sm:p-4 flex items-center justify-between group transition-all"
                            >
                                <div className="flex items-center gap-4">
                                    <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                        <Key size={20} weight="bold" />
                                    </div>
                                    <div className="text-left">
                                        <div className="font-bold text-text-main">Change Password</div>
                                        <div className="text-xs text-text-muted">Update your main encryption key</div>
                                    </div>
                                </div>
                                <div className="text-text-muted group-hover:translate-x-1 transition-transform">→</div>
                            </motion.button>
                        </div>
                    </div>

                    {/* Privacy & Portability Section */}
                    <div className="glass-panel p-8">
                        <h3 className="text-xl font-bold text-text-main mb-6 flex items-center gap-2">
                            <Info weight="duotone" className="text-blue-400" size={28} />
                            Privacy & Transparency
                        </h3>

                        <div className="space-y-6">
                            {/* SAR Report */}
                            <div className="bg-white/5 border border-white/10 rounded-2xl overflow-hidden">
                                <div className="px-5 py-3 bg-white/5 border-b border-white/10 flex items-center justify-between">
                                    <span className="text-xs font-bold text-text-muted uppercase tracking-wider">Transparency Report (SAR)</span>
                                    <span className="text-[10px] bg-primary/20 text-primary px-2 py-0.5 rounded-full font-bold">ZK VERIFIED</span>
                                </div>
                                <div className="p-0">
                                    <table className="w-full text-left text-xs border-collapse">
                                        <thead>
                                            <tr className="border-b border-white/5 bg-white/[0.02]">
                                                <th className="px-5 py-3 font-bold text-text-muted">Data Category</th>
                                                <th className="px-5 py-3 font-bold text-text-muted">Visibility to Nest</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-white/5">
                                            <tr>
                                                <td className="px-5 py-3 text-text-main font-medium">Account Email</td>
                                                <td className="px-5 py-3 text-slate-500 font-medium uppercase tracking-tight">Plain Text</td>
                                            </tr>
                                            <tr>
                                                <td className="px-5 py-3 text-text-main font-medium">Billing & Quota</td>
                                                <td className="px-5 py-3 text-slate-500 font-medium uppercase tracking-tight">Plain Text</td>
                                            </tr>
                                            <tr>
                                                <td className="px-5 py-3 text-text-main font-medium">File & Folder Names</td>
                                                <td className="px-5 py-3 text-slate-700 font-medium uppercase tracking-tight">Encrypted</td>
                                            </tr>
                                            <tr>
                                                <td className="px-5 py-3 text-text-main font-medium">File Content (Blobs)</td>
                                                <td className="px-5 py-3 text-slate-700 font-medium uppercase tracking-tight">Encrypted</td>
                                            </tr>
                                            <tr>
                                                <td className="px-5 py-3 text-text-main font-medium">Vault Keys</td>
                                                <td className="px-5 py-3 text-slate-700 font-medium uppercase tracking-tight">Encrypted</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>

                            {/* Data Portability */}
                            <div className="space-y-4">
                                <div className="flex items-start gap-4 p-4 bg-primary/5 border border-primary/20 rounded-2xl">
                                    <div className="p-2 bg-primary/10 rounded-lg text-primary">
                                        <Database size={20} weight="fill" />
                                    </div>
                                    <div className="flex-1">
                                        <h4 className="font-bold text-text-main text-sm">Right to Portability</h4>
                                        <p className="text-xs text-text-muted mt-1 leading-relaxed">
                                            You can download all your stored files and account metadata in a single, unencrypted bundle. Decryption happens locally in your browser.
                                        </p>
                                        <motion.button
                                            whileHover={{ scale: 1.02 }}
                                            whileTap={{ scale: 0.98 }}
                                            disabled={exporting}
                                            onClick={handleExportData}
                                            className="mt-4 flex items-center gap-2 bg-primary text-white text-xs font-bold px-4 py-2 rounded-lg hover:shadow-glow transition-all disabled:opacity-50"
                                        >
                                            {exporting ? 'Preparing zip...' : 'Export All Data (ZIP)'}
                                        </motion.button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                </div>
            </div>

            {/* Sentry Test Section (Bottom - Admin Only) */}
            <div className="mt-8">
                {user?.email === 'josephtoba29@gmail.com' && (
                    <div className="border border-blue-500/20 bg-blue-500/5 rounded-2xl p-6 backdrop-blur-sm relative overflow-hidden flex flex-col justify-between group max-w-xl mx-auto">
                        <div className="absolute top-0 right-0 w-32 h-32 bg-blue-500/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none group-hover:bg-blue-500/10 transition-colors"></div>
                        <div className="relative z-10 mb-6">
                            <h4 className="font-bold text-text-main mb-2">Sentinel Stress Test</h4>
                            <p className="text-sm text-text-muted leading-relaxed">
                                Trigger an intentional UI exception to verify Sentry error tracking and sentinel reporting.
                            </p>
                        </div>
                        <motion.button
                            whileHover={{ scale: 1.02 }}
                            whileTap={{ scale: 0.98 }}
                            onClick={() => setTriggerCrash(true)}
                            className="w-full py-2.5 bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-xl text-sm font-bold hover:bg-blue-500 hover:text-white transition-all relative z-10"
                        >
                            Test Sentinel
                        </motion.button>
                    </div>
                )}
            </div>

            {/* Account Deletion Modal */}
            <AccountDeletionModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
            />

            {/* Cancel Warning Modal (Over-Quota) */}
            <CancelWarningModal
                isOpen={showCancelWarning}
                onClose={() => setShowCancelWarning(false)}
                onProceed={async () => {
                    setShowCancelWarning(false);
                    const { billingAPI } = await import('../api/billing');
                    const { url } = await billingAPI.createPortalSession();
                    window.location.href = url;
                }}
                currentUsage={quota.used}
                freeQuota={FREE_TIER_QUOTA}
            />
        </motion.div>
    );
};

interface AccountDeletionModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const AccountDeletionModal = ({ isOpen, onClose }: AccountDeletionModalProps) => {
    const [password, setPassword] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const { logout } = useAuth();

    if (!isOpen) return null;

    const handleDelete = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const { deriveRootKey, deriveAuthHash, fromBase64 } = await import('../crypto/v2');
            const { authAPI } = await import('../api/auth');
            const { user } = useAuth();

            if (!user?.email) throw new Error('User email not found');

            // 1. Get salt and KDF params
            const saltData = await authAPI.getSalt(user.email);
            const salt = fromBase64(saltData.salt);
            const kdfParams = JSON.parse(saltData.kdfParams);

            // 2. Derive Root Key
            const rootKey = await deriveRootKey(password, salt, kdfParams);

            // 3. Derive AuthHash from Root Key
            const authHash = deriveAuthHash(rootKey);

            // 4. Call Delete API
            await authAPI.deleteAccount(authHash);

            // 5. Logout and Redirect
            logout();
            window.location.href = '/?deleted=true';
        } catch (err: any) {
            console.error('[Delete] Failed:', err);
            setError(err.response?.data?.error || err.message || 'Failed to delete account');
            setLoading(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={onClose}
                className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div
                initial={{ opacity: 0, scale: 0.9, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                className="w-full max-w-md bg-white/90 backdrop-blur-md rounded-3xl p-8 border border-white/20 shadow-2xl relative z-10"
            >
                <div className="w-16 h-16 bg-error/10 rounded-2xl flex items-center justify-center text-error mb-6 mx-auto">
                    <Warning size={32} weight="fill" />
                </div>

                <h2 className="text-2xl font-bold text-text-main text-center mb-2">Delete Account?</h2>
                <p className="text-text-muted text-center text-sm mb-8 leading-relaxed">
                    This will permanently erase your encryption keys, folder structures, and scrub your identity from our systems. <strong>This action cannot be undone.</strong>
                </p>

                <form onSubmit={handleDelete} className="space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2 ml-1">
                            Confirm with Password
                        </label>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            className="w-full glass-input"
                        />
                    </div>

                    {error && (
                        <div className="p-3 bg-error/10 border border-error/20 rounded-xl text-error text-xs font-medium text-center">
                            {error}
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 px-4 rounded-xl border border-white/40 font-bold text-text-main hover:bg-black/5 transition-all text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 py-3 px-4 rounded-xl bg-error text-white font-bold hover:shadow-lg transition-all text-sm disabled:opacity-50"
                        >
                            {loading ? 'Deleting...' : 'Permanently Delete'}
                        </button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
};

import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

import {
    User,
    ShieldCheck,
    Key,
    Warning,
    Crown,
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
    const { user, masterKey, metadata } = useAuth();
    const [quota, setQuota] = useState({ used: 0, quota: 2147483648, tier: 'free', percentage: 0 });
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showCancelWarning, setShowCancelWarning] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [triggerCrash, setTriggerCrash] = useState(false);
    const [showTransparencyModal, setShowTransparencyModal] = useState(false);
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
                metadata,
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

                        <h2 className="text-xl sm:text-2xl font-bold text-text-main mb-6">{user?.email || 'User'}</h2>

                        <div className="w-full space-y-3">
                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => setShowPasswordModal(true)}
                                className="w-full glass-button py-2.5 text-sm font-bold flex items-center justify-center gap-2"
                            >
                                <Key size={16} weight="bold" />
                                Change Password
                            </motion.button>

                            <motion.button
                                whileHover={{ scale: 1.02 }}
                                whileTap={{ scale: 0.98 }}
                                onClick={() => window.location.href = '/recovery-setup'}
                                className="w-full glass-button py-2.5 text-sm font-bold flex items-center justify-center gap-2"
                            >
                                <Warning size={16} weight="bold" className="text-amber-500" />
                                Recovery Kit
                            </motion.button>
                        </div>
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
                                {quota.used > 0 && (quota.percentage || 0) < 0.1 ? '< 0.1' : (quota.percentage || 0).toFixed(1)}% Used
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
                                    className="w-full glass-button py-2.5 text-sm font-bold flex items-center justify-center gap-2 text-white"
                                >
                                    <Crown weight="fill" className="text-white" size={20} />
                                    Upgrade to Pro
                                </motion.button>
                            )}

                            {/* Billing Management */}
                            {quota.tier === 'pro' && (
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={async () => {
                                        if (quota.used > FREE_TIER_QUOTA) {
                                            setShowCancelWarning(true);
                                            return;
                                        }
                                        const { billingAPI } = await import('../api/billing');
                                        const { url } = await billingAPI.createPortalSession();
                                        window.location.href = url;
                                    }}
                                    className="w-full glass-button py-2.5 text-sm font-bold flex items-center justify-center gap-2"
                                >
                                    <CreditCard weight="duotone" size={20} />
                                    Manage Billing
                                </motion.button>
                            )}
                        </div>
                    </div>
                </div>

                {/* Right Column: Data & Danger Zone */}
                <div className="lg:col-span-7 flex flex-col gap-6">

                    {/* Data Privacy Section */}
                    <div className="glass-panel p-8">
                        <h3 className="text-xl font-bold text-text-main mb-6 flex items-center gap-2">
                            <Info weight="duotone" className="text-blue-400" size={28} />
                            Privacy & Data
                        </h3>

                        <div className="space-y-6">
                            {/* Actions Group */}
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Export Data */}
                                <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl flex flex-col justify-between h-full">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2 text-primary font-bold">
                                            <Database size={20} weight="fill" />
                                            <span>Export Data</span>
                                        </div>
                                        <p className="text-xs text-text-muted mb-4">
                                            Download all your files and metadata in a decrypted ZIP bundle.
                                        </p>
                                    </div>
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        disabled={exporting}
                                        onClick={handleExportData}
                                        className="w-full bg-primary text-white text-xs font-bold px-4 py-2.5 rounded-xl hover:shadow-glow transition-all disabled:opacity-50"
                                    >
                                        {exporting ? 'Preparing zip...' : 'Export All Data (ZIP)'}
                                    </motion.button>
                                </div>

                                {/* Transparency Report Link */}
                                <div className="p-4 bg-primary/5 border border-primary/20 rounded-2xl flex flex-col justify-between h-full">
                                    <div>
                                        <div className="flex items-center gap-2 mb-2 text-text-main font-bold">
                                            <ShieldCheck size={20} weight="fill" className="text-blue-400" />
                                            <span>Transparency</span>
                                        </div>
                                        <p className="text-xs text-text-muted mb-4">
                                            View our SAR report detailing exactly what data we store.
                                        </p>
                                    </div>
                                    <motion.button
                                        whileHover={{ scale: 1.02 }}
                                        whileTap={{ scale: 0.98 }}
                                        onClick={() => setShowTransparencyModal(true)}
                                        className="w-full glass-button py-2.5 text-xs font-bold"
                                    >
                                        View Transparency Report
                                    </motion.button>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Danger Zone */}
                    <div className="glass-panel p-8 border-error/20 bg-error/5 relative overflow-hidden">
                        <div className="absolute top-0 right-0 w-64 h-64 bg-error/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2 pointer-events-none"></div>

                        <h3 className="text-xl font-bold text-error flex items-center gap-2 mb-6 relative z-10">
                            <Warning weight="fill" size={24} />
                            Danger Zone
                        </h3>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 relative z-10">
                            {/* Clear Cache */}
                            <div className="flex flex-col justify-between bg-error/5 rounded-2xl p-5 border border-error/10">
                                <div className="mb-4">
                                    <h4 className="font-bold text-text-main mb-1">Clear Local Cache</h4>
                                    <p className="text-xs text-text-muted">
                                        Removes keys and session data from this device.
                                    </p>
                                </div>
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={clearCache}
                                    className="w-full py-2.5 bg-error/10 text-error border border-error/20 rounded-xl text-sm font-bold hover:bg-error hover:text-white transition-colors"
                                >
                                    Clear Cache
                                </motion.button>
                            </div>

                            {/* Delete Account */}
                            <div className="flex flex-col justify-between bg-error/5 rounded-2xl p-5 border border-error/10">
                                <div className="mb-4">
                                    <h4 className="font-bold text-text-main mb-1">Delete Account</h4>
                                    <p className="text-xs text-text-muted">
                                        Permanently erases all data and identity.
                                    </p>
                                </div>
                                <motion.button
                                    whileHover={{ scale: 1.02 }}
                                    whileTap={{ scale: 0.98 }}
                                    onClick={() => setShowDeleteModal(true)}
                                    className="w-full py-2.5 bg-error/10 border border-error/30 text-error rounded-xl text-sm font-bold hover:bg-error hover:text-white transition-all relative z-10 mt-auto"
                                >
                                    Delete Account
                                </motion.button>
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

            {/* Transparency Report Modal */}
            <TransparencyModal
                isOpen={showTransparencyModal}
                onClose={() => setShowTransparencyModal(false)}
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

interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const TransparencyModal = ({ isOpen, onClose }: ModalProps) => {
    if (!isOpen) return null;

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
                className="w-full max-w-2xl bg-[#0f1115]/90 backdrop-blur-md rounded-3xl border border-white/10 shadow-2xl relative z-10 overflow-hidden flex flex-col max-h-[90vh]"
            >
                {/* Header */}
                <div className="p-6 border-b border-white/5 flex items-center justify-between shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg">
                            <ShieldCheck size={24} weight="duotone" />
                        </div>
                        <div>
                            <h2 className="text-xl font-bold text-text-main">Transparency Report</h2>
                            <p className="text-xs text-text-muted">Subject Access Request (SAR) Verification</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/5 rounded-full text-text-muted hover:text-text-main transition-colors"
                    >
                        ✕
                    </button>
                </div>

                {/* Scrollable Content */}
                <div className="p-0 overflow-y-auto custom-scrollbar">
                    <div className="px-6 py-4 bg-blue-500/5 border-b border-white/5">
                        <div className="flex items-start gap-3">
                            <Info size={20} className="text-blue-400 mt-0.5 shrink-0" weight="fill" />
                            <p className="text-sm text-text-muted leading-relaxed">
                                This report details exactly what data is visible to our servers versus what is encrypted client-side.
                                We operate on a <strong>Zero-Knowledge</strong> architecture, meaning we cannot access your files even if compelled by law.
                            </p>
                        </div>
                    </div>

                    <table className="w-full text-left text-sm border-collapse">
                        <thead>
                            <tr className="border-b border-white/5 bg-white/[0.02]">
                                <th className="px-6 py-4 font-bold text-text-muted w-1/2">Data Category</th>
                                <th className="px-6 py-4 font-bold text-text-muted w-1/2">Visibility to Nest</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-white/5">
                            <tr className="hover:bg-white/[0.02] transition-colors">
                                <td className="px-6 py-4 text-text-main font-medium">Account Email</td>
                                <td className="px-6 py-4 text-orange-400 font-bold uppercase text-xs tracking-wider flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-orange-400"></div>
                                    Plain Text
                                </td>
                            </tr>
                            <tr className="hover:bg-white/[0.02] transition-colors">
                                <td className="px-6 py-4 text-text-main font-medium">Billing & Quota</td>
                                <td className="px-6 py-4 text-orange-400 font-bold uppercase text-xs tracking-wider flex items-center gap-2">
                                    <div className="w-2 h-2 rounded-full bg-orange-400"></div>
                                    Plain Text
                                </td>
                            </tr>
                            <tr className="hover:bg-white/[0.02] transition-colors">
                                <td className="px-6 py-4 text-text-main font-medium">File & Folder Names</td>
                                <td className="px-6 py-4 text-emerald-400 font-bold uppercase text-xs tracking-wider flex items-center gap-2">
                                    <ShieldCheck size={14} weight="fill" />
                                    Encrypted
                                </td>
                            </tr>
                            <tr className="hover:bg-white/[0.02] transition-colors">
                                <td className="px-6 py-4 text-text-main font-medium">File Content (Blobs)</td>
                                <td className="px-6 py-4 text-emerald-400 font-bold uppercase text-xs tracking-wider flex items-center gap-2">
                                    <ShieldCheck size={14} weight="fill" />
                                    Encrypted
                                </td>
                            </tr>
                            <tr className="hover:bg-white/[0.02] transition-colors">
                                <td className="px-6 py-4 text-text-main font-medium">Vault Keys</td>
                                <td className="px-6 py-4 text-emerald-400 font-bold uppercase text-xs tracking-wider flex items-center gap-2">
                                    <ShieldCheck size={14} weight="fill" />
                                    Encrypted
                                </td>
                            </tr>
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-white/5 bg-black/20 flex justify-end shrink-0">
                    <button
                        onClick={onClose}
                        className="px-6 py-2.5 bg-white/10 hover:bg-white/20 text-text-main font-bold rounded-xl transition-all text-sm"
                    >
                        Close Report
                    </button>
                </div>
            </motion.div>
        </div>
    );
};

const AccountDeletionModal = ({ isOpen, onClose }: ModalProps) => {
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

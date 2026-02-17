import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
import {
    ShieldCheck,
    Key,
    Warning,
    CreditCard,
    Info,
    Broom,
    Trash,
    DownloadSimple,
    Eye,
    X,
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

// Theme constants from prototype
const COLORS = {
    primary: '#5D7285',
    secondary: '#8DA9C4',
    bg: '#F0F4F8',
    textMain: '#0F172A',
    textSub: '#475569',
    textFaint: '#94A3B8',
    danger: '#ef4444'
};

export const SettingsPage = () => {
    const { user, masterKey, metadata } = useAuth();
    const [quota, setQuota] = useState({ used: 0, quota: 2147483648, tier: 'free', percentage: 0 });
    const [showPasswordModal, setShowPasswordModal] = useState(false);
    const [showDeleteModal, setShowDeleteModal] = useState(false);
    const [showCancelWarning, setShowCancelWarning] = useState(false);
    const [exporting, setExporting] = useState(false);
    const [showTransparencyModal, setShowTransparencyModal] = useState(false);
    const { showToast } = useToast();

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
    const [syncAttempted, setSyncAttempted] = useState(false);

    useEffect(() => {
        const upgrade = searchParams.get('upgrade');
        const sessionId = searchParams.get('session_id');

        if (upgrade === 'success' && sessionId && !syncAttempted) {
            setSyncAttempted(true);

            const syncSubscription = async () => {
                try {
                    await billingAPI.syncSubscription(sessionId);
                    showToast('Upgraded to Pro! Enjoy your 100GB.', 'success');
                    const newQuota = await storageAPI.getQuota();
                    setQuota(newQuota);
                } catch (error) {
                    console.error('Sync failed:', error);
                    showToast('Subscription verification failed. Please contact support.', 'error');
                }
            };

            syncSubscription();
            setSearchParams({}, { replace: true });
        }
    }, [searchParams, syncAttempted, setSearchParams, showToast]);

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

            if (!user || (!masterKey && !localStorage.getItem('nest_master_key'))) {
                showToast('Encryption keys missing. Please re-login.', 'error');
                return;
            }

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
        <div className="flex-1 min-h-full font-sans antialiased text-[#0F172A] pb-20 relative">
            {/* Background Pattern */}
            <div className="absolute inset-0 z-0 pointer-events-none" style={{
                background: COLORS.bg,
                backgroundImage: `radial-gradient(circle at 10% 20%, rgba(170, 199, 216, 0.2) 0%, transparent 40%),
                                  radial-gradient(circle at 90% 80%, rgba(118, 138, 150, 0.15) 0%, transparent 40%)`,
                backgroundAttachment: 'fixed'
            }}></div>

            <div className="relative z-10 max-w-[680px] mx-auto px-8 py-14">

                {/* Page Title */}
                <div className="mb-10">
                    <h1 className="text-2xl font-extrabold tracking-tight mb-1">Settings</h1>
                    <p className="text-[#475569] text-sm">Manage your account, security and data.</p>
                </div>

                {/* ─── PROFILE ─── */}
                <div className="text-[11px] font-bold tracking-wider uppercase text-[#5D7285] opacity-70 mb-4">Profile</div>
                <div className="bg-white/65 backdrop-blur-md border border-slate-300/40 rounded-xl p-6 mb-10 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#5D7285] to-[#8DA9C4] flex items-center justify-center text-white font-bold text-lg shadow-sm">
                                {user?.email?.charAt(0).toUpperCase() || 'U'}
                            </div>
                            <div>
                                <p className="font-semibold text-sm">{user?.email}</p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* ─── SECURITY ─── */}
                <div className="text-[11px] font-bold tracking-wider uppercase text-[#5D7285] opacity-70 mb-4">Security</div>
                <div className="bg-white/65 backdrop-blur-md border border-slate-300/40 rounded-xl mb-10 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
                    {/* Password Row */}
                    <div className="flex items-center justify-between p-6 border-b border-slate-300/25">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-[#5D7285]/10 flex items-center justify-center text-[#5D7285]">
                                <Key size={16} weight="regular" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold">Password</p>
                                <p className="text-xs text-[#94A3B8]">Change your account password</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowPasswordModal(true)}
                            className="btn btn-fill text-xs"
                        >
                            Change
                        </button>
                    </div>

                    {/* Recovery Kit Row */}
                    <div className="flex items-center justify-between p-6">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600">
                                <Warning size={16} weight="regular" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold">Recovery Kit</p>
                                <p className="text-xs text-[#94A3B8]">Download your emergency backup key</p>
                            </div>
                        </div>
                        <button
                            onClick={() => window.location.href = '/recovery-setup'}
                            className="btn btn-fill text-xs"
                        >
                            Download
                        </button>
                    </div>
                </div>

                {/* ─── PLAN & STORAGE ─── */}
                <div className="text-[11px] font-bold tracking-wider uppercase text-[#5D7285] opacity-70 mb-4">Plan & Storage</div>
                <div className="bg-white/65 backdrop-blur-md border border-slate-300/40 rounded-xl p-6 mb-10 shadow-[0_1px_3px_rgba(0,0,0,0.04)]">
                    <div className="flex items-end justify-between mb-5">
                        <div>
                            <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-bold text-[#5D7285] bg-[#5D7285]/10 px-2 py-0.5 rounded uppercase">{quota.tier}</span>
                                <span className="text-xs text-[#94A3B8]">·</span>
                                <span className="text-xs text-[#94A3B8]">{formatBytes(quota.quota)} plan</span>
                            </div>
                            <p className="text-2xl font-extrabold tracking-tight">
                                {formatBytes(quota.used).split(' ')[0]} <span className="text-base font-semibold text-[#94A3B8]">{formatBytes(quota.used).split(' ')[1]} used</span>
                            </p>
                        </div>
                        <span className="text-xs font-semibold text-[#94A3B8]">
                            {quota.percentage < 0.1 && quota.used > 0 ? '< 0.1' : quota.percentage.toFixed(1)}%
                        </span>
                    </div>

                    {/* Progress Bar */}
                    <div className="h-2 bg-[#5D7285]/10 rounded-full overflow-hidden mb-6">
                        <div
                            className="h-full bg-gradient-to-r from-[#5D7285] to-[#8DA9C4] rounded-full transition-all duration-500"
                            style={{ width: `${Math.max(2, Math.min(quota.percentage, 100))}%` }}
                        ></div>
                    </div>

                    <div className="flex justify-end">
                        <button
                            onClick={async () => {
                                if (quota.used > FREE_TIER_QUOTA && quota.tier === 'free') {
                                    window.location.href = '/pricing';
                                } else {
                                    const { billingAPI } = await import('../api/billing');
                                    const { url } = await billingAPI.createPortalSession();
                                    window.location.href = url;
                                }
                            }}
                            className="btn btn-fill text-xs flex items-center gap-1.5"
                        >
                            <CreditCard size={14} weight="regular" />
                            Manage Billing
                        </button>
                    </div>
                </div>

                {/* ─── DATA & PRIVACY ─── */}
                <div className="text-[11px] font-bold tracking-wider uppercase text-[#5D7285] opacity-70 mb-4">Data & Privacy</div>
                <div className="bg-white/65 backdrop-blur-md border border-slate-300/40 rounded-xl mb-10 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
                    {/* Export Row */}
                    <div className="flex items-center justify-between p-6 border-b border-slate-300/25">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-[#5D7285]/10 flex items-center justify-center text-[#5D7285]">
                                <DownloadSimple size={16} weight="fill" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold">Export Data</p>
                                <p className="text-xs text-[#94A3B8]">Download all files & metadata as a ZIP</p>
                            </div>
                        </div>
                        <button
                            onClick={handleExportData}
                            disabled={exporting}
                            className="btn btn-fill text-xs"
                        >
                            {exporting ? 'Exporting...' : 'Export'}
                        </button>
                    </div>

                    {/* Transparency Report Row */}
                    <div className="flex items-center justify-between p-6">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-[#5D7285]/10 flex items-center justify-center text-[#5D7285]">
                                <Eye size={16} weight="fill" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold">Transparency Report</p>
                                <p className="text-xs text-[#94A3B8]">See exactly what Nest can and can't see</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowTransparencyModal(true)}
                            className="btn btn-fill text-xs"
                        >
                            View Report
                        </button>
                    </div>
                </div>

                {/* ─── DANGER ZONE ─── */}
                <div className="text-[11px] font-bold tracking-wider uppercase opacity-70 mb-4" style={{ color: COLORS.danger }}>Danger Zone</div>
                <div className="bg-white/65 backdrop-blur-md border border-red-200/40 rounded-xl mb-14 shadow-[0_1px_3px_rgba(0,0,0,0.04)] overflow-hidden">
                    {/* Clear Cache Row */}
                    <div className="flex items-center justify-between p-6 border-b border-slate-300/25">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-400">
                                <Broom size={16} weight="regular" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold">Clear Cache</p>
                                <p className="text-xs text-[#94A3B8]">Wipe local keys & sign out of this device</p>
                            </div>
                        </div>
                        <button
                            onClick={clearCache}
                            className="btn btn-fill text-xs"
                            style={{ background: COLORS.danger, boxShadow: '0 1px 3px rgba(239,68,68,0.3)' }}
                        >
                            Clear Cache
                        </button>
                    </div>

                    {/* Delete Account Row */}
                    <div className="flex items-center justify-between p-6">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 rounded-lg bg-red-50 flex items-center justify-center text-red-400">
                                <Trash size={16} weight="regular" />
                            </div>
                            <div>
                                <p className="text-sm font-semibold">Delete Account</p>
                                <p className="text-xs text-[#94A3B8]">Permanently erase all vault data & identity</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowDeleteModal(true)}
                            className="btn btn-fill text-xs"
                            style={{ background: COLORS.danger, boxShadow: '0 1px 3px rgba(239,68,68,0.3)' }}
                        >
                            Delete Account
                        </button>
                    </div>
                </div>
            </div>

            {/* Modals */}
            <PasswordChangeModal
                isOpen={showPasswordModal}
                onClose={() => setShowPasswordModal(false)}
                userEmail={user?.email || ''}
            />

            <AccountDeletionModal
                isOpen={showDeleteModal}
                onClose={() => setShowDeleteModal(false)}
            />

            <TransparencyModal
                isOpen={showTransparencyModal}
                onClose={() => setShowTransparencyModal(false)}
            />

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

            <style>{`
                .btn {
                    display: inline-flex;
                    align-items: center;
                    gap: 0.375rem;
                    padding: 0.4375rem 0.875rem;
                    border-radius: 0.5rem;
                    font-size: 0.8125rem;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all .15s;
                }
                .btn-fill {
                    background: ${COLORS.primary};
                    color: #fff;
                    border: none;
                    box-shadow: 0 1px 3px rgba(93, 114, 133, 0.25);
                }
                .btn-fill:hover {
                    background: #4a5e6d;
                }
            `}</style>
        </div>
    );
};


interface ModalProps {
    isOpen: boolean;
    onClose: () => void;
}

const TransparencyModal = ({ isOpen, onClose }: ModalProps) => {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4">
            <div onClick={onClose} className="absolute inset-0 bg-black/30 backdrop-blur-sm" />

            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative z-10 w-full max-w-lg bg-white rounded-xl border border-[#E2E8F0] shadow-xl overflow-hidden"
            >
                {/* Header */}
                <div className="p-6 pb-4 flex items-center justify-between border-b border-[#E2E8F0]">
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg bg-[#5D7285]/10 flex items-center justify-center text-[#5D7285]">
                            <ShieldCheck size={18} weight="fill" />
                        </div>
                        <div>
                            <h2 className="text-base font-bold text-[#0F172A]">Transparency Report</h2>
                            <p className="text-[11px] text-[#94A3B8]">Subject Access Request (SAR) Verification</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-slate-100 text-[#94A3B8] hover:text-[#0F172A] transition-colors">
                        <X size={14} />
                    </button>
                </div>

                {/* Info Banner */}
                <div className="mx-6 mt-5 p-3.5 bg-[#5D7285]/5 border border-[#5D7285]/10 rounded-lg flex items-start gap-2.5">
                    <Info size={16} weight="fill" className="text-[#5D7285] mt-0.5 shrink-0" />
                    <p className="text-xs text-[#475569] leading-relaxed">
                        This report details exactly what data is visible to our servers versus what is encrypted client-side.
                        We operate on a <strong className="text-[#0F172A]">Zero-Knowledge</strong> architecture, meaning we cannot access your files even if compelled by law.
                    </p>
                </div>

                {/* Table */}
                <div className="px-6 pt-5 pb-2">
                    <table className="w-full text-left text-sm">
                        <thead>
                            <tr className="border-b border-[#E2E8F0]">
                                <th className="pb-3 text-xs font-bold text-[#94A3B8] uppercase tracking-wider">Data Category</th>
                                <th className="pb-3 text-xs font-bold text-[#94A3B8] uppercase tracking-wider text-right">Visibility to Nest</th>
                            </tr>
                        </thead>
                        <tbody>
                            {[
                                { label: 'Account Email', type: 'plain' },
                                { label: 'Billing & Quota', type: 'plain' },
                                { label: 'File & Folder Names', type: 'encrypted' },
                                { label: 'File Content (Blobs)', type: 'encrypted' },
                                { label: 'Vault Keys', type: 'encrypted' }
                            ].map((row, i) => (
                                <tr key={i} className={i !== 4 ? "border-b border-[#E2E8F0]/50" : ""}>
                                    <td className="py-3 text-sm font-medium text-[#0F172A]">{row.label}</td>
                                    <td className="py-3 text-right">
                                        {row.type === 'plain' ? (
                                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#475569] bg-slate-100 px-2.5 py-1 rounded-full">
                                                <span className="w-1.5 h-1.5 rounded-full bg-[#94A3B8]"></span> Plain Text
                                            </span>
                                        ) : (
                                            <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#5D7285] bg-[#5D7285]/10 px-2.5 py-1 rounded-full">
                                                <ShieldCheck size={12} weight="fill" /> Encrypted
                                            </span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Footer */}
                <div className="p-5 border-t border-[#E2E8F0] flex justify-end">
                    <button onClick={onClose} className="btn btn-fill text-xs" style={{ background: COLORS.primary, color: 'white' }}>
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
    const { logout, user } = useAuth();

    if (!isOpen) return null;

    const handleDelete = async (e: React.FormEvent) => {
        e.preventDefault();
        setLoading(true);
        setError('');

        try {
            const { deriveRootKey, deriveAuthHash, fromBase64 } = await import('../crypto/v2');
            const { authAPI } = await import('../api/auth');

            if (!user?.email) throw new Error('User email not found');

            const saltData = await authAPI.getSalt(user.email);
            const salt = fromBase64(saltData.salt);
            const kdfParams = JSON.parse(saltData.kdfParams);

            const rootKey = await deriveRootKey(password, salt, kdfParams);
            const authHash = deriveAuthHash(rootKey);

            await authAPI.deleteAccount(authHash);
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
            <div onClick={onClose} className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
            <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="relative z-10 w-full max-w-md bg-white rounded-3xl p-8 shadow-2xl"
            >
                <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center text-red-500 mb-6 mx-auto">
                    <Warning size={32} weight="fill" />
                </div>

                <h2 className="text-2xl font-bold text-[#0F172A] text-center mb-2">Delete Account?</h2>
                <p className="text-[#475569] text-center text-sm mb-8 leading-relaxed">
                    This will permanently erase your encryption keys, folder structures, and scrub your identity from our systems. <strong>This action cannot be undone.</strong>
                </p>

                <form onSubmit={handleDelete} className="space-y-4">
                    <div>
                        <input
                            type="password"
                            required
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="Enter your password"
                            className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 text-sm"
                        />
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 text-red-600 rounded-xl text-xs font-medium text-center">
                            {error}
                        </div>
                    )}

                    <div className="flex gap-3 pt-2">
                        <button
                            type="button"
                            onClick={onClose}
                            className="flex-1 py-3 px-4 rounded-xl border border-slate-200 font-bold text-[#0F172A] hover:bg-slate-50 transition-all text-sm"
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            disabled={loading}
                            className="flex-1 py-3 px-4 rounded-xl bg-[#ef4444] text-white font-bold hover:bg-red-600 transition-all text-sm disabled:opacity-50"
                        >
                            {loading ? 'Deleting...' : 'Permanently Delete'}
                        </button>
                    </div>
                </form>
            </motion.div>
        </div>
    );
};

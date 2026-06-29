import { useState, useEffect } from 'react';
import { 
    Copy, Clock, DownloadSimple, X, GearSix, FileCsv, PaperPlaneTilt
} from '@phosphor-icons/react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../Modal';
import api from '../../lib/api';
import { deriveStandardLinkUrl } from '../../utils/shareUrl';
import clsx from 'clsx';
import QRCode from 'react-qr-code';
import nestLogo from '../../assets/nest-logo.png';

export interface ShareItem {
    id: number;
    type: 'standard_link' | 'drop_zone' | 'collab_folder';
    token: string;
    name?: string;
    custom_slug: string | null;
    size?: number;
    files_received?: number;
    has_password?: boolean;
    strict_mode?: boolean;
    expires_at: string | null;
    max_downloads?: number | null;
    views: number;
    downloads: number;
    status: string;
    created_at: string;
    collaborators?: string[];
    folder_id?: number;
}

export interface AuditLog {
    id: number;
    action: string;
    actor: string | null;
    filename: string | null;
    timestamp: string;
}

// ============================================================================
// COMPONENT: SHARE SETTINGS & AUDIT LOGS MODAL
// ============================================================================
interface SettingsProps {
    isOpen: boolean;
    onClose: () => void;
    share: ShareItem | null;
    onSuccess: () => void;
}
export const ShareSettingsModal = ({ isOpen, onClose, share, onSuccess }: SettingsProps) => {
    const { showToast } = useToast();
    const { masterKey, metadata } = useAuth();
    const [activeTab, setActiveTab] = useState<'settings' | 'audit'>('settings');
    const [submitting, setSubmitting] = useState(false);
    const [regeneratedUrl, setRegeneratedUrl] = useState<string | null>(null);

    // Form inputs state
    const [customSlug, setCustomSlug] = useState('');
    const [requirePin, setRequirePin] = useState(false);
    const [pin, setPin] = useState('');
    const [uploadNotifications, setUploadNotifications] = useState(true);
    const [expiresAt, setExpiresAt] = useState('');
    const [strictMode, setStrictMode] = useState(false);
    const [expandedQR, setExpandedQR] = useState<{ isOpen: boolean; url: string }>({ isOpen: false, url: '' });

    // For standard file links, the decryption key lives ONLY in the URL fragment
    // (never stored server-side). Re-derive it client-side so the displayed link and
    // QR code are complete and actually work — mirroring the row "copy" action.
    const [standardFullUrl, setStandardFullUrl] = useState<string | null>(null);
    const [derivingUrl, setDerivingUrl] = useState(false);

    // Emails state (Collab only)
    const [emailInput, setEmailInput] = useState('');
    const [emails, setEmails] = useState<string[]>([]);

    // Audit logs state
    const [logs, setLogs] = useState<AuditLog[]>([]);
    const [loadingLogs, setLoadingLogs] = useState(false);

    useEffect(() => {
        if (isOpen && share) {
            setActiveTab('settings');
            setCustomSlug(share.custom_slug || '');
            setRequirePin(share.has_password || false);
            setPin('');
            setUploadNotifications(true);
            setStrictMode(share.strict_mode || false);
            
            // Format expiry timestamp for datetime-local input
            if (share.expires_at) {
                const date = new Date(share.expires_at);
                const offset = date.getTimezoneOffset();
                const localDate = new Date(date.getTime() - (offset*60*1000));
                setExpiresAt(localDate.toISOString().slice(0, 16));
            } else {
                setExpiresAt('');
            }

            if (share.type === 'collab_folder') {
                setEmails(share.collaborators || []);
            } else {
                setEmails([]);
            }
        }
    }, [isOpen, share]);

    // Re-derive the full standard-link URL (with #key fragment) whenever the modal
    // opens for a standard file share. Same derivation as SharedLinksPage's copy action.
    useEffect(() => {
        let cancelled = false;
        setStandardFullUrl(null);
        if (!isOpen || !share || share.type !== 'standard_link' || !masterKey) {
            setDerivingUrl(false);
            return;
        }
        setDerivingUrl(true);
        (async () => {
            try {
                const url = await deriveStandardLinkUrl(share, masterKey, metadata);
                if (!cancelled) setStandardFullUrl(url);
            } catch (e) {
                console.error('Failed to reconstruct standard share URL in settings:', e);
            } finally {
                if (!cancelled) setDerivingUrl(false);
            }
        })();
        return () => { cancelled = true; };
    }, [isOpen, share, masterKey, metadata]);

    // Calculate dynamic share URL. Standard links need the re-derived #key fragment;
    // collab uses the regenerated lk fragment; drop zones need no key.
    const baseShareUrl = share
        ? share.type === 'drop_zone'
            ? `${window.location.origin}/dz/${share.custom_slug || share.token}`
            : share.type === 'collab_folder'
                ? `${window.location.origin}/collab/${share.custom_slug || share.token}`
                : `${window.location.origin}/s/${share.custom_slug || share.token}`
        : '';
    const shareUrl = regeneratedUrl
        || (share?.type === 'standard_link' ? (standardFullUrl || baseShareUrl) : baseShareUrl);

    const handleRegenerateLink = async () => {
        if (!share || share.type !== 'collab_folder' || !masterKey) return;
        setSubmitting(true);
        try {
            const res = await api.get(`/collab-folders/${share.id}/host-key`);
            const { host_encrypted_collab_key, host_collab_key_nonce } = res.data;

            const { decryptCollabKey, generateLinkKey, encryptCollabKeyForLink, fromBase64, toBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();

            const collabKey = decryptCollabKey(fromBase64(host_encrypted_collab_key), fromBase64(host_collab_key_nonce), masterKey);

            const newLinkKey = generateLinkKey();
            const { encrypted: newLinkEncrypted, nonce: newLinkNonce } = encryptCollabKeyForLink(collabKey, newLinkKey);

            await api.patch(`/collab-folders/${share.id}/link-key`, {
                link_encrypted_collab_key: toBase64(newLinkEncrypted),
                link_collab_key_nonce: toBase64(newLinkNonce)
            });

            const linkKeyBase64url = toBase64(newLinkKey).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
            const url = `${window.location.origin}/collab/${share.custom_slug || share.token}#lk=${linkKeyBase64url}`;
            setRegeneratedUrl(url);
            showToast('Link regenerated successfully', 'success');
        } catch (err) {
            console.error('Failed to regenerate link:', err);
            showToast('Failed to regenerate link', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    // Open the host's own mail client with the regenerated collab link. The #lk key
    // is reconstructed client-side and never reaches our server — stays zero-knowledge.
    const handleEmailInvite = () => {
        if (!regeneratedUrl) return;
        const folder = share?.name?.trim() || 'a shared folder';
        const subject = `You have been invited to collaborate on "${folder}" in Nest`;
        const body =
            `Hi,\n\n` +
            `You have been invited to collaborate on the secure folder "${folder}" in Nest.\n\n` +
            `Open this link to access it. It contains your private decryption key, so keep it safe and do not forward it:\n` +
            `${regeneratedUrl}\n\n` +
            `The first time you open it you will be asked to verify your email with a one time code.\n\n` +
            `Thanks`;
        window.location.href = `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    };

    const handleDownloadQR = () => {
        const svg = document.getElementById("share-qr-code");
        if (!svg) return;
        const svgData = new XMLSerializer().serializeToString(svg);
        const canvas = document.createElement("canvas");
        const ctx = canvas.getContext("2d");
        
        const qrImg = new Image();
        const logoImg = new Image();
        
        let loaded = 0;
        const onImageLoad = () => {
            loaded++;
            if (loaded === 2) {
                const padding = 40;
                const qrSize = 300;
                const logoSize = 40;
                const cardWidth = qrSize + (padding * 2);
                const cardHeight = qrSize + (padding * 2) + 110;
                
                canvas.width = cardWidth;
                canvas.height = cardHeight;
                
                if (ctx) {
                    // Draw Card Background
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(0, 0, cardWidth, cardHeight);
                    
                    // Draw Top Nest Logo
                    ctx.drawImage(logoImg, (cardWidth - logoSize) / 2, padding / 1.5, logoSize, logoSize);
                    
                    // Draw Title Text
                    ctx.fillStyle = "#0A0A0A";
                    ctx.font = "bold 22px system-ui, -apple-system, sans-serif";
                    ctx.textAlign = "center";
                    const titleText = share?.type === 'drop_zone' ? 'Nest Drop Zone' : share?.type === 'collab_folder' ? 'Nest Collab Folder' : 'Nest Shared Resource';
                    ctx.fillText(titleText, cardWidth / 2, padding + logoSize + 10);
                    
                    // Draw QR Code Background (in case of transparency issues)
                    ctx.fillStyle = "#ffffff";
                    ctx.fillRect(padding, padding + logoSize + 30, qrSize, qrSize);
                    // Draw QR Code
                    ctx.drawImage(qrImg, padding, padding + logoSize + 30, qrSize, qrSize);
                    
                    // Draw Subtitle / Share Name
                    ctx.fillStyle = "#666666";
                    ctx.font = "16px system-ui, -apple-system, sans-serif";
                    ctx.textAlign = "center";
                    const nameStr = share?.name || 'Scan to access files';
                    ctx.fillText(nameStr.length > 35 ? nameStr.substring(0, 32) + '...' : nameStr, cardWidth / 2, cardHeight - 25);
                }
                
                const a = document.createElement("a");
                a.download = `Nest_QR_${share?.name?.replace(/[^a-zA-Z0-9]/g, '_') || 'Share'}.png`;
                a.href = canvas.toDataURL("image/png", 1.0);
                a.click();
            }
        };

        qrImg.onload = onImageLoad;
        logoImg.onload = onImageLoad;
        
        qrImg.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svgData)));
        logoImg.src = nestLogo;
    };

    // Fetch Audit Logs when tab is clicked
    useEffect(() => {
        if (isOpen && share && activeTab === 'audit') {
            const fetchLogs = async () => {
                setLoadingLogs(true);
                try {
                    let res;
                    if (share.type === 'standard_link') {
                        res = await api.get(`/shares/${share.id}/audit-log`);
                    } else if (share.type === 'drop_zone') {
                        res = await api.get(`/drop-zones/${share.id}/audit-log`);
                    } else if (share.type === 'collab_folder') {
                        res = await api.get(`/collab-folders/${share.id}/audit-log`);
                    }
                    if (res && res.data && res.data.success) {
                        setLogs(res.data.logs || []);
                    }
                } catch (error) {
                    console.error('Failed to load audit logs:', error);
                    showToast('Failed to retrieve audit logs', 'error');
                } finally {
                    setLoadingLogs(false);
                }
            };
            fetchLogs();
        }
    }, [isOpen, share, activeTab]);

    const handleAddEmail = (e?: React.KeyboardEvent) => {
        if (e && e.key !== 'Enter' && e.key !== ',') return;
        if (e) e.preventDefault();

        const clean = emailInput.trim().toLowerCase().replace(/,/g, '');
        if (!clean) return;
        
        if (!clean.includes('@') || clean.length < 5) {
            showToast('Invalid email address', 'warning');
            return;
        }

        if (emails.includes(clean)) {
            showToast('Email already added', 'warning');
            return;
        }

        setEmails([...emails, clean]);
        setEmailInput('');
    };

    const handleRemoveEmail = (email: string) => {
        setEmails(emails.filter(e => e !== email));
    };

    const handleUpdate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!share) return;
        setSubmitting(true);

        try {
            const payload: any = {
                custom_slug: customSlug.trim() || null,
                expires_at: expiresAt ? new Date(expiresAt).toISOString() : null
            };

            if (share.type === 'standard_link') {
                payload.password = requirePin ? (pin || undefined) : null;
                // Wait! For files, does the route expect PATCH /files/:id/share?
                // Let's check files.ts lines 629: router.patch('/:id/share')
                await api.patch(`/files/${share.id}/share`, payload);
            } else if (share.type === 'drop_zone') {
                payload.require_pin = requirePin;
                payload.pin = requirePin ? (pin || undefined) : null;
                payload.upload_notifications = uploadNotifications;
                await api.patch(`/drop-zones/${share.id}`, payload);
            } else if (share.type === 'collab_folder') {
                payload.require_pin = requirePin;
                payload.pin = requirePin ? (pin || undefined) : null;
                payload.strict_mode = strictMode;
                
                let finalEmails = [...emails];
                const cleanInput = emailInput.trim().toLowerCase().replace(/,/g, '');
                if (cleanInput && cleanInput.includes('@') && cleanInput.length >= 5 && !finalEmails.includes(cleanInput)) {
                    finalEmails.push(cleanInput);
                }
                payload.emails = finalEmails;
                await api.patch(`/collab-folders/${share.id}`, payload);
            }

            showToast('Share link settings updated successfully.', 'success');
            onSuccess();
        } catch (error) {
            console.error('Update share settings failed:', error);
            showToast('Failed to update share settings', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleExportCSV = async () => {
        if (!share) return;
        try {
            let res;
            const config = { responseType: 'blob' as const };
            if (share.type === 'standard_link') {
                res = await api.get(`/shares/${share.id}/audit-log?format=csv`, config);
            } else if (share.type === 'drop_zone') {
                res = await api.get(`/drop-zones/${share.id}/audit-log?format=csv`, config);
            } else if (share.type === 'collab_folder') {
                res = await api.get(`/collab-folders/${share.id}/audit-log?format=csv`, config);
            }

            if (res && res.data) {
                const blob = new Blob([res.data], { type: 'text/csv' });
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${share.type}_log_${share.id}.csv`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                showToast('Audit log exported as CSV!', 'success');
            }
        } catch (error) {
            console.error('CSV export failed:', error);
            showToast('Failed to export audit log', 'error');
        }
    };

    if (!share) return null;

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title={`${share.name || `Folder ${share.id}`} Settings`}
            maxWidth="max-w-xl"
        >
            {/* Tabs */}
            <div className="flex border-b border-border mb-4">
                <button
                    onClick={() => setActiveTab('settings')}
                    className={clsx(
                        "flex-1 py-2.5 text-sm font-semibold border-b-2 transition-all flex items-center justify-center gap-1.5",
                        activeTab === 'settings'
                            ? "border-primary text-primary"
                            : "border-transparent text-text-muted hover:text-text-main"
                    )}
                >
                    <GearSix size={18} />
                    <span>Configure Settings</span>
                </button>
                <button
                    onClick={() => setActiveTab('audit')}
                    className={clsx(
                        "flex-1 py-2.5 text-sm font-semibold border-b-2 transition-all flex items-center justify-center gap-1.5",
                        activeTab === 'audit'
                            ? "border-primary text-primary"
                            : "border-transparent text-text-muted hover:text-text-main"
                    )}
                >
                    <Clock size={18} />
                    <span>Audit Logs</span>
                </button>
            </div>

            {activeTab === 'settings' ? (
                <form onSubmit={handleUpdate} className="flex flex-col gap-4">
                    {/* Expiry & Custom Slug */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-text-muted block mb-1">Expiry Date / Time</label>
                            <input
                                type="datetime-local"
                                value={expiresAt}
                                onChange={(e) => setExpiresAt(e.target.value)}
                                className="w-full bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary/50"
                            />
                        </div>

                        <div>
                            <label className="text-xs font-bold text-text-muted block mb-1">Custom Link Name</label>
                            <input
                                type="text"
                                placeholder="e.g. custom-slug"
                                value={customSlug}
                                onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                                className="w-full bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary/50"
                            />
                        </div>
                    </div>

                    {/* PIN / Password Gate */}
                    <div className="border border-border/40 rounded-xl p-3 bg-black/5 flex items-center justify-between">
                        <div>
                            <span className="text-sm font-semibold text-text-main block">
                                {share.type === 'standard_link' ? 'Password Protection' : 'PIN Protection'}
                            </span>
                            <span className="text-xs text-text-muted">Require guest verification before access</span>
                        </div>
                        <input
                            type="checkbox"
                            checked={requirePin}
                            onChange={(e) => setRequirePin(e.target.checked)}
                            className="w-4 h-4 rounded text-primary focus:ring-primary/40 cursor-pointer"
                        />
                    </div>

                    {requirePin && (
                        <div className="animate-in slide-in-from-top-2 duration-200">
                            <label className="text-xs font-bold text-text-muted block mb-1">
                                New {share.type === 'standard_link' ? 'Password' : 'PIN'} (Leave blank to keep current)
                            </label>
                            <input
                                type="password"
                                placeholder={`Enter secure ${share.type === 'standard_link' ? 'password' : 'PIN'}`}
                                value={pin}
                                onChange={(e) => setPin(e.target.value)}
                                className="w-full bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary/50"
                            />
                        </div>
                    )}

                    {/* Specific Collab Settings */}
                    {share.type === 'collab_folder' && (
                        <div className="flex flex-col gap-4 border-t border-border/40 pt-4">
                            <div className="border border-border/40 rounded-xl p-3 bg-black/5 flex items-center justify-between">
                                <div>
                                    <span className="text-sm font-semibold text-text-main block">Strict Mode</span>
                                    <span className="text-xs text-text-muted">Require collaborators to sign up for a Nest account</span>
                                </div>
                                <input
                                    type="checkbox"
                                    checked={strictMode}
                                    onChange={(e) => setStrictMode(e.target.checked)}
                                    className="w-4 h-4 rounded text-primary focus:ring-primary/40 cursor-pointer"
                                />
                            </div>

                            <div>
                                <label className="text-xs font-bold text-text-muted block mb-1">Manage Collaborators</label>
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        placeholder="Add collaborator email"
                                        value={emailInput}
                                        onChange={(e) => setEmailInput(e.target.value)}
                                        onKeyDown={handleAddEmail}
                                        className="flex-1 bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary/50"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handleAddEmail()}
                                        className="px-3 py-2 bg-primary text-white rounded-xl text-xs font-bold hover:bg-primary/80 transition-colors"
                                    >
                                        Add
                                    </button>
                                </div>

                                {/* Chips list */}
                                {emails.length > 0 && (
                                    <div className="flex flex-wrap gap-1.5 mt-2 bg-black/5 border border-border/40 p-2.5 rounded-xl max-h-24 overflow-y-auto custom-scrollbar">
                                        {emails.map(email => (
                                            <div
                                                key={email}
                                                className="inline-flex items-center gap-1 bg-white/60 border border-white/80 rounded-lg px-2 py-0.5 text-xs text-text-main font-medium shadow-sm"
                                            >
                                                <span>{email}</span>
                                                <button
                                                    type="button"
                                                    onClick={() => handleRemoveEmail(email)}
                                                    className="text-text-muted hover:text-error transition-colors"
                                                >
                                                    <X size={12} weight="bold" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>

                            <div className="border border-error/20 bg-error/5 rounded-xl p-3 flex flex-col gap-2 mt-2">
                                <div>
                                    <span className="text-sm font-semibold text-error block">Regenerate Link Key</span>
                                    <span className="text-xs text-text-muted mt-1 block">
                                        Lost the original link? You can generate a new one. <strong>Warning:</strong> Generating a new link will permanently break the previous link for any new users. Existing collaborators who have already joined will not be affected.
                                    </span>
                                </div>
                                {regeneratedUrl ? (
                                    <>
                                        <div className="flex w-full gap-2 mt-2">
                                            <input
                                                type="text"
                                                readOnly
                                                value={regeneratedUrl}
                                                className="flex-1 bg-white border border-border/40 rounded-lg px-2.5 py-1.5 text-xs text-text-main focus:outline-none"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    navigator.clipboard.writeText(regeneratedUrl);
                                                    showToast('Link copied!', 'success');
                                                }}
                                                className="bg-primary hover:bg-primary/80 text-white rounded-lg p-2 text-xs flex items-center justify-center transition-colors"
                                            >
                                                <Copy size={16} />
                                            </button>
                                        </div>
                                        {emails.length > 0 && (
                                            <button
                                                type="button"
                                                onClick={handleEmailInvite}
                                                className="w-full mt-2 flex items-center justify-center gap-2 bg-primary/10 text-primary border border-primary/20 rounded-lg py-2 text-xs font-semibold hover:bg-primary/15 transition-colors"
                                            >
                                                <PaperPlaneTilt size={14} weight="bold" />
                                                Email new link to {emails.length > 1 ? `${emails.length} collaborators` : 'collaborator'}
                                            </button>
                                        )}
                                    </>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={handleRegenerateLink}
                                        disabled={submitting}
                                        className="px-3 py-2 bg-error text-white rounded-xl text-xs font-bold hover:bg-error/80 transition-colors w-max disabled:opacity-50 mt-2"
                                    >
                                        {submitting ? 'Regenerating...' : 'Regenerate Link'}
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Specific Drop Zone Settings */}
                    {share.type === 'drop_zone' && (
                        <div className="border border-border/40 rounded-xl p-3 bg-black/5 flex items-center justify-between">
                            <div>
                                <span className="text-sm font-semibold text-text-main block">Notifications</span>
                                <span className="text-xs text-text-muted">Receive alerts on new uploads</span>
                            </div>
                            <input
                                type="checkbox"
                                checked={uploadNotifications}
                                onChange={(e) => setUploadNotifications(e.target.checked)}
                                className="w-4 h-4 rounded text-primary focus:ring-primary/40 cursor-pointer"
                            />
                        </div>
                    )}

                    {/* Shareable URL and QR Code */}
                    <div className="flex flex-col sm:flex-row gap-4 border-t border-border/40 pt-4">
                        <div className="flex-1 flex flex-col gap-2">
                            <label className="text-xs font-bold text-text-muted block mb-1">Shareable Link</label>
                            
                            {share.type === 'collab_folder' && !regeneratedUrl && (
                                <div className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 font-medium">
                                    ⚠️ The full link (with decryption key) is not stored on our servers. This URL is incomplete. If you lost the original link, please <strong>Regenerate Link Key</strong> above to get a new one.
                                </div>
                            )}

                            {share.type === 'standard_link' && !standardFullUrl && derivingUrl && (
                                <div className="text-[11px] text-text-muted bg-black/5 border border-border/40 rounded-lg p-2 font-medium">
                                    Generating secure link with decryption key…
                                </div>
                            )}
                            {share.type === 'standard_link' && !standardFullUrl && !derivingUrl && (
                                <div className="text-[11px] text-amber-600 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2 font-medium">
                                    ⚠️ Couldn't rebuild the secure link (decryption key). The URL below is incomplete — close and reopen this dialog, or copy the link from the share row.
                                </div>
                            )}

                            <input
                                type="text"
                                readOnly
                                value={shareUrl}
                                className={clsx(
                                    "w-full bg-black/5 rounded-xl border px-3 py-2 text-xs focus:outline-none",
                                    (share.type === 'collab_folder' && !regeneratedUrl) || (share.type === 'standard_link' && !standardFullUrl) ? "text-text-muted/50 border-amber-500/30" : "text-text-main border-white/20"
                                )}
                                onClick={(e) => e.currentTarget.select()}
                            />
                        </div>
                        <div className="flex flex-col items-center">
                            <span className="text-[10px] font-bold text-slate-500 uppercase mb-1">QR Code</span>
                            {(share.type === 'collab_folder' && !regeneratedUrl) || (share.type === 'standard_link' && !standardFullUrl) ? (
                                // The decryption key isn't stored server-side, so a static URL is
                                // incomplete — don't present a scannable QR of a broken link.
                                <div
                                    className="bg-black/5 rounded-lg border border-amber-500/30 flex items-center justify-center text-center p-1.5"
                                    style={{ width: 76, height: 76 }}
                                    title="The full link with its decryption key is needed to produce a working QR code"
                                >
                                    <span className="text-[9px] text-text-muted/60 font-medium leading-tight px-1">
                                        {share.type === 'standard_link' ? (derivingUrl ? 'Generating QR…' : 'Link key unavailable') : 'Regenerate link for QR'}
                                    </span>
                                </div>
                            ) : (
                                <button
                                    type="button"
                                    onClick={() => setExpandedQR({ isOpen: true, url: shareUrl })}
                                    className="bg-white p-1.5 rounded-lg shadow-sm border border-border/40 hover:scale-105 transition-transform"
                                    title="Click to enlarge and download"
                                >
                                    <QRCode value={shareUrl} size={64} />
                                </button>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-4 border-t border-border pt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 border border-border text-text-main rounded-xl hover:bg-card transition-colors text-sm font-semibold"
                            disabled={submitting}
                        >
                            Cancel
                        </button>
                        <button
                            type="submit"
                            className="px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/80 transition-colors text-sm font-semibold"
                            disabled={submitting}
                        >
                            {submitting ? 'Saving...' : 'Save Settings'}
                        </button>
                    </div>
                </form>
            ) : (
                <div className="flex flex-col gap-4">
                    <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-text-muted font-bold">Activity history inside this share object</span>
                        <button
                            type="button"
                            onClick={handleExportCSV}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold text-text-main bg-white/40 border border-white/60 hover:bg-white/80 rounded-xl transition-all shadow-sm"
                        >
                            <FileCsv size={16} className="text-emerald-700" />
                            <span>Export CSV</span>
                        </button>
                    </div>

                    <div className="border border-border/40 rounded-xl overflow-hidden max-h-80 overflow-y-auto custom-scrollbar">
                        {loadingLogs ? (
                            <div className="h-40 flex items-center justify-center">
                                <div className="w-6 h-6 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                            </div>
                        ) : logs.length === 0 ? (
                            <div className="h-40 flex flex-col items-center justify-center text-center p-4">
                                <span className="text-text-muted font-semibold text-sm">No activity recorded yet.</span>
                                <span className="text-xs text-text-muted/60 mt-0.5">Logs will automatically populate as recipients view or download.</span>
                            </div>
                        ) : (
                            <table className="w-full text-left text-xs border-collapse">
                                <thead>
                                    <tr className="bg-black/5 text-[10px] font-bold text-text-muted uppercase tracking-wider border-b border-border/40">
                                        <th className="p-3">Action</th>
                                        <th className="p-3">Actor</th>
                                        <th className="p-3">Filename / Detail</th>
                                        <th className="p-3">Timestamp</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {logs.map((log) => (
                                        <tr key={log.id} className="border-b border-border/20 hover:bg-black/[0.02] transition-colors">
                                            <td className="p-3 font-semibold capitalize text-primary">
                                                {log.action.replace('_', ' ')}
                                            </td>
                                            <td className="p-3 text-text-main font-medium">
                                                {log.actor || 'Anonymous'}
                                            </td>
                                            <td className="p-3 text-text-muted truncate max-w-xs" title={log.filename || ''}>
                                                {log.filename || '-'}
                                            </td>
                                            <td className="p-3 text-text-muted/80">
                                                {new Date(log.timestamp).toLocaleString()}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    <div className="flex justify-end mt-4">
                        <button
                            type="button"
                            onClick={onClose}
                            className="px-4 py-2 bg-slate-900 text-white rounded-xl hover:bg-slate-800 transition-colors text-sm font-semibold"
                        >
                            Done
                        </button>
                    </div>
                </div>
            )}

            {/* Expanded QR Code Modal */}
            <Modal
                isOpen={expandedQR.isOpen}
                onClose={() => setExpandedQR({ isOpen: false, url: '' })}
                title="Share QR Code"
                maxWidth="max-w-sm"
            >
                <div className="flex flex-col items-center gap-6 py-4">
                    <div className="bg-white p-4 rounded-2xl shadow-sm border border-border/20">
                        <QRCode id="share-qr-code" value={expandedQR.url} size={250} />
                    </div>
                    <button
                        onClick={handleDownloadQR}
                        className="w-full py-3 bg-primary text-white rounded-xl font-semibold hover:bg-primary/90 transition-colors flex items-center justify-center gap-2"
                    >
                        <DownloadSimple size={20} weight="bold" />
                        Download QR Code
                    </button>
                </div>
            </Modal>

        </Modal>
    );
};

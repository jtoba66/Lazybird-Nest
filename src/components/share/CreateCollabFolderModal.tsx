import { useState, useEffect } from 'react';
import clsx from 'clsx';
import { X, CheckCircle, Copy, PaperPlaneTilt } from '@phosphor-icons/react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../Modal';
import api from '../../lib/api';

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

// ============================================================================
// COMPONENT: CREATE COLLAB FOLDER MODAL
// ============================================================================
interface CreateCollabProps {
    isOpen: boolean;
    onClose: () => void;
    createZKFolder: (name: string) => Promise<number>;
    onSuccess: () => void;
}
export const CreateCollabFolderModal = ({ isOpen, onClose, createZKFolder, onSuccess }: CreateCollabProps) => {
    const { showToast } = useToast();
    const { masterKey } = useAuth();
    const [step, setStep] = useState(1);
    const [name, setName] = useState('');
    const [emailInput, setEmailInput] = useState('');
    const [emails, setEmails] = useState<string[]>([]);
    
    // Settings state
    const [requirePin, setRequirePin] = useState(false);
    const [pin, setPin] = useState('');
    const [strictMode, setStrictMode] = useState(false);
    const [activityNotifications, setActivityNotifications] = useState(true);
    const [customSlug, setCustomSlug] = useState('');
    const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
    const [submitting, setSubmitting] = useState(false);

    // Result state
    const [resultUrl, setResultUrl] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setStep(1);
            setName('');
            setEmailInput('');
            setEmails([]);
            setRequirePin(false);
            setPin('');
            setStrictMode(false);
            setActivityNotifications(true);
            setCustomSlug('');
            setSlugAvailable(null);
            setResultUrl('');
        }
    }, [isOpen]);

    // Custom Slug check
    useEffect(() => {
        if (!customSlug.trim()) {
            setSlugAvailable(null);
            return;
        }
        const check = async () => {
            try {
                const res = await api.get(`/shares/slug-check?slug=${customSlug}`);
                setSlugAvailable(res.data.available);
            } catch {
                setSlugAvailable(false);
            }
        };
        const timer = setTimeout(check, 500);
        return () => clearTimeout(timer);
    }, [customSlug]);

    const handleAddEmail = (e?: React.KeyboardEvent) => {
        if (e && e.key !== 'Enter' && e.key !== ',') return;
        if (e) e.preventDefault();

        const clean = emailInput.trim().toLowerCase().replace(/,/g, '');
        if (!clean) return;
        
        // Basic check
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

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        
        let finalEmails = [...emails];
        const cleanInput = emailInput.trim().toLowerCase().replace(/,/g, '');
        if (cleanInput && cleanInput.includes('@') && cleanInput.length >= 5 && !finalEmails.includes(cleanInput)) {
            finalEmails.push(cleanInput);
        }

        if (!name.trim()) return showToast('Please enter a name', 'warning');
        if (finalEmails.length === 0) return showToast('Please add at least one collaborator email', 'warning');
        if (requirePin && !pin) return showToast('Please enter a PIN', 'warning');
        if (customSlug && slugAvailable === false) return showToast('Custom link name not available', 'warning');

        setSubmitting(true);
        try {
            // 1. Provision folder in private vault
            const folderName = name.trim();
            const folderId = await createZKFolder(folderName);

            // 2. Generate ZK sharing keys
            const { generateCollabKey, encryptCollabKeyForHost, generateLinkKey, encryptCollabKeyForLink, toBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();
            if (!masterKey) throw new Error('Master key missing');

            const collabKey = generateCollabKey();
            const encryptedHost = encryptCollabKeyForHost(collabKey, masterKey);
            const linkKey = generateLinkKey();
            const encryptedLink = encryptCollabKeyForLink(collabKey, linkKey);

            // 3. Create collab on server
            const payload = {
                name: name.trim(),
                emails: finalEmails,
                folder_id: folderId,
                host_encrypted_collab_key: toBase64(encryptedHost.encrypted),
                host_collab_key_nonce: toBase64(encryptedHost.nonce),
                link_encrypted_collab_key: toBase64(encryptedLink.encrypted),
                link_collab_key_nonce: toBase64(encryptedLink.nonce),
                require_pin: requirePin,
                pin: requirePin ? pin : undefined,
                strict_mode: strictMode,
                activity_notifications: activityNotifications,
                custom_slug: customSlug ? customSlug.trim() : undefined
            };

            const response = await api.post('/collab-folders', payload);
            if (response.data && response.data.success) {
                // Link includes linkKey fragment encoded as base64url
                const linkKeyBase64url = toBase64(linkKey).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
                const finalSlug = customSlug ? customSlug.trim() : response.data.token;
                const shareUrl = `${window.location.origin}/collab/${finalSlug}#lk=${linkKeyBase64url}`;
                setResultUrl(shareUrl);
                setStep(2);
                showToast('Collab Folder created successfully!', 'success');
            }
        } catch (error) {
            console.error('Create Collab Folder failed:', error);
            showToast('Failed to create Collab Folder', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(resultUrl);
        showToast('Collaboration Link copied!', 'success');
    };

    // Open the host's own mail client with a pre-filled invite. The link (with its
    // #lk decryption key) is built client-side and never passes through our server,
    // so this stays zero-knowledge — same as the host emailing it manually.
    const handleEmailInvite = () => {
        const folder = name.trim() || 'a shared folder';
        const subject = `You have been invited to collaborate on "${folder}" in Nest`;
        const body =
            `Hi,\n\n` +
            `You have been invited to collaborate on the secure folder "${folder}" in Nest.\n\n` +
            `Open this link to access it. It contains your private decryption key, so keep it safe and do not forward it:\n` +
            `${resultUrl}\n\n` +
            `The first time you open it you will be asked to verify your email with a one time code.\n\n` +
            `Thanks`;
        window.location.href = `mailto:${emails.join(',')}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Collab Folder">
            {step === 1 ? (
                <form onSubmit={handleCreate} className="flex flex-col gap-4">
                    <div>
                        <label className="text-xs font-bold text-text-muted block mb-1">Folder Name</label>
                        <input
                            type="text"
                            placeholder="e.g. Acme Marketing Sync"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary/50"
                            required
                        />
                    </div>

                    <div>
                        <label className="text-xs font-bold text-text-muted block mb-1">Add Collaborators</label>
                        <div className="flex gap-2">
                            <input
                                type="text"
                                placeholder="Enter guest email and press enter"
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

                        {/* Email chips list */}
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

                    <div className="border border-border/40 rounded-xl p-3 bg-black/5 flex items-center justify-between">
                        <div>
                            <span className="text-sm font-semibold text-text-main block">PIN Protection</span>
                            <span className="text-xs text-text-muted">Require guest verification before uploads</span>
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
                            <label className="text-xs font-bold text-text-muted block mb-1">Folder PIN</label>
                            <input
                                type="password"
                                placeholder="Enter secure PIN"
                                value={pin}
                                onChange={(e) => setPin(e.target.value)}
                                className="w-full bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary/50"
                                required
                            />
                        </div>
                    )}

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

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-bold text-text-muted block mb-1">Notifications</label>
                            <select
                                value={activityNotifications ? 'yes' : 'no'}
                                onChange={(e) => setActivityNotifications(e.target.value === 'yes')}
                                className="w-full bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none"
                            >
                                <option value="yes">Notify on Activity</option>
                                <option value="no">Mute Notifications</option>
                            </select>
                        </div>

                        <div>
                            <div className="flex justify-between items-center mb-1">
                                <label className="text-xs font-bold text-text-muted">Custom Link Name (Optional)</label>
                            </div>
                            <input
                                type="text"
                                placeholder="e.g. acme-collab"
                                value={customSlug}
                                onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                                className={clsx(
                                    "w-full bg-black/5 rounded-xl border px-3 py-2 text-sm text-text-main focus:outline-none",
                                    customSlug && slugAvailable === false
                                        ? "border-error/50 focus:border-error/50"
                                        : customSlug && slugAvailable === true
                                            ? "border-emerald-500/50 focus:border-emerald-500/50"
                                            : "border-white/20 focus:border-primary/50"
                                )}
                            />
                            {customSlug.trim() && slugAvailable !== null && (
                                <p className={clsx(
                                    "text-[11px] font-medium mt-1",
                                    slugAvailable ? "text-emerald-600" : "text-error"
                                )}>
                                    {slugAvailable ? '✓ This link name is available' : '✗ This link name is already taken'}
                                </p>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 mt-4">
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
                            disabled={submitting || (!!customSlug && slugAvailable === false)}
                        >
                            {submitting ? 'Creating...' : 'Create Folder'}
                        </button>
                    </div>
                </form>
            ) : (
                <div className="flex flex-col items-center gap-4 text-center">
                    <CheckCircle size={48} className="text-emerald-500" weight="fill" />
                    <div>
                        <h3 className="font-bold text-text-main text-lg">Collab Folder Created!</h3>
                        <p className="text-xs text-text-muted mt-1 leading-normal max-w-sm">
                            Approved guests can now authenticate via OTP, access the files workspace, rename files, and upload new documents securely.
                        </p>
                    </div>

                    <div className="w-full bg-black/5 border border-border/40 rounded-xl p-3 flex flex-col items-center gap-2">
                        <span className="text-[10px] font-bold text-text-muted uppercase">Collaboration Link</span>
                        <div className="flex w-full gap-2">
                            <input
                                type="text"
                                readOnly
                                value={resultUrl}
                                className="flex-1 bg-white/60 border border-white/40 rounded-lg px-2.5 py-1.5 text-xs text-text-main focus:outline-none"
                            />
                            <button
                                onClick={handleCopy}
                                className="bg-primary hover:bg-primary/80 text-white rounded-lg p-2 text-xs flex items-center justify-center transition-colors"
                            >
                                <Copy size={16} />
                            </button>
                        </div>
                        <span className="block text-xs leading-snug text-amber-700 bg-amber-500/10 border border-amber-500/20 font-medium mt-2 px-3 py-2 rounded-lg">
                            ⚠️ This link contains the ephemeral decryption key. Save it immediately! It will not be shown again and the 'Copy' button in the dashboard is disabled for security.
                        </span>
                    </div>

                    {emails.length > 0 && (
                        <div className="w-full">
                            <button
                                onClick={handleEmailInvite}
                                className="w-full mt-2 flex items-center justify-center gap-2 bg-primary/10 text-primary border border-primary/20 rounded-xl py-2.5 text-sm font-semibold hover:bg-primary/15 transition-colors"
                            >
                                <PaperPlaneTilt size={16} weight="bold" />
                                Email invite to {emails.length > 1 ? `${emails.length} collaborators` : 'collaborator'}
                            </button>
                            <p className="text-[11px] text-text-muted mt-1.5 leading-snug">
                                Opens your email app with a pre-filled invite and the secure link. The key stays in your email, never on our servers.
                            </p>
                        </div>
                    )}

                    <button
                        onClick={onSuccess}
                        className="w-full mt-2 bg-slate-900 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-800 transition-colors"
                    >
                        Done
                    </button>
                </div>
            )}
        </Modal>
    );
};

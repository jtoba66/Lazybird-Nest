import { useState, useEffect } from 'react';
import { 
    Copy, CheckCircle
} from '@phosphor-icons/react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import { Modal } from '../Modal';
import api from '../../lib/api';
import clsx from 'clsx';
import QRCode from 'react-qr-code';

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
// COMPONENT: CREATE DROP ZONE MODAL
// ============================================================================
interface CreateDzProps {
    isOpen: boolean;
    onClose: () => void;
    createZKFolder: (name: string) => Promise<number>;
    onSuccess: () => void;
}
export const CreateDropZoneModal = ({ isOpen, onClose, createZKFolder, onSuccess }: CreateDzProps) => {
    const { showToast } = useToast();
    const { masterKey } = useAuth();
    const [step, setStep] = useState(1);
    const [name, setName] = useState('');
    const [requirePin, setRequirePin] = useState(false);
    const [pin, setPin] = useState('');
    const [uploadNotifications, setUploadNotifications] = useState(true);
    const [expiry, setExpiry] = useState<string>('never');
    const [customSlug, setCustomSlug] = useState('');
    const [slugAvailable, setSlugAvailable] = useState<boolean | null>(null);
    const [submitting, setSubmitting] = useState(false);
    
    // Result state
    const [resultUrl, setResultUrl] = useState('');

    useEffect(() => {
        if (!isOpen) {
            setStep(1);
            setName('');
            setRequirePin(false);
            setPin('');
            setUploadNotifications(true);
            setExpiry('never');
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

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!name.trim()) return showToast('Please enter a name', 'warning');
        if (requirePin && !pin) return showToast('Please enter a PIN', 'warning');
        if (customSlug && slugAvailable === false) return showToast('Custom link name not available', 'warning');
        
        setSubmitting(true);
        try {
            // 1. Provision folder in private vault
            const folderName = name.trim();
            const folderId = await createZKFolder(folderName);

            // 2. Generate Drop Zone asymmetric keys
            const { generateDropZoneKeyPair, encryptDropPrivateKey, toBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();
            if (!masterKey) throw new Error('Master key missing');

            const keyPair = generateDropZoneKeyPair();
            const encryptedPrivate = encryptDropPrivateKey(keyPair.privateKey, masterKey);

            // Calculate expiry
            let expiresAt: string | null = null;
            if (expiry === '24h') expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
            if (expiry === '7d') expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
            if (expiry === '30d') expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

            // 3. Create on server
            const payload = {
                name: name.trim(),
                folder_id: folderId,
                require_pin: requirePin,
                pin: requirePin ? pin : undefined,
                upload_notifications: uploadNotifications,
                expires_at: expiresAt,
                custom_slug: customSlug ? customSlug.trim() : undefined,
                drop_public_key: toBase64(keyPair.publicKey),
                encrypted_drop_private_key: toBase64(encryptedPrivate.encrypted),
                drop_private_key_nonce: toBase64(encryptedPrivate.nonce)
            };

            const response = await api.post('/drop-zones', payload);
            if (response.data && response.data.success) {
                const finalSlug = customSlug ? customSlug.trim() : response.data.token;
                setResultUrl(`${window.location.origin}/dz/${finalSlug}`);
                setStep(2);
                showToast('Drop Zone created successfully!', 'success');
            }
        } catch (error) {
            console.error('Create drop zone failed:', error);
            showToast('Failed to create Drop Zone', 'error');
        } finally {
            setSubmitting(false);
        }
    };

    const handleCopy = () => {
        navigator.clipboard.writeText(resultUrl);
        showToast('Drop Zone URL copied!', 'success');
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title="Create Drop Zone">
            {step === 1 ? (
                <form onSubmit={handleCreate} className="flex flex-col gap-4">
                    <div>
                        <label className="text-xs font-bold text-text-muted block mb-1">Drop Zone Name</label>
                        <input
                            type="text"
                            placeholder="e.g. Acme Project Assets"
                            value={name}
                            onChange={(e) => setName(e.target.value)}
                            className="w-full bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary/50"
                            required
                        />
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
                            <label className="text-xs font-bold text-text-muted block mb-1">Upload PIN</label>
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

                    <div className="grid grid-cols-2 gap-3">
                        <div>
                            <label className="text-xs font-bold text-text-muted block mb-1">Auto-Expiry</label>
                            <select
                                value={expiry}
                                onChange={(e) => setExpiry(e.target.value)}
                                className="w-full bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none"
                            >
                                <option value="never">Never</option>
                                <option value="24h">24 Hours</option>
                                <option value="7d">7 Days</option>
                                <option value="30d">30 Days</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs font-bold text-text-muted block mb-1">Notifications</label>
                            <select
                                value={uploadNotifications ? 'yes' : 'no'}
                                onChange={(e) => setUploadNotifications(e.target.value === 'yes')}
                                className="w-full bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none"
                            >
                                <option value="yes">Notify on Upload</option>
                                <option value="no">Mute Notifications</option>
                            </select>
                        </div>
                    </div>

                    <div>
                        <div className="flex justify-between items-center mb-1">
                            <label className="text-xs font-bold text-text-muted">Custom Link Name (Optional)</label>
                            {customSlug && (
                                <span className={clsx(
                                    "text-[10px] font-bold",
                                    slugAvailable === true && "text-emerald-600",
                                    slugAvailable === false && "text-error",
                                    slugAvailable === null && "text-text-muted"
                                )}>
                                    {slugAvailable === true && 'Available'}
                                    {slugAvailable === false && 'Already taken'}
                                    {slugAvailable === null && 'Checking...'}
                                </span>
                            )}
                        </div>
                        <input
                            type="text"
                            placeholder="e.g. acme-drop"
                            value={customSlug}
                            onChange={(e) => setCustomSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-_]/g, ''))}
                            className="w-full bg-black/5 rounded-xl border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none focus:border-primary/50"
                        />
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
                            {submitting ? 'Creating...' : 'Create Drop Zone'}
                        </button>
                    </div>
                </form>
            ) : (
                <div className="flex flex-col items-center gap-4 text-center">
                    <CheckCircle size={48} className="text-emerald-500" weight="fill" />
                    <div>
                        <h3 className="font-bold text-text-main text-lg">Drop Zone Created!</h3>
                        <p className="text-xs text-text-muted mt-1 leading-normal max-w-sm">
                            Anonymous guests can now securely upload files directly to your vault. Files will remain write-only and encrypted.
                        </p>
                    </div>

                    <div className="w-full bg-black/5 border border-border/40 rounded-xl p-3 flex flex-col items-center gap-2">
                        <span className="text-[10px] font-bold text-text-muted uppercase">Shareable Link</span>
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
                    </div>

                    {/* QR Code */}
                    <div className="bg-white border border-border/40 p-4 rounded-xl shadow-sm flex flex-col items-center gap-3">
                        <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">QR Code</span>
                        <QRCode value={resultUrl} size={150} />
                    </div>

                    <button
                        onClick={onSuccess}
                        className="w-full mt-4 bg-slate-900 text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-slate-800 transition-colors"
                    >
                        Done
                    </button>
                </div>
            )}
        </Modal>
    );
};

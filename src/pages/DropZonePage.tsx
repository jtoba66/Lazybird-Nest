import { useState, useEffect, useRef } from 'react';
import { useParams } from 'react-router-dom';
import API_BASE_URL from '../config/api';
import { motion } from 'framer-motion';
import {
    UploadSimple,
    Lock,
    CheckCircle,
    Warning,
    Prohibit
} from '@phosphor-icons/react';
import { fromBase64, toBase64, init as initCrypto, encryptFileForDropZone } from '@lazybird-inc/nest-crypto';
import sodium from 'libsodium-wrappers';
import logoImg from '../assets/nest-logo.png';
import { useToast } from '../contexts/ToastContext';

// Custom Unique Icon Component - Protected Prism
const ProtectedPrism = () => (
    <div className="relative w-28 h-28 flex items-center justify-center mx-auto mb-2">
        <img src={logoImg} alt="Nest Logo" className="relative z-10 w-16 h-16 object-contain" />

        {/* Outer Rotating Shield Ring 1 */}
        <motion.div
            className="absolute inset-0"
            animate={{ rotate: 360 }}
            transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
        >
            <svg width="112" height="112" viewBox="0 0 96 96" fill="none" className="opacity-50">
                <circle cx="48" cy="48" r="46" className="stroke-white/10" strokeWidth="1" strokeDasharray="4 6" />
                <circle cx="48" cy="2" r="3" className="fill-white shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
                <circle cx="48" cy="94" r="3" className="fill-white shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
            </svg>
        </motion.div>

        {/* Counter-Rotating Shield Ring 2 */}
        <motion.div
            className="absolute inset-0"
            animate={{ rotate: -360 }}
            transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
        >
            <svg width="112" height="112" viewBox="0 0 96 96" fill="none" className="opacity-70">
                <path d="M48 8A40 40 0 0 1 88 48" className="stroke-primary/40" strokeWidth="1.5" strokeLinecap="round" />
                <path d="M48 88A40 40 0 0 1 8 48" className="stroke-primary/40" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
        </motion.div>
    </div>
);

export const DropZonePage = () => {
    const { token } = useParams<{ token: string }>();
    const { showToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [deadState, setDeadState] = useState<'revoked' | 'expired' | null>(null);
    const [pinRequired, setPinRequired] = useState(false);
    const [pin, setPin] = useState('');
    const [pinError, setPinError] = useState('');
    const [sessionToken, setSessionToken] = useState<string | null>(null);
    
    // Drop zone information
    const [dropZoneName, setDropZoneName] = useState('');
    const [dropPublicKey, setDropPublicKey] = useState<Uint8Array | null>(null);

    // Upload state
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadSuccess, setUploadSuccess] = useState(false);
    const [dragging, setDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const cached = sessionStorage.getItem(`dz_session_${token}`);
        if (cached) {
            setSessionToken(cached);
        }
    }, [token]);

    useEffect(() => {
        loadDropZone();
    }, [token, sessionToken]);

    const loadDropZone = async () => {
        if (!token) return;
        try {
            const headers: HeadersInit = {};
            if (sessionToken) {
                headers['x-dz-session'] = sessionToken;
            }

            const response = await fetch(`${API_BASE_URL}/drop-zones/${token}`, { headers });
            
            if (response.status === 401) {
                setPinRequired(true);
                setLoading(false);
                return;
            }

            if (response.status === 410) {
                const data = await response.json();
                if (data.expired) setDeadState('expired');
                else setDeadState('revoked');
                setLoading(false);
                return;
            }

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Drop Zone not found');
            }

            const data = await response.json();
            setDropZoneName(data.name);
            await initCrypto();
            setDropPublicKey(fromBase64(data.drop_public_key));
            setPinRequired(false);
            setLoading(false);
        } catch (err: any) {
            setError(err.message || 'Failed to load Drop Zone');
            setLoading(false);
        }
    };

    const handleVerifyPin = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!pin || !token) return;
        setPinError('');

        try {
            const response = await fetch(`${API_BASE_URL}/drop-zones/${token}/verify-pin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Incorrect PIN. Please try again.');
            }

            const data = await response.json();
            if (data.success && data.session_token) {
                sessionStorage.setItem(`dz_session_${token}`, data.session_token);
                setSessionToken(data.session_token);
            }
        } catch (err: any) {
            setPinError(err.message || 'Incorrect PIN. Please try again.');
        }
    };

    const encryptStringAsymmetric = async (text: string, publicKey: Uint8Array): Promise<string> => {
        await sodium.ready;
        const textBytes = sodium.from_string(text);
        const encrypted = (sodium as any).crypto_box_seal(textBytes, publicKey);
        return toBase64(encrypted);
    };

    const handleUploadFile = async (file: File) => {
        if (!dropPublicKey || !token) return;
        setUploading(true);
        setUploadProgress(0);
        setUploadSuccess(false);

        try {
            // 1. Initialize crypto & load file bytes
            await initCrypto();
            const fileBytes = new Uint8Array(await file.arrayBuffer());

            // 2. Encrypt file using Drop Zone public key
            // This returns: encryptedFile (Uint8Array), encryptedFileKey (Uint8Array), fileKeyNonce (Uint8Array)
            const encryptedData = encryptFileForDropZone(fileBytes, dropPublicKey);

            // 3. Encrypt filename and mime-type using dropPublicKey (sealed box)
            const encryptedFilename = await encryptStringAsymmetric(file.name, dropPublicKey!);
            const encryptedMimeType = await encryptStringAsymmetric(file.type || 'application/octet-stream', dropPublicKey!);

            // 4. Create multipart form data
            const formData = new FormData();
            const encryptedFileBlob = new Blob([encryptedData.encryptedFile as any], { type: 'application/octet-stream' });
            formData.append('file', encryptedFileBlob, 'encrypted-payload');
            formData.append('encrypted_file_key', toBase64(encryptedData.encryptedFileKey));
            formData.append('file_key_nonce', toBase64(encryptedData.fileKeyNonce));
            formData.append('file_size', file.size.toString());
            formData.append('encrypted_filename', encryptedFilename);
            formData.append('encrypted_mime_type', encryptedMimeType);

            // 5. Upload via XHR for progress tracking
            const xhr = new XMLHttpRequest();
            xhr.open('POST', `${API_BASE_URL}/drop-zones/${token}/upload`);
            
            if (sessionToken) {
                xhr.setRequestHeader('x-dz-session', sessionToken);
            }

            xhr.upload.onprogress = (event) => {
                if (event.lengthComputable) {
                    const percentComplete = Math.round((event.loaded / event.total) * 100);
                    setUploadProgress(percentComplete);
                }
            };

            const uploadPromise = new Promise<void>((resolve, reject) => {
                xhr.onload = () => {
                    if (xhr.status >= 200 && xhr.status < 300) {
                        resolve();
                    } else {
                        try {
                            const resData = JSON.parse(xhr.responseText);
                            const errorObj: any = new Error(resData.error || 'Upload failed');
                            errorObj.status = xhr.status;
                            reject(errorObj);
                        } catch {
                            const errorObj: any = new Error(`Upload failed with status ${xhr.status}`);
                            errorObj.status = xhr.status;
                            reject(errorObj);
                        }
                    }
                };
                xhr.onerror = () => reject(new Error('Network error during upload'));
                xhr.onabort = () => reject(new Error('Upload aborted'));
            });

            xhr.send(formData);
            await uploadPromise;

            setUploadSuccess(true);
            showToast('File received securely!', 'success');
        } catch (err: any) {
            console.error('[DZ-UPLOAD] Error:', err);
            showToast(err.message || 'Failed to upload file', 'error');
            if (err.status === 401) {
                setPinRequired(true);
            }
        } finally {
            setUploading(false);
        }
    };

    // Upload every selected/dropped file sequentially. The page shares a single
    // `uploading`/`uploadProgress` state, so files must be awaited one at a time
    // rather than fired concurrently (which would clobber the progress display).
    const uploadFilesSequentially = async (fileList: FileList) => {
        for (const file of Array.from(fileList)) {
            await handleUploadFile(file);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            uploadFilesSequentially(e.target.files);
            e.target.value = ''; // reset so re-selecting the same file fires onChange
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(true);
    };

    const handleDragLeave = () => {
        setDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            uploadFilesSequentially(e.dataTransfer.files);
        }
    };

    const triggerFilePicker = () => {
        fileInputRef.current?.click();
    };

    // Render loading state
    if (loading) {
        return (
            <div className="min-h-screen flex items-center justify-center bg-background">
                <div className="w-10 h-10 border-2 border-primary border-t-transparent rounded-full animate-spin"></div>
            </div>
        );
    }

    // Render error state
    if (error) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 relative overflow-hidden bg-background">
                <div className="glass-panel p-8 max-w-md w-full text-center flex flex-col items-center gap-4">
                    <Warning size={48} className="text-error" />
                    <h2 className="text-xl font-bold text-text-main">Error Loading Drop Zone</h2>
                    <p className="text-text-muted text-sm leading-relaxed">{error}</p>
                </div>
            </div>
        );
    }

    // Render dead links (revoked/expired)
    if (deadState) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 relative overflow-hidden bg-background">
                {/* Background Gradients */}
                <div className="absolute top-0 left-0 right-0 h-full overflow-hidden -z-10 pointer-events-none">
                    <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[100px]" />
                    <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/5 rounded-full blur-[100px]" />
                </div>
                
                <div className="glass-panel p-8 max-w-md w-full text-center flex flex-col items-center gap-5">
                    <div className="w-16 h-16 rounded-full bg-error/10 flex items-center justify-center">
                        <Prohibit size={32} className="text-error" />
                    </div>
                    <div>
                        <h2 className="text-2xl font-bold text-text-main tracking-tight">
                            {deadState === 'expired' ? 'Link Expired' : 'Link Revoked'}
                        </h2>
                        <p className="text-text-muted text-sm mt-2 leading-relaxed">
                            {deadState === 'expired'
                                ? 'This secure upload link has expired and is no longer accepting files.'
                                : 'This secure upload link has been revoked by the owner.'}
                        </p>
                    </div>
                    <div className="text-xs text-text-muted mt-2">
                        Powered by <span className="font-semibold text-primary">Nest</span>
                    </div>
                </div>
            </div>
        );
    }

    // Render PIN gate
    if (pinRequired) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 relative overflow-hidden bg-background">
                {/* Background Gradients */}
                <div className="absolute top-0 left-0 right-0 h-full overflow-hidden -z-10 pointer-events-none">
                    <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[100px]" />
                    <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/5 rounded-full blur-[100px]" />
                </div>

                <div className="w-full max-w-md">
                    <div className="text-center mb-8">
                        <ProtectedPrism />
                        <h1 className="text-2xl font-bold text-text-main tracking-tight">PIN Verification Required</h1>
                        <p className="text-text-muted text-sm mt-1">Please enter the access PIN to upload files</p>
                    </div>

                    <div className="glass-panel p-8 border-white/60 shadow-xl">
                        <form onSubmit={handleVerifyPin} className="space-y-6">
                            <div>
                                <label className="block text-sm font-bold text-text-main mb-2">
                                    Access PIN
                                </label>
                                <div className="relative group">
                                    <Lock
                                        size={20}
                                        className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors"
                                    />
                                    <input
                                        type="password"
                                        value={pin}
                                        onChange={(e) => setPin(e.target.value)}
                                        className="w-full glass-input pl-12 bg-white/50 focus:bg-white text-center tracking-widest text-lg font-bold"
                                        placeholder="••••"
                                        required
                                    />
                                </div>
                            </div>

                            {pinError && (
                                <div className="bg-error/10 border border-error/20 text-error rounded-xl p-4 text-sm font-medium">
                                    {pinError}
                                </div>
                            )}

                            <button
                                type="submit"
                                className="glass-button w-full py-3.5 text-base font-bold flex items-center justify-center gap-2 shadow-xl hover:shadow-2xl"
                            >
                                Verify PIN
                            </button>
                        </form>
                    </div>
                </div>
            </div>
        );
    }

    // Render public upload page
    return (
        <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-background">
            {/* Background Gradients */}
            <div className="absolute top-0 left-0 right-0 h-full overflow-hidden -z-10 pointer-events-none">
                <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[100px]" />
                <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/5 rounded-full blur-[100px]" />
            </div>

            <div className="w-full max-w-lg">
                <div className="text-center mb-6">
                    <ProtectedPrism />
                    <h1 className="text-2xl sm:text-3xl font-bold text-text-main tracking-tight">{dropZoneName}</h1>
                    <p className="text-text-muted text-xs sm:text-sm mt-1">
                        Securely upload files directly into this encrypted vault
                    </p>
                </div>

                <div className="glass-panel p-6 sm:p-8 md:p-10 border-white/60 shadow-xl">
                    {uploadSuccess ? (
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            className="text-center flex flex-col items-center gap-5 py-4"
                        >
                            <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center">
                                <CheckCircle size={40} className="text-emerald-500" weight="fill" />
                            </div>
                            <div>
                                <h3 className="font-bold text-text-main text-xl">File Deposited Securely</h3>
                                <p className="text-xs text-text-muted mt-2 leading-relaxed max-w-sm">
                                    Your file has been encrypted client-side and uploaded. You may close this window or upload another file.
                                </p>
                            </div>
                            <div className="w-full flex flex-col gap-3 mt-4">
                                <button
                                    onClick={() => setUploadSuccess(false)}
                                    className="glass-button w-full py-3 font-semibold"
                                >
                                    Upload Another File
                                </button>
                                <a
                                    href="/signup"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="w-full py-3 font-semibold text-primary hover:text-primary/80 transition-colors border-2 border-primary/20 hover:border-primary/40 rounded-xl flex items-center justify-center"
                                >
                                    Get your free Nest account
                                </a>
                            </div>
                        </motion.div>
                    ) : uploading ? (
                        <div className="flex flex-col items-center gap-6 py-6">
                            <div className="w-14 h-14 rounded-full border-2 border-primary border-t-transparent animate-spin flex items-center justify-center">
                                <UploadSimple size={24} className="text-primary animate-pulse" />
                            </div>
                            <div className="w-full text-center">
                                <span className="text-sm font-semibold text-text-main block mb-1">Encrypting & Depositing File...</span>
                                <span className="text-xs text-text-muted">{uploadProgress}% uploaded</span>
                                <div className="w-full bg-black/5 rounded-full h-1.5 mt-3 overflow-hidden">
                                    <div
                                        className="bg-primary h-1.5 rounded-full transition-all duration-300"
                                        style={{ width: `${uploadProgress}%` }}
                                    ></div>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={triggerFilePicker}
                            className={`border-2 border-dashed rounded-2xl p-8 sm:p-12 text-center cursor-pointer flex flex-col items-center gap-4 transition-all ${
                                dragging
                                    ? 'border-primary bg-primary/5 scale-[0.99] shadow-inner'
                                    : 'border-border/60 hover:border-primary/50 hover:bg-white/10'
                            }`}
                        >
                            <input
                                type="file"
                                multiple
                                ref={fileInputRef}
                                onChange={handleFileChange}
                                className="hidden"
                            />
                            <div className="w-14 h-14 rounded-full bg-primary/5 flex items-center justify-center text-primary group-hover:scale-105 transition-transform duration-300">
                                <UploadSimple size={28} />
                            </div>
                            <div>
                                <span className="text-sm sm:text-base font-bold text-text-main block">
                                    Drag & drop file here
                                </span>
                                <span className="text-xs text-text-muted mt-1 block">
                                    or click to browse from device
                                </span>
                            </div>
                            <div className="text-[10px] text-text-muted bg-white/20 border border-white/40 rounded-full px-3 py-1 font-medium mt-2">
                                Write-Only Secure Deposit &bull; Max 10GB
                            </div>
                        </div>
                    )}
                </div>

                <div className="text-center text-text-muted text-xs mt-6 flex items-center justify-center gap-2">
                    <span>Powered by <span className="font-semibold text-primary">Nest</span></span>
                </div>
            </div>
        </div>
    );
};

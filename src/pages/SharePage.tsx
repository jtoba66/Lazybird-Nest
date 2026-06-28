import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API_BASE_URL from '../config/api';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import {
    Download,
    File,
    Image,
    FilmStrip,
    MusicNotes,
    FileText,
    Lock,
    Warning,
    Clock,
    XCircle,
    Prohibit
} from '@phosphor-icons/react';
import { fromBase64, init as initCrypto } from '@lazybird-inc/nest-crypto';
import { StreamingDownloader } from '../utils/StreamingDownloader';
import nestLogo from '../assets/nest-logo.png';
import { useToast } from '../contexts/ToastContext';

// Custom Unique Icon Component - Protected Prism
const ProtectedPrism = () => (
    <div className="relative w-28 h-28 flex items-center justify-center">
        <img src={nestLogo} alt="Nest Logo" className="relative z-10 w-16 h-16 object-contain" />

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

export const SharePage = () => {
    const { shareToken } = useParams<{ shareToken: string }>();
    const navigate = useNavigate();
    const { showToast } = useToast();

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [deadState, setDeadState] = useState<'revoked' | 'expired' | 'limit_reached' | null>(null);
    const [passwordRequired, setPasswordRequired] = useState(false);
    const [password, setPassword] = useState('');
    const [passwordError, setPasswordError] = useState('');
    
    // Auth JWT token for password protected shares
    const [passwordToken, setPasswordToken] = useState<string | null>(null);

    const [fileInfo, setFileInfo] = useState<any>(null);
    const [downloading, setDownloading] = useState(false);
    const [fileKey, setFileKey] = useState<Uint8Array | null>(null);
    const [filename, setFilename] = useState('');
    const [mimeType, setMimeType] = useState('application/octet-stream');
    const [downloadProgress, setDownloadProgress] = useState(0);

    // Mouse interactive lighting
    const mouseX = useMotionValue(0);
    const mouseY = useMotionValue(0);

    const springConfig = { damping: 25, stiffness: 150 };
    const dx = useSpring(mouseX, springConfig);
    const dy = useSpring(mouseY, springConfig);

    const shineX = useTransform(dx, [0, 400], ["0%", "100%"]);
    const shineY = useTransform(dy, [0, 600], ["0%", "100%"]);

    useEffect(() => {
        // Retrieve cached password token if available
        const cached = sessionStorage.getItem(`pw_token_${shareToken}`);
        if (cached) {
            setPasswordToken(cached);
        }
    }, [shareToken]);

    useEffect(() => {
        loadShareLink();
    }, [shareToken, passwordToken]);

    const loadShareLink = async () => {
        if (!shareToken) return;
        try {
            await initCrypto();
            const hash = window.location.hash.substring(1);
            if (!hash) {
                setError('Invalid share link - missing decryption key');
                setLoading(false);
                return;
            }

            const params = new URLSearchParams(hash);
            const fileKeyBase64 = params.get('key');
            const filenameFromUrl = params.get('name') || 'download';
            const mimeFromUrl = params.get('mime') || 'application/octet-stream';

            if (!fileKeyBase64) {
                setError('Invalid share link - missing encryption key');
                setLoading(false);
                return;
            }

            const sanitizedKey = fileKeyBase64.replace(/ /g, '+');
            const key = fromBase64(sanitizedKey);
            setFileKey(key);
            setFilename(filenameFromUrl);
            setMimeType(mimeFromUrl);

            // Fetch public file share info
            const headers: HeadersInit = {};
            if (passwordToken) {
                headers['Authorization'] = `Bearer ${passwordToken}`;
            }

            const response = await fetch(`${API_BASE_URL}/shares/s/${shareToken}`, { headers });
            
            if (response.status === 401) {
                setPasswordRequired(true);
                setLoading(false);
                return;
            }

            if (response.status === 410) {
                const data = await response.json();
                if (data.expired) setDeadState('expired');
                else if (data.limit_reached) setDeadState('limit_reached');
                else setDeadState('revoked');
                setLoading(false);
                return;
            }

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Share link not found');
            }

            const data = await response.json();
            setFileInfo(data);
            setPasswordRequired(false);
            setLoading(false);
        } catch (err: any) {
            setError(err.message || 'Failed to load share link');
            setLoading(false);
        }
    };

    const handleVerifyPassword = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!password) return;
        setPasswordError('');

        try {
            const response = await fetch(`${API_BASE_URL}/shares/s/${shareToken}/verify-password`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ password })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Incorrect password. Please try again.');
            }

            const data = await response.json();
            if (data.success && data.token) {
                sessionStorage.setItem(`pw_token_${shareToken}`, data.token);
                setPasswordToken(data.token);
            }
        } catch (err: any) {
            setPasswordError(err.message || 'Incorrect password. Please try again.');
        }
    };

    const handleDownload = async () => {
        if (!fileKey || !fileInfo) return;
        setDownloading(true);
        setDownloadProgress(0);

        try {
            if (!fileInfo.is_chunked) {
                // Fallback for non-chunked files (legacy)
                let blob: Blob | null = null;

                // Attempt Direct Gateway Download if verified
                if (fileInfo.is_gateway_verified) {
                    try {
                        console.log('[SharePage] 🚀 Attempting Direct Gateway Download...');
                        const controller = new AbortController();
                        const timeoutId = setTimeout(() => controller.abort(), 5000);

                        const res = await fetch(`https://gateway.lazybird.io/file/${fileInfo.merkle_hash}`, {
                            signal: controller.signal
                        });
                        clearTimeout(timeoutId);

                        if (res.ok) {
                            blob = await res.blob();
                            console.log('[SharePage] ✅ Gateway Download Successful');
                        }
                    } catch (e) {
                        console.warn('[SharePage] ⚠️ Gateway failed, falling back to Server Proxy:', e);
                    }
                }

                // Server Proxy Download (Auto-Hydration)
                if (!blob) {
                    console.log('[SharePage] 🔄 Attempting Server Proxy Download...');
                    // Send the password token via Authorization header (not query param)
                    // to keep it out of server/proxy logs and browser history. The server
                    // still accepts the legacy ?token= form, so existing links keep working.
                    const url = `${API_BASE_URL}/shares/s/${shareToken}/raw`;
                    const res = await fetch(url, passwordToken ? { headers: { Authorization: `Bearer ${passwordToken}` } } : undefined);
                    if (!res.ok) {
                        const errText = await res.text();
                        throw new Error(`Download failed: ${errText || res.statusText}`);
                    }
                    blob = await res.blob();
                    console.log('[SharePage] ✅ Server Proxy Download Successful');
                }

                const { decryptFile, init } = await import('@lazybird-inc/nest-crypto');
                await init();
                const decryptedBytes = await decryptFile(blob!, null, fileKey);

                const fileBlob = new Blob([decryptedBytes as any], { type: mimeType });
                const url = window.URL.createObjectURL(fileBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } else {
                // V3 Streaming Download (Zero-Memory)
                await StreamingDownloader.download({
                    shareToken: shareToken!,
                    authToken: passwordToken || undefined,
                    fileKey,
                    filename,
                    chunks: fileInfo.chunks,
                    isGatewayVerified: fileInfo.is_gateway_verified,
                    onProgress: (p) => setDownloadProgress(p)
                });
            }
        } catch (err: any) {
            console.error('[SharePage] Download Error:', err);
            showToast('Download failed: ' + err.message, 'error');
        } finally {
            setDownloading(false);
            setDownloadProgress(0);
        }
    };

    const getFileIcon = () => {
        const iconClasses = "w-14 h-14 sm:w-16 sm:h-16 text-primary drop-shadow-sm";
        if (mimeType.startsWith('image/')) return <Image weight="duotone" className={iconClasses} />;
        if (mimeType.startsWith('video/')) return <FilmStrip weight="duotone" className={iconClasses} />;
        if (mimeType.startsWith('audio/')) return <MusicNotes weight="duotone" className={iconClasses} />;
        if (mimeType.includes('pdf') || mimeType.includes('text')) return <FileText weight="duotone" className={iconClasses} />;
        return <File weight="duotone" className={iconClasses} />;
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const { clientX, clientY, currentTarget } = e;
        const { left, top } = currentTarget.getBoundingClientRect();
        mouseX.set(clientX - left);
        mouseY.set(clientY - top);
    };

    // 1. Loading screen
    if (loading) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center relative overflow-hidden bg-[#F2F4F8]">
                <div className="absolute inset-0 opacity-[0.04] pointer-events-none mix-blend-multiply" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
                <div className="absolute top-[-20%] left-[-10%] w-[800px] h-[800px] bg-blue-200/40 rounded-full blur-[140px] mix-blend-multiply opacity-70" />
                <div className="absolute bottom-[-10%] right-[-5%] w-[600px] h-[600px] bg-indigo-200/40 rounded-full blur-[120px] mix-blend-multiply opacity-60" />
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative z-10 text-center">
                    <div className="mb-6 flex justify-center opacity-60"><ProtectedPrism /></div>
                    <h2 className="text-xl font-medium text-slate-500 mb-2 tracking-tight">Accessing Secure Vault...</h2>
                </motion.div>
            </div>
        );
    }

    // 2. Dead Link Screen (410 Friendly layouts)
    if (deadState) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-[#F2F4F8]">
                <div className="absolute inset-0 opacity-[0.04] pointer-events-none mix-blend-multiply" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
                <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: "easeOut", duration: 0.4 }} className="max-w-sm w-full relative z-10">
                    <div className="backdrop-blur-3xl bg-white/40 rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-8 text-center border border-white/60 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] ring-1 ring-white/40 flex flex-col items-center">
                        <div className="w-16 h-16 rounded-2xl bg-error/10 text-error flex items-center justify-center mb-4">
                            {deadState === 'expired' && <Clock size={32} weight="bold" />}
                            {deadState === 'limit_reached' && <Prohibit size={32} weight="bold" />}
                            {deadState === 'revoked' && <XCircle size={32} weight="bold" />}
                        </div>
                        <h2 className="text-xl font-semibold text-slate-800 mb-2 tracking-tight">Link Unavailable</h2>
                        <p className="text-slate-500 mb-8 text-sm leading-relaxed">
                            {deadState === 'expired' && 'This share link has expired.'}
                            {deadState === 'limit_reached' && 'This link is no longer available — the maximum number of downloads has been reached.'}
                            {deadState === 'revoked' && 'This link has been revoked or expired.'}
                        </p>
                        <button onClick={() => navigate('/')} className="w-full py-3 bg-[#0F172A] text-white rounded-xl font-semibold hover:bg-slate-800 transition-colors text-sm shadow-md">Return Home</button>
                    </div>
                </motion.div>
            </div>
        );
    }

    // 3. Password Gate Page
    if (passwordRequired) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-[#F2F4F8]">
                <div className="absolute inset-0 opacity-[0.04] pointer-events-none mix-blend-multiply" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
                <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: "easeOut", duration: 0.4 }} className="max-w-sm w-full relative z-10">
                    <div className="backdrop-blur-3xl bg-white/40 rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-8 text-center border border-white/60 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] ring-1 ring-white/40">
                        <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4 mx-auto">
                            <Lock size={32} weight="bold" />
                        </div>
                        <h2 className="text-xl font-bold text-slate-800 mb-1 tracking-tight">Password Protected</h2>
                        <p className="text-slate-500 mb-6 text-xs font-semibold uppercase tracking-wider">A password is required to unlock this file</p>
                        
                        <form onSubmit={handleVerifyPassword} className="flex flex-col gap-3">
                            <input
                                type="password"
                                placeholder="Enter secure password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                className="w-full bg-white/60 border border-white/80 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:border-primary/50 text-center"
                                required
                            />
                            {passwordError && (
                                <p className="text-xs font-bold text-error text-center mt-1">{passwordError}</p>
                            )}
                            <button
                                type="submit"
                                className="w-full py-3.5 bg-[#0F172A] hover:bg-slate-800 text-white rounded-xl font-semibold transition-all text-sm shadow-md mt-2"
                            >
                                Unlock File
                            </button>
                        </form>
                    </div>
                </motion.div>
            </div>
        );
    }

    // 4. Default error fallback
    if (error) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-[#F2F4F8]">
                <div className="absolute inset-0 opacity-[0.04] pointer-events-none mix-blend-multiply" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
                <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: "easeOut", duration: 0.4 }} className="max-w-sm w-full relative z-10">
                    <div className="backdrop-blur-3xl bg-white/40 rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-8 text-center border border-white/60 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] ring-1 ring-white/40">
                        <div className="w-16 h-16 rounded-2xl bg-error/10 text-error flex items-center justify-center mb-4 mx-auto">
                            <Warning size={32} weight="bold" />
                        </div>
                        <h2 className="text-xl font-semibold text-slate-800 mb-2 tracking-tight">Access Error</h2>
                        <p className="text-slate-500 mb-8 text-sm leading-relaxed">{error}</p>
                        <button onClick={() => navigate('/')} className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl font-semibold transition-all shadow-md text-sm">Return Home</button>
                    </div>
                </motion.div>
            </div>
        );
    }

    // 5. Normal Active Share Screen
    return (
        <div
            className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-[#F2F4F8]"
            onMouseMove={handleMouseMove}
        >
            {/* Ambient Background */}
            <div className="absolute inset-0 opacity-[0.04] pointer-events-none mix-blend-multiply z-0" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
            <div className="absolute top-[-10%] left-[20%] w-[600px] h-[600px] bg-blue-300/30 rounded-full blur-[120px] mix-blend-overlay opacity-80" />
            <div className="absolute bottom-[-10%] right-[20%] w-[600px] h-[600px] bg-indigo-300/30 rounded-full blur-[120px] mix-blend-overlay opacity-80" />

            {/* Main Card */}
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="max-w-sm w-full relative z-10"
            >
                <div className="relative group overflow-hidden rounded-[1.75rem] sm:rounded-[2.5rem]">
                    {/* Dynamic Mouse Highlight */}
                    <motion.div
                        className="absolute inset-0 z-10 pointer-events-none opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                        style={{
                            background: `radial-gradient(600px circle at ${shineX} ${shineY}, rgba(255,255,255,0.15), transparent 40%)`
                        }}
                    />

                    {/* Main Glass Plane */}
                    <div className="backdrop-blur-[45px] bg-white/25 rounded-[1.75rem] sm:rounded-[2.5rem] p-1 shadow-[0_40px_80px_-20px_rgba(0,0,0,0.15),inset_0_0_0_1px_rgba(255,255,255,0.4)] border border-white/30 relative">
                        <div className="absolute inset-0 rounded-[1.75rem] sm:rounded-[2.5rem] bg-gradient-to-br from-white/30 to-transparent pointer-events-none" />

                        <div className="rounded-[1.5rem] sm:rounded-[2.25rem] bg-white/10 p-6 sm:p-8 flex flex-col items-center border border-white/10 shadow-[inset_0_2px_24px_rgba(255,255,255,0.4)] backdrop-blur-sm relative z-20">
                            {/* Header Section */}
                            <div className="text-center mb-8 w-full relative">
                                <div className="mb-6 flex justify-center scale-110 drop-shadow-2xl"><ProtectedPrism /></div>
                                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
                                    <h1 className="text-2xl font-semibold text-slate-800 tracking-tight drop-shadow-sm">Encrypted File</h1>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-2 mix-blend-multiply">Securely shared with you</p>
                                </motion.div>
                            </div>

                            {/* File Preview Card */}
                            <motion.div className="w-full bg-white/35 rounded-2xl p-5 mb-6 border border-white/40 text-center relative shadow-[0_8px_32px_0_rgba(31,38,135,0.04)] group/item backdrop-blur-xl overflow-hidden ring-1 ring-white/20">
                                <div className="absolute inset-0 bg-gradient-to-tr from-white/0 to-white/50 opacity-40" />
                                <div className="relative z-10">
                                    <div className="flex justify-center mb-4 text-primary group-hover/item:scale-105 transition-transform duration-500 ease-[0.16,1,0.3,1]">{getFileIcon()}</div>
                                    <h3 className="text-lg font-semibold text-slate-800 mb-1 truncate px-2 leading-tight" title={filename}>{filename}</h3>
                                    <p className="text-slate-600 font-medium text-sm">{(fileInfo.file_size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                            </motion.div>

                            {/* Action Button */}
                            <motion.button
                                whileHover={{ scale: 1.01, backgroundColor: "rgba(15, 23, 42, 0.95)" }}
                                whileTap={{ scale: 0.98 }}
                                onClick={handleDownload}
                                disabled={downloading}
                                className="w-full py-4 px-6 rounded-2xl bg-[#0F172A]/90 backdrop-blur-md text-white font-medium text-lg shadow-[0_20px_40px_-12px_rgba(15,23,42,0.35)] transition-all relative overflow-hidden flex items-center justify-center gap-3 border border-white/10 group/btn"
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-150%] group-hover/btn:translate-x-[150%] transition-transform duration-1000 ease-in-out" />
                                {downloading ? (
                                    <div className="flex flex-col items-center gap-2">
                                        <div className="flex items-center gap-3">
                                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                            <span className="text-sm">
                                                {downloadProgress > 0 ? `Downloading... ${downloadProgress.toFixed(0)}%` : 'Initializing...'}
                                            </span>
                                        </div>
                                        {downloadProgress > 0 && (
                                            <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-white/60 transition-all duration-300"
                                                    style={{ width: `${downloadProgress}%` }}
                                                />
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <Download size={20} weight="bold" />
                                        <span>Download File</span>
                                    </>
                                )}
                            </motion.button>

                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-8 text-center">
                                <p className="text-[10px] text-slate-400 font-medium leading-relaxed max-w-[200px] mx-auto mix-blend-multiply">Zero-knowledge encryption.<br />Only you hold the key.</p>
                            </motion.div>
                        </div>
                    </div>
                </div>

                <div className="text-center mt-10">
                    <a href="/" className="text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-[0.2em] flex items-center justify-center gap-1 mix-blend-multiply">Secured by Nest</a>
                </div>
            </motion.div>
        </div>
    );
};

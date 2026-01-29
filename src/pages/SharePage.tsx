import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion, useMotionValue, useSpring, useTransform } from 'framer-motion';
import {
    Download,
    File,
    Image,
    FilmStrip,
    MusicNotes,
    FileText,
} from '@phosphor-icons/react';
import { fromBase64 } from '../crypto/v2';
import { StreamingDownloader } from '../utils/StreamingDownloader';

// Custom Unique Icon Component - Protected Prism
const ProtectedPrism = () => (
    <div className="relative w-28 h-28 flex items-center justify-center">
        {/* Inner Core (The Nest Logo) */}
        <img src="/src/assets/nest-logo.png" alt="Nest Logo" className="relative z-10 w-20 h-20 object-contain mix-blend-screen scale-125" />

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

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
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
        loadShareLink();
    }, [shareToken]);

    const loadShareLink = async () => {
        try {
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

            const response = await fetch(`${import.meta.env.VITE_API_URL}/files/share/${shareToken}`);
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Share link not found');
            }

            const data = await response.json();
            setFileInfo(data);
            setLoading(false);
        } catch (err: any) {
            setError(err.message || 'Failed to load share link');
            setLoading(false);
        }
    };

    const handleDownload = async () => {
        if (!fileKey || !fileInfo) return;
        setDownloading(true);
        setDownloadProgress(0);

        try {
            if (!fileInfo.is_chunked) {
                // Fallback for non-chunked files (legacy)
                let downloadUrl = fileInfo.is_gateway_verified
                    ? `https://gateway.lazybird.io/file/${fileInfo.merkle_hash}`
                    : `${import.meta.env.VITE_API_URL}/files/share/raw/${shareToken}`;

                const res = await fetch(downloadUrl);
                if (!res.ok) throw new Error('Failed to download encrypted file');
                const encryptedBlob = await res.blob();

                // For monolithic files, we still use the old decrypt (rare in V3, but kept for compat)
                const { decryptFile } = await import('../crypto/v2');
                const decryptedBytes = await decryptFile(encryptedBlob, null, fileKey);

                const blob = new Blob([decryptedBytes as any], { type: mimeType });
                const url = window.URL.createObjectURL(blob);
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
                    fileKey,
                    filename,
                    chunks: fileInfo.chunks,
                    onProgress: (p) => setDownloadProgress(p)
                });
            }
        } catch (err: any) {
            console.error('[SharePage] Download Error:', err);
            setError('Download failed: ' + err.message);
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

    if (loading) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center relative overflow-hidden bg-[#F2F4F8]">
                <div className="absolute inset-0 opacity-[0.04] pointer-events-none mix-blend-multiply" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
                <div className="absolute top-[-20%] left-[-10%] w-[420px] h-[420px] sm:w-[800px] sm:h-[800px] bg-blue-200/40 rounded-full blur-[140px] mix-blend-multiply opacity-70 animate-pulse-slow" />
                <div className="absolute bottom-[-10%] right-[-5%] w-[360px] h-[360px] sm:w-[600px] sm:h-[600px] bg-indigo-200/40 rounded-full blur-[120px] mix-blend-multiply opacity-60 animate-pulse-slow delay-1000" />
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="relative z-10 text-center">
                    <div className="mb-6 flex justify-center opacity-60"><ProtectedPrism /></div>
                    <h2 className="text-xl font-medium text-slate-500 mb-2 tracking-tight">Verifying...</h2>
                </motion.div>
            </div>
        );
    }

    if (error) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-[#F2F4F8]">
                <div className="absolute inset-0 opacity-[0.04] pointer-events-none mix-blend-multiply" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
                <motion.div initial={{ opacity: 0, y: 15 }} animate={{ opacity: 1, y: 0 }} transition={{ ease: "easeOut", duration: 0.4 }} className="max-w-sm w-full relative z-10">
                    <div className="backdrop-blur-3xl bg-white/40 rounded-[1.75rem] sm:rounded-[2rem] p-6 sm:p-8 text-center border border-white/60 shadow-[0_20px_40px_-15px_rgba(0,0,0,0.1)] ring-1 ring-white/40">
                        <div className="w-24 h-24 sm:w-32 sm:h-32 flex items-center justify-center mx-auto mb-2 transform rotate-3 hover:rotate-6 transition-all duration-500 group">
                            <img src="/src/assets/nest-logo.png" alt="Nest Logo" className="w-full h-full object-contain mix-blend-screen scale-150 group-hover:scale-[1.65] transition-transform duration-700" />
                        </div>
                        <h2 className="text-xl font-semibold text-slate-800 mb-3 tracking-tight">Link Invalid</h2>
                        <p className="text-slate-500 mb-8 text-sm leading-relaxed">{error}</p>
                        <button onClick={() => navigate('/')} className="w-full py-3.5 sm:py-4 rounded-xl bg-white/60 hover:bg-white/80 text-slate-700 font-medium transition-all border border-white/50 shadow-sm text-sm">Return Home</button>
                    </div>
                </motion.div>
            </div>
        );
    }

    return (
        <div
            className="min-h-[100dvh] flex items-center justify-center p-4 sm:p-6 relative overflow-hidden bg-[#F2F4F8]"
            onMouseMove={handleMouseMove}
        >
            {/* Ambient Background */}
            <div className="absolute inset-0 opacity-[0.04] pointer-events-none mix-blend-multiply z-0" style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noiseFilter'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.65' numOctaves='3' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noiseFilter)'/%3E%3C/svg%3E")` }}></div>
            <div className="absolute top-[-10%] left-[20%] w-[420px] h-[420px] sm:w-[600px] sm:h-[600px] bg-blue-300/30 rounded-full blur-[120px] mix-blend-overlay opacity-80 animate-float" />
            <div className="absolute bottom-[-10%] right-[20%] w-[420px] h-[420px] sm:w-[600px] sm:h-[600px] bg-indigo-300/30 rounded-full blur-[120px] mix-blend-overlay opacity-80 animate-float delay-2000" />

            {/* Main Card */}
            <motion.div
                initial={{ opacity: 0, scale: 0.96, y: 10 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                className="max-w-sm w-full relative z-10"
            >
                {/* Ultra Glass Container */}
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
                        {/* Static Gloss Reflection */}
                        <div className="absolute inset-0 rounded-[1.75rem] sm:rounded-[2.5rem] bg-gradient-to-br from-white/30 to-transparent pointer-events-none" />

                        <div className="rounded-[1.5rem] sm:rounded-[2.25rem] bg-white/10 p-6 sm:p-8 flex flex-col items-center border border-white/10 shadow-[inset_0_2px_24px_rgba(255,255,255,0.4)] backdrop-blur-sm relative z-20">
                            {/* Header Section */}
                            <div className="text-center mb-8 sm:mb-10 w-full relative">
                                <div className="mb-6 flex justify-center scale-110 drop-shadow-2xl"><ProtectedPrism /></div>
                                <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2, duration: 0.5 }}>
                                    <h1 className="text-2xl font-semibold text-slate-800 tracking-tight drop-shadow-sm">Encrypted File</h1>
                                    <p className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-2 mix-blend-multiply">Securely shared with you</p>
                                </motion.div>
                            </div>

                            {/* File Preview Card - Super Frosty */}
                            <motion.div initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.5 }} className="w-full bg-white/35 rounded-2xl p-5 sm:p-6 mb-6 sm:mb-8 border border-white/40 text-center relative shadow-[0_8px_32px_0_rgba(31,38,135,0.04)] group/item backdrop-blur-xl overflow-hidden ring-1 ring-white/20">
                                <div className="absolute inset-0 bg-gradient-to-tr from-white/0 to-white/50 opacity-40" />
                                <div className="relative z-10">
                                    <div className="flex justify-center mb-4 text-primary group-hover/item:scale-105 transition-transform duration-500 ease-[0.16,1,0.3,1]">{getFileIcon()}</div>
                                    <h3 className="text-lg font-semibold text-slate-800 mb-1 truncate px-2 leading-tight">{filename}</h3>
                                    <p className="text-slate-600 font-medium text-sm">{(fileInfo.file_size / 1024 / 1024).toFixed(2)} MB</p>
                                </div>
                            </motion.div>

                            {/* Action Area */}
                            <motion.button
                                initial={{ opacity: 0, scale: 0.9, y: -80 }}
                                animate={{ opacity: 1, scale: 1, y: 0 }}
                                transition={{
                                    delay: 0.5,
                                    type: "spring",
                                    damping: 10,
                                    stiffness: 180,
                                    mass: 0.8,
                                    restDelta: 0.001
                                }}
                                whileHover={{ scale: 1.01, backgroundColor: "rgba(15, 23, 42, 0.95)" }}
                                whileTap={{ scale: 0.98 }}
                                onClick={handleDownload}
                                disabled={downloading}
                                className="w-full py-4 px-6 rounded-2xl bg-[#0F172A]/90 backdrop-blur-md text-white font-medium text-lg shadow-[0_20px_40px_-12px_rgba(15,23,42,0.35)] transition-all relative overflow-hidden flex items-center justify-center gap-3 border border-white/10 group/btn"
                            >
                                <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-150%] group-hover/btn:translate-x-[150%] transition-transform duration-1000 ease-in-out" />
                                {downloading ? (
                                    <>
                                        <div className="flex flex-col items-center gap-2">
                                            <div className="flex items-center gap-3">
                                                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                <span>{downloadProgress > 0 ? `Streaming... ${downloadProgress.toFixed(0)}%` : 'Initializing...'}</span>
                                            </div>
                                            {downloadProgress > 0 && (
                                                <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden">
                                                    <motion.div
                                                        className="h-full bg-white/60"
                                                        initial={{ width: 0 }}
                                                        animate={{ width: `${downloadProgress}%` }}
                                                    />
                                                </div>
                                            )}
                                        </div>
                                    </>
                                ) : (
                                    <><Download size={20} weight="bold" /><span>Download File</span></>
                                )}
                            </motion.button>

                            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }} className="mt-8 text-center">
                                <p className="text-[10px] text-slate-400 font-medium leading-relaxed max-w-[200px] mx-auto mix-blend-multiply">Zero-knowledge encryption.<br />Only you hold the key.</p>
                            </motion.div>
                        </div>
                    </div>
                </div>

                <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.8 }} className="text-center mt-10">
                    <a href="/" className="text-[10px] font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-[0.2em] flex items-center justify-center gap-1 mix-blend-multiply">Secured by Nest</a>
                </motion.div>
            </motion.div>
        </div>
    );
};

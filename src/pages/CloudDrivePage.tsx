import { useState, useEffect } from 'react';
import { useToast } from '../contexts/ToastContext';
import { CloudArrowUp, MagnifyingGlass, SortAscending } from '@phosphor-icons/react';
import { FileGrid } from '../components/FileGrid';
import { FileTable } from '../components/FileTable';
import { filesAPI } from '../api/files';
import { ShareSuccessModal } from '../components/ShareSuccessModal';
import { PageLoader } from '../components/PageLoader';
import { useAuth } from '../contexts/AuthContext';
import { useUpload } from '../contexts/UploadContext';
import api from '../lib/api';

type SortOption = 'newest' | 'oldest' | 'name' | 'size';

export const CloudDrivePage = () => {
    const { showToast } = useToast();
    const { masterKey } = useAuth();
    const { addDownload, updateProgress, completeUpload, failUpload } = useUpload();
    const [files, setFiles] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const [sortBy, setSortBy] = useState<SortOption>('newest');
    const [showUploadModal, setShowUploadModal] = useState(false);
    const [shareModal, setShareModal] = useState<{ isOpen: boolean, link: string, name: string }>({ isOpen: false, link: '', name: '' });

    useEffect(() => {
        loadFiles();
    }, []);

    const loadFiles = async () => {
        try {
            const data = await filesAPI.list();
            setFiles(data.files || []);
        } catch (error) {
            console.error('Failed to load files:', error);
            showToast('Failed to load files', 'error');
        } finally {
            setLoading(false);
        }
    };

    // Filter and sort files
    const filteredFiles = files.filter(file =>
        file.filename.toLowerCase().includes(searchQuery.toLowerCase())
    );

    const sortedFiles = [...filteredFiles].sort((a, b) => {
        switch (sortBy) {
            case 'newest':
                return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
            case 'oldest':
                return new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
            case 'name':
                return a.filename.localeCompare(b.filename);
            case 'size':
                return b.file_size - a.file_size;
            default:
                return 0;
        }
    });

    const handleShare = async (file: any) => {
        // This will trigger share link generation in the future
        // For now, just provide a placeholder
        const shareUrl = `${window.location.origin}/download/${file.id}`;

        try {
            if (navigator.clipboard) {
                await navigator.clipboard.writeText(shareUrl);
                showToast('Share link copied to clipboard!', 'success');
            } else {
                throw new Error('Clipboard API unavailable');
            }
        } catch (clipboardError) {
            console.warn('[SHARE] Clipboard write failed:', clipboardError);
            // Fallback: Open Modal for manual copy
            setShareModal({
                isOpen: true,
                link: shareUrl,
                name: file.filename || 'File'
            });
        }
    };

    const handleDownload = async (file: any) => {
        if (!masterKey) {
            showToast('Please log in again to download files', 'error');
            return;
        }

        const downloadId = addDownload(file.filename, file.file_size);
        let fakeProgress = 0;
        let fakeProgressInterval: NodeJS.Timeout | undefined;

        try {
            // Import crypto functions
            const { decryptFolderKey, decryptFileKey, decryptFile, fromBase64, init } = await import('@lazybird-inc/nest-crypto');
            await init();

            // Start Feedback Fake Progress (0-5%)
            fakeProgressInterval = setInterval(() => {
                if (fakeProgress < 5) {
                    fakeProgress += 0.5;
                    updateProgress(downloadId, fakeProgress);
                }
            }, 200);

            // 1. Fetch encrypted keys and file metadata from server
            const downloadInfo = await api.get(`/files/download/${file.id}`);

            // 2. Decrypt Keys (moved up to support StreamingDownloader)
            const fileKeyEncrypted = fromBase64(downloadInfo.data.file_key_encrypted);
            const fileKeyNonce = fromBase64(downloadInfo.data.file_key_nonce);
            const folderKeyEncrypted = fromBase64(downloadInfo.data.folder_key_encrypted);
            const folderKeyNonce = fromBase64(downloadInfo.data.folder_key_nonce);

            const folderKey = decryptFolderKey(folderKeyEncrypted, folderKeyNonce, masterKey);
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, folderKey);

            // NEW: Use StreamingDownloader for chunked files (universal via StreamSaver.js)
            const isLargeFile = file.file_size > 128 * 1024 * 1024;
            const token = localStorage.getItem('nest_token');

            if (isLargeFile && token && downloadInfo.data.chunks?.length > 0) {
                // Map chunks to DownloadChunk format
                const downloadChunks = downloadInfo.data.chunks.map((c: any) => ({
                    index: c.index,
                    size: c.size,
                    nonce: c.nonce,
                    jackal_merkle: c.jackal_merkle,
                    status: (c.jackal_merkle && c.jackal_merkle !== 'pending' && c.jackal_merkle !== 'pending-chunks') ? 'cloud' : 'local'
                }));

                const { StreamingDownloader } = await import('../utils/StreamingDownloader');

                await StreamingDownloader.download({
                    fileKey,
                    filename: file.filename,
                    chunks: downloadChunks,
                    fileId: file.id,
                    authToken: token,
                    onProgress: (p) => {
                        clearInterval(fakeProgressInterval);
                        updateProgress(downloadId, Math.max(5, p));
                    }
                });

                clearInterval(fakeProgressInterval);
                completeUpload(downloadId);
                return;
            }

            // FALLBACK: Legacy Blob Download (for monolithic/small files)

            // 3. Fetch Raw Encrypted Content
            const contentResponse = await api.get(`/files/raw/${file.id}`, {
                responseType: 'blob',
                onDownloadProgress: (progressEvent) => {
                    clearInterval(fakeProgressInterval);
                    const total = progressEvent.total || file.file_size;
                    const percent = (progressEvent.loaded / total) * 100;
                    updateProgress(downloadId, Math.max(5, percent * 0.9));
                }
            });
            const encryptedBlob = contentResponse.data;

            updateProgress(downloadId, 95);

            // 4. Decrypt Content
            // Allow UI to update before heavy crypto
            await new Promise(r => setTimeout(r, 50));

            const headerNonce = fileKeyNonce;
            const chunks = downloadInfo.data.chunks;

            const decryptedBytes = await decryptFile(encryptedBlob, (chunks && chunks.length > 0) ? chunks : headerNonce, fileKey);

            // 5. Trigger Browser Download
            const blob = new Blob([decryptedBytes as unknown as BlobPart], { type: file.mime_type });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.style.display = 'none';
            a.href = url;
            a.download = file.filename;
            document.body.appendChild(a);
            a.click();

            // Cleanup
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            clearInterval(fakeProgressInterval);
            completeUpload(downloadId);

        } catch (error: any) {
            console.error('Download failed:', error);
            if (fakeProgressInterval) clearInterval(fakeProgressInterval);
            failUpload(downloadId, error.message || 'Download failed');
        }
    };

    const handleDelete = async (fileId: number) => {
        try {
            await filesAPI.delete(fileId);
            // showToast('File deleted successfully', 'success'); // Handled by FileTable
            loadFiles(); // Reload list
        } catch (error) {
            console.error('Delete failed:', error);
            showToast('Failed to delete file', 'error');
        }
    };

    const handleMove = async (fileId: number, folderId: number | null) => {
        try {
            await filesAPI.move(fileId, folderId);
            showToast('File moved successfully', 'success');
            loadFiles(); // Reload list
        } catch (error) {
            console.error('Move failed:', error);
            showToast('Failed to move file', 'error');
        }
    };

    if (showUploadModal) {
        return <FileGrid />;
    }

    return (
        <div className="flex-1 p-2">
            <ShareSuccessModal
                isOpen={shareModal.isOpen}
                onClose={() => setShareModal({ ...shareModal, isOpen: false })}
                shareLink={shareModal.link}
                filename={shareModal.name}
            />

            {/* Header */}
            <div className="mb-6 flex items-center justify-between">
                <h1 className="text-2xl font-bold text-text-main">Cloud Drive</h1>
                <button
                    onClick={() => setShowUploadModal(true)}
                    className="glass-button flex items-center gap-2"
                >
                    <CloudArrowUp size={20} weight="bold" />
                    <span>Upload File</span>
                </button>
            </div>

            {/* Search & Sort Bar */}
            <div className="mb-6 flex items-center gap-4">
                <div className="flex-1 relative group">
                    <MagnifyingGlass
                        size={20}
                        className="absolute left-4 top-1/2 -translate-y-1/2 text-text-muted group-focus-within:text-primary transition-colors"
                    />
                    <input
                        type="text"
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full glass-input pl-12"
                    />
                </div>

                <div className="relative">
                    <select
                        value={sortBy}
                        onChange={(e) => setSortBy(e.target.value as SortOption)}
                        className="glass-input pl-4 pr-10 appearance-none cursor-pointer hover:bg-white/40"
                    >
                        <option value="newest">Newest First</option>
                        <option value="oldest">Oldest First</option>
                        <option value="name">Name (A-Z)</option>
                        <option value="size">Size (Largest)</option>
                    </select>
                    <SortAscending
                        size={16}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none"
                    />
                </div>
            </div>

            {/* File List */}
            {loading ? (
                <PageLoader />
            ) : (
                <FileTable
                    items={sortedFiles.map(file => ({
                        id: file.id,
                        name: file.filename,
                        type: 'file',
                        mimeType: file.mime_type,
                        size: file.file_size,
                        createdAt: file.created_at,
                        folderId: file.folder_id,
                        onDownload: () => handleDownload(file),
                        onShare: () => handleShare(file),
                        onMove: (fId: number | null) => handleMove(file.id, fId),
                        onDelete: () => handleDelete(file.id)
                    }))}
                />
            )}
        </div>
    );
};

import { useState, useEffect } from 'react';
import API_BASE_URL from '../config/api';
import { useToast } from '../contexts/ToastContext';
import { CloudArrowUp, MagnifyingGlass, SortAscending } from '@phosphor-icons/react';
import { FileGrid } from '../components/FileGrid';
import { FileTable } from '../components/FileTable';
import { filesAPI } from '../api/files';
import { ShareSuccessModal } from '../components/ShareSuccessModal';
import { PageLoader } from '../components/PageLoader';

type SortOption = 'newest' | 'oldest' | 'name' | 'size';

export const CloudDrivePage = () => {
    const { showToast } = useToast();
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

    const handleDownload = async (fileId: number, filename: string) => {
        console.log('[CloudDrive] Starting download for file:', fileId);
        showToast(`Downloading "${filename}"...`, 'info');

        try {
            // Step 1: Get File Key and Metadata
            const keyResponse = await fetch(`${API_BASE_URL}/files/download/${fileId}`, {
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('nest_token')}`,
                },
            });

            if (!keyResponse.ok) {
                const err = await keyResponse.json();
                throw new Error(err.error || 'Failed to get file info');
            }

            const {
                file_key,
                file_key_nonce,
                filename: serverFilename,
                mime_type,
                jackal_fid,
                merkle_hash,
                is_chunked,
                is_gateway_verified
            } = await keyResponse.json();

            console.log('[CloudDrive] ✅ File info received. Verified on Gateway:', is_gateway_verified);

            const { decryptFile, decryptChunk, fromBase64 } = await import('../crypto/v2');
            const fileKey = fromBase64(file_key);

            let decryptedBlob: Blob;

            if (is_chunked) {
                // CHUNKED DOWNLOAD
                showToast(`Downloading chunked file "${filename}"...`, 'info');

                // 1. Get Manifest
                const { chunks } = await filesAPI.getManifest(fileId);
                console.log(`[CloudDrive] Found ${chunks.length} chunks`);

                const parts: Blob[] = [];

                // 2. Download & Decrypt Sequentially
                for (let i = 0; i < chunks.length; i++) {
                    const chunk = chunks[i];

                    // Determine Source: Gateway or Local Proxy
                    let chunkUrl = '';
                    if (chunk.is_gateway_verified) {
                        chunkUrl = `https://gateway.lazybird.io/file/${chunk.jackal_merkle}`;
                    } else {
                        chunkUrl = `${API_BASE_URL}/files/chunks/raw/${chunk.id}`;
                    }

                    const chunkResp = await fetch(chunkUrl, {
                        headers: chunk.is_gateway_verified ? {} : { 'Authorization': `Bearer ${localStorage.getItem('nest_token')}` }
                    });

                    if (!chunkResp.ok) throw new Error(`Failed to download chunk ${i}`);

                    const encryptedChunkBlob = await chunkResp.blob();

                    // Decrypt
                    const chunkNonce = fromBase64(chunk.nonce);
                    const decryptedPart = await decryptChunk(encryptedChunkBlob, chunkNonce, fileKey);

                    parts.push(decryptedPart);

                    if (i % 5 === 0) console.log(`[CloudDrive] Processed chunk ${i + 1}/${chunks.length}`);
                }

                decryptedBlob = new Blob(parts, { type: mime_type });

            } else {
                // MONOLITHIC DOWNLOAD
                let downloadUrl = '';
                if (is_gateway_verified) {
                    downloadUrl = `https://gateway.lazybird.io/file/${jackal_fid || merkle_hash}`;
                    console.log('[CloudDrive] Downloading from Jackal Gateway');
                } else {
                    downloadUrl = `${API_BASE_URL}/files/raw/${fileId}`;
                    console.log('[CloudDrive] Downloading from Local Proxy');
                }

                const blobResponse = await fetch(downloadUrl, {
                    headers: is_gateway_verified ? {} : { 'Authorization': `Bearer ${localStorage.getItem('nest_token')}` }
                });

                if (!blobResponse.ok) throw new Error('Failed to download encrypted file');

                const encryptedBlob = await blobResponse.blob();

                // Decrypt
                const nonce = fromBase64(file_key_nonce || '');
                const decryptedBytes = await decryptFile(encryptedBlob, nonce, fileKey);
                decryptedBlob = new Blob([decryptedBytes as any], { type: mime_type });
            }

            // Step 4: Trigger browser download
            const url = window.URL.createObjectURL(decryptedBlob);
            const link = document.createElement('a');
            link.href = url;
            link.setAttribute('download', serverFilename || filename);
            document.body.appendChild(link);
            link.click();
            link.remove();

            window.URL.revokeObjectURL(url);

            console.log('[CloudDrive] ✅ Download complete');
            showToast(`"${filename}" downloaded successfully!`, 'success');

        } catch (error: any) {
            console.error('[CloudDrive] ❌ Download failed:', error);
            showToast(`Failed to download "${filename}": ${error.message}`, 'error');
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
                        onDownload: () => handleDownload(file.id, file.filename),
                        onShare: () => handleShare(file),
                        onMove: (fId: number | null) => handleMove(file.id, fId),
                        onDelete: () => handleDelete(file.id)
                    }))}
                />
            )}
        </div>
    );
};

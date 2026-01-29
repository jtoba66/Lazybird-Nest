import { useState, useCallback } from 'react';
import API_BASE_URL from '../config/api';
import { CloudArrowUp, FolderPlus, GridFour, Info, CaretUp, Check, Copy } from '@phosphor-icons/react';
import { useDropzone } from 'react-dropzone';
import { useUpload } from '../contexts/UploadContext';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { useRefresh } from '../contexts/RefreshContext';
import { foldersAPI } from '../api/folders';
import { CreateFolderModal } from '../components/CreateFolderModal';
import { encryptFile, generateFileKey, toBase64, generateFolderKey, encryptFolderKey } from '../crypto/v2';

export const FileGrid = () => {
    const { metadata, masterKey, saveMetadata } = useAuth();
    const { addUpload, updateProgress, completeUpload, failUpload } = useUpload();
    const { showToast } = useToast();
    const { triggerFileRefresh } = useRefresh();

    const [shareLink, setShareLink] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [copied, setCopied] = useState(false);
    const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);

    const onDrop = useCallback(async (acceptedFiles: File[]) => {
        if (acceptedFiles.length === 0) return;

        const file = acceptedFiles[0];
        const uploadId = addUpload(file);
        setUploading(true);
        setUploadProgress(0);
        setShareLink('');

        try {
            console.log('[v2-upload] Starting upload:', file.name);

            // 1. Generate File Key
            const fileKey = generateFileKey();
            console.log('[v2-upload] ✅ File Key generated');

            // 2. Encrypt file with File Key
            const { encryptedBlob } = await encryptFile(file, fileKey);
            console.log('[v2-upload] ✅ File encrypted');

            // 3. Prepare FormData
            const formData = new FormData();
            formData.append('file', encryptedBlob, file.name);
            formData.append('filename', file.name);
            formData.append('mimeType', file.type);
            formData.append('folderId', ''); // Root folder

            formData.append('fileKeyEncrypted', toBase64(fileKey)); // Placeholder - backend will re-encrypt
            formData.append('fileKeyNonce', toBase64(new Uint8Array(24))); // Placeholder nonce

            // 5. Upload to backend
            console.log('[v2-upload] Uploading to backend...');

            const response = await fetch(`${API_BASE_URL}/files/upload`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${localStorage.getItem('nest_token')}`,
                },
                body: formData,
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.error || 'Upload failed');
            }

            const result = await response.json();

            completeUpload(uploadId);
            updateProgress(uploadId, 100);

            console.log('[v2-upload] ✅ Upload complete:', result);
            showToast(`"${file.name}" uploaded successfully!`, 'success');

            const shareLink = `${window.location.origin}/s/${result.share_token}#key=${encodeURIComponent(toBase64(fileKey))}&name=${encodeURIComponent(file.name)}&mime=${encodeURIComponent(file.type)}`;
            setShareLink(shareLink);

        } catch (error: any) {
            console.error('[v2-upload] ❌ Upload failed:', error);
            failUpload(uploadId, error.message);
            showToast(`Failed to upload "${file.name}"`, 'error');
        } finally {
            setUploading(false);
            setUploadProgress(0);
        }
    }, [addUpload, updateProgress, completeUpload, failUpload, showToast]);


    const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
        onDrop,
        multiple: false,
        noClick: false,
        noKeyboard: true
    });

    const copyToClipboard = () => {
        navigator.clipboard.writeText(shareLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const handleUploadClick = () => {
        open();
    };

    const handleCreateFolder = async (folderName: string) => {
        if (!metadata || !masterKey) return;
        try {
            console.log('[v2-folder] Creating folder:', folderName);

            // 1. Generate & Encrypt Folder Key locally
            const folderKey = generateFolderKey();
            const { encrypted, nonce } = encryptFolderKey(folderKey, masterKey);
            const pathHash = folderName; // Server hashes this

            // 2. Create on Server
            const res = await foldersAPI.create(
                toBase64(encrypted),
                toBase64(nonce),
                pathHash
            );
            const newId = res.folder_id;

            // 3. Update Metadata
            const newMeta = JSON.parse(JSON.stringify(metadata));
            newMeta.folders[newId.toString()] = {
                name: folderName,
                created_at: new Date().toISOString()
            };

            // 4. Encrypt & Save Metadata
            await saveMetadata(newMeta);

            console.log('[v2-folder] ✅ Folder created successfully');
            showToast('Folder created successfully!', 'success');
            triggerFileRefresh();
            setShowCreateFolderModal(false);
        } catch (error) {
            console.error('[v2-folder] ❌ Creation failed:', error);
            showToast('Failed to create folder', 'error');
        }
    };

    return (
        <div {...getRootProps()} className="flex-1 flex flex-col bg-background relative">
            <input {...getInputProps()} />

            <div onClick={(e) => e.stopPropagation()}>
                <CreateFolderModal
                    isOpen={showCreateFolderModal}
                    onClose={() => setShowCreateFolderModal(false)}
                    onCreate={handleCreateFolder}
                />
            </div>

            <div className="px-4 sm:px-8 py-3 sm:py-4 flex items-center justify-between z-10" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleUploadClick}
                        className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-lg font-medium shadow-soft hover:shadow-glow hover:bg-secondary transition-all active:scale-95 disabled:opacity-50"
                    >
                        <CloudArrowUp size={20} weight="bold" />
                        <span>Upload</span>
                    </button>
                    <button
                        onClick={() => setShowCreateFolderModal(true)}
                        className="flex items-center gap-2 bg-card text-text-main border border-transparent hover:border-border px-4 py-2 rounded-lg font-medium transition-all active:scale-95"
                    >
                        <FolderPlus size={20} weight="bold" />
                        <span>New folder</span>
                    </button>
                </div>

                <div className="flex items-center gap-2 text-text-muted">
                    <button className="p-2 hover:bg-card-hover rounded-lg transition-all">
                        <GridFour size={20} />
                    </button>
                    <button className="p-2 hover:bg-card-hover rounded-lg transition-all">
                        <Info size={20} />
                    </button>
                    <button className="p-2 hover:bg-card-hover rounded-lg transition-all">
                        <CaretUp size={20} />
                    </button>
                </div>
            </div>

            <div
                className={`flex-1 mx-3 sm:mx-6 lg:mx-8 mb-3 sm:mb-6 lg:mb-8 border-2 border-dashed rounded-2xl sm:rounded-3xl flex flex-col items-center justify-center relative overflow-hidden group transition-all ${isDragActive ? 'border-primary bg-primary/5 scale-[1.01]' : 'border-border hover:border-primary/50'
                    } ${uploading ? 'pointer-events-none' : ''}`}
            >
                {uploading ? (
                    <div className="text-center p-6 sm:p-8">
                        <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
                            <CloudArrowUp size={48} className="text-primary" weight="duotone" />
                        </div>
                        <h3 className="text-xl font-bold text-text-main mb-2">
                            Encrypting & Uploading...
                        </h3>
                        <div className="w-56 sm:w-64 h-2 bg-border rounded-full overflow-hidden mx-auto mb-2">
                            <div
                                className="h-full bg-primary transition-all duration-300"
                                style={{ width: `${uploadProgress}%` }}
                            />
                        </div>
                        <p className="text-text-muted text-sm">{uploadProgress}%</p>
                    </div>
                ) : shareLink ? (
                    <div
                        className="text-center p-6 sm:p-8 max-w-xl z-20"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl bg-green-500/10 flex items-center justify-center mx-auto mb-4">
                            <Check size={48} className="text-green-500" weight="bold" />
                        </div>
                        <h3 className="text-xl font-bold text-text-main mb-2">
                            Upload Complete!
                        </h3>
                        <p className="text-text-muted mb-4">
                            Your file has been encrypted and uploaded securely.
                        </p>

                        <div className="bg-card rounded-xl p-4 border border-border mb-4">
                            <p className="text-xs text-text-muted mb-2">Share Link (includes decryption key)</p>
                            <div className="flex items-center gap-2">
                                <input
                                    type="text"
                                    value={shareLink}
                                    readOnly
                                    className="flex-1 bg-background text-text-main text-sm px-3 py-2 rounded-lg border border-border focus:outline-none"
                                />
                                <button
                                    onClick={copyToClipboard}
                                    className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg hover:bg-secondary transition-all"
                                >
                                    {copied ? <Check size={16} weight="bold" /> : <Copy size={16} />}
                                    {copied ? 'Copied' : 'Copy'}
                                </button>
                            </div>
                        </div>

                        <button
                            onClick={() => setShareLink('')}
                            className="text-primary hover:underline text-sm font-medium"
                        >
                            Upload another file
                        </button>
                    </div>
                ) : (
                    <div className="text-center p-6 sm:p-8">
                        <div className="w-16 h-16 sm:w-24 sm:h-24 rounded-2xl bg-card flex items-center justify-center mx-auto mb-4 group-hover:bg-primary/10 transition-all">
                            <CloudArrowUp size={48} className="text-text-muted group-hover:text-primary transition-all" weight="duotone" />
                        </div>
                        <h3 className="text-xl font-bold text-text-main mb-2">
                            Drop files to upload
                        </h3>
                        <p className="text-text-muted mb-4">
                            or click the Upload button above
                        </p>
                        <p className="text-xs text-text-muted">
                            Files are encrypted client-side before upload
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
};

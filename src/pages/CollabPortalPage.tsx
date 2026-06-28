import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import API_BASE_URL from '../config/api';
import { formatBytes, formatFileType } from '../utils/fileFormat';
import { motion, AnimatePresence } from 'framer-motion';
import {
    Folder,
    FolderOpen,
    File,
    DownloadSimple,
    Plus,
    Trash,
    SignOut,
    Prohibit,
    CaretRight,
    PencilSimple,
    Warning,
    ShieldCheck,
    Image,
    Video,
    FilePdf,
    FileArchive,
    FileText,
    FileArrowUp,
    FolderPlus
} from '@phosphor-icons/react';
import {
    fromBase64,
    toBase64,
    init as initCrypto,
    decryptCollabKey,
    encryptFileWithCollabKey,
    encryptWithMasterKey,
    decryptWithMasterKey
} from '@lazybird-inc/nest-crypto';
import logoImg from '../assets/nest-logo.png';
import { useToast } from '../contexts/ToastContext';
import { useAuth } from '../contexts/AuthContext';
import { StreamingDownloader } from '../utils/StreamingDownloader';

// Helper to determine file icon
function getFileIcon(mimeType: string) {
    if (!mimeType) return File;
    if (mimeType.startsWith('image/')) return Image;
    if (mimeType.startsWith('video/')) return Video;
    if (mimeType === 'application/pdf') return FilePdf;
    if (mimeType.includes('zip') || mimeType.includes('archive')) return FileArchive;
    if (mimeType.startsWith('text/')) return FileText;
    return File;
}

// Helper to convert base64url to base64
const fromBase64url = (str: string): Uint8Array => {
    let s = str.replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) {
        s += '=';
    }
    return fromBase64(s);
};

// Helper for symmetric encryption of metadata
const encryptSymmetricMetadata = (text: string, key: Uint8Array): string => {
    const { encrypted, nonce } = encryptWithMasterKey(text, key);
    return JSON.stringify({
        encrypted: toBase64(encrypted),
        nonce: toBase64(nonce)
    });
};

// Helper for symmetric decryption of metadata
const decryptSymmetricMetadata = (jsonStr: string | null, key: Uint8Array): string => {
    if (!jsonStr) return 'Unnamed Item';
    try {
        const { encrypted, nonce } = JSON.parse(jsonStr);
        const decryptedBytes = decryptWithMasterKey(fromBase64(encrypted), fromBase64(nonce), key);
        return new TextDecoder().decode(decryptedBytes);
    } catch (e) {
        console.error('Failed to decrypt symmetric metadata:', e);
        return 'Decryption Error';
    }
};

export const CollabPortalPage = () => {
    const { token } = useParams<{ token: string }>();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { user: authedUser, masterKey } = useAuth();

    // Onboarding & Gate states
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState('');
    const [deadState, setDeadState] = useState<'revoked' | 'expired' | null>(null);
    const [onboardingStep, setOnboardingStep] = useState<'info' | 'otp' | 'verified'>('info');
    const [email, setEmail] = useState('');
    const [otpCode, setOtpCode] = useState('');
    const [otpError, setOtpError] = useState('');
    
    // Decryption Keys in memory
    const [linkKey, setLinkKey] = useState<Uint8Array | null>(null);
    const [collabKey, setCollabKey] = useState<Uint8Array | null>(null);
    const [sessionToken, setSessionToken] = useState<string | null>(null);

    // Collaboration data
    const [collabName, setCollabName] = useState('');
    const [hostEmail, setHostEmail] = useState('');
    const [strictMode, setStrictMode] = useState(false);

    // Folder workspace hierarchy states
    const [collabRootId, setCollabRootId] = useState<number | null>(null);
    const [currentFolderId, setCurrentFolderId] = useState<number | null>(null);
    const [rawFiles, setRawFiles] = useState<any[]>([]);
    const [rawFolders, setRawFolders] = useState<any[]>([]);
    
    // UI displaying list
    const [files, setFiles] = useState<any[]>([]);
    const [folders, setFolders] = useState<any[]>([]);

    // Modals & inputs
    const [showCreateFolder, setShowCreateFolder] = useState(false);
    const [showNewMenu, setShowNewMenu] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const [renameFileItem, setRenameFileItem] = useState<any | null>(null);
    const [renameValue, setRenameValue] = useState('');
    const [uploading, setUploading] = useState(false);
    const [uploadProgress, setUploadProgress] = useState(0);
    const [uploadCount, setUploadCount] = useState(1);
    const [downloadingFileId, setDownloadingFileId] = useState<number | null>(null);

    const [submittingOtp, setSubmittingOtp] = useState(false);
    const [submittingFolder, setSubmittingFolder] = useState(false);

    // 1. Recover keys from URL fragment and sessionStorage
    useEffect(() => {
        const loadKeys = async () => {
            const hash = window.location.hash.substring(1);
            if (hash) {
                const params = new URLSearchParams(hash);
                const lkParam = params.get('lk');
                if (lkParam) {
                    try {
                        await initCrypto();
                        const lk = fromBase64url(lkParam);
                        setLinkKey(lk);
                    } catch (e: any) {
                        console.error('Failed to parse link key from fragment:', e);
                    }
                }
            }

            const cachedSession = sessionStorage.getItem(`collab_session_${token}`);
            if (cachedSession) {
                setSessionToken(cachedSession);
            }
            
            const cachedEmail = sessionStorage.getItem(`collab_email_${token}`);
            if (cachedEmail) {
                setEmail(cachedEmail);
            }
            
            const cachedCollabKey = sessionStorage.getItem(`collab_key_${token}`);
            if (cachedCollabKey) {
                try {
                    await initCrypto();
                    setCollabKey(fromBase64(cachedCollabKey));
                } catch (e) {
                    console.error('Failed to parse cached collab key:', e);
                }
            }
        };
        
        loadKeys();
    }, [token]);

    // 2. Fetch onboarding details
    useEffect(() => {
        loadOnboardingDetails();
    }, [token]);

    const loadOnboardingDetails = async () => {
        if (!token) return;
        try {
            const response = await fetch(`${API_BASE_URL}/collab/${token}`);
            if (response.status === 410) {
                const data = await response.json();
                setDeadState(data.expired ? 'expired' : 'revoked');
                setLoading(false);
                return;
            }

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to retrieve collaboration workspace details');
            }

            const data = await response.json();
            setCollabName(data.name);
            setHostEmail(data.host_display);
            setStrictMode(data.strict_mode);
            
            // Check if user is logged-in Nest user
            if (authedUser && masterKey) {
                // Shared With Me flow
                handleSharedWithMeFlow(data);
            } else {
                setLoading(false);
            }
        } catch (err: any) {
            setError(err.message || 'Workspace unavailable');
            setLoading(false);
        }
    };

    const handleSharedWithMeFlow = async (collabData: any) => {
        // Resolve the link key from state, falling back to the URL fragment directly.
        // The fragment is parsed in a separate effect via setState, so on a fast/cached
        // onboarding response this handler can run before that state has propagated.
        let lk = linkKey;
        if (!lk) {
            const hashParam = new URLSearchParams(window.location.hash.substring(1)).get('lk');
            if (hashParam) {
                try {
                    await initCrypto();
                    lk = fromBase64url(hashParam);
                } catch (e) {
                    console.error('Failed to derive link key from fragment:', e);
                }
            }
        }
        if (!lk) {
            setError('Missing collaboration link key fragment');
            setLoading(false);
            return;
        }

        try {
            // Fetch keys from authenticated endpoint
            const keyRes = await fetch(`${API_BASE_URL}/collab-folders/by-token/${token}/keys`, {
                headers: { 'Authorization': `Bearer ${localStorage.getItem('nest_token')}` }
            });
            if (!keyRes.ok) throw new Error('Failed to fetch collab keys. You may not have access.');
            const keyData = await keyRes.json();

            // Decrypt collab key in memory
            const encKey = fromBase64(keyData.link_encrypted_collab_key);
            const nonce = fromBase64(keyData.link_collab_key_nonce);
            const derivedCollabKey = decryptCollabKey(encKey, nonce, lk);

            setCollabKey(derivedCollabKey);
            sessionStorage.setItem(`collab_key_${token}`, toBase64(derivedCollabKey));
            
            // Automatically map to Nest
            const { encryptCollabKeyForHost, toBase64: base64Helper } = await import('@lazybird-inc/nest-crypto');
            const encryptedHostKey = encryptCollabKeyForHost(derivedCollabKey, masterKey!);

            await fetch(`${API_BASE_URL}/collab-folders/${keyData.id}/add-to-nest`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('nest_token')}`
                },
                body: JSON.stringify({
                    encrypted_collab_key: base64Helper(encryptedHostKey.encrypted),
                    collab_key_nonce: base64Helper(encryptedHostKey.nonce)
                })
            });

            // Redirect to dashboard folder path
            showToast(`Added "${collabData.name}" to Shared With Me`, 'success');
            navigate(`/folders?folderId=${keyData.folder_id}&collabToken=${token}`);
        } catch (e) {
            console.error('Shared With Me mapping failed:', e);
            // Fall back to standard Guest portal
            setLoading(false);
        }
    };

    // Request OTP code
    const handleRequestOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!email || !token) return;
        setOtpError('');
        setSubmittingOtp(true);

        try {
            const response = await fetch(`${API_BASE_URL}/collab/${token}/otp/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Failed to send verification code');
            }

            setOnboardingStep('otp');
            showToast('Verification code sent to your email', 'success');
        } catch (err: any) {
            showToast(err.message || 'OTP request failed', 'error');
        } finally {
            setSubmittingOtp(false);
        }
    };

    // Verify OTP code
    const handleVerifyOtp = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!otpCode || !token) return;
        
        if (!linkKey) {
            // Never render window.location.hash — it contains the #lk= link key (the
            // secret that decrypts the collab key). Show a generic message instead.
            setOtpError('This collaboration link is missing its decryption key. Please re-open the original link you were sent.');
            return;
        }

        setOtpError('');
        setSubmittingOtp(true);

        try {
            const response = await fetch(`${API_BASE_URL}/collab/${token}/otp/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code: otpCode })
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.error || 'Invalid code');
            }

            const data = await response.json();
            
            // Decrypt collab key
            const encKey = fromBase64(data.link_encrypted_collab_key);
            const nonce = fromBase64(data.link_collab_key_nonce);
            const derivedCollabKey = decryptCollabKey(encKey, nonce, linkKey!);

            setCollabKey(derivedCollabKey);
            setSessionToken(data.session_token);
            sessionStorage.setItem(`collab_session_${token}`, data.session_token);
            sessionStorage.setItem(`collab_key_${token}`, toBase64(derivedCollabKey));
            sessionStorage.setItem(`collab_email_${token}`, email);

            if (authedUser && masterKey && data.id) {
                try {
                    const { encryptCollabKeyForHost, toBase64: base64Helper } = await import('@lazybird-inc/nest-crypto');
                    const encryptedHostKey = encryptCollabKeyForHost(derivedCollabKey, masterKey);

                    await fetch(`${API_BASE_URL}/collab-folders/${data.id}/add-to-nest`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            'Authorization': `Bearer ${localStorage.getItem('nest_token')}`
                        },
                        body: JSON.stringify({
                            encrypted_collab_key: base64Helper(encryptedHostKey.encrypted),
                            collab_key_nonce: base64Helper(encryptedHostKey.nonce)
                        })
                    });

                    showToast(`Collab folder mapped to Shared With Me!`, 'success');
                    navigate(`/folders?folderId=${data.folder_id}&collabToken=${token}`);
                    return;
                } catch (e) {
                    console.error('Shared With Me mapping failed during OTP:', e);
                }
            }

            setOnboardingStep('verified');
            showToast('Verification successful', 'success');
        } catch (err: any) {
            setOtpError(err.message || 'Verification failed');
        } finally {
            setSubmittingOtp(false);
        }
    };

    // Fetch workspace files list
    useEffect(() => {
        if (sessionToken && collabKey) {
            fetchFilesList();
            // Start 20-second polling interval
            const interval = setInterval(fetchFilesList, 20000);
            return () => clearInterval(interval);
        }
    }, [sessionToken, collabKey, token]);

    const fetchFilesList = async () => {
        if (!token || !sessionToken || !collabKey) return;
        try {
            const response = await fetch(`${API_BASE_URL}/collab/${token}/files`, {
                headers: { 'x-collab-session': sessionToken }
            });

            if (response.status === 401) {
                // Session expired
                handleSignOut();
                return;
            }

            if (!response.ok) throw new Error('Failed to fetch files');

            const data = await response.json();
            setCollabRootId(data.collab_root_id);
            setRawFiles(data.files || []);
            setRawFolders(data.folders || []);
        } catch (err) {
            console.error('Failed to poll workspace files:', err);
        }
    };

    // Update display items whenever raw arrays or currentFolderId changes
    useEffect(() => {
        if (!collabKey || !collabRootId) return;

        const activeFolder = currentFolderId === null ? collabRootId : currentFolderId;

        // Decrypt and map subfolders
        const mappedFolders = rawFolders
            .filter(f => f.parent_id === activeFolder)
            .map(f => ({
                id: f.id,
                name: decryptSymmetricMetadata(f.encrypted_folder_name, collabKey),
                created_at: f.created_at,
                parent_id: f.parent_id
            }));

        // Decrypt and map files
        const mappedFiles = rawFiles
            .filter(f => f.folder_id === activeFolder)
            .map(f => ({
                id: f.id,
                name: decryptSymmetricMetadata(f.encrypted_filename, collabKey),
                mime: decryptSymmetricMetadata(f.encrypted_mime_type, collabKey),
                size: f.file_size,
                created_at: f.created_at,
                is_chunked: f.is_chunked,
                obsideo_key: f.obsideo_key,
                merkle_hash: f.merkle_hash,
                file_key_encrypted: f.file_key_encrypted,
                file_key_nonce: f.file_key_nonce
            }));

        setFolders(mappedFolders);
        setFiles(mappedFiles);
    }, [rawFiles, rawFolders, currentFolderId, collabKey, collabRootId]);

    // Handle breadcrumb clicks
    const getBreadcrumbs = () => {
        if (!collabRootId) return [];
        const crumbs = [{ id: null, name: collabName }];
        if (currentFolderId === null || currentFolderId === collabRootId) {
            return crumbs;
        }

        // Traverse upwards from currentFolderId
        const path: any[] = [];
        let currId = currentFolderId;
        while (currId && currId !== collabRootId) {
            const folderRecord = rawFolders.find(f => f.id === currId);
            if (folderRecord) {
                path.unshift({
                    id: folderRecord.id,
                    name: decryptSymmetricMetadata(folderRecord.encrypted_folder_name, collabKey!)
                });
                currId = folderRecord.parent_id;
            } else {
                break;
            }
        }
        return [...crumbs, ...path];
    };

    // Sign out collaborator session
    const handleSignOut = () => {
        sessionStorage.removeItem(`collab_session_${token}`);
        sessionStorage.removeItem(`collab_key_${token}`);
        setSessionToken(null);
        setCollabKey(null);
        setOnboardingStep('info');
    };

    // Create a subfolder
    const handleCreateFolder = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newFolderName.trim() || !collabKey || !token || !sessionToken) return;
        setSubmittingFolder(true);

        try {
            // Encrypt folder name
            const folderNameEncrypted = encryptSymmetricMetadata(newFolderName.trim(), collabKey);
            const parentFolderId = currentFolderId === null ? collabRootId : currentFolderId;

            const response = await fetch(`${API_BASE_URL}/collab/${token}/folders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-collab-session': sessionToken
                },
                body: JSON.stringify({
                    folder_name_encrypted: folderNameEncrypted,
                    parent_id: parentFolderId
                })
            });

            if (!response.ok) throw new Error('Failed to create folder');

            showToast(`Folder "${newFolderName}" created`, 'success');
            setNewFolderName('');
            setShowCreateFolder(false);
            fetchFilesList();
        } catch (err: any) {
            showToast(err.message || 'Failed to create subfolder', 'error');
        } finally {
            setSubmittingFolder(false);
        }
    };

    // Delete a file (soft-delete to host's trash)
    const handleDeleteFile = async (fileId: number, name: string) => {
        if (!confirm(`Delete "${name}"? It will be moved to the host's Trash.`)) return;
        try {
            const response = await fetch(`${API_BASE_URL}/collab/${token}/files/${fileId}`, {
                method: 'DELETE',
                headers: { 'x-collab-session': sessionToken! }
            });

            if (!response.ok) throw new Error('Failed to delete file');
            showToast(`"${name}" moved to Trash`, 'success');
            fetchFilesList();
        } catch (err: any) {
            showToast(err.message || 'Delete failed', 'error');
        }
    };

    // Rename a file
    const handleRenameFileSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!renameFileItem || !renameValue.trim() || !collabKey || !token || !sessionToken) return;

        try {
            const newNameEncrypted = encryptSymmetricMetadata(renameValue.trim(), collabKey);
            const response = await fetch(`${API_BASE_URL}/collab/${token}/files/${renameFileItem.id}`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'x-collab-session': sessionToken
                },
                body: JSON.stringify({ new_filename_encrypted: newNameEncrypted })
            });

            if (!response.ok) throw new Error('Failed to rename file');
            showToast('File renamed', 'success');
            setRenameFileItem(null);
            fetchFilesList();
        } catch (err: any) {
            showToast(err.message || 'Rename failed', 'error');
        }
    };

    // Guest Upload
    const handleUploadFile = async (file: File) => {
        if (!collabKey || !token || !sessionToken) return;
        setUploading(true);
        setUploadProgress(0);

        try {
            await initCrypto();
            // Generate a random AES key specifically for this file
            const fileKey = window.crypto.getRandomValues(new Uint8Array(32));
            
            // Re-encrypt the file key with the Collab Key
            const { encryptFileKey, encryptChunk } = await import('@lazybird-inc/nest-crypto');
            const encryptedFileKey = encryptFileKey(fileKey, collabKey);

            // 2. Encrypt filename and mime-type symmetrically using collabKey
            const encryptedFilename = encryptSymmetricMetadata(file.name, collabKey);
            const encryptedMime = encryptSymmetricMetadata(file.type || 'application/octet-stream', collabKey);

            const parentFolderId = currentFolderId === null ? collabRootId : currentFolderId;
            
            const CHUNK_THRESHOLD = 128 * 1024 * 1024; // 128MB
            const CHUNK_SIZE = 128 * 1024 * 1024;

            if (file.size >= CHUNK_THRESHOLD) {
                // === CHUNKED COLLAB UPLOAD ===
                
                try {
                    const { filesAPI } = await import('../api/files');
                    const sessionId = crypto.randomUUID();

                    const initResult = await filesAPI.initCollabUpload(token, {
                        file_size: file.size,
                        folder_id: parentFolderId,
                        encrypted_file_key: toBase64(encryptedFileKey.encrypted),
                        file_key_nonce: toBase64(encryptedFileKey.nonce),
                        sessionId
                    }, sessionToken);

                    const fileId = initResult.file_id;
                    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
                    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

                    for (let i = 0; i < totalChunks; i++) {
                        const start = i * CHUNK_SIZE;
                        const end = Math.min(start + CHUNK_SIZE, file.size);
                        const chunkBlob = file.slice(start, end);

                        const { encryptedChunk, nonce: chunkNonce } = await encryptChunk(chunkBlob, fileKey);
                        const chunkNonceBase64 = toBase64(chunkNonce);

                        let retryCount = 0;
                        const maxRetries = 3;
                        let success = false;

                        while (retryCount < maxRetries && !success) {
                            try {
                                const result = await filesAPI.uploadCollabChunk(
                                    token,
                                    fileId,
                                    i,
                                    encryptedChunk,
                                    chunkNonceBase64,
                                    encryptedChunk.size,
                                    (chunkPercent) => {
                                        const totalPercent = ((i * 100) + chunkPercent) / totalChunks;
                                        setUploadProgress(totalPercent);
                                    },
                                    sessionToken
                                );
                                if (!result.success) throw new Error(`Chunk ${i} failed`);
                                success = true;
                            } catch (err: any) {
                                retryCount++;
                                console.warn(`[COLLAB-CHUNK-UP] Chunk ${i} failed:`, err.message);
                                if (retryCount >= maxRetries) throw err;
                                await sleep(2000 * retryCount);
                            }
                        }
                        setUploadProgress(((i + 1) / totalChunks) * 100);
                    }

                    await filesAPI.finishCollabChunkedUpload(token, fileId, encryptedFilename, encryptedMime, sessionToken);
                } catch (err: any) {
                    throw err;
                }

            } else {
                // === MONOLITHIC COLLAB UPLOAD ===
                const fileBytes = new Uint8Array(await file.arrayBuffer());
                const encryptedData = encryptFileWithCollabKey(fileBytes, fileKey);

                // 3. Assemble multipart
                const formData = new FormData();
                const encryptedFileBlob = new Blob([encryptedData.encryptedFile as any], { type: 'application/octet-stream' });
                formData.append('file', encryptedFileBlob, 'encrypted-collab');
                formData.append('encrypted_file_key', toBase64(encryptedFileKey.encrypted));
                formData.append('file_key_nonce', toBase64(encryptedFileKey.nonce));
                formData.append('file_size', file.size.toString());
                formData.append('encrypted_filename', encryptedFilename);
                formData.append('encrypted_mime_type', encryptedMime);
                if (parentFolderId) {
                    formData.append('folder_id', parentFolderId.toString());
                }

                // 4. Upload with progress
                const xhr = new XMLHttpRequest();
                xhr.open('POST', `${API_BASE_URL}/collab/${token}/upload`);
                xhr.setRequestHeader('x-collab-session', sessionToken);

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
                                reject(new Error(resData.error || 'Upload failed'));
                            } catch {
                                reject(new Error(`Upload failed: status ${xhr.status}`));
                            }
                        }
                    };
                    xhr.onerror = () => reject(new Error('Network error during upload'));
                });

                xhr.send(formData);
                await uploadPromise;
            }

            showToast('File shared successfully', 'success');
            fetchFilesList();
        } catch (err: any) {
            showToast(err.message || 'Upload failed', 'error');
        } finally {
            setUploading(false);
        }
    };

    // Guest Download (supports zero-knowledge streaming and chunking)
    const handleDownloadFile = async (file: any) => {
        if (!collabKey || !token || !sessionToken) return;
        setDownloadingFileId(file.id);

        try {
            await initCrypto();
            const { decryptFileKey, fromBase64 } = await import('@lazybird-inc/nest-crypto');

            // 1. Decrypt file key using the Collab Symmetric Key
            const fileKeyEncrypted = fromBase64(file.file_key_encrypted);
            const fileKeyNonce = fromBase64(file.file_key_nonce);
            const fileKey = decryptFileKey(fileKeyEncrypted, fileKeyNonce, collabKey);

            if (!file.is_chunked) {
                // Non-chunked direct/proxy download.
                // Send the session via header (not query param) to keep it out of
                // server/proxy logs and browser history. Server still accepts the
                // legacy ?session_token= form, so existing links keep working.
                const downloadUrl = `${API_BASE_URL}/collab/${token}/files/${file.id}/raw`;
                const response = await fetch(downloadUrl, {
                    headers: { 'x-collab-session': sessionToken }
                });
                if (!response.ok) throw new Error('Download request failed');

                const blob = await response.blob();
                const { decryptFile } = await import('@lazybird-inc/nest-crypto');
                const decryptedBytes = await decryptFile(blob, null, fileKey);

                const finalBlob = new Blob([decryptedBytes as any], { type: file.mime });
                const url = window.URL.createObjectURL(finalBlob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.name;
                a.click();
                window.URL.revokeObjectURL(url);
            } else {
                // Chunked download
                console.log(`[CollabPortal] Starting chunked download of ${file.name}`);
                const detailsResponse = await fetch(`${API_BASE_URL}/collab/${token}/files/${file.id}`, {
                    headers: { 'x-collab-session': sessionToken! }
                });
                if (!detailsResponse.ok) throw new Error('Failed to retrieve chunk details from server');
                const detailsData = await detailsResponse.json();

                await StreamingDownloader.download({
                    collabToken: token!,
                    collabSession: sessionToken!,
                    fileId: file.id,
                    fileKey,
                    filename: file.name,
                    chunks: detailsData.chunks || []
                });
            }
        } catch (err: any) {
            showToast(err.message || 'Download failed', 'error');
        } finally {
            setDownloadingFileId(null);
        }
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
                    <h2 className="text-xl font-bold text-text-main">Collaboration Error</h2>
                    <p className="text-text-muted text-sm leading-relaxed">{error}</p>
                </div>
            </div>
        );
    }

    // Render dead links (revoked/expired)
    if (deadState) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 relative overflow-hidden bg-background">
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
                            {deadState === 'expired' ? 'Workspace Expired' : 'Workspace Revoked'}
                        </h2>
                        <p className="text-text-muted text-sm mt-2 leading-relaxed">
                            {deadState === 'expired'
                                ? 'This collaborative workspace has expired and is no longer active.'
                                : 'This collaborative workspace link has been revoked by the owner.'}
                        </p>
                    </div>
                    <div className="text-xs text-text-muted mt-2">
                        Powered by <span className="font-semibold text-primary">Nest</span> &bull; Zero-Knowledge Sharing
                    </div>
                </div>
            </div>
        );
    }

    // Render guest login OTP gate
    if (!sessionToken || !collabKey) {
        return (
            <div className="min-h-[100dvh] flex items-center justify-center p-4 relative overflow-hidden bg-background">
                {/* Background Gradients */}
                <div className="absolute top-0 left-0 right-0 h-full overflow-hidden -z-10 pointer-events-none">
                    <div className="absolute top-[-10%] left-[-10%] w-[50%] h-[50%] bg-primary/5 rounded-full blur-[100px]" />
                    <div className="absolute bottom-[-10%] right-[-10%] w-[50%] h-[50%] bg-secondary/5 rounded-full blur-[100px]" />
                </div>

                <div className="w-full max-w-md">
                    <div className="text-center mb-6">
                        <img src={logoImg} alt="Nest Logo" className="w-16 h-16 object-contain mx-auto mb-2 mix-blend-multiply" />
                        <h1 className="text-2xl font-bold text-text-main tracking-tight">{collabName}</h1>
                        <p className="text-text-muted text-xs mt-1">
                            Shared by <span className="text-text-main font-semibold">{hostEmail}</span>
                        </p>
                    </div>

                    <div className="glass-panel p-6 sm:p-8 border-white/60 shadow-xl">
                        {strictMode ? (
                            <div className="space-y-5 text-center">
                                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-2">
                                    <ShieldCheck size={32} className="text-primary" />
                                </div>
                                <p className="text-sm text-text-main font-medium leading-normal">
                                    This folder is in Strict Mode.
                                </p>
                                <p className="text-xs text-text-muted leading-normal">
                                    The owner requires collaborators to have a registered Nest account to access these files.
                                </p>
                                <button
                                    onClick={() => navigate('/login')}
                                    className="glass-button w-full py-3 text-sm font-bold mt-4"
                                >
                                    Log In or Sign Up
                                </button>
                            </div>
                        ) : onboardingStep === 'info' ? (
                            <form onSubmit={handleRequestOtp} className="space-y-5">
                                <p className="text-xs text-text-muted text-center leading-normal">
                                    This is a secure collaborative workspace. Enter your email to receive a temporary access key.
                                </p>
                                <div>
                                    <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                                        Your Email Address
                                    </label>
                                    <input
                                        type="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                        className="w-full glass-input bg-white/50 focus:bg-white text-center text-sm"
                                        placeholder="partner@studiocorp.com"
                                        required
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={submittingOtp}
                                    className="glass-button w-full py-3 text-sm font-bold flex items-center justify-center gap-2"
                                >
                                    {submittingOtp ? 'Sending...' : 'Request Access Key'}
                                </button>
                            </form>
                        ) : (
                            <form onSubmit={handleVerifyOtp} className="space-y-5">
                                <p className="text-xs text-text-muted text-center leading-normal">
                                    We sent a 6-digit access key to <span className="text-text-main font-semibold">{email}</span>.
                                </p>
                                <div>
                                    <label className="block text-xs font-bold text-text-muted uppercase tracking-wider mb-2">
                                        Enter Access Key
                                    </label>
                                    <input
                                        type="text"
                                        value={otpCode}
                                        onChange={(e) => setOtpCode(e.target.value.replace(/[^0-9]/g, ''))}
                                        className="w-full glass-input bg-white/50 focus:bg-white text-center tracking-widest text-lg font-bold"
                                        placeholder="••••••"
                                        maxLength={6}
                                        required
                                    />
                                </div>

                                {otpError && (
                                    <div className="bg-error/10 border border-error/20 text-error rounded-xl p-3.5 text-xs text-center font-medium">
                                        {otpError}
                                    </div>
                                )}

                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={() => setOnboardingStep('info')}
                                        className="px-4 border border-border text-text-main rounded-xl hover:bg-card text-xs font-semibold"
                                    >
                                        Back
                                    </button>
                                    <button
                                        type="submit"
                                        disabled={submittingOtp}
                                        className="glass-button flex-1 py-3 text-sm font-bold flex items-center justify-center gap-2"
                                    >
                                        {submittingOtp ? 'Verifying...' : 'Verify & Enter Workspace'}
                                    </button>
                                </div>
                            </form>
                        )}
                    </div>
                </div>
            </div>
        );
    }

    // Render workspace
    const crumbs = getBreadcrumbs();

    return (
        <div className="min-h-screen bg-background text-text-main flex flex-col font-sans">
            {/* Top Navigation */}
            <header className="h-16 border-b border-border/40 bg-white/40 backdrop-blur-md sticky top-0 z-40 px-6 flex items-center justify-between shadow-sm">
                <div className="flex items-center gap-3">
                    <img src={logoImg} alt="Nest Logo" className="w-8 h-8 object-contain mix-blend-multiply" />
                    <span className="font-bold text-lg tracking-tight text-text-main hidden sm:inline">Nest</span>
                    <span className="hidden sm:inline-block w-px h-4 bg-border" />
                    <span className="hidden sm:inline-flex items-center gap-1.5 text-sm font-medium text-text-muted">
                        <FolderOpen size={15} />
                        Collab folder
                    </span>
                </div>
                <div className="flex items-center gap-4">
                    <div className="hidden sm:flex flex-col text-right">
                        <span className="text-sm font-bold text-text-main">{email}</span>
                    </div>
                    <button
                        onClick={handleSignOut}
                        className="flex items-center gap-2 p-2 text-text-muted hover:text-error hover:bg-error/10 rounded-xl transition-all"
                    >
                        <SignOut size={20} />
                        <span className="text-sm font-medium hidden md:inline">Sign Out</span>
                    </button>
                </div>
            </header>

            {/* Workspace Main */}
            <main className="flex-1 w-full max-w-7xl mx-auto px-4 py-6 flex flex-col h-full relative">
                
                {/* Folder Header & Actions */}
                <div className="relative z-30 mb-4 flex flex-col sm:flex-row sm:items-center justify-between glass-panel p-3 rounded-xl gap-4">
                    <div className="flex-1 min-w-0 mr-4 overflow-x-auto">
                        <nav className="flex items-center text-sm font-medium text-text-muted whitespace-nowrap custom-scrollbar pb-1">
                            <div className="flex items-center">
                                <button
                                    onClick={() => setCurrentFolderId(null)}
                                    className={`transition-colors truncate max-w-[200px] flex items-center gap-1.5 ${currentFolderId === null ? 'text-text-main font-bold' : 'hover:text-primary'}`}
                                >
                                    <FolderOpen size={18} weight={currentFolderId === null ? "fill" : "bold"} className={currentFolderId === null ? "text-primary" : ""} />
                                    <span>{collabName}</span>
                                </button>
                            </div>
                            {crumbs.map((crumb, idx) => {
                                if (crumb.id === null) return null;
                                const isLast = idx === crumbs.length - 1;
                                return (
                                    <div key={idx} className="flex items-center">
                                        <CaretRight size={14} className="mx-2 text-text-muted/50" />
                                        <button
                                            onClick={() => setCurrentFolderId(crumb.id)}
                                            className={`transition-colors truncate max-w-[200px] ${isLast ? 'text-text-main font-bold' : 'hover:text-primary'}`}
                                        >
                                            {crumb.name}
                                        </button>
                                    </div>
                                );
                            })}
                        </nav>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div className="relative">
                            <button
                                onClick={() => setShowNewMenu(!showNewMenu)}
                                className={`flex items-center gap-2.5 bg-primary text-white shadow-md shadow-primary/20 transition-all px-4 py-2 rounded-xl font-bold group border border-white/10 hover:bg-primary/90 hover:shadow-lg ${showNewMenu ? 'bg-primary/90 shadow-lg' : ''}`}
                            >
                                <Plus size={20} weight="bold" className={`text-white transition-transform duration-300 ${showNewMenu ? 'rotate-45' : 'group-hover:rotate-90'}`} />
                                <span>New</span>
                            </button>
                            
                            {showNewMenu && (
                                <>
                                    <div className="fixed inset-0 z-40" onClick={() => setShowNewMenu(false)} />
                                    <div className="absolute top-full right-0 mt-2 bg-white/95 backdrop-blur-md border border-white/40 rounded-2xl shadow-xl z-50 py-2 animate-in fade-in slide-in-from-top-2 duration-200 min-w-[180px]">
                                        <button
                                            onClick={() => {
                                                setShowNewMenu(false);
                                                document.getElementById('file-upload')?.click();
                                            }}
                                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/10 text-text-main transition-colors text-left"
                                        >
                                            <FileArrowUp size={20} className="text-primary" />
                                            <span className="font-medium text-sm">File upload</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                setShowNewMenu(false);
                                                setShowCreateFolder(true);
                                            }}
                                            className="w-full flex items-center gap-3 px-4 py-3 hover:bg-primary/10 text-text-main transition-colors text-left"
                                        >
                                            <FolderPlus size={20} className="text-primary" />
                                            <span className="font-medium text-sm">New Folder</span>
                                        </button>
                                    </div>
                                </>
                            )}
                            
                            <input
                                type="file"
                                multiple
                                className="hidden"
                                id="file-upload"
                                onChange={(e) => {
                                    if (e.target.files && e.target.files.length) {
                                        const selected = Array.from(e.target.files);
                                        setUploadCount(selected.length);
                                        selected.forEach(handleUploadFile);
                                    }
                                }}
                            />
                        </div>
                    </div>
                </div>

                {/* Main Files Table */}
                <div className="glass-panel border-white/60 shadow-sm overflow-hidden flex-1 flex flex-col">
                    <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse">
                            <thead>
                                <tr className="border-b border-border/40 text-[10px] uppercase font-bold text-text-muted bg-black/5">
                                    <th className="p-4">Name</th>
                                    <th className="p-4 w-32">Type</th>
                                    <th className="p-4 w-28">Size</th>
                                    <th className="p-4 w-40">Uploaded</th>
                                    <th className="p-4 w-20 text-center">Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {/* Subfolders List */}
                                {folders.map(folder => (
                                    <tr
                                        key={folder.id}
                                        className="border-b border-border/20 hover:bg-white/30 transition-colors cursor-pointer group"
                                        onDoubleClick={() => setCurrentFolderId(folder.id)}
                                    >
                                        <td className="p-4">
                                            <div className="flex items-center gap-3 min-w-0">
                                                <div className="p-1.5 rounded-md shadow-sm border border-white/20 bg-primary/20 text-primary">
                                                    <FolderOpen size={18} weight="fill" />
                                                </div>
                                                <span className="text-sm font-medium text-text-main group-hover:text-primary transition-colors truncate">{folder.name}</span>
                                            </div>
                                        </td>
                                        <td className="p-4">
                                            <div className="inline-flex px-1.5 py-0.5 rounded-md bg-white/20 border border-white/20 text-[10px] font-medium text-text-muted">FOLDER</div>
                                        </td>
                                        <td className="p-4 text-xs text-text-muted font-medium">—</td>
                                        <td className="p-4 text-xs text-text-muted font-medium">
                                            {new Date(folder.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                        </td>
                                        <td className="p-4 text-center">
                                            {/* Folder Actions */}
                                    <span className="text-text-muted text-xs">-</span>
                                        </td>
                                    </tr>
                                ))}

                                {/* Files List */}
                                {files.map(file => {
                                    const FileTypeIcon = getFileIcon(file.mime || '');
                                    return (
                                        <tr
                                            key={file.id}
                                            className="border-b border-border/20 hover:bg-white/30 transition-colors group"
                                        >
                                            <td className="p-4">
                                                <div className="flex items-center gap-3 min-w-0">
                                                    <div className="p-1.5 rounded-md shadow-sm border border-white/20 bg-white/40 text-text-main">
                                                        <FileTypeIcon size={18} weight="duotone" />
                                                    </div>
                                                    <span className="text-sm font-medium text-text-main group-hover:text-primary truncate max-w-xs sm:max-w-md transition-colors" title={file.name}>
                                                        {file.name}
                                                    </span>
                                                </div>
                                            </td>
                                            <td className="p-4">
                                                <div className="inline-flex px-1.5 py-0.5 rounded-md bg-white/20 border border-white/20 text-[10px] font-medium text-text-muted">
                                                    {formatFileType(file.mime || '', file.name)}
                                                </div>
                                            </td>
                                            <td className="p-4 text-xs text-text-muted font-medium">
                                                {formatBytes(file.size)}
                                            </td>
                                            <td className="p-4 text-xs text-text-muted font-medium">
                                                {new Date(file.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                                            </td>
                                            <td className="p-4 flex items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleDownloadFile(file)}
                                                    disabled={downloadingFileId === file.id}
                                                    title="Download"
                                                    className={`p-1.5 rounded hover:bg-black/10 transition-colors ${downloadingFileId === file.id ? 'opacity-50 cursor-not-allowed' : 'text-text-muted hover:text-primary'}`}
                                                >
                                                    {downloadingFileId === file.id ? (
                                                        <div className="w-4 h-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
                                                    ) : (
                                                        <DownloadSimple size={16} weight="bold" />
                                                    )}
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setRenameFileItem(file);
                                                        setRenameValue(file.name);
                                                    }}
                                                    className="p-1.5 text-text-muted hover:text-primary transition-colors"
                                                    title="Rename"
                                                >
                                                    <PencilSimple size={18} />
                                                </button>
                                                <button
                                                    onClick={() => handleDeleteFile(file.id, file.name)}
                                                    className="p-1.5 text-text-muted hover:text-error transition-colors"
                                                    title="Delete"
                                                >
                                                    <Trash size={18} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}

                                {/* Empty State */}
                                {folders.length === 0 && files.length === 0 && (
                                    <tr>
                                        <td colSpan={5} className="py-16 text-center">
                                            <div className="flex flex-col items-center gap-3">
                                                <Folder size={40} className="text-text-muted/40 animate-pulse" />
                                                <span className="text-sm font-semibold text-text-muted">This folder is empty</span>
                                                <span className="text-xs text-text-muted max-w-xs leading-normal">
                                                    Drag and drop files, or use the buttons above to share files with {hostEmail}.
                                                </span>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </main>

            <footer className="text-center py-6 text-xs text-text-light px-4">
                Secured by Nest · Your files. Your keys.{' '}
                <button
                    onClick={() => navigate('/signup')}
                    className="text-text-muted border-b border-border hover:text-primary transition-colors"
                >
                    Get a free account
                </button>
            </footer>

            {/* Custom Modals */}
            <AnimatePresence>
                {/* Create Folder Modal */}
                {showCreateFolder && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full"
                        >
                            <h3 className="font-bold text-text-main text-lg mb-4">Create New Folder</h3>
                            <form onSubmit={handleCreateFolder} className="space-y-4">
                                <input
                                    type="text"
                                    placeholder="Folder Name"
                                    value={newFolderName}
                                    onChange={(e) => setNewFolderName(e.target.value)}
                                    className="w-full glass-input bg-black/5 border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none"
                                    required
                                    autoFocus
                                />
                                <div className="flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setShowCreateFolder(false)}
                                        className="px-4 py-2 border border-border text-text-main rounded-xl hover:bg-card text-xs font-semibold"
                                        disabled={submittingFolder}
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/80 text-xs font-semibold transition-colors"
                                        disabled={submittingFolder}
                                    >
                                        {submittingFolder ? 'Creating...' : 'Create Folder'}
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}

                {/* Rename File Modal */}
                {renameFileItem && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <motion.div
                            initial={{ opacity: 0, scale: 0.95 }}
                            animate={{ opacity: 1, scale: 1 }}
                            exit={{ opacity: 0, scale: 0.95 }}
                            className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full"
                        >
                            <h3 className="font-bold text-text-main text-lg mb-4">Rename File</h3>
                            <form onSubmit={handleRenameFileSubmit} className="space-y-4">
                                <input
                                    type="text"
                                    placeholder="New filename"
                                    value={renameValue}
                                    onChange={(e) => setRenameValue(e.target.value)}
                                    className="w-full glass-input bg-black/5 border border-white/20 px-3 py-2 text-sm text-text-main focus:outline-none"
                                    required
                                    autoFocus
                                />
                                <div className="flex justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setRenameFileItem(null)}
                                        className="px-4 py-2 border border-border text-text-main rounded-xl hover:bg-card text-xs font-semibold"
                                    >
                                        Cancel
                                    </button>
                                    <button
                                        type="submit"
                                        className="px-4 py-2 bg-primary text-white rounded-xl hover:bg-primary/80 text-xs font-semibold transition-colors"
                                    >
                                        Rename
                                    </button>
                                </div>
                            </form>
                        </motion.div>
                    </div>
                )}

                {/* File Upload Overlay Modal */}
                {uploading && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="bg-card border border-border rounded-2xl p-6 shadow-xl max-w-sm w-full text-center flex flex-col items-center gap-4">
                            <div className="w-10 h-10 border-2 border-primary border-t-transparent animate-spin rounded-full"></div>
                            <div>
                                <h4 className="font-bold text-text-main text-base">Encrypting &amp; uploading {uploadCount > 1 ? 'files' : 'file'}…</h4>
                                <p className="text-xs text-text-muted mt-1">{Math.round(uploadProgress)}% complete</p>
                            </div>
                        </div>
                    </div>
                )}
            </AnimatePresence>
        </div>
    );
};
